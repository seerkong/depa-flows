/**
 * instant-flow-contract —— InstantFlow 契约（纯类型，零依赖）。
 * 概念对应 docs/flow-dsl：flow bundle（spec/flow-core）、IF-* 公理。
 */

export type FlowForm = 'InstantFlow' | 'WorkFlow' | 'BizProcess';

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

/** Static callable boundary of an InstantFlow, WorkFlow, or BizProcess definition. */
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
  /** Unique FlowContract child domain; it describes the static callable boundary. */
  flowContract: CtrlFlowContract;
  /** config 域：ConfigEntry id → 字段表 */
  config: Record<string, Record<string, unknown>>;
  /** config.def facet：ConfigEntryDef id → shape 字段表 */
  configDef: Record<string, Record<string, unknown>>;
  /** state.def facet（WF-2；InstantFlow 恒缺省） */
  stateDef?: Record<string, string>;
  /** state.seed facet（只读启动快照，M-D4） */
  stateSeed?: Record<string, unknown>;
  /** task.space 域根节点（BizProcess；结构化投影） */
  taskSpace?: FlowNodeSpec;
  diagnostics: FlowDiagnostic[];
}

/** DEPA 边界：runtime 显式注入（BT-6） */
export interface InstantFlowRuntime {
  [key: string]: unknown;
}

export interface InstantFlowRunOptions {
  input?: unknown;
  runtime?: InstantFlowRuntime;
}

export type FlowCodeFunction<Output = unknown, Runtime = InstantFlowRuntime> = (
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

export type FlowCodeResolver<Runtime = InstantFlowRuntime> = (
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
