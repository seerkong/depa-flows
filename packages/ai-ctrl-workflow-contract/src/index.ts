import type {
  AICtrlWorkflowDefinitionBinding,
  AICtrlWorkflowRunProfileState,
  AIWorkflowRuntimeContext,
  FlowRunCheckpoint,
} from 'ai-workflow-contract';
import type {
  ResumeSignal,
  TickOutcome,
  WaitHandle,
  WorkCtrlFlowSnapshot,
  WorkCtrlFlowStartOptions,
  WorkCtrlFlowStore,
} from 'work-ctrl-flow-contract';

export type AICtrlWorkflowRunStatus = 'Waiting' | 'Completed' | 'Failed';

export type AICtrlWorkflowNodeStatus = 'Succeeded' | 'Failed' | 'Waiting';

export interface AICtrlWorkflowDefinition {
  readonly binding: AICtrlWorkflowDefinitionBinding;
  readonly resourceRef?: string;
}

export interface AICtrlWorkflowNodeRecord {
  readonly nodeId: string;
  readonly invocationKey: string;
  readonly status: AICtrlWorkflowNodeStatus;
}

export interface AICtrlWorkflowRunRecord {
  readonly treeId: string;
  readonly fqn: string;
  readonly status: AICtrlWorkflowRunStatus;
  readonly tickNo: number;
  readonly openWaitHandles: readonly WaitHandle[];
  readonly nodes: readonly AICtrlWorkflowNodeRecord[];
}

export interface AICtrlWorkflowController {
  readonly store: WorkCtrlFlowStore;
  start(treeId: string, options?: WorkCtrlFlowStartOptions): Promise<TickOutcome>;
  resume(treeId: string, signal: ResumeSignal): Promise<TickOutcome>;
  refresh(treeId: string): Promise<TickOutcome>;
  getOutcome(treeId: string): Promise<TickOutcome | undefined>;
}

export interface AICtrlWorkflowRuntimeContextBinding {
  readonly ai: AIWorkflowRuntimeContext;
}

export interface AICtrlWorkflowSnapshotProjectionInput {
  readonly snapshot: WorkCtrlFlowSnapshot;
  readonly outcome?: TickOutcome;
}

export type AICtrlWorkflowRunCheckpoint = FlowRunCheckpoint<
  AICtrlWorkflowRunProfileState<WorkCtrlFlowSnapshot>
>;
