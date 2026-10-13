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
  FlowClosedObject,
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

export interface AIDataWorkflowDeclaredSubFlowBinding {
  readonly kind: 'declared';
  readonly flowRef: `eager-data-flow://${string}`;
}

export interface AIDataWorkflowAutonomousSubFlowBinding {
  readonly kind: 'autonomous';
  readonly schemaVersion: 'depa.ai-data-subflow-binding/v1';
  readonly capabilityId: string;
  readonly catalogDigest: string;
  readonly definitionRef: `resource://${string}`;
  readonly flowRef: `eager-data-flow://${string}`;
  readonly contractDigest: string;
}

export type AIDataWorkflowSubFlowBinding =
  | AIDataWorkflowDeclaredSubFlowBinding
  | AIDataWorkflowAutonomousSubFlowBinding;

export const AI_DATA_CHILD_INVOCATION_SCHEMA_VERSION = 'depa.ai-data-child-invocation/v1' as const;

export interface AIDataWorkflowChildInvocationIdentity {
  readonly schemaVersion: typeof AI_DATA_CHILD_INVOCATION_SCHEMA_VERSION;
  readonly invocationKey: string;
  readonly parentInstanceId: string;
  readonly parentRunId: string;
  readonly parentNodeId: string;
  readonly parentGeneration: number;
  readonly childInstanceId: string;
  readonly childRunId: string;
  readonly subflow: AIDataWorkflowAutonomousSubFlowBinding;
}

/** Immutable proof that the exact child resource closure was resolved before dispatch. */
export interface AIDataWorkflowChildFreezeReceipt {
  readonly schemaVersion: typeof AI_DATA_CHILD_INVOCATION_SCHEMA_VERSION;
  readonly invocationKey: string;
  readonly childInstanceId: string;
  readonly childRunId: string;
  readonly definitionRef: `resource://${string}`;
  readonly flowRef: `eager-data-flow://${string}`;
  readonly contractDigest: string;
  readonly definitionRevision: string;
  readonly definitionDigest: string;
}

export type AIDataWorkflowChildInvocationStatus =
  | 'Reserved'
  | 'Running'
  | 'Succeeded'
  | 'Failed';

/** Read-only child-owner projection. The parent never writes child lifecycle state. */
export interface AIDataWorkflowChildInvocationObservation {
  readonly schemaVersion: typeof AI_DATA_CHILD_INVOCATION_SCHEMA_VERSION;
  readonly invocationKey: string;
  readonly childInstanceId: string;
  readonly childRunId: string;
  readonly status: AIDataWorkflowChildInvocationStatus;
}

export interface AIDataWorkflowChildSucceededReceipt {
  readonly schemaVersion: typeof AI_DATA_CHILD_INVOCATION_SCHEMA_VERSION;
  readonly invocationKey: string;
  readonly childInstanceId: string;
  readonly childRunId: string;
  readonly definitionRef: `resource://${string}`;
  readonly flowRef: `eager-data-flow://${string}`;
  readonly contractDigest: string;
  readonly status: 'Succeeded';
  readonly output: FlowClosedObject;
  readonly receiptDigest: string;
}

export interface AIDataWorkflowChildFailedReceipt {
  readonly schemaVersion: typeof AI_DATA_CHILD_INVOCATION_SCHEMA_VERSION;
  readonly invocationKey: string;
  readonly childInstanceId: string;
  readonly childRunId: string;
  readonly definitionRef: `resource://${string}`;
  readonly flowRef: `eager-data-flow://${string}`;
  readonly contractDigest: string;
  readonly status: 'Failed';
  readonly failureCode: string;
  readonly failureMessage: string;
  readonly receiptDigest: string;
}

export type AIDataWorkflowChildTerminalReceipt =
  | AIDataWorkflowChildSucceededReceipt
  | AIDataWorkflowChildFailedReceipt;

export interface AIDataWorkflowResolveAndFreezeChildRequest {
  readonly identity: AIDataWorkflowChildInvocationIdentity;
}

export interface AIDataWorkflowStartOrContinueChildRequest {
  readonly identity: AIDataWorkflowChildInvocationIdentity;
  readonly freeze: AIDataWorkflowChildFreezeReceipt;
  readonly input: FlowClosedObject;
}

export interface AIDataWorkflowLoadChildRequest {
  readonly identity: AIDataWorkflowChildInvocationIdentity;
  readonly freeze: AIDataWorkflowChildFreezeReceipt;
}

export interface AIDataWorkflowSettleChildRequest extends AIDataWorkflowLoadChildRequest {
  readonly terminalStatus: 'Succeeded' | 'Failed';
}

/**
 * Narrow child-owner port. Every operation is idempotent for one deterministic identity;
 * startOrContinue must continue an existing child rather than create a successor.
 */
export interface AIDataWorkflowChildInvocationRuntimePort {
  resolveAndFreeze(
    request: AIDataWorkflowResolveAndFreezeChildRequest,
  ): Promise<AIDataWorkflowChildFreezeReceipt>;
  startOrContinue(
    request: AIDataWorkflowStartOrContinueChildRequest,
  ): Promise<AIDataWorkflowChildInvocationObservation>;
  load(
    request: AIDataWorkflowLoadChildRequest,
  ): Promise<AIDataWorkflowChildInvocationObservation>;
  settle(
    request: AIDataWorkflowSettleChildRequest,
  ): Promise<AIDataWorkflowChildTerminalReceipt>;
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
  readonly subflow?: AIDataWorkflowSubFlowBinding;
  readonly childInvocation?: AIDataWorkflowChildInvocationIdentity;
  readonly childFreezeReceipt?: AIDataWorkflowChildFreezeReceipt;
  readonly childTerminalReceipt?: AIDataWorkflowChildTerminalReceipt;
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
  readonly subflow?: AIDataWorkflowSubFlowBinding;
  readonly dependsOn?: readonly string[];
  readonly reusePolicy?: AIWorkflowEffectiveReusePolicy;
}

export interface AIDataWorkflowGraphPatchNodeChanges {
  readonly tag?: AIDataWorkflowNodeTag;
  readonly nodeType?: AIWorkflowNodeType;
  readonly inputs?: AIDataWorkflowNodeInputs;
  readonly outputs?: readonly string[];
  readonly config?: AIDataWorkflowNodeConfig;
  readonly subflow?: AIDataWorkflowSubFlowBinding | null;
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

/** 声明式 after 策略只允许重开标记过的前序任务，不添加反向 DAG 边。 */
export interface AIDataWorkflowAfterPolicy {
  readonly schemaVersion: 'depa.ai-data-after/v1';
  readonly targetNodeId: string;
  readonly resultPort: string;
  readonly decisionField: string;
  readonly reopenValue: string;
  readonly completeValue: string;
  readonly maxReopens: number;
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

export const AI_DATA_CONTROL_SCHEMA_VERSION = 'depa.ai-data-control/v1' as const;

export type AIDataControlSchemaVersion = typeof AI_DATA_CONTROL_SCHEMA_VERSION;

export interface AIDataControlGoal {
  readonly schemaVersion: AIDataControlSchemaVersion;
  readonly goalId: string;
  readonly objective: string;
  readonly verifierRef: `resource://${string}`;
  readonly requiredOutputSchemaRef: string;
}

export interface AIDataControlBudgetLimits {
  readonly maxIterations: number;
  readonly maxOperationsPerDecision: number;
  readonly maxNoProgressIterations: number;
  readonly maxTokens?: number;
  readonly deadlineEpochMs?: number;
}

export interface AIDataControlBudgetUsage {
  readonly iteration: number;
  readonly noProgressIterations: number;
  readonly tokensUsed?: number;
  readonly nowEpochMs?: number;
}

export interface AIDataControlBudget {
  readonly schemaVersion: AIDataControlSchemaVersion;
  readonly limits: AIDataControlBudgetLimits;
  readonly usage: AIDataControlBudgetUsage;
}

export interface AIDataControlBudgetProjection {
  readonly iteration: number;
  readonly remainingIterations: number;
  readonly remainingOperations: number;
  readonly noProgressIterations: number;
  readonly remainingNoProgressIterations: number;
  readonly remainingTokens?: number;
  readonly remainingMs?: number;
}

export interface AIDataControlNodeContract {
  readonly protected: boolean;
  readonly inputSchemaRefs: Readonly<Record<string, string>>;
  readonly outputSchemaRefs: Readonly<Record<string, string>>;
}

export interface AIDataControlCodeCapabilityImplementation {
  readonly kind: 'code';
  readonly codeRef: `resource://${string}`;
}

export interface AIDataControlAgentCapabilityImplementation {
  readonly kind: 'agent';
  readonly agentDefinitionRef: `resource://${string}`;
  readonly taskProofRef: `resource://${string}`;
}

export interface AIDataControlSubFlowCapabilityImplementation {
  readonly kind: 'subflow';
  readonly definitionRef: `resource://${string}`;
  readonly flowRef: `eager-data-flow://${string}`;
  readonly contractDigest: string;
  readonly callGraphDigest: string;
  readonly transitiveChildFlowRefs: readonly `eager-data-flow://${string}`[];
}

export type AIDataControlExecutableCapabilityImplementation =
  | AIDataControlCodeCapabilityImplementation
  | AIDataControlAgentCapabilityImplementation;

export interface AIDataControlCapabilityBase {
  readonly capabilityId: string;
  readonly inputSchemaRefs: Readonly<Record<string, string>>;
  readonly outputSchemaRefs: Readonly<Record<string, string>>;
  readonly fixedConfig: AIDataWorkflowNodeConfig;
}

export interface AIDataControlExecutableCapability extends AIDataControlCapabilityBase {
  readonly tag: 'TransformNode' | 'SinkNode';
  readonly nodeType: AIWorkflowNodeType;
  readonly implementation: AIDataControlExecutableCapabilityImplementation;
}

export interface AIDataControlSubFlowCapability extends AIDataControlCapabilityBase {
  readonly tag: 'SubFlowNode';
  readonly nodeType: 'subflow';
  readonly implementation: AIDataControlSubFlowCapabilityImplementation;
}

export type AIDataControlCapability =
  | AIDataControlExecutableCapability
  | AIDataControlSubFlowCapability;

export interface AIDataControlCapabilityCatalog {
  readonly schemaVersion: AIDataControlSchemaVersion;
  readonly catalogId: string;
  readonly digest: string;
  readonly foundationNodes: Readonly<Record<string, AIDataControlNodeContract>>;
  readonly capabilities: Readonly<Record<string, AIDataControlCapability>>;
}

export type AIDataControlVerifierStatus = 'not-run' | 'passed' | 'failed';

export interface AIDataControlDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly nodeId?: string;
}

export interface AIDataControlVerifierFact {
  readonly schemaVersion: AIDataControlSchemaVersion;
  readonly factId: string;
  readonly goalId: string;
  readonly graphGeneration: number;
  readonly status: AIDataControlVerifierStatus;
  readonly verifierRef: `resource://${string}`;
  readonly requiredOutputSchemaRef: string;
  readonly diagnostics: readonly AIDataControlDiagnostic[];
}

export interface AIDataControlObservedNode {
  readonly nodeId: string;
  readonly tag: AIDataWorkflowNodeTag;
  readonly nodeType: AIWorkflowNodeType;
  readonly status: AIDataWorkflowRunNodeStatus;
  readonly protected: boolean;
  readonly capabilityId?: string;
  readonly dependsOn: readonly string[];
  readonly inputSchemaRefs: Readonly<Record<string, string>>;
  readonly outputSchemaRefs: Readonly<Record<string, string>>;
}

export interface AIDataControlGraphObservation {
  readonly runId: string;
  readonly generation: number;
  readonly digest: string;
  readonly nodes: readonly AIDataControlObservedNode[];
}

export type AIDataControlFeedbackCode =
  | 'SCHEMA_VERSION_MISMATCH'
  | 'GOAL_MISMATCH'
  | 'CATALOG_MISMATCH'
  | 'STALE_OBSERVATION'
  | 'BUDGET_EXHAUSTED'
  | 'INVALID_OPERATION_COUNT'
  | 'DUPLICATE_TARGET'
  | 'PROTECTED_NODE'
  | 'UNKNOWN_CAPABILITY'
  | 'UNKNOWN_NODE'
  | 'INPUT_CONTRACT_MISMATCH'
  | 'OUTPUT_CONTRACT_MISMATCH'
  | 'RECURSIVE_SUBFLOW'
  | 'NO_PROGRESS'
  | 'VERIFIER_REQUIRED'
  | 'VERIFIER_MISMATCH'
  | 'INVALID_DECISION';

export interface AIDataControlFeedback {
  readonly code: AIDataControlFeedbackCode;
  readonly message: string;
  readonly operationIndex?: number;
  readonly nodeId?: string;
  readonly port?: string;
}

export interface AIDataControlObservation {
  readonly schemaVersion: AIDataControlSchemaVersion;
  readonly observationId: string;
  readonly observationDigest: string;
  readonly goalId: string;
  readonly catalogDigest: string;
  readonly graph: AIDataControlGraphObservation;
  readonly verifier: AIDataControlVerifierFact;
  readonly budget: AIDataControlBudgetProjection;
  readonly feedback: readonly AIDataControlFeedback[];
}

export interface AIDataControlPortInputBinding {
  readonly kind: 'port';
  readonly nodeId: string;
  readonly port: string;
  readonly schemaRef: string;
}

export interface AIDataControlLiteralInputBinding {
  readonly kind: 'literal';
  readonly schemaRef: string;
  readonly value: EagerDataFlowValue;
}

export type AIDataControlInputBinding =
  | AIDataControlPortInputBinding
  | AIDataControlLiteralInputBinding;

export interface AIDataControlAddCapabilityOperation {
  readonly op: 'add-capability';
  readonly nodeId: string;
  readonly capabilityId: string;
  readonly inputs: Readonly<Record<string, AIDataControlInputBinding>>;
  readonly dependsOn?: readonly string[];
}

export interface AIDataControlRewireCapabilityOperation {
  readonly op: 'rewire-capability';
  readonly nodeId: string;
  readonly capabilityId: string;
  readonly inputs: Readonly<Record<string, AIDataControlInputBinding>>;
  readonly dependsOn?: readonly string[];
}

export interface AIDataControlAddSubFlowOperation {
  readonly op: 'add-subflow';
  readonly nodeId: string;
  readonly subflowCapabilityId: string;
  readonly inputs: Readonly<Record<string, AIDataControlInputBinding>>;
  readonly dependsOn?: readonly string[];
}

export interface AIDataControlRewireSubFlowOperation {
  readonly op: 'rewire-subflow';
  readonly nodeId: string;
  readonly subflowCapabilityId: string;
  readonly inputs: Readonly<Record<string, AIDataControlInputBinding>>;
  readonly dependsOn?: readonly string[];
}

export interface AIDataControlRemoveNodeOperation {
  readonly op: 'remove-node';
  readonly nodeId: string;
}

export type AIDataControlRevisionOperation =
  | AIDataControlAddCapabilityOperation
  | AIDataControlRewireCapabilityOperation
  | AIDataControlAddSubFlowOperation
  | AIDataControlRewireSubFlowOperation
  | AIDataControlRemoveNodeOperation;

interface AIDataControlDecisionBase {
  readonly schemaVersion: AIDataControlSchemaVersion;
  readonly decisionId: string;
  readonly goalId: string;
  readonly observationId: string;
  readonly observationDigest: string;
  readonly catalogDigest: string;
  readonly reason: string;
}

export interface AIDataControlReviseDecision extends AIDataControlDecisionBase {
  readonly kind: 'revise';
  readonly operations: readonly AIDataControlRevisionOperation[];
}

export interface AIDataControlCompleteDecision extends AIDataControlDecisionBase {
  readonly kind: 'complete';
  readonly verifierFactId: string;
  readonly outputNodeId: string;
  readonly outputPort: string;
  readonly outputSchemaRef: string;
}

export type AIDataControlFailureCode =
  | 'CONTROLLER_DECLARED_FAILURE'
  | 'GOAL_UNREACHABLE'
  | 'BUDGET_EXHAUSTED'
  | 'NO_PROGRESS';

export interface AIDataControlFailDecision extends AIDataControlDecisionBase {
  readonly kind: 'fail';
  readonly failureCode: AIDataControlFailureCode;
}

export type AIDataControlDecision =
  | AIDataControlReviseDecision
  | AIDataControlCompleteDecision
  | AIDataControlFailDecision;

interface AIDataControlAdmissionBase {
  readonly schemaVersion: AIDataControlSchemaVersion;
  readonly decisionId: string;
  readonly decisionDigest: string;
}

export interface AIDataControlPatchAdmission extends AIDataControlAdmissionBase {
  readonly kind: 'patch';
  readonly patch: AIDataWorkflowGraphPatch;
}

export interface AIDataControlCompletionAdmission extends AIDataControlAdmissionBase {
  readonly kind: 'complete';
  readonly verifierFactId: string;
  readonly outputNodeId: string;
  readonly outputPort: string;
  readonly outputSchemaRef: string;
}

export interface AIDataControlFailureAdmission extends AIDataControlAdmissionBase {
  readonly kind: 'fail';
  readonly failureCode: AIDataControlFailureCode;
  readonly reason: string;
}

export interface AIDataControlRejectedAdmission extends AIDataControlAdmissionBase {
  readonly kind: 'rejected';
  readonly feedback: readonly AIDataControlFeedback[];
  readonly terminal: boolean;
}

export type AIDataControlAdmission =
  | AIDataControlPatchAdmission
  | AIDataControlCompletionAdmission
  | AIDataControlFailureAdmission
  | AIDataControlRejectedAdmission;

export interface AIDataControlIterationReceipt {
  readonly schemaVersion: AIDataControlSchemaVersion;
  readonly iteration: number;
  readonly observationId: string;
  readonly observationDigest: string;
  readonly decisionId: string;
  readonly decisionDigest: string;
  readonly admissionKind: AIDataControlAdmission['kind'];
  readonly generationBefore: number;
  readonly generationAfter: number;
}
