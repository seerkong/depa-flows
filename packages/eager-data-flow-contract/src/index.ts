import type {
  DefinitionStepForest,
  DefinitionStepProfileLoadOptions,
} from 'flow-step-space-contract';

/** Serializable values retained from EagerDataFlow XNL authoring. */
export type EagerDataFlowValue =
  | string
  | number
  | boolean
  | null
  | EagerDataFlowValue[]
  | { [key: string]: EagerDataFlowValue };

export interface EagerDataFlowDiagnostic {
  code: string;
  message: string;
  source?: string;
  nodeId?: string;
}

/** A named virtual XNL file. Loaders must not assume that it exists on disk. */
export interface EagerDataFlowXnlSource {
  name: string;
  content: string;
}

export type EagerDataFlowSourceCollection =
  | readonly EagerDataFlowXnlSource[]
  | Readonly<Record<string, string>>;

export interface EagerDataFlowContract {
  id: string;
  inputPorts: readonly string[];
  outputPorts: readonly string[];
  input?: string;
  output?: string;
}

export interface FlowPortReference {
  ref: string;
  nodeId: string;
  port: string;
}

export interface FlowNodeReference {
  ref: string;
  nodeId: string;
}

export interface EagerDataFlowNodeBase {
  id: string;
  declarationIndex: number;
  waitFor: FlowNodeReference[];
}

export interface EntryNodePlan extends EagerDataFlowNodeBase {
  tag: 'EntryNode';
  outputs: string[];
}

export interface TransformNodePlan extends EagerDataFlowNodeBase {
  tag: 'TransformNode';
  inputs: Record<string, FlowPortReference>;
  outputs: string[];
  type?: string;
  src?: string;
  impl?: string;
  config: Record<string, EagerDataFlowValue>;
}

export interface SinkNodePlan extends EagerDataFlowNodeBase {
  tag: 'SinkNode';
  inputs: Record<string, FlowPortReference>;
  type?: string;
  src?: string;
  impl?: string;
  config: Record<string, EagerDataFlowValue>;
}

export interface SubFlowNodePlan extends EagerDataFlowNodeBase {
  tag: 'SubFlowNode';
  flow: string;
  inputs: Record<string, FlowPortReference>;
  outputs: string[];
}

export interface ReturnNodePlan extends EagerDataFlowNodeBase {
  tag: 'ReturnNode';
  inputs: Record<string, FlowPortReference>;
}

export type EagerDataFlowNodePlan =
  | EntryNodePlan
  | TransformNodePlan
  | SinkNodePlan
  | SubFlowNodePlan
  | ReturnNodePlan;

export interface EagerDataEdge {
  kind: 'data';
  fromNodeId: string;
  fromPort: string;
  toNodeId: string;
  toInput: string;
  ref: string;
}

export interface EagerWaitForEdge {
  kind: 'waitFor';
  fromNodeId: string;
  toNodeId: string;
  ref: string;
}

export interface EagerSubflowEdge {
  kind: 'subflow';
  fromFlowId: string;
  nodeId: string;
  targetFlowId: string;
  ref: string;
}

export interface EagerDataFlowAuthoringPlan {
  form: 'EagerDataFlow';
  fqn: string;
  apiVersion: string;
  version: string;
  title?: string;
  baseUri?: string;
  sourceNames: string[];
  /** Frozen modular definition authority; absent for inline authoring. */
  definitionStepForest?: DefinitionStepForest;
  contract: EagerDataFlowContract;
  nodes: EagerDataFlowNodePlan[];
  nodeById: Record<string, EagerDataFlowNodePlan>;
  declarationOrder: string[];
  dataEdges: EagerDataEdge[];
  waitForEdges: EagerWaitForEdge[];
  subflowEdges: EagerSubflowEdge[];
  diagnostics: EagerDataFlowDiagnostic[];
}

/**
 * Serializable linker registration. A linked plan is structurally compatible;
 * lightweight callers may provide only contract and subflow target facts.
 */
export interface EagerDataFlowRegistryEntry {
  form: string;
  contract: EagerDataFlowContract;
  subflowTargets?: readonly string[];
  subflowEdges?: readonly EagerSubflowEdge[];
}

export type EagerDataFlowRegistry = Readonly<Record<string, EagerDataFlowRegistryEntry>>;

export interface LoadEagerDataFlowOptions {
  baseUri?: string;
  registry?: EagerDataFlowRegistry;
  /** Optional exact StepSpace composition policy; no host path is accepted here. */
  stepSpace?: DefinitionStepProfileLoadOptions;
}

export interface EagerDataFlowLoadResult {
  plan?: EagerDataFlowAuthoringPlan;
  diagnostics: EagerDataFlowDiagnostic[];
}

export type EagerDataFlowRecord = Record<string, unknown>;

export type EagerDataFlowCode<Runtime = unknown> = (
  runtime: Runtime,
  input: Readonly<EagerDataFlowRecord>,
  config: Readonly<Record<string, EagerDataFlowValue>>,
) => unknown | Promise<unknown>;

export interface EagerDataFlowCodeResolutionRequest {
  reference: string;
  flowId: string;
  nodeId: string;
  baseUri?: string;
}

export type EagerDataFlowCodeResolver<Runtime = unknown> = (
  request: EagerDataFlowCodeResolutionRequest,
) => EagerDataFlowCode<Runtime> | Promise<EagerDataFlowCode<Runtime>>;

export interface EagerDataFlowDurableNodeState {
  readonly nodeId: string;
  readonly output?: Readonly<EagerDataFlowRecord>;
  readonly returned?: Readonly<EagerDataFlowRecord>;
}

export interface EagerDataFlowNodeFailure {
  readonly nodeId: string;
  readonly cause: unknown;
}

export interface EagerDataFlowInvocationOptions<Runtime = unknown> {
  signal?: AbortSignal;
  bindSignal?: (runtime: Runtime, signal: AbortSignal) => Runtime;
  /** Derives the explicit Processor runtime for one ordinary node invocation. */
  bindNode?: (runtime: Runtime, identity: { readonly nodeId: string }) => Runtime;
  /** Node-addressed SubFlow dispatch seam; the admitted registry remains keyed by exact child Flow identity. */
  invokeSubFlow?: (
    runtime: Runtime,
    identity: { readonly nodeId: string; readonly flowRef: string },
    input: Readonly<EagerDataFlowRecord>,
    options: { readonly signal: AbortSignal },
  ) => Promise<EagerDataFlowRecord>;
  onCancel?: (reason: unknown) => void;
  /** Previously accepted node settlements used to reconstruct scheduler ports without replay. */
  completedNodes?: Readonly<Record<string, EagerDataFlowDurableNodeState>>;
  /** Durable boundaries are awaited before execution and before dependent nodes become ready. */
  onNodeStart?: (nodeId: string) => void | Promise<void>;
  onNodeSuccess?: (state: EagerDataFlowDurableNodeState) => void | Promise<void>;
  onNodeFailure?: (failure: EagerDataFlowNodeFailure) => void | Promise<void>;
}

export interface EagerDataFlowExecutable<Runtime = unknown> {
  readonly plan: EagerDataFlowAuthoringPlan;
  invoke(
    runtime: Runtime,
    input: Readonly<EagerDataFlowRecord>,
    options?: EagerDataFlowInvocationOptions<Runtime>,
  ): Promise<EagerDataFlowRecord>;
}

export type EagerDataFlowExecutableRegistry<Runtime = unknown> = Readonly<
  Record<string, EagerDataFlowExecutable<Runtime>>
>;
