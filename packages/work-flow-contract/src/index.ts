/**
 * work-flow-contract —— WorkFlow 契约（WF-1~WF-7）。
 * 机制对齐 docs/flow-dsl/std/work-flow/axioms.md：状态按节点 path 外置，
 * Snapshot + WaitHandle + ResumeSignal，恢复幂等；实例物化 + status 标注视图。
 *
 * 状态枚举约定（2026-07-04 用户定稿）：协议级枚举一律大驼峰、定义在 contract 包。
 * 内核枚举（BehaviorTreeNodeStatus/BehaviorResult）属实现细节，经 logic 层 STATUS_VIEW 投影，不外泄。
 */
import type { FlowBundleSpec, InstantFlowRuntime } from 'instant-flow-contract';

export type { FlowBundleSpec };

/** v4: durable orchestration facts are explicit snapshot data. */
export const WORKFLOW_SNAPSHOT_SCHEMA = 'depa.flows.workflow/v4';

export type WaitKind = 'external-job' | 'timer' | 'task-step';

/** 等待句柄生命周期（可审计）：Open 在 openWaitHandles，其余在 closedWaitHandles */
export type WaitHandleStatus = 'Open' | 'Consumed' | 'Expired' | 'Cancelled';

/** 等待/动作的终结结果（协议词表；Cancelled 树语义按 Failure 收敛但全链可区分） */
export type TerminalResult = 'Success' | 'Failure' | 'Cancelled';

export interface WaitHandle {
  waitHandleId: string;
  treeId: string;
  /** 挂起节点的 #id */
  nodeKey: string;
  /** 节点 path 的执行实例键：`${nodeKey}#${visitIndex}`（Until 循环中同一节点多次执行各占一键） */
  invocationKey: string;
  waitKind: WaitKind;
  status: WaitHandleStatus;
  signalKind: string;
  signalKey: string;
  /** 幂等令牌：ResumeSignal 必须回传 */
  resumeToken: string;
  /** 超时时刻（epoch ms；0 = 无限）；到期由 fireDueDeadlines 收敛（Timer→Success，其余→Failure） */
  deadlineAtMs: number;
  /** payload 写入的 vars 变量（可缺省） */
  assignTo?: string;
  /** 关闭时刻（终态句柄） */
  closedAtMs?: number;
  metadata?: Record<string, unknown>;
}

export interface ResumeSignal {
  signalKind: string;
  signalKey: string;
  resumeToken: string;
  /** 缺省 Success；Failure/Cancelled → 节点 Failure（Cancelled 在视图与句柄中可区分） */
  outcome?: TerminalResult;
  payload?: unknown;
}

export type BranchDecisionKind = 'Branch' | 'Otherwise' | 'NoMatch';

/** An If choice, addressed by stable definition path plus replay invocation identity. */
export interface BranchDecision {
  ifPath: string;
  invocationKey: string;
  kind: BranchDecisionKind;
  branchKey?: string;
}

export type DurableFactStatus = 'Open' | 'Completed' | 'Failed' | 'Cancelled' | 'Expired';

export interface AttemptFact {
  invocationKey: string;
  attempt: number;
  maxAttempts: number;
  status: DurableFactStatus;
  nextAttemptAtMs?: number;
}

export interface DeadlineFact {
  invocationKey: string;
  deadlineAtMs: number;
  status: DurableFactStatus;
}

export interface LaneFact {
  invocationKey: string;
  laneId: string;
  status: DurableFactStatus;
  bodyId: string;
  item?: unknown;
  /** Isolated data-chain state resumed by this lane. */
  flowState?: unknown;
  output?: unknown;
}

export interface WinnerFact {
  invocationKey: string;
  winnerId: string;
  mode: 'first-success' | 'first-completed';
}

export interface CancellationFact {
  invocationKey: string;
  reason: 'SignalCancelled' | 'DeadlineExceeded' | 'RaceLost' | 'ParentCancelled';
  atMs: number;
}

export type CompositePrimitive = 'Retry' | 'Timeout' | 'ForEach' | 'Parallel' | 'Race' | 'CallFlow';
export type CompositeInvocationStatus = 'Open' | 'Waiting' | 'Completed' | 'Failed' | 'Cancelled';

/** Snapshot-owned cursor for one composite invocation. */
export interface CompositeInvocationFact {
  invocationKey: string;
  primitive: CompositePrimitive;
  /** Stable scheduler slot, not a transient behavior-tree execution id. */
  bodyId: string;
  status: CompositeInvocationStatus;
  /** Snapshot-owned input captured before the first body execution. */
  input?: unknown;
  /** Product-specific replay cursor. */
  cursor?: number;
  /** Stable child instance id for CallFlow. */
  childTreeId?: string;
  updatedAtMs: number;
}

/**
 * Facts required to resume composite orchestration without deriving progress from
 * transient handler state.
 */
export interface WorkFlowOrchestrationFacts {
  attempts: Record<string, AttemptFact>;
  deadlines: Record<string, DeadlineFact>;
  lanes: Record<string, LaneFact>;
  winners: Record<string, WinnerFact>;
  cancellations: Record<string, CancellationFact>;
  composites: Record<string, CompositeInvocationFact>;
}

/** 快照信封：影响后续推进的信息必须全部在内（WF-6 判据） */
export interface WorkFlowSnapshot {
  schemaVersion: string;
  treeId: string;
  fqn: string;
  /** Last persisted process status; idempotent reads must not infer it from transient engine state. */
  status: WorkFlowStatus;
  /** vars 命名空间（含 state.seed 初值演化） */
  vars: Record<string, unknown>;
  input: Record<string, unknown>;
  /** 已选择 If 分支（按 `${ifPath}#${visitIndex}`）；分支 body 执行前持久化 */
  branchDecisions: Record<string, BranchDecision>;
  /** 已完成动作结果（按 invocationKey）：重放时跳过执行，避免副作用重复 */
  nodeResults: Record<string, TerminalResult>;
  /** 已收敛等待结果（按 invocationKey） */
  waitResults: Record<string, { result: TerminalResult; payload?: unknown }>;
  openWaitHandles: WaitHandle[];
  /** 已关闭句柄（Consumed/Expired/Cancelled，审计用） */
  closedWaitHandles: WaitHandle[];
  /** 已应用信号（`${waitHandleId}:${resumeToken}`），重复投递幂等 */
  appliedResumeSignals: string[];
  /** Durable orchestration progress; never reconstructed from an in-memory handler. */
  orchestration: WorkFlowOrchestrationFacts;
  lastTickNo: number;
  updatedAtMs: number;
}

export type WorkFlowStatus = 'Waiting' | 'Completed' | 'Failed';

export interface TickOutcome {
  status: WorkFlowStatus;
  treeId: string;
  vars: Record<string, unknown>;
  openWaitHandles: WaitHandle[];
  logs: string[];
  errors: string[];
  tickNo: number;
}

/** 状态外置存储（WF-1：DSL 不描述介质，这是引擎契约） */
export interface WorkFlowStore {
  load(treeId: string): Promise<WorkFlowSnapshot | undefined>;
  save(snapshot: WorkFlowSnapshot): Promise<void>;
  remove(treeId: string): Promise<void>;
}

export interface WorkFlowClock {
  now(): number;
}

export interface WorkFlowRuntime extends InstantFlowRuntime {
  /** 时钟注入（Timer/超时判定；缺省 Date.now） */
  now?: () => number;
}

export interface DurableChildFlowHandle {
  treeId: string;
  status: 'Waiting' | 'Completed' | 'Failed' | 'Cancelled';
  output?: unknown;
}

/**
 * Durable child lifecycle port. A resolver may execute InstantFlow directly,
 * but WorkFlow/BizProcess children must expose their persisted instance here.
 */
export interface DurableChildFlowResolver {
  start(reference: string, childTreeId: string, input: unknown): Promise<DurableChildFlowHandle>;
  inspect(reference: string, childTreeId: string): Promise<DurableChildFlowHandle>;
  cancel?(reference: string, childTreeId: string): Promise<void>;
}

export interface WorkFlowStartOptions {
  input?: Record<string, unknown>;
}

// ── status 标注视图（WF-7）：写在实例 xnl { } 块的协议枚举 ──

export type NodeViewStatus = 'Init' | 'Active' | 'Success' | 'Failure' | 'Waiting' | 'Omitted' | 'Cancelled';

export interface NodeAnnotation {
  status: NodeViewStatus;
  iterations?: number;
}

export interface TreeViewAnnotation {
  runStatus: WorkFlowStatus;
  tickNo: number;
  /** 节点 #id → 标注 */
  nodes: Record<string, NodeAnnotation>;
}
