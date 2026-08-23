/**
 * instant-ctrl-flow-contract —— InstantCtrlFlow 契约（纯类型，零依赖）。
 * 概念对应 docs/flow-dsl：flow bundle（spec/flow-core）、IF-* 公理。
 */
import type {
  DefinitionStepForest,
  DefinitionStepProfileLoadOptions,
} from 'flow-step-space-contract';

export type FlowForm = 'InstantCtrlFlow' | 'WorkCtrlFlow' | 'BPCtrlFlow';

export interface FlowDiagnostic {
  code: string;
  message: string;
}

/** A named virtual XNL file. Loaders must not assume that it exists on disk. */
export interface FlowXnlSource {
  name: string;
  content: string;
}

export type FlowSourceCollection =
  | readonly FlowXnlSource[]
  | Readonly<Record<string, string>>;

export interface LoadFlowSourcesOptions {
  /** Resolution base carried into code-resolution requests; it need not be a filesystem path. */
  baseUri?: string;
  /** Optional exact StepSpace composition policy; no host path is accepted here. */
  stepSpace?: DefinitionStepProfileLoadOptions;
}

/** XNL 节点的纯结构投影（与物理段对应：attrs={}, children=[], sections=()） */
export interface FlowNodeSpec {
  tag: string;
  id?: string;
  /** 元数据位 key=value（系统级元信息，如 TaskSpace 的 version） */
  metadata: Record<string, unknown>;
  attrs: Record<string, unknown>;
  children: FlowNodeSpec[];
  sections: Record<string, FlowNodeSpec>;
}

/** Static callable boundary of an InstantCtrlFlow, WorkCtrlFlow, or BPCtrlFlow definition. */
export interface CtrlFlowContract {
  id: string;
  input?: string;
  output?: string;
}

/** Registry projection used to resolve a callable CtrlFlow without loading its implementation. */
export interface CtrlFlowRegistryEntry {
  fqn: string;
  form: FlowForm;
  contract: CtrlFlowContract;
  canSuspend: boolean;
}

export type CtrlFlowRegistry = Readonly<Record<string, CtrlFlowRegistryEntry>>;

export interface FlowBundleSpec {
  form: FlowForm;
  fqn: string;
  apiVersion: string;
  version: string;
  title?: string;
  /** Named XNL inputs retained in deterministic order. */
  sourceNames: string[];
  /** Resolution base for vfs:// references; may identify an AppBundle/VFS location. */
  baseUri?: string;
  /** @deprecated Use baseUri. Retained for callers migrating from directory bundles. */
  dir: string;
  /** 产品根 [] 中按声明顺序保存的 canonical CtrlFlow statements */
  statements: FlowNodeSpec[];
  /** Frozen modular definition authority; absent for inline authoring. */
  definitionStepForest?: DefinitionStepForest;
  /** Unique FlowContract child domain; it describes the static callable boundary. */
  flowContract: CtrlFlowContract;
  /** config 域：ConfigEntry id → 字段表 */
  config: Record<string, Record<string, unknown>>;
  /** config.def facet：ConfigEntryDef id → shape 字段表 */
  configDef: Record<string, Record<string, unknown>>;
  /** state.def facet（WF-2；InstantCtrlFlow 恒缺省） */
  stateDef?: Record<string, string>;
  /** state.seed facet（只读启动快照，M-D4） */
  stateSeed?: Record<string, unknown>;
  /** task.space 域根节点（BPCtrlFlow；结构化投影） */
  taskSpace?: FlowNodeSpec;
  diagnostics: FlowDiagnostic[];
}

/** DEPA 边界：runtime 显式注入（BT-6） */
export interface InstantCtrlFlowRuntime {
  [key: string]: unknown;
}

export interface InstantCtrlFlowRunOptions {
  input?: unknown;
  runtime?: InstantCtrlFlowRuntime;
}

export type FlowCodeFunction<Output = unknown, Runtime = InstantCtrlFlowRuntime> = (
  runtime: Runtime,
  input: unknown,
  config: Readonly<Record<string, unknown>>,
) => Output | Promise<Output>;

export interface FlowCodeResolutionRequest {
  reference: string;
  flowId: string;
  nodeId: string;
  baseUri?: string;
}

export type FlowCodeResolver<Runtime = InstantCtrlFlowRuntime> = (
  request: FlowCodeResolutionRequest,
) => FlowCodeFunction<unknown, Runtime> | Promise<FlowCodeFunction<unknown, Runtime>>;

export interface ResolvedCtrlFlow {
  spec: FlowBundleSpec;
  resolveCode: FlowCodeResolver;
}

export type CtrlFlowResolver = (
  reference: string,
  caller: FlowBundleSpec,
) => ResolvedCtrlFlow | Promise<ResolvedCtrlFlow>;
