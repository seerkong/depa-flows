/**
 * WorkFlow 引擎（WF-1~WF-6）。
 *
 * 定义 / 实例分离：
 *   start 时把定义 bundle 物化为 instancesDir/<treeId>/ 的冻结拷贝，实例终身只从拷贝编译执行；
 *   定义后续修改不影响在途实例（重放的 invocationKey 依赖树结构，这是正确性要求）。
 *
 * 执行模型：每个 tick 从快照出发**重放整棵树**——
 *   - 已完成动作按 invocationKey 命中 nodeResults → 直接返回记录结果（副作用不重复）；
 *   - 已收敛等待命中 waitResults → 写回 payload 并返回记录结果；
 *   - 未收敛的可中断节点 → 登记 WaitHandle、通知 TickController 挂起，tick 落快照返回 WAITING。
 * 恢复唯一入口是 ResumeSignal（resumeToken + appliedResumeSignals 双重幂等，WF-4）。
 * 重放确定性假设（v1，见 mission 决策）：控制流分支只依赖 vars/config/input。
 *
 * status 标注：每 tick 收尾把节点状态视图写回实例 manifest.xnl 的 { } 属性块
 * （行为树枚举；Until 附 iterations；Tree 根附 runStatus/tickNo）。快照是真源，标注是单向视图。
 */
import {
  CtrlFlowDsl,
  BehaviorTreeEngine,
  ActionHandlerRegistry,
  BehaviorResult,
  BehaviorTreeNodeKind,
  BehaviorTreeNodeStatus,
  evaluateExpression,
  LogActionHandler,
  AssertActionHandler,
  SleepActionHandler,
  type ActionHandler,
  type BehaviorTreeData,
  type BehaviorTreeNode,
  type ExecutionContext,
  type INodeConfig,
  type CtrlFlowNodeType,
} from 'depa-behavior-tree';
import type { CtrlFlowResolver, FlowBundleSpec, FlowCodeResolver } from 'instant-flow-contract';
import {
  compileBundle,
  FlowCompileError,
  createFlowExecutionState,
  createFlowHandlers,
  flowStateOf,
  FLOW_STATE_KEY,
  runInstantFlowSpec,
  type FlowBranchDecision,
  type FlowDecisionHooks,
  type CompileExtension,
} from 'instant-flow-logic/browser';
import type {
  CompositeInvocationFact,
  CompositePrimitive,
  LaneFact,
  NodeAnnotation,
  NodeViewStatus,
  ResumeSignal,
  TerminalResult,
  TickOutcome,
  TreeViewAnnotation,
  WaitHandle,
  WaitKind,
  WorkFlowRuntime,
  WorkFlowClock,
  WorkFlowSnapshot,
  WorkFlowStartOptions,
  WorkFlowStore,
  WorkFlowOrchestrationFacts,
  DurableChildFlowResolver,
} from 'work-flow-contract';
import { WORKFLOW_SNAPSHOT_SCHEMA } from 'work-flow-contract';

type Ctx = ExecutionContext<CtrlFlowNodeType, INodeConfig>;
type CtrlNode = BehaviorTreeNode<CtrlFlowNodeType, INodeConfig>;

const WAIT_TAGS: Record<string, WaitKind> = {
  ExternalJob: 'external-job',
  Timer: 'timer',
  TaskStep: 'task-step',
};

function emptyOrchestrationFacts(): WorkFlowOrchestrationFacts {
  return {
    attempts: {},
    deadlines: {},
    lanes: {},
    winners: {},
    cancellations: {},
    composites: {},
  };
}

function ensureOrchestrationFacts(snapshot: WorkFlowSnapshot): WorkFlowOrchestrationFacts {
  const facts = (snapshot.orchestration ??= emptyOrchestrationFacts());
  facts.composites ??= {};
  return facts;
}

/** WorkFlow 层的编译扩展：可中断节点 → wf.* Type（BizProcess 复用并在其上扩展 TaskStep） */
export const workFlowCompileExtension: CompileExtension = (_spec, node, { meta, attrs, compileStatements }) => {
  const kind = WAIT_TAGS[node.tag];
  if (!kind) {
    if (!['Retry', 'Timeout', 'ForEach', 'Parallel', 'Race', 'CallFlow'].includes(node.tag)) return null;
    const section = node.tag === 'Parallel' ? node.sections.Lanes : node.tag === 'Race' ? node.sections.Candidates : undefined;
    const items = section?.children.map((item) => ({
      id: item.id ?? item.tag,
      bodyPlan: compileStatements(item.children, `${meta.key}.${item.id ?? item.tag}`),
    }));
    return CtrlFlowDsl.node(
      'wf.Composite' as CtrlFlowNodeType,
      meta,
      {
        primitive: node.tag,
        bodyId: node.tag === 'Retry' ? 'attempt:1' : 'body',
        ...attrs,
        items,
        bodyPlan: node.tag === 'CallFlow' ? undefined : compileStatements(node.children, `${meta.key}.__body`),
      } as INodeConfig,
    );
  }
  if (node.tag === 'TaskStep') {
    // WorkFlow 不含 TaskStep（BP-5：由 biz-process 的扩展接管）
    throw new FlowCompileError('interruptible-in-work', `<TaskStep #${node.id}> illegal in WorkFlow`);
  }
  return CtrlFlowDsl.node(`wf.${node.tag}` as CtrlFlowNodeType, meta, { ...attrs, __waitKind: kind } as INodeConfig);
};

/** tick 内挂起控制器 */
export class TickController {
  suspended: WaitHandle[] = [];
  /** 挂起后惰性执行过的节点（视图中应显示 INIT，见 computeView） */
  inertKeys = new Set<string>();
  constructor(
    public snapshot: WorkFlowSnapshot,
    public runtime: WorkFlowRuntime,
  ) {}
  now(): number {
    return this.runtime.now?.() ?? Date.now();
  }
  /** invocationKey 计数（每 tick 重置，重放确定性来源） */
  private visitCounts = new Map<string, number>();
  private invocationScopes: string[] = [];
  invocationKeyFor(nodeKey: string): string {
    const scopedNodeKey = [...this.invocationScopes, nodeKey].join('/');
    const n = this.visitCounts.get(scopedNodeKey) ?? 0;
    this.visitCounts.set(scopedNodeKey, n + 1);
    return `${scopedNodeKey}#${n}`;
  }
  async withinInvocationScope<T>(scope: string, run: () => Promise<T>): Promise<T> {
    this.invocationScopes.push(scope);
    try {
      return await run();
    } finally {
      this.invocationScopes.pop();
    }
  }
}

type Registry = ActionHandlerRegistry<CtrlFlowNodeType, INodeConfig>;

/**
 * Snapshot-driven actor for durable composite bodies. Product primitive policy
 * is deliberately kept outside this scheduler foundation.
 */
export class DurableCompositeScheduler implements ActionHandler<CtrlFlowNodeType, INodeConfig> {
  constructor(
    private controller: () => TickController,
    private registryFor: (
      controller: () => TickController,
      persist?: (snapshot: WorkFlowSnapshot) => Promise<void>,
    ) => Registry,
    private persist: (snapshot: WorkFlowSnapshot) => Promise<void>,
    private definition: WorkFlowDefinition,
    private durableChildren?: DurableChildFlowResolver,
  ) {}

  async execute(ctx: Ctx): Promise<BehaviorResult> {
    const controller = this.controller();
    if (controller.suspended.length > 0) {
      controller.inertKeys.add(ctx.node.Key);
      return BehaviorResult.Failure;
    }

    const config = ctx.node.Config as {
      primitive: CompositePrimitive;
      bodyId: string;
      bodyPlan?: CtrlNode;
      maxAttempts?: number;
      backoffMs?: number;
      timeoutMs?: number;
      src?: string;
      when?: string;
      concurrency?: number;
      config?: Record<string, unknown>;
      mode?: 'first-success' | 'first-completed';
      flow?: string;
      items?: Array<{ id: string; bodyPlan: CtrlNode }>;
    };
    const invocationKey = controller.invocationKeyFor(ctx.node.Key);
    let fact = controller.snapshot.orchestration.composites[invocationKey];
    if (!fact) {
      fact = {
        invocationKey,
        primitive: config.primitive,
        bodyId: config.bodyId,
        status: 'Open',
        input: flowStateOf(ctx).current,
        cursor: 0,
        updatedAtMs: controller.now(),
      };
      controller.snapshot.orchestration.composites[invocationKey] = fact;
      await this.persist(controller.snapshot);
    }
    if (fact.status === 'Completed') return BehaviorResult.Success;
    if (fact.status === 'Failed' || fact.status === 'Cancelled') return BehaviorResult.Failure;

    if (config.primitive === 'CallFlow') {
      return this.runCallFlow(ctx, invocationKey, fact, config);
    }
    if (config.primitive === 'ForEach' || config.primitive === 'Parallel' || config.primitive === 'Race') {
      return this.runLanes(ctx, invocationKey, fact, config);
    }
    if (config.primitive === 'Timeout') {
      const deadline = controller.snapshot.orchestration.deadlines[invocationKey] ??= {
        invocationKey,
        deadlineAtMs: controller.now() + Math.max(0, Number(config.timeoutMs ?? 0)),
        status: 'Open',
      };
      this.ensureCompositeTimer(controller, invocationKey, deadline.deadlineAtMs, 'timeout');
      if (deadline.deadlineAtMs <= controller.now()) {
        deadline.status = 'Expired';
        fact.status = 'Cancelled';
        controller.snapshot.orchestration.cancellations[invocationKey] = {
          invocationKey,
          reason: 'DeadlineExceeded',
          atMs: controller.now(),
        };
        this.cancelScopedWaits(controller, invocationKey, 'DeadlineExceeded');
        await this.persist(controller.snapshot);
        return BehaviorResult.Failure;
      }
    }

    const body = config.bodyPlan;
    if (!body) {
      fact.status = 'Completed';
      fact.updatedAtMs = controller.now();
      await this.persist(controller.snapshot);
      return BehaviorResult.Success;
    }

    const attempt = controller.snapshot.orchestration.attempts[invocationKey] ??= {
      invocationKey,
      attempt: 1,
      maxAttempts: Math.max(1, Number(config.maxAttempts ?? 1)),
      status: 'Open',
    };
    if (config.primitive === 'Retry' && attempt.nextAttemptAtMs && attempt.nextAttemptAtMs > controller.now()) {
      return this.openSchedulerTimer(controller, invocationKey, attempt.nextAttemptAtMs);
    }
    if (config.primitive === 'Retry' && attempt.nextAttemptAtMs) {
      flowStateOf(ctx).fault = undefined;
      flowStateOf(ctx).current = fact.input;
      attempt.nextAttemptAtMs = undefined;
    }
    const bodyId = config.primitive === 'Retry' ? `attempt:${attempt.attempt}` : fact.bodyId;
    const result = await controller.withinInvocationScope(
      `${invocationKey}/${bodyId}`,
      () => runScheduledBody(
        structuredCloneTree(body),
        this.registryFor(() => controller),
        controller,
        ctx.runtime,
        flowStateOf(ctx),
      ),
    );
    if (config.primitive === 'Retry' && controller.suspended.length === 0 && result !== BehaviorResult.Success
      && attempt.attempt < attempt.maxAttempts) {
      attempt.status = 'Failed';
      attempt.attempt += 1;
      attempt.status = 'Open';
      attempt.nextAttemptAtMs = controller.now() + Math.max(0, Number(config.backoffMs ?? 0));
      fact.bodyId = `attempt:${attempt.attempt}`;
      fact.status = 'Waiting';
      fact.updatedAtMs = controller.now();
      await this.persist(controller.snapshot);
      return attempt.nextAttemptAtMs > controller.now()
        ? this.openSchedulerTimer(controller, invocationKey, attempt.nextAttemptAtMs)
        : BehaviorResult.Failure;
    }
    fact.status = controller.suspended.length > 0
      ? 'Waiting'
      : result === BehaviorResult.Success
        ? 'Completed'
        : 'Failed';
    attempt.status = fact.status === 'Waiting'
      ? 'Open'
      : fact.status === 'Completed'
        ? 'Completed'
        : 'Failed';
    if (config.primitive === 'Timeout' && fact.status !== 'Waiting') {
      this.closeCompositeTimer(controller, invocationKey, 'timeout');
      const deadline = controller.snapshot.orchestration.deadlines[invocationKey];
      if (deadline && fact.status === 'Completed') deadline.status = 'Completed';
    }
    fact.updatedAtMs = controller.now();
    await this.persist(controller.snapshot);
    return controller.suspended.length > 0 ? BehaviorResult.Failure : result;
  }

  private async runLanes(
    ctx: Ctx,
    invocationKey: string,
    fact: CompositeInvocationFact,
    config: {
      primitive: CompositePrimitive;
      src?: string;
      when?: string;
      mode?: 'first-success' | 'first-completed';
      concurrency?: number;
      config?: Record<string, unknown>;
      bodyPlan?: CtrlNode;
      items?: Array<{ id: string; bodyPlan: CtrlNode }>;
    },
  ): Promise<BehaviorResult> {
    const c = this.controller();
    let items = config.items ?? [];
    if (config.primitive === 'ForEach') {
      const existing = Object.values(c.snapshot.orchestration.lanes)
        .filter((lane) => lane.invocationKey === invocationKey)
        .sort((a, b) => Number(a.laneId) - Number(b.laneId));
      let selected: unknown[];
      if (existing.length > 0) {
        selected = existing.map((lane) => lane.item);
      } else {
        const selector = await this.definition.resolveCode({
          reference: String(config.src ?? config.when ?? ''),
          flowId: this.definition.spec.fqn,
          nodeId: ctx.node.Key,
          baseUri: this.definition.spec.baseUri,
        });
        const value = await selector(c.runtime, fact.input, config.config ?? {});
        if (!Array.isArray(value)) throw new TypeError('ForEach selector must return an array');
        selected = value;
      }
      items = selected.map((_item, index) => ({ id: String(index), bodyPlan: config.bodyPlan! }));
      for (let i = 0; i < selected.length; i++) {
        c.snapshot.orchestration.lanes[`${invocationKey}/${i}`] ??= {
          invocationKey,
          laneId: String(i),
          bodyId: `item:${i}`,
          item: selected[i],
          flowState: createFlowExecutionState(selected[i]),
          status: 'Open',
        };
      }
    } else {
      for (const item of items) c.snapshot.orchestration.lanes[`${invocationKey}/${item.id}`] ??= {
        invocationKey,
        laneId: item.id,
        bodyId: `lane:${item.id}`,
        flowState: createFlowExecutionState(fact.input),
        status: 'Open',
      };
    }

    const executeLane = async (item: { id: string; bodyPlan: CtrlNode }, signal?: AbortSignal) => {
      // A lane can only publish through commitLaneOutcome. Late race losers keep
      // running against this detached copy and cannot mutate persisted facts.
      const workingSnapshot = structuredClone(c.snapshot);
      const lane = workingSnapshot.orchestration.lanes[`${invocationKey}/${item.id}`];
      const laneState = (lane.flowState ??= createFlowExecutionState(
        config.primitive === 'ForEach' ? lane.item : fact.input,
      )) as ReturnType<typeof createFlowExecutionState>;
      laneState.fault = undefined;
      const laneController = new TickController(workingSnapshot, c.runtime);
      const laneRuntime = signal
        ? Object.assign(Object.create((ctx.runtime ?? {}) as object), { abortSignal: signal })
        : ctx.runtime;
      let result = BehaviorResult.Failure;
      try {
        result = await laneController.withinInvocationScope(
          `${invocationKey}/${lane.bodyId}`,
          () => runScheduledBody(
            structuredCloneTree(item.bodyPlan),
            this.registryFor(() => laneController, async () => {}),
            laneController,
            laneRuntime,
            laneState,
          ),
        );
      } catch {
        result = BehaviorResult.Failure;
      }
      if (laneController.suspended.length > 0) {
        return { lane, snapshot: workingSnapshot, suspensions: laneController.suspended };
      }
      lane.status = result === BehaviorResult.Success ? 'Completed' : 'Failed';
      lane.output = laneState.current;
      return { lane, snapshot: workingSnapshot, suspensions: laneController.suspended };
    };

    const ready = items.filter((item) =>
      c.snapshot.orchestration.lanes[`${invocationKey}/${item.id}`].status === 'Open');
    const concurrency = config.primitive === 'ForEach'
      ? Math.max(1, Math.floor(Number(config.concurrency ?? 1)))
      : Math.max(1, ready.length);
    const completed: Awaited<ReturnType<typeof executeLane>>[] = [];
    const isRaceWinner = (lane: LaneFact) =>
      (config.mode ?? 'first-success') === 'first-completed'
        ? lane.status === 'Completed' || lane.status === 'Failed'
        : lane.status === 'Completed';
    for (let offset = 0; offset < ready.length; offset += concurrency) {
      const batchItems = ready.slice(offset, offset + concurrency);
      const controllers = batchItems.map(() => new AbortController());
      const batch = batchItems.map((item, index) =>
        executeLane(item, controllers[index].signal).catch(() => {
          const failedSnapshot = structuredClone(c.snapshot);
          const lane = failedSnapshot.orchestration.lanes[`${invocationKey}/${item.id}`];
          lane.status = 'Failed';
          return { lane, snapshot: failedSnapshot, suspensions: [] as WaitHandle[] };
        }));
      if (config.primitive === 'Race') {
        const tagged = batch.map((promise, index) => promise.then((value) => ({ index, value })));
        const pending = new Map(tagged.map((promise, index) => [index, promise]));
        while (pending.size > 0) {
          const settled = await Promise.race(pending.values());
          pending.delete(settled.index);
          completed.push(settled.value);
          this.commitLaneOutcome(c.snapshot, invocationKey, settled.value);
          if (isRaceWinner(settled.value.lane)) {
            controllers.forEach((controller, index) => {
              if (index !== settled.index) controller.abort();
            });
            break;
          }
        }
      } else {
        const settled = await Promise.all(batch);
        completed.push(...settled);
        for (const outcome of settled) this.commitLaneOutcome(c.snapshot, invocationKey, outcome);
      }
      if (config.primitive === 'Race' && completed.some(({ lane }) => isRaceWinner(lane))) break;
    }
    c.suspended.push(...completed.flatMap(({ suspensions }) => suspensions));

    if (config.primitive === 'Race') {
      const settled = completed.find(({ lane }) => isRaceWinner(lane));
      if (settled) {
        const lane = settled.lane;
        c.snapshot.orchestration.winners[invocationKey] = {
          invocationKey,
          winnerId: lane.laneId,
          mode: config.mode ?? 'first-success',
        };
        for (const loser of Object.values(c.snapshot.orchestration.lanes)) {
          if (loser.invocationKey === invocationKey && loser.laneId !== lane.laneId) {
            loser.status = 'Cancelled';
            c.snapshot.orchestration.cancellations[`${invocationKey}/${loser.laneId}`] = {
              invocationKey: `${invocationKey}/${loser.laneId}`,
              reason: 'RaceLost',
              atMs: c.now(),
            };
          }
        }
        this.cancelScopedWaits(c, invocationKey, 'RaceLost', lane.laneId);
        flowStateOf(ctx).current = { winner: lane.laneId, output: lane.output };
        const wonSuccessfully = lane.status === 'Completed';
        fact.status = wonSuccessfully ? 'Completed' : 'Failed';
        await this.persist(c.snapshot);
        return wonSuccessfully ? BehaviorResult.Success : BehaviorResult.Failure;
      }
    }
    const lanes = Object.values(c.snapshot.orchestration.lanes)
      .filter((lane) => lane.invocationKey === invocationKey)
      .sort((a, b) => a.laneId.localeCompare(b.laneId, undefined, { numeric: true }));
    if (c.suspended.length > 0 || lanes.some((lane) => lane.status === 'Open')) {
      fact.status = 'Waiting';
      await this.persist(c.snapshot);
      return BehaviorResult.Failure;
    }
    const success = config.primitive === 'Race'
      ? false
      : lanes.every((lane) => lane.status === 'Completed');
    if (success) {
      flowStateOf(ctx).current = config.primitive === 'ForEach'
        ? lanes.map((lane) => lane.output)
        : Object.fromEntries(lanes.map((lane) => [lane.laneId, lane.output]));
    }
    fact.status = success ? 'Completed' : 'Failed';
    await this.persist(c.snapshot);
    return success ? BehaviorResult.Success : BehaviorResult.Failure;
  }

  private commitLaneOutcome(
    snapshot: WorkFlowSnapshot,
    invocationKey: string,
    outcome: {
      lane: LaneFact;
      snapshot: WorkFlowSnapshot;
      suspensions: WaitHandle[];
    },
  ): void {
    const laneKey = `${invocationKey}/${outcome.lane.laneId}`;
    const current = snapshot.orchestration.lanes[laneKey];
    if (current.status === 'Cancelled') return;
    snapshot.orchestration.lanes[laneKey] = structuredClone(outcome.lane);

    const scope = `${invocationKey}/${outcome.lane.bodyId}/`;
    this.mergeScopedRecord(snapshot.nodeResults, outcome.snapshot.nodeResults, scope);
    this.mergeScopedRecord(snapshot.waitResults, outcome.snapshot.waitResults, scope);
    this.mergeScopedRecord(snapshot.branchDecisions, outcome.snapshot.branchDecisions, scope);
    this.mergeScopedRecord(snapshot.orchestration.attempts, outcome.snapshot.orchestration.attempts, scope);
    this.mergeScopedRecord(snapshot.orchestration.deadlines, outcome.snapshot.orchestration.deadlines, scope);
    this.mergeScopedRecord(snapshot.orchestration.lanes, outcome.snapshot.orchestration.lanes, scope);
    this.mergeScopedRecord(snapshot.orchestration.winners, outcome.snapshot.orchestration.winners, scope);
    this.mergeScopedRecord(snapshot.orchestration.cancellations, outcome.snapshot.orchestration.cancellations, scope);
    this.mergeScopedRecord(snapshot.orchestration.composites, outcome.snapshot.orchestration.composites, scope);

    snapshot.openWaitHandles = this.mergeScopedHandles(
      snapshot.openWaitHandles,
      outcome.snapshot.openWaitHandles,
      scope,
    );
    snapshot.closedWaitHandles = this.mergeScopedHandles(
      snapshot.closedWaitHandles,
      outcome.snapshot.closedWaitHandles,
      scope,
    );
    snapshot.appliedResumeSignals = [...new Set([
      ...snapshot.appliedResumeSignals,
      ...outcome.snapshot.appliedResumeSignals,
    ])];
  }

  private mergeScopedRecord<T>(
    target: Record<string, T>,
    source: Record<string, T>,
    scope: string,
  ): void {
    for (const key of Object.keys(target)) {
      if (key.startsWith(scope)) delete target[key];
    }
    for (const [key, value] of Object.entries(source)) {
      if (key.startsWith(scope)) target[key] = structuredClone(value);
    }
  }

  private mergeScopedHandles(
    target: WaitHandle[],
    source: WaitHandle[],
    scope: string,
  ): WaitHandle[] {
    return [
      ...target.filter((handle) => !handle.invocationKey.startsWith(scope)),
      ...source.filter((handle) => handle.invocationKey.startsWith(scope)).map((handle) => structuredClone(handle)),
    ];
  }

  private async runCallFlow(
    ctx: Ctx,
    invocationKey: string,
    fact: CompositeInvocationFact,
    config: { flow?: string },
  ): Promise<BehaviorResult> {
    const c = this.controller();
    const reference = String(config.flow ?? '');
    const parsed = /^(instant-flow|work-flow|biz-process):\/\/([\w.-]+)$/.exec(reference);
    if (!parsed) throw new WorkFlowLoadError(['invalid-flow-ref'], `CallFlow reference is invalid: ${reference}`);
    const [, scheme, expectedFqn] = parsed;
    if (this.definition.resolveFlow) {
      const target = await this.definition.resolveFlow(reference, this.definition.spec);
      const expectedScheme = target.spec.form === 'InstantFlow'
        ? 'instant-flow'
        : target.spec.form === 'WorkFlow'
          ? 'work-flow'
          : 'biz-process';
      if (scheme !== expectedScheme || target.spec.fqn !== expectedFqn) {
        throw new WorkFlowLoadError(
          ['flow-resolution-mismatch'],
          `CallFlow ${reference} resolved to ${target.spec.form} #${target.spec.fqn}`,
        );
      }
      if (target.spec.form === 'InstantFlow') {
        flowStateOf(ctx).current = await runInstantFlowSpec(target.spec, {
          input: fact.input,
          runtime: c.runtime,
          resolveCode: target.resolveCode,
          resolveFlow: this.definition.resolveFlow,
        });
        fact.status = 'Completed';
        await this.persist(c.snapshot);
        return BehaviorResult.Success;
      }
    }
    if (!this.durableChildren) throw new WorkFlowLoadError(
      ['durable-child-resolver-required'],
      `CallFlow ${reference} targets a durable flow and requires durableChildren`,
    );
    fact.childTreeId ??= `${c.snapshot.treeId}:${invocationKey}:child`;
    const child = fact.status === 'Open'
      ? await this.durableChildren.start(reference, fact.childTreeId, fact.input)
      : await this.durableChildren.inspect(reference, fact.childTreeId);
    if (child.treeId !== fact.childTreeId) {
      throw new WorkFlowLoadError(
        ['durable-child-tree-id-mismatch'],
        `CallFlow ${reference} expected child ${fact.childTreeId}, got ${child.treeId}`,
      );
    }
    if (child.status === 'Waiting') {
      fact.status = 'Waiting';
      const handle = this.ensureCompositeTimer(c, invocationKey, 0, 'child');
      c.suspended.push(handle);
      await this.persist(c.snapshot);
      return BehaviorResult.Failure;
    }
    fact.status = child.status === 'Completed' ? 'Completed' : child.status === 'Cancelled' ? 'Cancelled' : 'Failed';
    if (child.status === 'Completed') flowStateOf(ctx).current = child.output;
    await this.persist(c.snapshot);
    return child.status === 'Completed' ? BehaviorResult.Success : BehaviorResult.Failure;
  }

  private openSchedulerTimer(c: TickController, invocationKey: string, deadlineAtMs: number): BehaviorResult {
    const handle = this.ensureCompositeTimer(c, invocationKey, deadlineAtMs, 'backoff');
    c.suspended.push(handle);
    return BehaviorResult.Failure;
  }

  private ensureCompositeTimer(
    c: TickController,
    invocationKey: string,
    deadlineAtMs: number,
    role: 'backoff' | 'timeout' | 'child',
  ): WaitHandle {
    const key = `${invocationKey}/${role}`;
    let handle = c.snapshot.openWaitHandles.find((item) => item.invocationKey === key);
    if (!handle) {
      handle = {
        waitHandleId: `wh_${c.snapshot.treeId}_${key.replace(/[^\w]/g, '_')}`,
        treeId: c.snapshot.treeId,
        nodeKey: invocationKey.slice(0, invocationKey.lastIndexOf('#')),
        invocationKey: key,
        waitKind: role === 'child' ? 'external-job' : 'timer',
        status: 'Open',
        signalKind: role === 'child' ? 'flow.child.updated' : 'timer.due',
        signalKey: key,
        resumeToken: `rt_${Math.random().toString(36).slice(2, 10)}`,
        deadlineAtMs,
        metadata: { compositeRole: role },
      };
      c.snapshot.openWaitHandles.push(handle);
    }
    return handle;
  }

  private closeCompositeTimer(c: TickController, invocationKey: string, role: 'backoff' | 'timeout' | 'child'): void {
    const key = `${invocationKey}/${role}`;
    const handle = c.snapshot.openWaitHandles.find((item) => item.invocationKey === key);
    if (!handle) return;
    handle.status = 'Cancelled';
    handle.closedAtMs = c.now();
    c.snapshot.openWaitHandles = c.snapshot.openWaitHandles.filter((item) => item !== handle);
    c.snapshot.closedWaitHandles.push(handle);
  }

  private cancelScopedWaits(c: TickController, invocationKey: string, reason: 'DeadlineExceeded' | 'RaceLost', winnerId?: string): void {
    const atMs = c.now();
    for (const handle of [...c.snapshot.openWaitHandles]) {
      if (!handle.invocationKey.startsWith(`${invocationKey}/`)) continue;
      if (winnerId && handle.invocationKey.includes(`/lane:${winnerId}/`)) continue;
      handle.status = 'Cancelled';
      handle.closedAtMs = atMs;
      c.snapshot.openWaitHandles = c.snapshot.openWaitHandles.filter((item) => item !== handle);
      c.snapshot.closedWaitHandles.push(handle);
      c.snapshot.waitResults[handle.invocationKey] = { result: 'Cancelled' };
      c.snapshot.orchestration.cancellations[handle.invocationKey] = {
        invocationKey: handle.invocationKey,
        reason,
        atMs,
      };
    }
  }
}

async function runScheduledBody(
  tree: CtrlNode,
  registry: Registry,
  controller: TickController,
  runtime: unknown,
  state: ReturnType<typeof createFlowExecutionState>,
): Promise<BehaviorResult> {
  const engine = new BehaviorTreeEngine<CtrlFlowNodeType, INodeConfig>(registry, evaluateExpression);
  const data: BehaviorTreeData<CtrlFlowNodeType, INodeConfig> = {
    NodeTree: tree,
    Vars: new Map([[FLOW_STATE_KEY, state]]),
    CmdStack: [],
    CmdHistory: [],
    NodeMap: new Map(),
  };
  await engine.start(data, runtime);
  while (!engine.isComplete(data) && controller.suspended.length === 0) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    await engine.runPendingCommands(data, runtime);
  }
  return data.NodeTree.Status === BehaviorTreeNodeStatus.Success
    ? BehaviorResult.Success
    : BehaviorResult.Failure;
}

/**
 * 挂起协议：wait 节点登记挂起后返回 Failure 让树快速塌陷（内核 adapter 会 await handler，
 * 不能用不结算的 Promise）；其后所有 handler 进入惰性模式——不执行、不记录。
 * 本 tick 的树状态整体丢弃，恢复时从快照全新重放，因此塌陷路径不产生任何可观察效果。
 */

/** 包装动作 handler：重放命中即跳过执行（副作用不重复）；挂起后惰性 */
class ReplayingHandler implements ActionHandler<CtrlFlowNodeType, INodeConfig> {
  constructor(
    private inner: ActionHandler<CtrlFlowNodeType, INodeConfig>,
    private controller: () => TickController,
    private replayResults = true,
  ) {}
  async execute(ctx: Ctx): Promise<BehaviorResult> {
    const c = this.controller();
    if (c.suspended.length > 0) {
      c.inertKeys.add(ctx.node.Key);
      return BehaviorResult.Failure; // 惰性中止
    }
    if (!this.replayResults) return this.inner.execute(ctx);
    const key = c.invocationKeyFor(ctx.node.Key);
    const recorded = c.snapshot.nodeResults[key];
    if (recorded !== undefined) return recorded === 'Success' ? BehaviorResult.Success : BehaviorResult.Failure;
    const result = await this.inner.execute(ctx);
    if (result !== BehaviorResult.Running) {
      c.snapshot.nodeResults[key] = result === BehaviorResult.Success ? 'Success' : 'Failure';
    }
    return result;
  }
}

/** 可中断节点 handler：命中 waitResults 即收敛，否则登记 WaitHandle 并让本 tick 挂起 */
export class WaitNodeHandler implements ActionHandler<CtrlFlowNodeType, INodeConfig> {
  constructor(
    private waitKind: WaitKind,
    private controller: () => TickController,
    /** TaskStep 由 biz-process 注入的进入动作（置任务 ACTIVE、before-hooks 等） */
    private onOpen?: (ctx: Ctx, handle: WaitHandle) => Promise<void>,
    /** 收敛回调（首次命中 waitResults 时执行一次，after-hooks 等）；重放幂等由 nodeResults 标记保证 */
    private onConverge?: (ctx: Ctx, invocationKey: string, result: TerminalResult) => Promise<void>,
  ) {}
  async execute(ctx: Ctx): Promise<BehaviorResult> {
    const c = this.controller();
    const flow = flowStateOf(ctx);
    if (flow.returned) return BehaviorResult.Success;
    if (c.suspended.length > 0) {
      c.inertKeys.add(ctx.node.Key);
      return BehaviorResult.Failure; // 惰性中止
    }
    const key = c.invocationKeyFor(ctx.node.Key);
    const done = c.snapshot.waitResults[key];
    const cfg = ctx.node.Config as Record<string, unknown>;
    if (done) {
      const closed = c.snapshot.closedWaitHandles.find((handle) => handle.invocationKey === key);
      if (done.result === 'Success') {
        flow.fault = undefined;
        flow.current = this.waitKind === 'timer' ? closed?.metadata?.input : done.payload;
      } else {
        flow.fault = new Error(`${this.waitKind} ${ctx.node.Key} finished with ${done.result}`);
      }
      const convergeMark = `${key}:converged`;
      if (this.onConverge && c.snapshot.nodeResults[convergeMark] === undefined) {
        c.snapshot.nodeResults[convergeMark] = done.result;
        await this.onConverge(ctx, key, done.result);
      }
      return done.result === 'Success' ? BehaviorResult.Success : BehaviorResult.Failure;
    }
    // 未收敛：若已有同 invocationKey 的 open handle（上个 tick 登记过）则复用，否则新建
    let handle = c.snapshot.openWaitHandles.find((h) => h.invocationKey === key);
    if (!handle) {
      const now = c.now();
      handle = {
        waitHandleId: `wh_${c.snapshot.treeId}_${key.replace(/[^\w]/g, '_')}`,
        treeId: c.snapshot.treeId,
        nodeKey: ctx.node.Key,
        invocationKey: key,
        waitKind: this.waitKind,
        status: 'Open',
        signalKind: String(cfg.signalKind ?? (this.waitKind === 'timer' ? 'timer.due' : this.waitKind === 'task-step' ? 'task.operated' : 'job.completed')),
        signalKey: String(cfg.signalKey ?? ctx.node.Key),
        resumeToken: `rt_${Math.random().toString(36).slice(2, 10)}`,
        deadlineAtMs:
          this.waitKind === 'timer'
            ? now + Number(cfg.durationMs ?? 0)
            : cfg.timeoutMs !== undefined
              ? now + Number(cfg.timeoutMs)
              : 0,
        assignTo: cfg.assignTo as string | undefined,
        metadata: this.waitKind === 'timer' ? { input: flow.current } : undefined,
      };
      c.snapshot.openWaitHandles.push(handle);
      if (handle.deadlineAtMs > 0) {
        c.snapshot.orchestration.deadlines[key] = {
          invocationKey: key,
          deadlineAtMs: handle.deadlineAtMs,
          status: 'Open',
        };
      }
      if (this.onOpen) await this.onOpen(ctx, handle);
    }
    c.suspended.push(handle);
    return BehaviorResult.Failure; // 触发树塌陷结束本 tick；恢复经 ResumeSignal 后整树重放
  }
}

export interface WorkFlowEngineOptions {
  definition: WorkFlowDefinition;
  store: WorkFlowStore;
  runtime?: WorkFlowRuntime;
  clock?: WorkFlowClock;
  view?: WorkFlowViewAdapter;
  /** 产品形态扩展（BizProcess 注入 TaskStep 编译与 handler） */
  compileExtension?: CompileExtension;
  extraHandlers?: (controller: () => TickController) => Record<string, ActionHandler<CtrlFlowNodeType, INodeConfig>>;
  expectedForm?: 'WorkFlow' | 'BizProcess';
  durableChildren?: DurableChildFlowResolver;
}

export interface WorkFlowDefinition {
  spec: FlowBundleSpec;
  resolveCode: FlowCodeResolver<WorkFlowRuntime>;
  resolveFlow?: CtrlFlowResolver;
}

export interface WorkFlowViewAdapter {
  annotateTree(treeId: string, view: TreeViewAnnotation): void | Promise<void>;
}

export class WorkFlowLoadError extends Error {
  constructor(public codes: string[], message: string) {
    super(message);
  }
}

export class WorkFlowEngine {
  readonly spec: FlowBundleSpec;
  private runtime: WorkFlowRuntime;
  private controllerRef: { current?: TickController } = {};

  constructor(private options: WorkFlowEngineOptions) {
    this.spec = options.definition.spec;
    this.runtime = options.runtime ?? {};
    const expected = this.options.expectedForm ?? 'WorkFlow';
    const hard = this.spec.diagnostics.filter((diagnostic) => diagnostic.code !== 'parser-warning');
    if (hard.length) {
      throw new WorkFlowLoadError(hard.map((diagnostic) => diagnostic.code), hard.map((diagnostic) => diagnostic.message).join('; '));
    }
    if (this.spec.form !== expected) {
      throw new WorkFlowLoadError(['form-mismatch'], `bundle ${this.spec.fqn} is a ${this.spec.form}, expected ${expected}`);
    }
  }

  private now(): number {
    return this.options.clock?.now() ?? this.runtime.now?.() ?? Date.now();
  }

  async start(treeId: string, opts: WorkFlowStartOptions = {}): Promise<TickOutcome> {
    const existing = await this.options.store.load(treeId);
    if (existing) throw new WorkFlowLoadError(['tree-exists'], `tree ${treeId} already exists`);
    const spec = this.spec;
    const snapshot: WorkFlowSnapshot = {
      schemaVersion: WORKFLOW_SNAPSHOT_SCHEMA,
      treeId,
      fqn: spec.fqn,
      status: 'Waiting',
      vars: { ...(spec.stateSeed ?? {}) },
      input: { ...(opts.input ?? {}) },
      branchDecisions: {},
      nodeResults: {},
      waitResults: {},
      openWaitHandles: [],
      closedWaitHandles: [],
      appliedResumeSignals: [],
      orchestration: emptyOrchestrationFacts(),
      lastTickNo: 0,
      updatedAtMs: this.now(),
    };
    snapshot.vars[FLOW_STATE_KEY] = createFlowExecutionState(opts.input ?? {});
    return this.tick(snapshot, spec);
  }

  /** 投递恢复信号（WF-4：幂等；未匹配 open handle 拒绝） */
  async resume(treeId: string, signal: ResumeSignal): Promise<TickOutcome> {
    const snapshot = await this.options.store.load(treeId);
    if (!snapshot) throw new WorkFlowLoadError(['tree-not-found'], `tree ${treeId} not found`);
    ensureOrchestrationFacts(snapshot);

    const handle = snapshot.openWaitHandles.find(
      (h) => h.signalKind === signal.signalKind && h.signalKey === signal.signalKey,
    );
    if (!handle) {
      const appliedKey = `${signal.signalKind}:${signal.signalKey}:${signal.resumeToken}`;
      if (snapshot.appliedResumeSignals.some((a) => a.endsWith(`:${signal.resumeToken}`))) {
        // A crash can happen after durable node facts are saved but before the
        // enclosing tick persists its terminal status. Reconcile from facts
        // when there is no remaining wait instead of returning stale Waiting.
        if (snapshot.status === 'Waiting' && snapshot.openWaitHandles.length === 0) {
          return this.tick(snapshot, this.spec);
        }
        return this.outcomeFromSnapshot(snapshot);
      }
      throw new WorkFlowLoadError(['no-open-wait-handle'], `no open wait handle for ${appliedKey}`);
    }
    if (handle.resumeToken !== signal.resumeToken) {
      throw new WorkFlowLoadError(['resume-token-mismatch'], `resume token mismatch for ${handle.waitHandleId}`);
    }

    snapshot.appliedResumeSignals.push(`${handle.waitHandleId}:${signal.resumeToken}`);
    const result: TerminalResult = signal.outcome ?? 'Success';
    snapshot.waitResults[handle.invocationKey] = { result, payload: signal.payload };
    handle.status = result === 'Cancelled' ? 'Cancelled' : 'Consumed';
    handle.closedAtMs = this.now();
    snapshot.openWaitHandles = snapshot.openWaitHandles.filter((h) => h !== handle);
    snapshot.closedWaitHandles.push(handle);
    const deadline = snapshot.orchestration.deadlines[handle.invocationKey];
    if (deadline) deadline.status = result === 'Cancelled' ? 'Cancelled' : result === 'Failure' ? 'Failed' : 'Completed';
    if (result === 'Cancelled') {
      snapshot.orchestration.cancellations[handle.invocationKey] = {
        invocationKey: handle.invocationKey,
        reason: 'SignalCancelled',
        atMs: handle.closedAtMs!,
      };
    }
    return this.tick(snapshot, this.spec);
  }

  /**
   * 到期等待统一收敛：Timer 到期 → Success（等价于 timer.due 信号）；
   * 其余（如 ExternalJob timeoutMs）到期 → Failure，句柄标 Expired。deadlineAtMs=0 表示无限不收敛。
   */
  async fireDueDeadlines(treeId: string): Promise<TickOutcome> {
    const snapshot = await this.options.store.load(treeId);
    if (!snapshot) throw new WorkFlowLoadError(['tree-not-found'], `tree ${treeId} not found`);
    ensureOrchestrationFacts(snapshot);
    const now = this.now();
    let fired = 0;
    for (const h of [...snapshot.openWaitHandles]) {
      if (h.deadlineAtMs > 0 && h.deadlineAtMs <= now) {
        snapshot.appliedResumeSignals.push(`${h.waitHandleId}:${h.resumeToken}`);
        if (h.waitKind === 'timer') {
          snapshot.waitResults[h.invocationKey] = { result: 'Success' };
          h.status = 'Consumed';
        } else {
          snapshot.waitResults[h.invocationKey] = { result: 'Failure' };
          h.status = 'Expired';
        }
        h.closedAtMs = now;
        snapshot.openWaitHandles = snapshot.openWaitHandles.filter((x) => x !== h);
        snapshot.closedWaitHandles.push(h);
        const deadline = snapshot.orchestration.deadlines[h.invocationKey];
        if (deadline) deadline.status = h.waitKind === 'timer' ? 'Completed' : 'Expired';
        if (h.waitKind !== 'timer') {
          snapshot.orchestration.cancellations[h.invocationKey] = {
            invocationKey: h.invocationKey,
            reason: 'DeadlineExceeded',
            atMs: now,
          };
        }
        fired++;
      }
    }
    if (!fired) return this.outcomeFromSnapshot(snapshot);
    return this.tick(snapshot, this.spec);
  }

  /** @deprecated 用 fireDueDeadlines（保留别名以兼容） */
  async fireDueTimers(treeId: string): Promise<TickOutcome> {
    return this.fireDueDeadlines(treeId);
  }

  async getOutcome(treeId: string): Promise<TickOutcome | undefined> {
    const snapshot = await this.options.store.load(treeId);
    return snapshot && this.outcomeFromSnapshot(snapshot);
  }

  /** Explicit scheduler tick used after an external durable child changes state. */
  async refresh(treeId: string): Promise<TickOutcome> {
    const snapshot = await this.options.store.load(treeId);
    if (!snapshot) throw new WorkFlowLoadError(['tree-not-found'], `tree ${treeId} not found`);
    for (const handle of [...snapshot.openWaitHandles]) {
      if (handle.metadata?.compositeRole !== 'child') continue;
      handle.status = 'Consumed';
      handle.closedAtMs = this.now();
      snapshot.openWaitHandles = snapshot.openWaitHandles.filter((item) => item !== handle);
      snapshot.closedWaitHandles.push(handle);
    }
    return this.tick(snapshot, this.spec);
  }

  private outcomeFromSnapshot(snapshot: WorkFlowSnapshot): TickOutcome {
    return {
      status: snapshot.status,
      treeId: snapshot.treeId,
      vars: snapshot.vars,
      openWaitHandles: snapshot.openWaitHandles,
      logs: [],
      errors: [],
      tickNo: snapshot.lastTickNo,
    };
  }

  private buildRegistry(
    spec: FlowBundleSpec,
    logs: string[],
    controller: () => TickController = () => this.controllerRef.current!,
    persist: (snapshot: WorkFlowSnapshot) => Promise<void> = (snapshot) => this.options.store.save(snapshot),
  ): ActionHandlerRegistry<CtrlFlowNodeType, INodeConfig> {
    const registry = new ActionHandlerRegistry<CtrlFlowNodeType, INodeConfig>();
    const wrap = (h: ActionHandler<CtrlFlowNodeType, INodeConfig>, replayResults = true) =>
      new ReplayingHandler(h, controller, replayResults);

    const decisionHooks: FlowDecisionHooks = {
      begin: (ifPath) => {
        const c = controller();
        const invocationKey = c.invocationKeyFor(ifPath);
        return { ifPath, invocationKey, decision: c.snapshot.branchDecisions[invocationKey] };
      },
      record: async (decision: FlowBranchDecision) => {
        const c = controller();
        const existing = c.snapshot.branchDecisions[decision.invocationKey];
        if (existing && JSON.stringify(existing) !== JSON.stringify(decision)) {
          throw new Error(`conflicting branch decision for ${decision.invocationKey}`);
        }
        c.snapshot.branchDecisions[decision.invocationKey] = decision;
        c.snapshot.updatedAtMs = c.now();
        await persist(c.snapshot);
      },
    };

    registry.register('Log', wrap(new LogActionHandler(logs)));
    registry.register('Assert', wrap(new AssertActionHandler()));
    registry.register('Sleep', wrap(new SleepActionHandler()));
    for (const [type, handler] of Object.entries(createFlowHandlers(spec, this.options.definition.resolveCode, decisionHooks))) {
      const decisionAware = type === 'flow.IfStart' || type === 'flow.Predicate' || type === 'flow.Otherwise';
      registry.register(type as CtrlFlowNodeType, wrap(handler, !decisionAware));
    }
    registry.register('wf.ExternalJob', new WaitNodeHandler('external-job', controller));
    registry.register('wf.Timer', new WaitNodeHandler('timer', controller));
    registry.register(
      'wf.Composite',
      new DurableCompositeScheduler(
        controller,
        (nestedController, nestedPersist = persist) => this.buildRegistry(spec, logs, nestedController, nestedPersist),
        persist,
        this.options.definition,
        this.options.durableChildren,
      ),
    );
    // seed: restore the persistent statement data holder before replaying the plan.
    registry.register('instant.Seed', {
      execute: async (ctx: Ctx) => {
        const c = controller();
        const state = c.snapshot.vars[FLOW_STATE_KEY] ?? createFlowExecutionState(c.snapshot.input);
        c.snapshot.vars[FLOW_STATE_KEY] = state;
        ctx.setVar(FLOW_STATE_KEY, state);
        return BehaviorResult.Success;
      },
    });
    for (const [type, handler] of Object.entries(this.options.extraHandlers?.(controller) ?? {})) {
      registry.register(type, handler);
    }
    return registry;
  }

  private compileTree(spec: FlowBundleSpec): CtrlNode {
    const ext: CompileExtension = (s, node, helpers) =>
      this.options.compileExtension?.(s, node, helpers) ?? workFlowCompileExtension(s, node, helpers);
    const userRoot = compileBundle(spec, ext);
    const seed = CtrlFlowDsl.node('instant.Seed' as CtrlFlowNodeType, { key: '__seed__' }, {});
    return CtrlFlowDsl.node('Sequence' as CtrlFlowNodeType, { key: '__root__' }, {}, [seed, userRoot]);
  }

  private async tick(snapshot: WorkFlowSnapshot, spec: FlowBundleSpec): Promise<TickOutcome> {
    snapshot.branchDecisions ??= {};
    ensureOrchestrationFacts(snapshot);
    snapshot.lastTickNo += 1;
    const logs: string[] = [];
    const errors: string[] = [];
    const controller = new TickController(snapshot, this.runtime);
    this.controllerRef.current = controller;

    const registry = this.buildRegistry(spec, logs);
    const engine = new BehaviorTreeEngine<CtrlFlowNodeType, INodeConfig>(registry, evaluateExpression);
    // 重放要求全新树实例（节点 Status 不能跨 tick 残留）
    const tree = structuredCloneTree(this.compileTree(spec));
    const btData: BehaviorTreeData<CtrlFlowNodeType, INodeConfig> = {
      NodeTree: tree,
      Vars: new Map(),
      CmdStack: [],
      CmdHistory: [],
      NodeMap: new Map(),
    };

    await engine.start(btData, this.runtime);
    while (!engine.isComplete(btData) && controller.suspended.length === 0) {
      await new Promise((r) => setTimeout(r, 5));
      await engine.runPendingCommands(btData, this.runtime);
    }

    snapshot.updatedAtMs = this.now();
    let status: TickOutcome['status'];
    if (controller.suspended.length > 0) {
      status = 'Waiting';
    } else {
      status = btData.NodeTree.Status === BehaviorTreeNodeStatus.Success ? 'Completed' : 'Failed';
      if (status === 'Failed') collectErrors(btData.NodeTree, errors);
    }
    snapshot.status = status;
    await this.options.store.save(snapshot);

    // Optional views are adapters; snapshots remain the engine truth source.
    try {
      await this.options.view?.annotateTree(snapshot.treeId, computeView(btData, controller, status, snapshot.lastTickNo));
    } catch (e) {
      console.error(`[workflow view] annotate failed for ${snapshot.treeId}:`, e);
    }

    return {
      status,
      treeId: snapshot.treeId,
      vars: snapshot.vars,
      openWaitHandles: snapshot.openWaitHandles,
      logs,
      errors,
      tickNo: snapshot.lastTickNo,
    };
  }
}

/** 编译结果是纯数据树（Config/Children/Attr），深拷贝以避免 tick 间状态残留 */
function structuredCloneTree(node: CtrlNode): CtrlNode {
  return {
    ...node,
    Config: { ...(node.Config as Record<string, unknown>) } as INodeConfig,
    Children: node.Children.map((c) => structuredCloneTree(c as CtrlNode)),
  };
}

function collectErrors(node: CtrlNode, errors: string[]): void {
  if (node.Status === BehaviorTreeNodeStatus.Failure && node.Children.length === 0) {
    errors.push(`node ${node.Key} failed`);
  }
  for (const c of node.Children) collectErrors(c as CtrlNode, errors);
}

function flatConfig(spec: FlowBundleSpec): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const entry of Object.values(spec.config)) Object.assign(flat, entry);
  return Object.freeze(flat);
}

const STATUS_VIEW: Record<string, NodeViewStatus> = {
  [BehaviorTreeNodeStatus.Init]: 'Init',
  [BehaviorTreeNodeStatus.Started]: 'Active',
  [BehaviorTreeNodeStatus.Success]: 'Success',
  [BehaviorTreeNodeStatus.Failure]: 'Failure',
  [BehaviorTreeNodeStatus.Omitted]: 'Omitted',
};

const SYNTHETIC_KEYS = new Set(['__root__', '__seed__']);

/**
 * 从 tick 末的树状态计算标注视图。挂起 tick 的塌陷路径修正：
 *   惰性执行节点 → INIT；全 INIT 子树的控制节点 → INIT；挂起节点 → WAITING；其祖先链 → ACTIVE。
 */
export function computeView(
  btData: BehaviorTreeData<CtrlFlowNodeType, INodeConfig>,
  controller: TickController,
  runStatus: TickOutcome['status'],
  tickNo: number,
): TreeViewAnnotation {
  const nodes: Record<string, NodeAnnotation> = {};
  const parentOf = new Map<string, string>();

  const walk = (n: CtrlNode, parent?: CtrlNode): void => {
    if (parent) parentOf.set(n.Key, parent.Key);
    nodes[n.Key] = { status: STATUS_VIEW[n.Status] ?? 'Init' };
    for (const c of n.Children) walk(c as CtrlNode, n);
  };
  walk(btData.NodeTree as CtrlNode);

  if (controller.suspended.length > 0) {
    for (const k of controller.inertKeys) if (nodes[k]) nodes[k].status = 'Init';
    // 全 INIT 子树的控制节点归 INIT（塌陷路径上被误标 FAILURE 的分支容器）
    const settle = (n: CtrlNode): NodeViewStatus => {
      const children = n.Children as CtrlNode[];
      if (children.length) {
        const childStatuses = children.map(settle);
        if (childStatuses.every((s) => s === 'Init')) nodes[n.Key].status = 'Init';
      }
      return nodes[n.Key].status;
    };
    settle(btData.NodeTree as CtrlNode);
    const byKey = new Map<string, CtrlNode>();
    const index = (n: CtrlNode) => {
      byKey.set(n.Key, n);
      for (const c of n.Children) index(c as CtrlNode);
    };
    index(btData.NodeTree as CtrlNode);
    const resetOmitted = (n: CtrlNode) => {
      if (nodes[n.Key]?.status === 'Omitted') nodes[n.Key].status = 'Init';
      for (const c of n.Children) resetOmitted(c as CtrlNode);
    };
    for (const h of controller.suspended) {
      if (nodes[h.nodeKey]) nodes[h.nodeKey].status = 'Waiting';
      // 祖先链 → ACTIVE；同时清掉塌陷伪影：链上每个父节点中、链子节点之后的兄弟子树里的
      // OMITTED（Sequence 塌陷标记）→ INIT。真实的 Selector 分支跳过（Omitted）在链子节点
      // 之前的已完成分支里，不受影响。
      let child = h.nodeKey;
      let p = parentOf.get(child);
      while (p) {
        if (nodes[p]) nodes[p].status = 'Active';
        const parentNode = byKey.get(p);
        if (parentNode) {
          const idx = parentNode.Children.findIndex((c) => (c as CtrlNode).Key === child);
          for (let i = idx + 1; i >= 0 && i < parentNode.Children.length; i++) {
            resetOmitted(parentNode.Children[i] as CtrlNode);
          }
        }
        child = p;
        p = parentOf.get(p);
      }
    }
  }

  // Cancelled 可区分（WF：树语义按 Failure 收敛，视图还原 Cancelled）
  for (const [invKey, r] of Object.entries(controller.snapshot.waitResults)) {
    if (r.result === 'Cancelled') {
      const nodeKey = invKey.slice(0, invKey.lastIndexOf('#'));
      if (nodes[nodeKey]?.status === 'Failure') nodes[nodeKey].status = 'Cancelled';
    }
  }

  // Until iterations（内核在 Vars 里维护循环计数；首轮为 0 → iterations = 计数 + 1）
  const untilIterations = (n: CtrlNode): void => {
    if (n.Kind === BehaviorTreeNodeKind.Until && nodes[n.Key].status !== 'Init') {
      const counter = (btData.Vars.get(`__until_iterations_${n.Key}`) as number | undefined) ?? 0;
      nodes[n.Key].iterations = counter + 1;
    }
    for (const c of n.Children) untilIterations(c as CtrlNode);
  };
  untilIterations(btData.NodeTree as CtrlNode);

  for (const k of SYNTHETIC_KEYS) delete nodes[k];
  return { runStatus, tickNo, nodes };
}

export { FlowCompileError };
