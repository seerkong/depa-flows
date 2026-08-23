import type { EagerDataFlowAuthoringPlan, EagerDataFlowValue } from 'eager-data-flow-contract';
import type {
  ResourceDependencyEdge,
  ResourceDependencySnapshot,
  ResourceRecord,
  ResourceRegistry,
  ResourceTree,
  ResourceValue,
  Sha256Digest,
} from 'halfcode-compiler.xnl/resource-core';
import type {
  FlowBundleSpec,
  FlowClosedObject,
  FlowClosedValue,
  FlowRunCheckpoint,
  FlowRunCheckpointKey,
  FlowRunCheckpointRuntime as GenericFlowRunCheckpointRuntime,
  WorkCtrlFlowRuntime,
} from 'work-ctrl-flow-contract';

export {
  FLOW_INSTANCE_SCHEMA_VERSION,
  FLOW_RUN_CHECKPOINT_SCHEMA_VERSION,
  type FlowClosedArray,
  type FlowClosedObject,
  type FlowClosedPrimitive,
  type FlowClosedValue,
  type FlowDefinitionArtifactIdentity,
  type FlowDefinitionProvenance,
  type FlowInstanceDescriptor,
  type FlowRunCheckpoint,
  type FlowRunStepExtensionFact,
  type FlowRunStepExtensions,
  type FlowRunCheckpointCommit,
  type FlowRunCheckpointKey,
  type FlowRunCheckpointStore,
  } from 'work-ctrl-flow-contract';

export type AIWorkflowKind = 'AICtrlWorkflow' | 'AIDataWorkflow';

export type AIWorkflowSubstrate = 'WorkCtrlFlow' | 'EagerDataFlow';

export type AIWorkflowReusePolicy = 'semantic-hash' | 'never';

export type AIWorkflowReusePolicySource = 'node' | 'node-type-default' | 'platform-default';

/** @deprecated Generic resource-reference authority belongs to Halfcode. */
export type AIWorkflowResourceRefScheme = 'vfs' | 'resource' | 'config' | 'secret';

/** @deprecated Retained for 0.1.x compatibility; do not use for resource discovery. */
export const AI_WORKFLOW_ALLOWED_RESOURCE_REF_SCHEMES = Object.freeze([
  'vfs',
  'resource',
  'config',
  'secret',
] as const satisfies readonly AIWorkflowResourceRefScheme[]);

/** @deprecated Use normalized Halfcode ResourceRecord facts and typed domain refs. */
export type AIWorkflowResourceRef = `${AIWorkflowResourceRefScheme}://${string}`;

/** @deprecated This open vocabulary is not a Kind registry. Halfcode owns KindDefinition. */
export type AIWorkflowResourceKind =
  | 'AIWorkflowAppBundle'
  | 'AIWorkflowCatalog'
  | 'AICtrlWorkflow'
  | 'AIDataWorkflow'
  | 'AIAgentDefinition'
  | 'MaterialPort'
  | 'MaterialBinding'
  | 'MessageSchema'
  | 'Config'
  | 'SecretHandle'
  | (string & {});

/** @deprecated Halfcode ResourceRecord owns generic resource identity and provenance. */
export interface AIWorkflowResourceIdentity {
  readonly kind: AIWorkflowResourceKind;
  readonly fqn: string;
  readonly ref: `resource://${string}`;
  readonly revision?: string;
}

/** @deprecated Halfcode ResourcePackage/Catalog owns generic resource membership. */
export interface AIWorkflowCatalogEntry {
  readonly id: string;
  readonly kind: AIWorkflowResourceKind;
  readonly ref: AIWorkflowResourceRef;
  readonly fqn?: string;
}

/** @deprecated Halfcode ResourcePackage/Catalog owns generic resource membership. */
export interface AIWorkflowResourceCatalog {
  readonly id: string;
  readonly entries: readonly AIWorkflowCatalogEntry[];
}

/**
 * @deprecated Compatibility DTO for the pre-Halfcode catalog surface.
 * Use AIWorkflowAppBundleProjection for canonical consumers.
 */
export interface AIWorkflowAppBundleManifest {
  readonly kind: 'AIWorkflowAppBundle';
  readonly fqn: string;
  readonly catalog: AIWorkflowResourceCatalog;
  readonly entrypoints?: readonly AIWorkflowResourceRef[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type AIWorkflowDefinitionResourceKind = 'AICtrlWorkflow' | 'AIDataWorkflow';

/**
 * Minimal public Halfcode read port. ResourceTree.registry and
 * EffectiveResourceRegistry both satisfy this shape without depa-flows owning
 * either registry implementation.
 */
export type AIWorkflowResourceRegistryView = Pick<ResourceRegistry, 'byKind'>;

export interface AIWorkflowBindingProjection {
  readonly id: string;
  readonly kind: AIWorkflowDefinitionResourceKind;
  readonly ref: `resource://${string}`;
  readonly entrypoint: boolean;
  readonly resource: ResourceRecord;
}

export interface AIWorkflowAppBundleProjection {
  readonly kind: 'AIWorkflowAppBundle';
  readonly fqn: string;
  readonly packageResourceId?: string;
  readonly resource: ResourceRecord;
  readonly workflowBindings: readonly AIWorkflowBindingProjection[];
  readonly entrypoints: readonly AIWorkflowBindingProjection[];
}

export interface AIWorkflowResourceProjectionDiagnostic {
  readonly code: string;
  readonly location: string;
  readonly message: string;
}

export interface ProjectAIWorkflowAppBundlesOptions {
  readonly packageResourceId?: string;
}

export interface LoadedAIWorkflowResourcePackage {
  readonly tree: ResourceTree;
  readonly appBundles: readonly AIWorkflowAppBundleProjection[];
}

export type AIAgentMessageRole = 'system' | 'developer' | 'user' | 'assistant';

export type MaterialCardinality = 'one' | 'many';

export type AIWorkflowAgentResourceRelation =
  | 'agent-message-prompt'
  | 'agent-message-schema'
  | 'agent-input-schema'
  | 'agent-output-schema'
  | 'agent-tool'
  | 'agent-effect-policy'
  | 'agent-material-port'
  | 'material-port-schema'
  | 'material-binding-port'
  | 'material-binding-material'
  | 'workflow-agent-task'
  | 'workflow-material-binding';

export interface AIWorkflowTypedResourceRef {
  readonly kind: string;
  readonly ref: `resource://${string}`;
  readonly resource: ResourceRecord;
}

export interface AIWorkflowMessageSchemaProjection extends AIWorkflowTypedResourceRef {
  readonly kind: 'MessageSchema';
  readonly schema: Readonly<Record<string, ResourceValue>>;
}

export type AIWorkflowEffectToolMode = 'declared-only' | 'none';

export interface AIWorkflowEffectPolicyProjection extends AIWorkflowTypedResourceRef {
  readonly kind: 'EffectPolicy';
  readonly toolMode: AIWorkflowEffectToolMode;
}

export interface AIWorkflowMaterialValueProjection extends AIWorkflowTypedResourceRef {
  readonly value: ResourceValue;
}

export interface AIAgentMessageProjection {
  readonly id: string;
  readonly role: AIAgentMessageRole;
  readonly prompt: AIWorkflowTypedResourceRef;
  readonly schema?: AIWorkflowMessageSchemaProjection;
}

export interface MaterialPortProjection {
  readonly kind: 'MaterialPort';
  readonly fqn: string;
  readonly resource: ResourceRecord;
  readonly materialKind: string;
  readonly required: boolean;
  readonly cardinality: MaterialCardinality;
  readonly schema?: AIWorkflowMessageSchemaProjection;
}

export interface AIAgentDefinitionProjection {
  readonly kind: 'AIAgentDefinition';
  readonly fqn: string;
  readonly resource: ResourceRecord;
  readonly messages: readonly AIAgentMessageProjection[];
  readonly inputSchema?: AIWorkflowMessageSchemaProjection;
  readonly outputSchema?: AIWorkflowMessageSchemaProjection;
  readonly tools: readonly AIWorkflowTypedResourceRef[];
  readonly effectPolicy?: AIWorkflowEffectPolicyProjection;
  readonly materialPorts: readonly AIWorkflowTypedResourceRef[];
}

export interface AIWorkflowAgentTaskRef {
  readonly workflowKind: AIWorkflowDefinitionResourceKind;
  readonly workflowRef: `resource://${string}`;
  readonly nodeId: string;
  readonly agentDefinitionRef: `resource://${string}`;
}

export interface MaterialBindingProjection {
  readonly kind: 'MaterialBinding';
  readonly fqn: string;
  readonly resource: ResourceRecord;
  readonly task: AIWorkflowAgentTaskRef;
  readonly port: MaterialPortProjection;
  readonly material: AIWorkflowMaterialValueProjection;
}

export interface AIWorkflowAgentResourceProjection {
  readonly agentDefinitions: readonly AIAgentDefinitionProjection[];
  readonly materialPorts: readonly MaterialPortProjection[];
  readonly materialBindings: readonly MaterialBindingProjection[];
  readonly dependencyEdges: readonly ResourceDependencyEdge[];
}

export interface AIWorkflowRunResourceFreezeReceipt {
  readonly schemaVersion: 'ai-workflow.run-resource-freeze/v1';
  readonly task: AIWorkflowAgentTaskRef;
  readonly bindingResourceIds: readonly string[];
  readonly dependencySnapshot: ResourceDependencySnapshot;
  readonly semanticFingerprint: Sha256Digest;
}

/** In-memory proof projected only from an admitted run-resource freeze receipt. */
export interface FrozenAIAgentTaskBinding {
  readonly schemaVersion: 'ai-workflow.frozen-agent-task-binding/v1';
  readonly task: AIWorkflowAgentTaskRef;
  readonly semanticFingerprint: Sha256Digest;
  readonly snapshotRevision: Sha256Digest;
  readonly closureResourceIds: readonly string[];
}

export type AIWorkflowNodeType =
  | 'agent'
  | 'data'
  | 'effect'
  | 'manual'
  | 'subflow'
  | 'tool'
  | (string & {});

export const AI_WORKFLOW_MACHINE_NODE_DEFAULT_REUSE_POLICY = 'semantic-hash' as const;

export const AI_WORKFLOW_MANUAL_NODE_DEFAULT_REUSE_POLICY = 'never' as const;

export interface AIWorkflowProfileDescriptor<
  Kind extends AIWorkflowKind = AIWorkflowKind,
  Substrate extends AIWorkflowSubstrate = AIWorkflowSubstrate,
> {
  readonly kind: Kind;
  readonly substrate: Substrate;
  readonly defaultReusePolicy: AIWorkflowReusePolicy;
  readonly manualNodeDefaultReusePolicy: 'never';
}

export const AI_CTRL_WORKFLOW_DESCRIPTOR = Object.freeze({
  kind: 'AICtrlWorkflow',
  substrate: 'WorkCtrlFlow',
  defaultReusePolicy: AI_WORKFLOW_MACHINE_NODE_DEFAULT_REUSE_POLICY,
  manualNodeDefaultReusePolicy: AI_WORKFLOW_MANUAL_NODE_DEFAULT_REUSE_POLICY,
} satisfies AIWorkflowProfileDescriptor<'AICtrlWorkflow', 'WorkCtrlFlow'>);

export const AI_DATA_WORKFLOW_DESCRIPTOR = Object.freeze({
  kind: 'AIDataWorkflow',
  substrate: 'EagerDataFlow',
  defaultReusePolicy: AI_WORKFLOW_MACHINE_NODE_DEFAULT_REUSE_POLICY,
  manualNodeDefaultReusePolicy: AI_WORKFLOW_MANUAL_NODE_DEFAULT_REUSE_POLICY,
} satisfies AIWorkflowProfileDescriptor<'AIDataWorkflow', 'EagerDataFlow'>);

export type AIWorkflowDefinitionRefScheme = 'resource' | 'vfs' | (string & {});

export interface AIWorkflowDefinitionRef {
  readonly ref: string;
  readonly scheme?: AIWorkflowDefinitionRefScheme;
  readonly fqn?: string;
  readonly revision?: string;
}

export interface AIWorkflowRunRef {
  readonly workflow: AIWorkflowDefinitionRef;
  readonly runId: string;
  readonly generation: number;
  readonly parentGeneration?: number;
}

export interface AIWorkflowRuntimeRoots {
  /**
   * Wrapper-provided global AI workflow state root. The contract treats it as
   * opaque; it may be a VFS URI, content-addressed root, or host-specific path
   * resolved outside core logic.
   */
  readonly globalRoot: string;
  /**
   * Wrapper-provided workspace AI workflow state root. Core logic must not
   * derive this value from process cwd or environment variables.
   */
  readonly workspaceRoot: string;
}

export interface AIWorkflowSemanticFingerprintPart {
  readonly name: string;
  readonly value: string;
}

export interface AIWorkflowSemanticFingerprint {
  readonly algorithm: 'semantic-hash/v1' | (string & {});
  readonly value: string;
  readonly parts?: readonly AIWorkflowSemanticFingerprintPart[];
}

export interface AIWorkflowEffectiveReusePolicy {
  readonly policy: AIWorkflowReusePolicy;
  readonly source: AIWorkflowReusePolicySource;
  readonly nodeType: AIWorkflowNodeType;
}

export type AIWorkflowRunStatus = 'Pending' | 'Running' | 'Waiting' | 'Succeeded' | 'Failed' | 'Cancelled';

export type AIWorkflowNodeStatus =
  | 'Pending'
  | 'Running'
  | 'Waiting'
  | 'Succeeded'
  | 'Failed'
  | 'Cancelled'
  | 'Invalidated'
  | 'Reused';

export interface AIWorkflowNodeResult {
  readonly nodeId: string;
  readonly generation: number;
  readonly status: AIWorkflowNodeStatus;
  readonly output?: unknown;
  readonly semanticFingerprint?: AIWorkflowSemanticFingerprint;
  readonly reusedFrom?: {
    readonly runId: string;
    readonly generation: number;
    readonly nodeId: string;
  };
}

export interface AIWorkflowRunEvent {
  readonly eventId: string;
  readonly runId: string;
  readonly generation: number;
  readonly type: string;
  readonly atMs: number;
  readonly nodeId?: string;
  readonly payload?: unknown;
}

export interface AIWorkflowRunState {
  readonly ref: AIWorkflowRunRef;
  readonly status: AIWorkflowRunStatus;
  readonly nodes: Readonly<Record<string, AIWorkflowNodeResult>>;
  readonly events?: readonly AIWorkflowRunEvent[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface WorkCtrlFlowRunProfileState<Snapshot = FlowClosedObject> {
  readonly kind: 'WorkCtrlFlow';
  readonly snapshot: Snapshot;
}

export const AI_AGENT_CHECKPOINT_STATE_SCHEMA_VERSION = 'depa.ai-agent-state/v1' as const;

/** Opaque identity owned by an external agent/runtime authority. */
export interface AIWorkflowExternalRuntimeReference {
  readonly authority: string;
  readonly instanceId: string;
  readonly instanceName?: string;
  readonly sessionId?: string;
  readonly agentDefinitionRef?: `resource://${string}`;
  readonly metadata?: FlowClosedObject;
}

/** Audit linkage without copying external conversation or execution history. */
export interface AIWorkflowExecutionReceipt {
  readonly nodeId: string;
  readonly externalRuntimeRef: string;
  readonly metadata?: FlowClosedObject;
}

export type AIAgentSelector =
  | { readonly byInstanceId: string; readonly byInstanceName?: never }
  | { readonly byInstanceName: string; readonly byInstanceId?: never };

export interface AIAgentInvocation<Input extends FlowClosedValue = FlowClosedValue> {
  readonly kind: 'ai.agent';
  readonly payload: Input;
  readonly metadata?: FlowClosedObject;
}

export interface AIAgentEffectConfig {
  readonly agentDefinitionRef: `resource://${string}`;
  readonly instanceName?: string;
  readonly materialRefs?: readonly string[];
  readonly effectPolicy?: FlowClosedObject;
}

export interface AIAgentInstanceReference {
  readonly authority: string;
  readonly instanceId: string;
  readonly instanceName?: string;
  readonly sessionId?: string;
  readonly agentDefinitionRef: `resource://${string}`;
  readonly metadata?: FlowClosedObject;
}

export interface AIAgentInvocationReceipt {
  readonly invocationKey: string;
  readonly nodeId: string;
  readonly status: 'pending' | 'completed';
  readonly mode: 'new' | 'targeted';
  readonly agentDefinitionRef: `resource://${string}`;
  readonly instanceName?: string;
  readonly instanceId?: string;
  readonly generation?: number;
  readonly input: FlowClosedValue;
  /** Exact static/invocation semantics bound to this idempotency key. */
  readonly semanticFacts: FlowClosedObject;
  readonly metadata?: FlowClosedObject;
  readonly output?: FlowClosedValue;
  readonly hostReceipt?: FlowClosedObject;
}

export interface AIAgentRunResult<Output extends FlowClosedValue = FlowClosedValue> {
  readonly output: Output;
  readonly instance: AIAgentInstanceReference;
  readonly receipt: {
    readonly invocationKey: string;
    readonly nodeId: string;
    readonly status: 'pending' | 'completed';
  };
}

export interface AIAgentHostRunRequest<Input extends FlowClosedValue = FlowClosedValue> {
  readonly invocationKey: string;
  readonly flowInstanceId: string;
  readonly runId: string;
  readonly nodeId: string;
  readonly generation?: number;
  readonly input: Input;
  readonly agentDefinitionRef: `resource://${string}`;
  readonly instanceName?: string;
  readonly materialRefs?: readonly string[];
  readonly effectPolicy?: FlowClosedObject;
  readonly signal?: AbortSignal;
  readonly metadata?: FlowClosedObject;
}

export interface AIAgentHostTargetedRunRequest<Input extends FlowClosedValue = FlowClosedValue>
  extends AIAgentHostRunRequest<Input> {
  readonly instance: AIAgentInstanceReference;
}

export interface AIAgentHostRunResult<Output extends FlowClosedValue = FlowClosedValue> {
  readonly output: Output;
  readonly instance: Omit<AIAgentInstanceReference, 'agentDefinitionRef'> & {
    readonly agentDefinitionRef?: `resource://${string}`;
  };
  readonly hostReceipt?: FlowClosedObject;
}

/** Host-owned typed effect boundary. It is deliberately not a generic dispatcher. */
export interface AIAgentHostEffectPort {
  runAgent(request: AIAgentHostRunRequest): Promise<AIAgentHostRunResult>;
  runTargetedAgent(request: AIAgentHostTargetedRunRequest): Promise<AIAgentHostRunResult>;
}

export interface AIAgentProcessorRuntime {
  readonly checkpointRuntime: FlowRunCheckpointRuntime;
  readonly checkpointKey: FlowRunCheckpointKey;
  readonly nodeId: string;
  readonly invocationKey: string;
  readonly workflowKind: AIWorkflowDefinitionResourceKind;
  readonly workflowRef: `resource://${string}`;
  readonly taskBinding: AIWorkflowAgentTaskRef;
  readonly generation?: number;
  readonly effects: AIAgentHostEffectPort;
  readonly signal?: AbortSignal;
  readonly metadata?: FlowClosedObject;
}

export interface AIWorkflowAuthoredEffects {
  runAgent<Input extends FlowClosedValue = FlowClosedValue, Output extends FlowClosedValue = FlowClosedValue>(
    input: Input,
    config: AIAgentEffectConfig,
  ): Promise<AIAgentRunResult<Output>>;
  runTargetedAgent<Input extends FlowClosedValue = FlowClosedValue, Output extends FlowClosedValue = FlowClosedValue>(
    selector: AIAgentSelector,
    invocation: AIAgentInvocation<Input>,
    config: AIAgentEffectConfig,
  ): Promise<AIAgentRunResult<Output>>;
}

export interface RunStepExtensionSelector {
  readonly instanceId: string;
  readonly runId: string;
  readonly stepId: string;
  readonly kind: string;
}

export interface RunStepExtensionMutationInvocation {
  readonly expectedRevision: number;
  readonly value: FlowClosedValue;
}

export type RunStepExtensionMutationConfig = Readonly<Record<string, never>>;

/** Runtime-bound authored facade for the targeted StepExtension Processor. */
export interface AIWorkflowAuthoredStepExtensions {
  mutateRunStepExtension(
    selector: RunStepExtensionSelector,
    invocation: RunStepExtensionMutationInvocation,
    config: RunStepExtensionMutationConfig,
  ): Promise<AIWorkflowFlowRunCheckpoint>;
}

/** Closed durable AI profile state stored inside the Flow checkpoint owner. */
export interface AIWorkflowProfileDurableState {
  readonly schemaVersion: typeof AI_AGENT_CHECKPOINT_STATE_SCHEMA_VERSION;
  readonly instancesById: Readonly<Record<string, AIAgentInstanceReference>>;
  readonly instanceIdByName: Readonly<Record<string, string>>;
  readonly invocationsByKey: Readonly<Record<string, AIAgentInvocationReceipt>>;
}

/** Explicit read-only input accepted only by the one-way legacy upgrade helper. */
export interface LegacyAIWorkflowProfileDurableState {
  readonly externalRuntimeRefs: Readonly<Record<string, AIWorkflowExternalRuntimeReference>>;
  readonly receipts: readonly AIWorkflowExecutionReceipt[];
}

export interface AICtrlWorkflowRunProfileState<
  Snapshot = FlowClosedObject,
  AIState = AIWorkflowProfileDurableState,
> {
  readonly kind: 'AICtrlWorkflow';
  readonly snapshot: Snapshot;
  readonly ai: AIState;
}

export interface AIDataWorkflowRunProfileState<
  RunGraph = FlowClosedObject,
  AIState = AIWorkflowProfileDurableState,
> {
  readonly kind: 'AIDataWorkflow';
  readonly runGraph: RunGraph;
  readonly ai: AIState;
}

export type FlowRunProfileState =
  | WorkCtrlFlowRunProfileState
  | AICtrlWorkflowRunProfileState
  | AIDataWorkflowRunProfileState;

export type AIWorkflowFlowRunCheckpoint = FlowRunCheckpoint<FlowRunProfileState>;

export type FlowRunCheckpointRuntime = GenericFlowRunCheckpointRuntime<FlowRunProfileState>;

export interface AIWorkflowReusableNodeResultRequest {
  readonly run: AIWorkflowRunRef;
  readonly nodeId: string;
  readonly nodeType: AIWorkflowNodeType;
  readonly fingerprint: AIWorkflowSemanticFingerprint;
  readonly policy: AIWorkflowEffectiveReusePolicy;
}

/** Read-only, rebuildable view over canonical FlowRunCheckpoint facts. */
export interface AIWorkflowStateProjection {
  loadRunState(ref: AIWorkflowRunRef): Promise<AIWorkflowRunState | undefined>;
  findReusableNodeResult?(
    request: AIWorkflowReusableNodeResultRequest,
  ): Promise<AIWorkflowNodeResult | undefined>;
}

/**
 * @deprecated Writable legacy/derived projection compatibility only. Canonical
 * Ctrl/Data execution writes exclusively through FlowRunCheckpointStore.
 */
export interface AIWorkflowStateStore extends AIWorkflowStateProjection {
  saveRunState(state: AIWorkflowRunState): Promise<void>;
  appendRunEvent(ref: AIWorkflowRunRef, event: AIWorkflowRunEvent): Promise<void>;
}

export interface AIWorkflowEffectRequest<Input = unknown> {
  readonly effectId: string;
  readonly operation: string;
  readonly input: Input;
  readonly config?: Readonly<Record<string, EagerDataFlowValue>>;
  readonly run: AIWorkflowRunRef;
  readonly nodeId?: string;
  readonly materialRefs?: readonly string[];
  readonly signal?: AbortSignal;
}

export interface AIWorkflowEffectProvider {
  invoke<Input = unknown, Output = unknown>(request: AIWorkflowEffectRequest<Input>): Promise<Output>;
}

export interface AIWorkflowEffectHandlerContext {
  readonly roots: AIWorkflowRuntimeRoots;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type AIWorkflowEffectHandler<Input = unknown, Output = unknown> = (
  request: AIWorkflowEffectRequest<Input>,
  context: AIWorkflowEffectHandlerContext,
) => Output | Promise<Output>;

export type AIWorkflowEffectHandlerMap = Readonly<Record<string, AIWorkflowEffectHandler>>;

export interface AIWorkflowEffectHandlerResolution {
  readonly operation: string;
  readonly handler?: AIWorkflowEffectHandler;
}

export interface AIWorkflowEffectHandlerRegistry {
  hasHandler(operation: string): boolean;
  resolveHandler(operation: string): AIWorkflowEffectHandlerResolution;
  listOperations(): readonly string[];
}

export interface AIWorkflowMutableEffectHandlerRegistry extends AIWorkflowEffectHandlerRegistry {
  registerHandler(operation: string, handler: AIWorkflowEffectHandler): void;
  unregisterHandler(operation: string): boolean;
}

export interface AIWorkflowEmbeddedEffectProvider extends AIWorkflowEffectProvider {
  readonly registry: AIWorkflowEffectHandlerRegistry;
  readonly roots: AIWorkflowRuntimeRoots;
}

export interface AIWorkflowEffectResult<Output = unknown> {
  readonly effectId: string;
  readonly operation: string;
  readonly output: Output;
}

export interface AIWorkflowRuntimeContext<
  Effects extends AIWorkflowEffectProvider | AIWorkflowAuthoredEffects = AIWorkflowEffectProvider,
  Store extends AIWorkflowStateProjection = AIWorkflowStateProjection,
> {
  readonly roots: AIWorkflowRuntimeRoots;
  readonly effects: Effects;
  /** Historical field name; canonical runtimes expose a read-only projection here. */
  readonly stateStore: Store;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Authored code surface; generic infrastructure dispatch is intentionally absent. */
export type AIWorkflowAuthoredRuntimeContext<Store extends AIWorkflowStateProjection = AIWorkflowStateProjection> =
  AIWorkflowRuntimeContext<AIWorkflowAuthoredEffects, Store>;

export type AIWorkflowStepExtensionAuthoredRuntimeContext<
  Store extends AIWorkflowStateProjection = AIWorkflowStateProjection,
> = AIWorkflowRuntimeContext<AIWorkflowAuthoredEffects & AIWorkflowAuthoredStepExtensions, Store>;

export interface AICtrlWorkflowRuntime<
  Effects extends AIWorkflowEffectProvider | AIWorkflowAuthoredEffects = AIWorkflowEffectProvider,
  Store extends AIWorkflowStateProjection = AIWorkflowStateProjection,
> extends WorkCtrlFlowRuntime {
  readonly ai: AIWorkflowRuntimeContext<Effects, Store>;
}

export interface AIDataWorkflowRuntime<
  Effects extends AIWorkflowEffectProvider | AIWorkflowAuthoredEffects = AIWorkflowEffectProvider,
  Store extends AIWorkflowStateProjection = AIWorkflowStateProjection,
> {
  readonly ai: AIWorkflowRuntimeContext<Effects, Store>;
}

export interface AICtrlWorkflowDefinitionBinding {
  readonly kind: 'AICtrlWorkflow';
  readonly substrate: 'WorkCtrlFlow';
  readonly definition: FlowBundleSpec;
  readonly descriptor?: AIWorkflowProfileDescriptor<'AICtrlWorkflow', 'WorkCtrlFlow'>;
}

export interface AIDataWorkflowDefinitionBinding {
  readonly kind: 'AIDataWorkflow';
  readonly substrate: 'EagerDataFlow';
  readonly definition: EagerDataFlowAuthoringPlan;
  readonly descriptor?: AIWorkflowProfileDescriptor<'AIDataWorkflow', 'EagerDataFlow'>;
}

export type AIWorkflowDefinitionBinding =
  | AICtrlWorkflowDefinitionBinding
  | AIDataWorkflowDefinitionBinding;
