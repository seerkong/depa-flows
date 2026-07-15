import {
  ActionHandlerRegistry,
  BehaviorTreeEngine,
  BehaviorTreeNodeStatus,
  evaluateExpression,
  type BehaviorTreeData,
  type CtrlFlowNodeType,
  type INodeConfig,
} from 'depa-behavior-tree';
import type {
  FlowBundleSpec,
  FlowCodeResolver,
  CtrlFlowResolver,
  FlowNodeSpec,
  FlowSourceCollection,
  InstantFlowRunOptions,
  LoadFlowSourcesOptions,
} from 'instant-flow-contract';
import { compileBundle, FlowCompileError } from './compile.js';
import { loadFlowBundleFromSources } from './loader.js';
import {
  createFlowExecutionState,
  createFlowHandlers,
  FLOW_STATE_KEY,
} from './handlers.js';

export class FlowLoadError extends Error {
  constructor(public codes: string[], message: string) {
    super(message);
  }
}

export class FlowExecutionError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
  }
}

function requireInstantFlowSpec(spec: FlowBundleSpec | undefined, diagnostics: readonly { code: string; message: string }[]): FlowBundleSpec {
  const hard = diagnostics.filter((diagnostic) => diagnostic.code !== 'parser-warning');
  if (!spec || hard.length) {
    throw new FlowLoadError(
      diagnostics.map((diagnostic) => diagnostic.code),
      `failed to load flow: ${diagnostics.map((diagnostic) => `[${diagnostic.code}] ${diagnostic.message}`).join('; ')}`,
    );
  }
  if (spec.form !== 'InstantFlow') {
    throw new FlowLoadError(['form-mismatch'], `bundle ${spec.fqn} is a ${spec.form}, not an InstantFlow`);
  }
  return spec;
}

export function loadInstantFlowSources(
  sources: FlowSourceCollection,
  options: LoadFlowSourcesOptions = {},
): FlowBundleSpec {
  const result = loadFlowBundleFromSources(sources, options);
  return requireInstantFlowSpec(result.spec, result.diagnostics);
}

export interface RunInstantFlowSpecOptions extends InstantFlowRunOptions {
  resolveCode: FlowCodeResolver;
  resolveFlow?: CtrlFlowResolver;
}

export interface MaterializedInstantFlow<Output = unknown> {
  readonly spec: FlowBundleSpec;
  run(options?: InstantFlowRunOptions): Promise<Output>;
}

export function materializeInstantFlowSpec<Output = unknown>(
  spec: FlowBundleSpec,
  resolveCode: FlowCodeResolver,
  resolveFlow?: CtrlFlowResolver,
): MaterializedInstantFlow<Output> {
  requireInstantFlowSpec(spec, spec.diagnostics);
  return {
    spec,
    run: (options = {}) => runInstantFlowSpec<Output>(spec, { ...options, resolveCode, resolveFlow }),
  };
}

export function materializeInstantFlowSources<Output = unknown>(
  sources: FlowSourceCollection,
  options: LoadFlowSourcesOptions & { resolveCode: FlowCodeResolver; resolveFlow?: CtrlFlowResolver },
): MaterializedInstantFlow<Output> {
  return materializeInstantFlowSpec(loadInstantFlowSources(sources, options), options.resolveCode, options.resolveFlow);
}

export async function runInstantFlowSpec<Output = unknown>(
  spec: FlowBundleSpec,
  options: RunInstantFlowSpecOptions,
): Promise<Output> {
  requireInstantFlowSpec(spec, spec.diagnostics);
  return runStatements<Output>(spec, spec.statements, options);
}

async function runStatements<Output>(
  spec: FlowBundleSpec,
  statements: FlowNodeSpec[],
  options: RunInstantFlowSpecOptions & { signal?: AbortSignal },
): Promise<Output> {
  if (options.signal?.aborted) throw new FlowExecutionError(`InstantFlow ${spec.fqn} was cancelled`);
  const executionSpec = statements === spec.statements ? spec : { ...spec, statements };
  const tree = compileBundle(executionSpec);
  const state = createFlowExecutionState(options.input ?? {});
  const registry = new ActionHandlerRegistry<CtrlFlowNodeType, INodeConfig>();
  const runtimeWithSignal = (runtime: Record<string, unknown>, signal?: AbortSignal) => {
    if (!signal) return runtime;
    const overlay = Object.create(runtime) as Record<string, unknown>;
    overlay.abortSignal = signal;
    return overlay;
  };
  const executeBody = (body: FlowNodeSpec[], input: unknown, runtime: Record<string, unknown>, signal?: AbortSignal) =>
    runStatements(executionSpec, body, { ...options, input, runtime: runtimeWithSignal(runtime, signal), signal });
  const executeTarget = async (reference: string, input: unknown, runtime: Record<string, unknown>, signal?: AbortSignal) => {
    if (!options.resolveFlow) throw new FlowExecutionError(`CallFlow ${reference} requires resolveFlow`);
    const target = await options.resolveFlow(reference, spec);
    const match = /^([a-z-]+):\/\/([\w.-]+)$/.exec(reference);
    const expectedScheme = target.spec.form === 'InstantFlow'
      ? 'instant-flow'
      : target.spec.form === 'WorkFlow'
        ? 'work-flow'
        : 'biz-process';
    if (!match || match[1] !== expectedScheme || match[2] !== target.spec.fqn) {
      throw new FlowExecutionError(`CallFlow resolver returned ${target.spec.form} #${target.spec.fqn} for ${reference}`);
    }
    if (target.spec.form !== 'InstantFlow') {
      throw new FlowExecutionError(`InstantFlow cannot call suspendable ${target.spec.form} target ${reference}`);
    }
    return runStatements(target.spec, target.spec.statements, {
      ...options,
      input,
      runtime: runtimeWithSignal(runtime, signal),
      signal,
      resolveCode: target.resolveCode,
    });
  };
  for (const [type, handler] of Object.entries(
    createFlowHandlers(executionSpec, options.resolveCode, undefined, executeBody, executeTarget),
  )) {
    registry.register(type as CtrlFlowNodeType, handler);
  }
  const data: BehaviorTreeData<CtrlFlowNodeType, INodeConfig> = {
    NodeTree: tree,
    Vars: new Map([[FLOW_STATE_KEY, state]]),
    CmdStack: [],
    CmdHistory: [],
    NodeMap: new Map(),
  };
  const engine = new BehaviorTreeEngine(registry, evaluateExpression);
  await engine.start(data, options.runtime ?? {});
  while (!engine.isComplete(data)) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await engine.runPendingCommands(data, options.runtime ?? {});
  }
  if (options.signal?.aborted) throw new FlowExecutionError(`InstantFlow ${spec.fqn} was cancelled`);
  if (data.NodeTree.Status !== BehaviorTreeNodeStatus.Success || state.fault) {
    throw new FlowExecutionError(`InstantFlow ${spec.fqn} failed`, state.fault);
  }
  return (state.returned ? state.output : state.current) as Output;
}

export async function runInstantFlowSources<Output = unknown>(
  sources: FlowSourceCollection,
  options: RunInstantFlowSpecOptions & LoadFlowSourcesOptions,
): Promise<Output> {
  return runInstantFlowSpec<Output>(loadInstantFlowSources(sources, options), options);
}

export { FlowCompileError };
