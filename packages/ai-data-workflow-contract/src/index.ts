import type {
  AIDataWorkflowRunProfileState,
  AIDataWorkflowDefinitionBinding,
  AIWorkflowDefinitionRef,
  AIWorkflowEffectiveReusePolicy,
  AIWorkflowNodeResult,
  AIWorkflowNodeType,
  AIWorkflowReusePolicy,
  AIWorkflowRunRef,
  AIWorkflowRunStatus,
  AIWorkflowSemanticFingerprint,
  FlowRunCheckpoint,
} from 'ai-workflow-contract';
import type {
  EagerDataFlowAuthoringPlan,
  EagerDataFlowNodePlan,
  EagerDataFlowValue,
  FlowPortReference,
} from 'eager-data-flow-contract';

export type AIDataWorkflowRunNodeStatus =
  | 'Pending'
  | 'Ready'
  | 'Running'
  | 'Succeeded'
  | 'Failed'
  | 'Invalidated'
  | 'Reused'
  | 'Removed';

export type AIDataWorkflowNodeTag = EagerDataFlowNodePlan['tag'] | (string & {});

export type AIDataWorkflowNodeInputBinding = FlowPortReference | EagerDataFlowValue;

export type AIDataWorkflowNodeInputs = Readonly<Record<string, AIDataWorkflowNodeInputBinding>>;

export type AIDataWorkflowNodeConfig = Readonly<Record<string, EagerDataFlowValue>>;

export interface AIDataWorkflowInvalidation {
  readonly nodeId: string;
  readonly generation: number;
  readonly reason: string;
  readonly sourceNodeId: string;
  readonly atMs?: number;
}

export interface AIDataWorkflowRunNode {
  readonly id: string;
  readonly tag: AIDataWorkflowNodeTag;
  readonly nodeType: AIWorkflowNodeType;
  readonly generation: number;
  readonly status: AIDataWorkflowRunNodeStatus;
  readonly declarationIndex: number;
  readonly inputs: AIDataWorkflowNodeInputs;
  readonly outputs: readonly string[];
  readonly config: AIDataWorkflowNodeConfig;
  readonly dependsOn: readonly string[];
  readonly dependents: readonly string[];
  readonly reusePolicy: AIWorkflowEffectiveReusePolicy;
  readonly semanticFingerprint?: AIWorkflowSemanticFingerprint;
  readonly result?: AIWorkflowNodeResult;
  readonly invalidatedBy?: readonly AIDataWorkflowInvalidation[];
}

export interface AIDataWorkflowGraphPatchNodeSpec {
  readonly id: string;
  readonly tag?: AIDataWorkflowNodeTag;
  readonly nodeType?: AIWorkflowNodeType;
  readonly declarationIndex?: number;
  readonly inputs?: AIDataWorkflowNodeInputs;
  readonly outputs?: readonly string[];
  readonly config?: AIDataWorkflowNodeConfig;
  readonly dependsOn?: readonly string[];
  readonly reusePolicy?: AIWorkflowEffectiveReusePolicy;
}

export interface AIDataWorkflowGraphPatchNodeChanges {
  readonly tag?: AIDataWorkflowNodeTag;
  readonly nodeType?: AIWorkflowNodeType;
  readonly inputs?: AIDataWorkflowNodeInputs;
  readonly outputs?: readonly string[];
  readonly config?: AIDataWorkflowNodeConfig;
  readonly dependsOn?: readonly string[];
  readonly reusePolicy?: AIWorkflowEffectiveReusePolicy;
}

export interface AIDataWorkflowGraphPatchAddNodeOperation {
  readonly op: 'add-node';
  readonly node: AIDataWorkflowGraphPatchNodeSpec;
}

export interface AIDataWorkflowGraphPatchUpdateNodeOperation {
  readonly op: 'update-node';
  readonly nodeId: string;
  readonly changes: AIDataWorkflowGraphPatchNodeChanges;
}

export interface AIDataWorkflowGraphPatchRemoveNodeOperation {
  readonly op: 'remove-node';
  readonly nodeId: string;
}

export type AIDataWorkflowGraphPatchOperation =
  | AIDataWorkflowGraphPatchAddNodeOperation
  | AIDataWorkflowGraphPatchUpdateNodeOperation
  | AIDataWorkflowGraphPatchRemoveNodeOperation;

export interface AIDataWorkflowGraphPatch {
  readonly patchId: string;
  readonly generation?: number;
  readonly reason?: string;
  readonly operations: readonly AIDataWorkflowGraphPatchOperation[];
  readonly atMs?: number;
}

export interface AIDataWorkflowPatchRecord {
  readonly patchId: string;
  readonly generation: number;
  readonly reason?: string;
  readonly operations: readonly AIDataWorkflowGraphPatchOperation[];
  readonly atMs?: number;
}

export interface AIDataWorkflowRunGraph {
  readonly runId: string;
  readonly binding: AIDataWorkflowDefinitionBinding;
  readonly platformDefaultPolicy?: AIWorkflowReusePolicy;
  readonly currentGeneration: number;
  readonly nodes: Readonly<Record<string, AIDataWorkflowRunNode>>;
  readonly declarationOrder: readonly string[];
  readonly patchHistory: readonly AIDataWorkflowPatchRecord[];
  readonly invalidations: readonly AIDataWorkflowInvalidation[];
}

export interface AIDataWorkflowSemanticInput {
  readonly nodeId: string;
  readonly nodeTag: AIDataWorkflowNodeTag;
  readonly effectiveInput: unknown;
  readonly config?: AIDataWorkflowNodeConfig;
  readonly materialRevisions?: Readonly<Record<string, string>>;
  readonly effectPolicy?: unknown;
}

export interface AIDataWorkflowReuseCandidate {
  readonly runId: string;
  readonly nodeId: string;
  readonly generation: number;
  readonly result: AIWorkflowNodeResult;
  readonly semanticFingerprint: AIWorkflowSemanticFingerprint;
}

export interface AIDataWorkflowRunRecord {
  readonly ref: AIWorkflowRunRef;
  readonly status: AIWorkflowRunStatus;
  readonly workflow: AIWorkflowDefinitionRef;
  readonly graph: AIDataWorkflowRunGraph;
}

export interface AIDataWorkflowDefinition {
  readonly binding: AIDataWorkflowDefinitionBinding;
  readonly resourceRef?: string;
}

export interface AIDataWorkflowPlanProjection {
  readonly binding: AIDataWorkflowDefinitionBinding;
  readonly plan: EagerDataFlowAuthoringPlan;
}

export type AIDataWorkflowRunCheckpoint = FlowRunCheckpoint<
  AIDataWorkflowRunProfileState<AIDataWorkflowRunGraph>
>;
