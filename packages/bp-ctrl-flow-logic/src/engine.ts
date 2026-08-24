/** BPCtrlFlow engine backed by the shared TaskSpace Processor/CAS authority. */
import { CtrlFlowDsl, type CtrlFlowNodeType, type INodeConfig, type ExecutionContext } from 'depa-behavior-tree';
import type { FlowNodeSpec } from 'instant-ctrl-flow-contract';
import { FLOW_STATE_KEY, FlowCompileError, type CompileExtension } from 'instant-ctrl-flow-logic/browser';
import {
  WorkCtrlFlowEngine,
  WorkCtrlFlowLoadError,
  WaitNodeHandler,
  workFlowCompileExtension,
  type TickController,
  type WorkCtrlFlowDefinition,
} from 'work-ctrl-flow-logic/browser';
import type {
  DurableChildFlowResolver,
  TickOutcome,
  WorkCtrlFlowClock,
  WorkCtrlFlowRuntime,
  WorkCtrlFlowStore,
} from 'work-ctrl-flow-contract';
import type { TaskRecord, TaskSpaceOwnerPort, TaskSpaceSnapshot } from 'task-manager-contract';
import {
  cancelTask,
  claimTask,
  createTaskSpace,
  settleTask,
  startTask,
  waitTask,
} from 'task-manager-logic';
import {
  BP_OPERATION_TARGET,
  bpTaskProfile,
  isBPTaskProfile,
  taskStepResultOf,
  type BPTaskDTO,
  type BPTaskOperation,
  type BPTaskProfile,
  type BPTaskStatus,
  type BPTaskTreeNode,
  type TaskOperationRequest,
  type TaskOperationResult,
  type TaskStepStatus,
} from 'bp-ctrl-flow-contract';
import {
  bpTaskSpaceView,
  bpTaskView,
  bpTerminalStatusOf,
  findBPNode,
  findBPTask,
  listBPTasks,
  taskSpaceDefinitionFromSpec,
} from './taskSpace.js';

type Ctx = ExecutionContext<CtrlFlowNodeType, INodeConfig>;

export class BPCtrlFlowError extends Error {
  readonly name = 'BPCtrlFlowError';

  constructor(readonly code: string, message: string) {
    super(`[${code}] ${message}`);
  }
}

export const defaultBPCtrlFlowTaskDependencies = Object.freeze({
  createTaskSpace,
  claimTask,
  startTask,
  waitTask,
  settleTask,
  cancelTask,
});

export type BPCtrlFlowTaskDependencies = typeof defaultBPCtrlFlowTaskDependencies;

export interface BPCtrlFlowEngineOptions {
  readonly definition: WorkCtrlFlowDefinition;
  readonly store: WorkCtrlFlowStore;
  readonly taskStore: TaskSpaceOwnerPort;
  readonly tasks?: BPCtrlFlowTaskDependencies;
  readonly runtime?: WorkCtrlFlowRuntime;
  readonly clock?: WorkCtrlFlowClock;
  readonly view?: BPCtrlFlowViewAdapter;
  readonly durableChildren?: DurableChildFlowResolver;
  readonly taskLeaseDurationMs?: number;
}

export interface BPCtrlFlowViewAdapter {
  annotateTasks(treeId: string, statuses: Readonly<Record<string, string>>): void | Promise<void>;
}

interface StepHook {
  readonly id: string;
  readonly point: 'before' | 'after';
  readonly src: string;
}

export class BPCtrlFlowEngine {
  readonly #wf: WorkCtrlFlowEngine;
  readonly #taskStore: TaskSpaceOwnerPort;
  readonly #runtime: WorkCtrlFlowRuntime;
  readonly #tasks: BPCtrlFlowTaskDependencies;
  readonly #stepBindings = new Map<string, { readonly taskId: string; readonly hooks: readonly StepHook[] }>();

  constructor(private readonly options: BPCtrlFlowEngineOptions) {
    this.#taskStore = options.taskStore;
    this.#runtime = options.runtime ?? {};
    this.#tasks = options.tasks ?? defaultBPCtrlFlowTaskDependencies;
    if (!Number.isSafeInteger(this.taskLeaseDurationMs) || this.taskLeaseDurationMs <= 0) {
      throw new BPCtrlFlowError('invalid-task-lease', 'taskLeaseDurationMs must be a positive safe integer');
    }

    const compileExtension: CompileExtension = (spec, node, helpers) => {
      if (node.tag !== 'TaskStep') return workFlowCompileExtension(spec, node, helpers);
      const ref = String(node.attrs.task ?? '');
      if (node.attrs.assignTo !== undefined) {
        throw new FlowCompileError('taskstep-assignto-forbidden', `TaskStep #${node.id} must not have assignTo (BP-2)`);
      }
      if (!ref.startsWith('task-space://#')) {
        throw new FlowCompileError('taskstep-ref-malformed', `TaskStep #${node.id} task ref malformed: ${ref}`);
      }
      const taskId = ref.slice('task-space://#'.length);
      this.#stepBindings.set(helpers.meta.key, { taskId, hooks: collectHooks(node) });
      return CtrlFlowDsl.node('bf.TaskStep' as CtrlFlowNodeType, helpers.meta, {
        signalKind: 'task.operated',
        signalKey: taskId,
        taskId,
      } as INodeConfig);
    };

    this.#wf = new WorkCtrlFlowEngine({
      definition: options.definition,
      store: options.store,
      runtime: options.runtime,
      clock: options.clock,
      durableChildren: options.durableChildren,
      expectedForm: 'BPCtrlFlow',
      compileExtension,
      extraHandlers: (controller) => ({
        'bf.TaskStep': new WaitNodeHandler(
          'task-step',
          controller,
          (ctx, handle) => this.#onStepOpen(controller(), ctx, handle.signalKey),
          (ctx, key, result) => this.#onStepConverge(controller(), ctx, key, result),
        ),
      }),
    });

    const spec = this.#wf.spec;
    if (!spec.taskSpace) throw new BPCtrlFlowError('missing-task-space', `BPCtrlFlow bundle ${spec.fqn} requires task.space domain`);
    const direct = new Set(spec.taskSpace.children.map((child) => child.id));
    const walk = (node: FlowNodeSpec): void => {
      if (node.tag === 'TaskStep') {
        const taskId = String(node.attrs.task ?? '').slice('task-space://#'.length);
        if (!direct.has(taskId)) {
          throw new BPCtrlFlowError('task-ref-not-direct-child', `TaskStep #${node.id} must bind a direct child of TaskSpace, got "${taskId}"`);
        }
      }
      node.children.forEach(walk);
      Object.values(node.sections).forEach(walk);
    };
    spec.statements.forEach(walk);
  }

  private get taskLeaseDurationMs(): number {
    return this.options.taskLeaseDurationMs ?? 86_400_000;
  }

  #now(): number {
    return this.options.clock?.now() ?? this.#runtime.now?.() ?? Date.now();
  }

  #nowIso(atMs = this.#now()): string {
    return new Date(atMs).toISOString();
  }

  async #loadSnapshot(treeId: string): Promise<TaskSpaceSnapshot> {
    const snapshot = await this.#taskStore.readSnapshot(treeId);
    if (!snapshot) throw new BPCtrlFlowError('task-space-not-found', `task space for tree ${treeId} not found`);
    return snapshot;
  }

  async #annotate(treeId: string, snapshot: TaskSpaceSnapshot): Promise<void> {
    try {
      const statuses = Object.fromEntries(listBPTasks(bpTaskSpaceView(snapshot)).map((task) => [task.id, task.status]));
      await this.options.view?.annotateTasks(treeId, statuses);
    } catch (error) {
      console.error(`[bp-ctrl-flow view] annotate task.space failed for ${treeId}:`, error);
    }
  }

  async #activateTask(treeId: string, taskId: string, operatorAccount: string): Promise<TaskSpaceSnapshot> {
    let snapshot = await this.#loadSnapshot(treeId);
    let record = requireRecord(snapshot, taskId);
    const view = bpTaskView(record);
    if (view.status === 'Active' && record.status === 'Running') return snapshot;
    if (view.status !== 'NotStarted') {
      throw new BPCtrlFlowError('invalid-task-transition', `cannot activate BP task ${taskId} from ${view.status}`);
    }
    let claim = record.activeClaim;
    if (!claim) {
      if (record.status !== 'Ready') {
        throw new BPCtrlFlowError('task-not-operable', `task ${taskId} is ${record.status}, not Ready`);
      }
      const claimed = await this.#tasks.claimTask({ owner: this.#taskStore }, {
        kind: 'task.claim',
        commandId: commandId(treeId, taskId, 'claim', record.attempt === 0 ? 1 : record.attempt),
        taskSpaceId: treeId,
        taskId,
        expectedRevision: snapshot.revision,
        assigneeRef: view.ownerAccount || operatorAccount,
        claimedAt: this.#nowIso(),
        leaseDurationMs: this.taskLeaseDurationMs,
      }, { maxLeaseDurationMs: this.taskLeaseDurationMs });
      snapshot = claimed.snapshot;
      claim = claimed.receipt.claim;
      record = requireRecord(snapshot, taskId);
    }
    if (record.status !== 'Claimed') {
      throw new BPCtrlFlowError('invalid-task-transition', `task ${taskId} cannot start from ${record.status}`);
    }
    const atMs = this.#now();
    const started = await this.#tasks.startTask({ owner: this.#taskStore }, {
      kind: 'task.start',
      commandId: commandId(treeId, taskId, 'start', nextLifecycleSequence(record)),
      taskSpaceId: treeId,
      expectedRevision: snapshot.revision,
      claim,
      occurredAt: this.#nowIso(atMs),
      profile: nextProfile(record, 'Active', operatorAccount, atMs),
    }, {});
    await this.#annotate(treeId, started.snapshot);
    return started.snapshot;
  }

  async #onStepOpen(controller: TickController, ctx: Ctx, boundId: string): Promise<void> {
    const treeId = controller.snapshot.treeId;
    const snapshot = await this.#loadSnapshot(treeId);
    const space = bpTaskSpaceView(snapshot);
    const node = findBPNode(space, boundId);
    if (!node) throw new BPCtrlFlowError('unresolved-task-ref', `bound task node ${boundId} not found`);
    if (node.kind === 'task') {
      if (node.status === 'NotStarted') await this.#activateTask(treeId, node.id, 'system:bp-ctrl-flow');
    } else {
      const first = listTasksIn(node)
        .sort((left, right) => left.order - right.order)
        .find((task) => task.status === 'NotStarted'
          && snapshot.tasks.find((record) => record.taskId === task.id)?.status === 'Ready');
      if (first) await this.#activateTask(treeId, first.id, 'system:bp-ctrl-flow');
    }
    await this.#runHooks(ctx, 'before');
  }

  async #onStepConverge(
    _controller: TickController,
    ctx: Ctx,
    _key: string,
    _result: import('work-ctrl-flow-contract').TerminalResult,
  ): Promise<void> {
    await this.#runHooks(ctx, 'after');
  }

  async #runHooks(ctx: Ctx, point: 'before' | 'after'): Promise<void> {
    const binding = this.#stepBindings.get(ctx.node.Key);
    if (!binding) return;
    for (const hook of binding.hooks.filter((candidate) => candidate.point === point)) {
      try {
        const handler = await this.options.definition.resolveCode({
          reference: hook.src,
          flowId: this.#wf.spec.fqn,
          nodeId: hook.id,
          baseUri: this.#wf.spec.baseUri,
        });
        const flow = ctx.getVar(FLOW_STATE_KEY) as { current?: unknown } | undefined;
        await handler(this.#runtime, flow?.current, {});
      } catch (error) {
        console.error(`[bp-ctrl-flow hook ${hook.id}:${point}]`, error);
      }
    }
  }

  async start(treeId: string, opts: { readonly input?: Record<string, unknown> } = {}): Promise<TickOutcome> {
    const existing = await this.#taskStore.readSnapshot(treeId);
    if (!existing) {
      await this.#tasks.createTaskSpace({ owner: this.#taskStore }, {
        kind: 'task-space.create',
        commandId: commandId(treeId, 'space', 'create', 0),
        taskSpaceId: treeId,
        definition: taskSpaceDefinitionFromSpec(this.#wf.spec.taskSpace!, treeId),
        createdAt: this.#nowIso(),
      }, {});
    }
    return this.#wf.start(treeId, opts);
  }

  async getOutcome(treeId: string): Promise<TickOutcome | undefined> {
    return this.#wf.getOutcome(treeId);
  }

  async refresh(treeId: string): Promise<TickOutcome> {
    return this.#wf.refresh(treeId);
  }

  async tasks(treeId: string): Promise<BPTaskDTO[]> {
    return listBPTasks(bpTaskSpaceView(await this.#loadSnapshot(treeId)));
  }

  async operateTask(treeId: string, request: TaskOperationRequest): Promise<TaskOperationResult> {
    let snapshot = await this.#loadSnapshot(treeId);
    let space = bpTaskSpaceView(snapshot);
    const task = findBPTask(space, request.taskId);
    if (!task) throw new BPCtrlFlowError('task-not-found', `task ${request.taskId} not found in tree ${treeId}`);
    const target = BP_OPERATION_TARGET[request.operation];
    const terminalReplay = task.status === target && isTaskStepStatus(target);
    if (!terminalReplay) assertBPTransition(task.status, request.operation, request.taskId);

    if (!terminalReplay) {
      snapshot = await this.#applyOperation(treeId, snapshot, request.taskId, request.operation, request.operatorAccount);
      await this.#annotate(treeId, snapshot);
      space = bpTaskSpaceView(snapshot);
    }

    const outcome = await this.#wf.getOutcome(treeId);
    if (!outcome) throw new BPCtrlFlowError('tree-not-found', `tree ${treeId} not found`);
    const handle = outcome.openWaitHandles.find(
      (candidate) => candidate.waitKind === 'task-step' && coversTask(space, candidate.signalKey, request.taskId),
    );
    if (handle) {
      const bound = findBPNode(space, handle.signalKey);
      if (!bound) throw new BPCtrlFlowError('unresolved-task-ref', `open TaskStep references missing task node ${handle.signalKey}`);
      const terminal = bpTerminalStatusOf(bound);
      if (terminal) {
        if (!isTaskStepStatus(terminal)) {
          throw new BPCtrlFlowError('invalid-task-terminal-status', `TaskStep ${handle.nodeKey} resolved with invalid status ${terminal}`);
        }
        const flowState = outcome.vars[FLOW_STATE_KEY] as { current?: unknown } | undefined;
        const result = taskStepResultOf(handle.signalKey, terminal, flowState?.current);
        const advanced = await this.#wf.resume(treeId, {
          signalKind: handle.signalKind,
          signalKey: handle.signalKey,
          resumeToken: handle.resumeToken,
          outcome: 'Success',
          payload: result,
        });
        return { taskStatus: target, outcome: advanced, advancedFlow: true };
      }
      if (bound.kind === 'group') {
        const latest = await this.#loadSnapshot(treeId);
        const next = listTasksIn(findBPNode(bpTaskSpaceView(latest), bound.id) as BPTaskTreeNode)
          .sort((left, right) => left.order - right.order)
          .find((candidate) => candidate.status === 'NotStarted'
            && latest.tasks.find((record) => record.taskId === candidate.id)?.status === 'Ready');
        if (next) await this.#activateTask(treeId, next.id, 'system:bp-ctrl-flow');
      }
    }
    const current = await this.#wf.getOutcome(treeId);
    return { taskStatus: target, outcome: current!, advancedFlow: false };
  }

  async #applyOperation(
    treeId: string,
    snapshot: TaskSpaceSnapshot,
    taskId: string,
    operation: BPTaskOperation,
    operatorAccount: string,
  ): Promise<TaskSpaceSnapshot> {
    let record = requireRecord(snapshot, taskId);
    const atMs = this.#now();
    const occurredAt = this.#nowIso(atMs);
    const target = BP_OPERATION_TARGET[operation];
    if (operation === 'start') return this.#activateTask(treeId, taskId, operatorAccount);
    if (operation === 'delegate') {
      const claim = requireClaim(record);
      return (await this.#tasks.waitTask({ owner: this.#taskStore }, {
        kind: 'task.wait',
        commandId: commandId(treeId, taskId, operation, nextLifecycleSequence(record)),
        taskSpaceId: treeId,
        expectedRevision: snapshot.revision,
        claim,
        occurredAt,
        reason: 'bp.delegate',
        profile: nextProfile(record, target, operatorAccount, atMs),
      }, {})).snapshot;
    }
    if (operation === 'reactivate') {
      const claim = requireClaim(record);
      return (await this.#tasks.startTask({ owner: this.#taskStore }, {
        kind: 'task.start',
        commandId: commandId(treeId, taskId, operation, nextLifecycleSequence(record)),
        taskSpaceId: treeId,
        expectedRevision: snapshot.revision,
        claim,
        occurredAt,
        profile: nextProfile(record, target, operatorAccount, atMs),
      }, {})).snapshot;
    }
    if (operation === 'abandon') {
      return (await this.#tasks.cancelTask({ owner: this.#taskStore }, {
        kind: 'task.cancel',
        commandId: commandId(treeId, taskId, operation, nextLifecycleSequence(record)),
        taskSpaceId: treeId,
        taskId,
        expectedRevision: snapshot.revision,
        cancelledAt: occurredAt,
        reason: 'bp.abandon',
        ...(record.activeClaim === null ? {} : { claim: record.activeClaim }),
        profile: nextProfile(record, target, operatorAccount, atMs),
      }, {})).snapshot;
    }
    const claim = requireClaim(record);
    if (operation !== 'complete' && operation !== 'refuse' && operation !== 'forward') {
      throw new BPCtrlFlowError('invalid-task-operation', `unsupported BP operation ${operation}`);
    }
    return (await this.#tasks.settleTask({ owner: this.#taskStore }, {
      kind: 'task.settle',
      commandId: commandId(treeId, taskId, operation, nextLifecycleSequence(record)),
      taskSpaceId: treeId,
      expectedRevision: snapshot.revision,
      claim,
      occurredAt,
      outputArtifacts: [],
      result: { bpOutcome: target },
      profile: nextProfile(record, target, operatorAccount, atMs),
    }, {})).snapshot;
  }
}

function requireRecord(snapshot: TaskSpaceSnapshot, taskId: string): TaskRecord {
  const record = snapshot.tasks.find((candidate) => candidate.taskId === taskId);
  if (!record) throw new BPCtrlFlowError('task-not-found', `task ${taskId} not found`);
  if (record.definition.kind !== 'task' || !isBPTaskProfile(record.profile)) {
    throw new BPCtrlFlowError('invalid-task-profile', `task ${taskId} is not a BP leaf task`);
  }
  return record;
}

function requireClaim(record: TaskRecord) {
  if (!record.activeClaim) throw new BPCtrlFlowError('claim-required', `task ${record.taskId} has no live claim`);
  return record.activeClaim;
}

function nextProfile(
  record: TaskRecord,
  status: BPTaskStatus,
  operatorAccount: string,
  atMs: number,
): BPTaskProfile {
  if (!isBPTaskProfile(record.profile)) {
    throw new BPCtrlFlowError('invalid-task-profile', `task ${record.taskId} has no BP profile`);
  }
  const prior = record.profile.facts;
  const terminal = status === 'Done' || status === 'Refused' || status === 'Forwarded' || status === 'Abandoned';
  return bpTaskProfile({
    ownerAccount: prior.ownerAccount,
    status,
    operatorAccount,
    transferredBy: status === 'Delegated' || status === 'Forwarded' ? operatorAccount : prior.transferredBy,
    startedAtMs: status === 'Active' ? (prior.startedAtMs ?? atMs) : prior.startedAtMs,
    endedAtMs: terminal ? atMs : prior.endedAtMs,
    lifecycleSequence: prior.lifecycleSequence + 1,
  });
}

function assertBPTransition(from: BPTaskStatus, operation: BPTaskOperation, taskId: string): void {
  const allowed: Readonly<Record<BPTaskStatus, readonly BPTaskOperation[]>> = {
    NotStarted: ['start', 'abandon'],
    Active: ['complete', 'refuse', 'forward', 'delegate', 'abandon'],
    Delegated: ['reactivate', 'abandon'],
    Forwarded: [],
    Done: [],
    Refused: [],
    Abandoned: [],
  };
  if (!allowed[from].includes(operation)) {
    throw new BPCtrlFlowError('invalid-task-transition', `task ${taskId} cannot apply ${operation} from ${from}`);
  }
}

function isTaskStepStatus(status: string): status is TaskStepStatus {
  return status === 'Done' || status === 'Refused' || status === 'Forwarded' || status === 'Abandoned';
}

function listTasksIn(node: BPTaskTreeNode): BPTaskDTO[] {
  if (node.kind === 'task') return [node];
  return node.children.flatMap(listTasksIn);
}

function coversTask(space: ReturnType<typeof bpTaskSpaceView>, boundId: string, taskId: string): boolean {
  if (boundId === taskId) return true;
  const bound = findBPNode(space, boundId);
  return bound?.kind === 'group' && listTasksIn(bound).some((task) => task.id === taskId);
}

function commandId(treeId: string, taskId: string, operation: string, sequence: number): string {
  return `bp:${encodeURIComponent(treeId)}:${encodeURIComponent(taskId)}:${operation}:${sequence}`;
}

function nextLifecycleSequence(record: TaskRecord): number {
  if (!isBPTaskProfile(record.profile)) {
    throw new BPCtrlFlowError('invalid-task-profile', `task ${record.taskId} has no BP profile`);
  }
  return record.profile.facts.lifecycleSequence + 1;
}

function collectHooks(node: FlowNodeSpec): StepHook[] {
  const hooksSection = node.sections['Hooks'];
  if (!hooksSection) return [];
  return hooksSection.children
    .filter((hook) => hook.tag === 'Hook')
    .map((hook) => ({
      id: hook.id ?? '',
      point: (hook.attrs.point as 'before' | 'after') ?? 'before',
      src: String(hook.attrs.src ?? ''),
    }));
}

export { WorkCtrlFlowLoadError };
