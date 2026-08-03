import type { EagerDataFlowAuthoringPlan, EagerDataFlowValue } from 'eager-data-flow-contract';
import type { FlowBundleSpec, WorkCtrlFlowRuntime } from 'work-ctrl-flow-contract';

export type AIWorkflowKind = 'AICtrlWorkflow' | 'AIDataWorkflow';

export type AIWorkflowSubstrate = 'WorkCtrlFlow' | 'EagerDataFlow';

export type AIWorkflowReusePolicy = 'semantic-hash' | 'never';

export type AIWorkflowReusePolicySource = 'node' | 'node-type-default' | 'platform-default';

export type AIWorkflowResourceRefScheme = 'vfs' | 'resource' | 'config' | 'secret';

export const AI_WORKFLOW_ALLOWED_RESOURCE_REF_SCHEMES = Object.freeze([
  'vfs',
  'resource',
  'config',
  'secret',
] as const satisfies readonly AIWorkflowResourceRefScheme[]);

export type AIWorkflowResourceRef = `${AIWorkflowResourceRefScheme}://${string}`;

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

export interface AIWorkflowResourceIdentity {
  readonly kind: AIWorkflowResourceKind;
  readonly fqn: string;
  readonly ref: `resource://${string}`;
  readonly revision?: string;
}

export interface AIWorkflowCatalogEntry {
  readonly id: string;
  readonly kind: AIWorkflowResourceKind;
  readonly ref: AIWorkflowResourceRef;
  readonly fqn?: string;
}

export interface AIWorkflowResourceCatalog {
  readonly id: string;
  readonly entries: readonly AIWorkflowCatalogEntry[];
}

export interface AIWorkflowAppBundleManifest {
  readonly kind: 'AIWorkflowAppBundle';
  readonly fqn: string;
  readonly catalog: AIWorkflowResourceCatalog;
  readonly entrypoints?: readonly AIWorkflowResourceRef[];
  readonly metadata?: Readonly<Record<string, unknown>>;
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

export interface AIWorkflowReusableNodeResultRequest {
  readonly run: AIWorkflowRunRef;
  readonly nodeId: string;
  readonly nodeType: AIWorkflowNodeType;
  readonly fingerprint: AIWorkflowSemanticFingerprint;
  readonly policy: AIWorkflowEffectiveReusePolicy;
}

export interface AIWorkflowStateStore {
  loadRunState(ref: AIWorkflowRunRef): Promise<AIWorkflowRunState | undefined>;
  saveRunState(state: AIWorkflowRunState): Promise<void>;
  appendRunEvent(ref: AIWorkflowRunRef, event: AIWorkflowRunEvent): Promise<void>;
  findReusableNodeResult?(
    request: AIWorkflowReusableNodeResultRequest,
  ): Promise<AIWorkflowNodeResult | undefined>;
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
  Effects extends AIWorkflowEffectProvider = AIWorkflowEffectProvider,
  Store extends AIWorkflowStateStore = AIWorkflowStateStore,
> {
  readonly roots: AIWorkflowRuntimeRoots;
  readonly effects: Effects;
  readonly stateStore: Store;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AICtrlWorkflowRuntime<
  Effects extends AIWorkflowEffectProvider = AIWorkflowEffectProvider,
  Store extends AIWorkflowStateStore = AIWorkflowStateStore,
> extends WorkCtrlFlowRuntime {
  readonly ai: AIWorkflowRuntimeContext<Effects, Store>;
}

export interface AIDataWorkflowRuntime<
  Effects extends AIWorkflowEffectProvider = AIWorkflowEffectProvider,
  Store extends AIWorkflowStateStore = AIWorkflowStateStore,
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
