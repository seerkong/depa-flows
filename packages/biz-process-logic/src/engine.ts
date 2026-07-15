/**
 * BizProcess 引擎（BP-1~BP-5）：构建在 WorkFlow 机制之上（BP-5）。
 *
 * - TaskStep 是流树引用任务树的唯一桥（BP-2）：进入置任务 ACTIVE + before-hooks + 登记
 *   WaitHandle(signalKind="task.operated", signalKey=绑定节点 id)；无 assignTo。
 * - 人工操作经任务状态机校验后，若使绑定节点（Task 或按 executionMode 聚合的 TaskGroup）
 *   到达终态，则作为 ResumeSignal 驱动流程推进（BP-3）；四种业务终态都以普通
 *   TaskStepResult data 写回 data chain，并由后续 If 路由（BP-4）。
 * - 任务树是独立事实源（BP-1）：外置于 TaskSpaceStore，流程快照不复制任务数据。
 */
import { CtrlFlowDsl, type ActionHandler, type CtrlFlowNodeType, type INodeConfig, type ExecutionContext } from 'depa-behavior-tree';
import type { FlowNodeSpec } from 'instant-flow-contract';
import { FLOW_STATE_KEY, FlowCompileError, type CompileExtension } from 'instant-flow-logic/browser';
import {
  WorkFlowEngine,
  WorkFlowLoadError,
  WaitNodeHandler,
  workFlowCompileExtension,
  type TickController,
  type WorkFlowDefinition,
} from 'work-flow-logic/browser';
import type {
  DurableChildFlowResolver,
  TickOutcome,
  WorkFlowClock,
  WorkFlowRuntime,
  WorkFlowStore,
} from 'work-flow-contract';
import type { TaskSpaceDTO, TaskSpaceStore, TaskDTO, TaskTreeNode, TaskOperation } from 'task-manager-contract';
import { taskStepResultOf } from 'biz-process-contract';
import type { TaskOperationRequest, TaskOperationResult, TaskStepStatus } from 'biz-process-contract';
import { taskSpaceFromSpec } from './taskSpace.js';

type Ctx = ExecutionContext<CtrlFlowNodeType, INodeConfig>;

export class BizProcessError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
  }
}

export interface BizProcessEngineOptions {
  definition: WorkFlowDefinition;
  store: WorkFlowStore;
  taskStore: TaskSpaceStore;
  tasks: BizProcessTaskDependencies;
  runtime?: WorkFlowRuntime;
  clock?: WorkFlowClock;
  view?: BizProcessViewAdapter;
  durableChildren?: DurableChildFlowResolver;
}

export interface BizProcessViewAdapter {
  annotateTasks(treeId: string, statuses: Readonly<Record<string, string>>): void | Promise<void>;
}

export interface BizProcessTaskDependencies {
  applyOperation(task: TaskDTO, operation: TaskOperation, operatorAccount: string, atMs: number): void;
  findNode(space: TaskSpaceDTO, id: string): TaskTreeNode | undefined;
  findTask(space: TaskSpaceDTO, id: string): TaskDTO | undefined;
  isOperable(space: TaskSpaceDTO, id: string): boolean;
  listTasks(space: TaskSpaceDTO): TaskDTO[];
  terminalStatusOf(node: TaskTreeNode): string | undefined;
}

interface StepHook {
  id: string;
  point: 'before' | 'after';
  src: string;
}

export class BizProcessEngine {
  private wf: WorkFlowEngine;
  private taskStore: TaskSpaceStore;
  private runtime: WorkFlowRuntime;
  private tasksApi: BizProcessTaskDependencies;
  /** TaskStep 节点 → 绑定任务节点 id / hooks（编译期收集） */
  private stepBindings = new Map<string, { taskId: string; hooks: StepHook[] }>();

  constructor(private options: BizProcessEngineOptions) {
    this.taskStore = options.taskStore;
    this.runtime = options.runtime ?? {};
    this.tasksApi = options.tasks;

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
      const hooks = collectHooks(node);
      this.stepBindings.set(helpers.meta.key, { taskId, hooks });
      return CtrlFlowDsl.node('bf.TaskStep' as CtrlFlowNodeType, helpers.meta, {
        signalKind: 'task.operated',
        signalKey: taskId,
        taskId,
      } as INodeConfig);
    };

    this.wf = new WorkFlowEngine({
      definition: options.definition,
      store: options.store,
      runtime: options.runtime,
      clock: options.clock,
      durableChildren: options.durableChildren,
      expectedForm: 'BizProcess',
      compileExtension,
      extraHandlers: (controller) => ({
        'bf.TaskStep': new WaitNodeHandler(
          'task-step',
          controller,
          (ctx, handle) => this.onStepOpen(controller(), ctx, handle.signalKey),
          (ctx, key, result) => this.onStepConverge(controller(), ctx, key, result),
        ),
      }),
    });

    // 静态校验：TaskStep 必须绑定 TaskSpace 直接子节点（BP-2）
    const spec = this.wf.spec;
    if (!spec.taskSpace) throw new BizProcessError('missing-task-space', `BizProcess bundle ${spec.fqn} requires task.space domain`);
    const direct = new Set(spec.taskSpace.children.map((c) => c.id));
    const walk = (n: FlowNodeSpec): void => {
      if (n.tag === 'TaskStep') {
        const tid = String(n.attrs.task ?? '').slice('task-space://#'.length);
        if (!direct.has(tid)) {
          throw new BizProcessError('task-ref-not-direct-child', `TaskStep #${n.id} must bind a direct child of TaskSpace, got "${tid}"`);
        }
      }
      n.children.forEach(walk);
      Object.values(n.sections).forEach(walk);
    };
    spec.statements.forEach(walk);
  }

  private now(): number {
    return this.options.clock?.now() ?? this.runtime.now?.() ?? Date.now();
  }

  private async loadSpace(treeId: string): Promise<TaskSpaceDTO> {
    const space = await this.taskStore.load(treeId);
    if (!space) throw new BizProcessError('task-space-not-found', `task space for tree ${treeId} not found`);
    return space;
  }

  /** 任务状态视图：真源在 TaskSpaceStore，单向写实例 task.space.xnl 的 status 值 */
  private async saveSpaceAndAnnotate(treeId: string, space: TaskSpaceDTO): Promise<void> {
    await this.taskStore.save(treeId, space);
    try {
      const statuses = Object.fromEntries(this.tasksApi.listTasks(space).map((t) => [t.id, t.status]));
      await this.options.view?.annotateTasks(treeId, statuses);
    } catch (e) {
      console.error(`[biz-process view] annotate task.space failed for ${treeId}:`, e);
    }
  }

  /** TaskStep 进入：置绑定 Task（或组内首个可操作 Task）ACTIVE；执行 before-hooks（BP-2） */
  private async onStepOpen(controller: TickController, ctx: Ctx, boundId: string): Promise<void> {
    const treeId = controller.snapshot.treeId;
    const space = await this.loadSpace(treeId);
    const node = this.tasksApi.findNode(space, boundId);
    if (!node) throw new BizProcessError('unresolved-task-ref', `bound task node ${boundId} not found`);
    const activate = (t: TaskDTO) => {
      if (t.status === 'NotStarted') this.tasksApi.applyOperation(t, 'start', 'system:biz-process', this.now());
    };
    if (node.kind === 'task') activate(node);
    else {
      const first = listTasksIn(node).sort((a, b) => a.order - b.order).find((t) => t.status === 'NotStarted');
      if (first) activate(first);
    }
    await this.saveSpaceAndAnnotate(treeId, space);
    await this.runHooks(ctx, 'before');
  }

  /** TaskStep 收敛：after-hooks（Hook 失败不改变主结果） */
  private async onStepConverge(_controller: TickController, ctx: Ctx, _key: string, _result: import('work-flow-contract').TerminalResult): Promise<void> {
    await this.runHooks(ctx, 'after');
  }

  private async runHooks(ctx: Ctx, point: 'before' | 'after'): Promise<void> {
    const binding = this.stepBindings.get(ctx.node.Key);
    if (!binding) return;
    for (const hook of binding.hooks.filter((h) => h.point === point)) {
      try {
        const handler = await this.options.definition.resolveCode({
          reference: hook.src,
          flowId: this.wf.spec.fqn,
          nodeId: hook.id,
          baseUri: this.wf.spec.baseUri,
        });
        const flow = ctx.getVar(FLOW_STATE_KEY) as { current?: unknown } | undefined;
        await handler(this.runtime, flow?.current, {});
      } catch (e) {
        console.error(`[biz-process hook ${hook.id}:${point}]`, e); // Hook 失败不改变主结果（记录于日志）
      }
    }
  }

  /** 启动：物化实例（定义冻结拷贝）→ 用实例 spec 初始化任务树外置副本 → 首个 tick */
  async start(treeId: string, opts: { input?: Record<string, unknown> } = {}): Promise<TickOutcome> {
    const instanceSpec = this.wf.spec;
    const existing = await this.taskStore.load(treeId);
    if (!existing) {
      await this.taskStore.save(treeId, taskSpaceFromSpec(instanceSpec.taskSpace!, treeId));
    }
    return this.wf.start(treeId, opts);
  }

  async getOutcome(treeId: string): Promise<TickOutcome | undefined> {
    return this.wf.getOutcome(treeId);
  }

  async refresh(treeId: string): Promise<TickOutcome> {
    return this.wf.refresh(treeId);
  }

  async tasks(treeId: string): Promise<TaskDTO[]> {
    return this.tasksApi.listTasks(await this.loadSpace(treeId));
  }

  /**
   * 人工操作（BP-3）：状态机校验 → 更新任务树 → 若绑定节点到达终态则作为 ResumeSignal 推进流程。
   */
  async operateTask(treeId: string, request: TaskOperationRequest): Promise<TaskOperationResult> {
    const space = await this.loadSpace(treeId);
    const task = this.tasksApi.findTask(space, request.taskId);
    if (!task) throw new BizProcessError('task-not-found', `task ${request.taskId} not found in tree ${treeId}`);
    if (!this.tasksApi.isOperable(space, request.taskId)) {
      throw new BizProcessError('task-not-operable', `task ${request.taskId} blocked by SEQUENTIAL predecessors`);
    }
    this.tasksApi.applyOperation(task, request.operation, request.operatorAccount, this.now());
    await this.saveSpaceAndAnnotate(treeId, space);

    // 找到覆盖该任务的 open TaskStep handle（绑定节点 = 任务自身或其祖先直接子节点）
    const outcome = await this.wf.getOutcome(treeId);
    if (!outcome) throw new BizProcessError('tree-not-found', `tree ${treeId} not found`);
    const handle = outcome.openWaitHandles.find(
      (h) => h.waitKind === 'task-step' && coversTask(space, h.signalKey, request.taskId, this.tasksApi),
    );
    if (handle) {
      const bound = this.tasksApi.findNode(space, handle.signalKey);
      if (!bound) {
        throw new BizProcessError('unresolved-task-ref', `open TaskStep references missing task node ${handle.signalKey}`);
      }
      const terminal = this.tasksApi.terminalStatusOf(bound);
      if (terminal) {
        if (!isTaskStepStatus(terminal)) {
          throw new BizProcessError('invalid-task-terminal-status', `TaskStep ${handle.nodeKey} resolved with invalid status ${terminal}`);
        }
        const flowState = outcome.vars[FLOW_STATE_KEY] as { current?: unknown } | undefined;
        const result = taskStepResultOf(handle.signalKey, terminal, flowState?.current);
        const advanced = await this.wf.resume(treeId, {
          signalKind: handle.signalKind,
          signalKey: handle.signalKey,
          resumeToken: handle.resumeToken,
          outcome: 'Success',
          payload: result,
        });
        return { taskStatus: task.status, outcome: advanced, advancedFlow: true };
      }
      // 组内还有后续任务：激活下一个 NOT_STARTED（SEQUENTIAL 推进）
      if (bound.kind === 'group') {
        const next = listTasksIn(bound).sort((a, b) => a.order - b.order).find((t) => t.status === 'NotStarted');
        if (next && this.tasksApi.isOperable(space, next.id)) {
          this.tasksApi.applyOperation(next, 'start', 'system:biz-process', this.now());
          await this.taskStore.save(treeId, space);
        }
      }
    }
    const current = await this.wf.getOutcome(treeId);
    return { taskStatus: task.status, outcome: current!, advancedFlow: false };
  }
}

function isTaskStepStatus(status: string): status is TaskStepStatus {
  return status === 'Done' || status === 'Refused' || status === 'Forwarded' || status === 'Abandoned';
}

function listTasksIn(group: { children: unknown[] }): TaskDTO[] {
  const out: TaskDTO[] = [];
  const walk = (nodes: { kind: string; children?: unknown[] }[]) => {
    for (const n of nodes) {
      if (n.kind === 'task') out.push(n as unknown as TaskDTO);
      else walk((n.children ?? []) as { kind: string; children?: unknown[] }[]);
    }
  };
  walk(group.children as { kind: string; children?: unknown[] }[]);
  return out;
}

/** handle 绑定的节点是否覆盖被操作任务（任务自身或其所在子树） */
function coversTask(space: TaskSpaceDTO, boundId: string, taskId: string, tasks: BizProcessTaskDependencies): boolean {
  if (boundId === taskId) return true;
  const bound = tasks.findNode(space, boundId);
  if (!bound || bound.kind !== 'group') return false;
  return listTasksIn(bound).some((t) => t.id === taskId);
}

/** 收集 TaskStep 的 ( <Hooks [ <Hook …> ]> ) */
function collectHooks(node: FlowNodeSpec): StepHook[] {
  const hooksSection = node.sections['Hooks'];
  if (!hooksSection) return [];
  return hooksSection.children
    .filter((h) => h.tag === 'Hook')
    .map((h) => ({
      id: h.id ?? '',
      point: (h.attrs.point as 'before' | 'after') ?? 'before',
      src: String(h.attrs.src ?? ''),
    }));
}

export { WorkFlowLoadError };
