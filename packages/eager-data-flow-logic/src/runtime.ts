import type {
  EagerDataFlowAuthoringPlan,
  EagerDataFlowCode,
  EagerDataFlowCodeResolver,
  EagerDataFlowExecutable,
  EagerDataFlowExecutableRegistry,
  EagerDataFlowInvocationOptions,
  EagerDataFlowNodePlan,
  EagerDataFlowRecord,
  EagerDataFlowSourceCollection,
  LoadEagerDataFlowOptions,
  SubFlowNodePlan,
} from 'eager-data-flow-contract';
import { loadEagerDataFlowSources } from './source-loader.js';

type NodeStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export interface EagerDataFlowNodeFault {
  flowId: string;
  nodeId: string;
  topologyLayer: number;
  declarationIndex: number;
  cause: unknown;
}

interface NodeSuccess {
  node: EagerDataFlowNodePlan;
  output?: EagerDataFlowRecord;
  returned?: EagerDataFlowRecord;
}

type NodeSettlement =
  | { ok: true; value: NodeSuccess }
  | { ok: false; node: EagerDataFlowNodePlan; cause: unknown };

export class EagerDataFlowLoadError extends Error {
  constructor(
    public readonly diagnostics: readonly { code: string; message: string }[],
  ) {
    const details = diagnostics.map((item) => `[${item.code}] ${item.message}`).join('; ');
    super(`EagerDataFlow loading failed: ${details}`);
  }
}

export class EagerDataFlowMaterializationError extends Error {
  constructor(
    message: string,
    public readonly flowId: string,
    public readonly nodeId?: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
  }
}

export class EagerDataFlowCancelledError extends Error {
  constructor(public readonly flowId: string, public override readonly cause?: unknown) {
    super(`EagerDataFlow ${flowId} was cancelled`);
  }
}

export class EagerDataFlowExecutionError extends Error {
  readonly nodeId: string;

  constructor(
    public readonly flowId: string,
    public readonly primaryFault: EagerDataFlowNodeFault,
    public readonly faults: readonly EagerDataFlowNodeFault[],
  ) {
    super(`EagerDataFlow ${flowId} failed at node ${primaryFault.nodeId}`);
    this.nodeId = primaryFault.nodeId;
    this.cause = primaryFault.cause;
  }

  override readonly cause: unknown;
}

export interface MaterializeEagerDataFlowOptions<Runtime = unknown> {
  resolveCode: EagerDataFlowCodeResolver<Runtime>;
  subflows?: EagerDataFlowExecutableRegistry<Runtime>;
}

export interface MaterializeEagerDataFlowSourcesOptions<Runtime = unknown>
  extends MaterializeEagerDataFlowOptions<Runtime> {
  load?: LoadEagerDataFlowOptions;
}

export interface RunEagerDataFlowPlanOptions<Runtime = unknown>
  extends MaterializeEagerDataFlowOptions<Runtime>, EagerDataFlowInvocationOptions<Runtime> {
  runtime: Runtime;
  input: Readonly<EagerDataFlowRecord>;
}

export interface RunEagerDataFlowSourcesOptions<Runtime = unknown>
  extends MaterializeEagerDataFlowSourcesOptions<Runtime>, EagerDataFlowInvocationOptions<Runtime> {
  runtime: Runtime;
  input: Readonly<EagerDataFlowRecord>;
}

const ownKeysEqual = (value: unknown, expected: readonly string[]): value is EagerDataFlowRecord => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length && keys.every(
    (key) => typeof key === 'string' && expected.includes(key),
  );
};

const keysEqual = (actual: readonly string[], expected: readonly string[]): boolean =>
  actual.length === expected.length && actual.every((key) => expected.includes(key));

function requireExactRecord(
  value: unknown,
  expected: readonly string[],
  label: string,
): EagerDataFlowRecord {
  if (!ownKeysEqual(value, expected)) {
    const actual = value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [];
    throw new TypeError(`${label} must have exact own keys [${expected.join(', ')}], got [${actual.join(', ')}]`);
  }
  return Object.fromEntries(expected.map((key) => [key, value[key]]));
}

function topologyLayers(plan: EagerDataFlowAuthoringPlan): ReadonlyMap<string, number> {
  const predecessors = new Map(plan.nodes.map((node) => [node.id, new Set<string>()]));
  for (const edge of [...plan.dataEdges, ...plan.waitForEdges]) {
    predecessors.get(edge.toNodeId)?.add(edge.fromNodeId);
  }
  const layers = new Map<string, number>();
  const visit = (nodeId: string): number => {
    const known = layers.get(nodeId);
    if (known !== undefined) return known;
    const layer = Math.max(-1, ...[...(predecessors.get(nodeId) ?? [])].map(visit)) + 1;
    layers.set(nodeId, layer);
    return layer;
  };
  for (const node of plan.nodes) visit(node.id);
  return layers;
}

function inputFor(node: Exclude<EagerDataFlowNodePlan, { tag: 'EntryNode' }>, ports: ReadonlyMap<string, unknown>) {
  return Object.freeze(Object.fromEntries(
    Object.entries(node.inputs).map(([input, ref]) => [input, ports.get(`${ref.nodeId}/${ref.port}`)]),
  ));
}

function isReady(
  node: EagerDataFlowNodePlan,
  status: ReadonlyMap<string, NodeStatus>,
  ports: ReadonlyMap<string, unknown>,
): boolean {
  if (status.get(node.id) !== 'pending') return false;
  if (node.tag !== 'EntryNode') {
    for (const ref of Object.values(node.inputs)) {
      if (!ports.has(`${ref.nodeId}/${ref.port}`)) return false;
    }
  }
  return node.waitFor.every((ref) => status.get(ref.nodeId) === 'succeeded');
}

function subflowId(node: SubFlowNodePlan): string {
  return node.flow.slice('eager-data-flow://'.length);
}

export async function materializeEagerDataFlowPlan<Runtime = unknown>(
  plan: EagerDataFlowAuthoringPlan,
  options: MaterializeEagerDataFlowOptions<Runtime>,
): Promise<EagerDataFlowExecutable<Runtime>> {
  const code = new Map<string, EagerDataFlowCode<Runtime>>();
  for (const node of plan.nodes) {
    if (node.tag !== 'TransformNode' && node.tag !== 'SinkNode') continue;
    const reference = node.src ?? node.impl;
    if (!reference) {
      throw new EagerDataFlowMaterializationError('node has no implementation binding', plan.fqn, node.id);
    }
    try {
      const resolved = await options.resolveCode({
        reference,
        flowId: plan.fqn,
        nodeId: node.id,
        ...(plan.baseUri ? { baseUri: plan.baseUri } : {}),
      });
      if (typeof resolved !== 'function') throw new TypeError(`${reference} did not resolve to a function`);
      code.set(node.id, resolved);
    } catch (cause) {
      throw new EagerDataFlowMaterializationError(
        `failed to resolve ${plan.fqn}#${node.id}`,
        plan.fqn,
        node.id,
        cause,
      );
    }
  }

  for (const node of plan.nodes) {
    if (node.tag !== 'SubFlowNode') continue;
    const targetId = subflowId(node);
    const target = options.subflows?.[targetId];
    if (!target) {
      throw new EagerDataFlowMaterializationError(`subflow ${targetId} is not materialized`, plan.fqn, node.id);
    }
    if (!keysEqual(target.plan.contract.inputPorts, Object.keys(node.inputs))) {
      throw new EagerDataFlowMaterializationError(`subflow ${targetId} input contract changed after linking`, plan.fqn, node.id);
    }
    if (!keysEqual(target.plan.contract.outputPorts, node.outputs)) {
      throw new EagerDataFlowMaterializationError(`subflow ${targetId} output contract changed after linking`, plan.fqn, node.id);
    }
  }

  const layers = topologyLayers(plan);
  const executable: EagerDataFlowExecutable<Runtime> = {
    plan,
    invoke: (runtime, input, invocationOptions = {}) =>
      invokeMaterialized(plan, code, options.subflows ?? {}, layers, runtime, input, invocationOptions),
  };
  return executable;
}

async function invokeMaterialized<Runtime>(
  plan: EagerDataFlowAuthoringPlan,
  code: ReadonlyMap<string, EagerDataFlowCode<Runtime>>,
  subflows: EagerDataFlowExecutableRegistry<Runtime>,
  layers: ReadonlyMap<string, number>,
  runtime: Runtime,
  input: Readonly<EagerDataFlowRecord>,
  options: EagerDataFlowInvocationOptions<Runtime>,
): Promise<EagerDataFlowRecord> {
  const exactInput = requireExactRecord(input, plan.contract.inputPorts, `${plan.fqn} input`);
  const controller = new AbortController();
  let stopped = false;
  let cancelNotified = false;
  let wake: (() => void) | undefined;
  const notify = () => {
    wake?.();
    wake = undefined;
  };
  const stop = (reason: unknown) => {
    if (stopped) return;
    stopped = true;
    controller.abort(reason);
    if (!cancelNotified) {
      cancelNotified = true;
      options.onCancel?.(reason);
    }
    notify();
  };
  const externalAbort = () => stop(options.signal?.reason);
  if (options.signal?.aborted) stop(options.signal.reason);
  else options.signal?.addEventListener('abort', externalAbort, { once: true });

  const effectiveRuntime = options.bindSignal?.(runtime, controller.signal) ?? runtime;
  const status = new Map(plan.nodes.map((node) => [node.id, 'pending' as NodeStatus]));
  const ports = new Map<string, unknown>();
  const running = new Set<string>();
  const queue: NodeSettlement[] = [];
  const faults: EagerDataFlowNodeFault[] = [];
  let returned: EagerDataFlowRecord | undefined;

  const runNode = async (node: EagerDataFlowNodePlan): Promise<NodeSuccess> => {
    if (node.tag === 'EntryNode') return { node, output: exactInput };
    const nodeInput = inputFor(node, ports);
    if (node.tag === 'ReturnNode') {
      return { node, returned: requireExactRecord(nodeInput, plan.contract.outputPorts, `${node.id} output`) };
    }
    if (node.tag === 'SubFlowNode') {
      const target = subflows[subflowId(node)];
      const output = await target.invoke(runtime, nodeInput, {
        signal: controller.signal,
        ...(options.bindSignal ? { bindSignal: options.bindSignal } : {}),
      });
      return { node, output: requireExactRecord(output, node.outputs, `${node.id} output`) };
    }
    const fn = code.get(node.id)!;
    const result = await fn(effectiveRuntime, nodeInput, Object.freeze({ ...node.config }));
    if (node.tag === 'SinkNode') {
      if (result !== undefined) throw new TypeError(`${node.id} SinkNode must return void`);
      return { node };
    }
    return { node, output: requireExactRecord(result, node.outputs, `${node.id} output`) };
  };

  const startReady = () => {
    if (stopped) return;
    const wave = plan.nodes.filter((node) => isReady(node, status, ports));
    for (const node of wave) {
      status.set(node.id, 'running');
      running.add(node.id);
      void runNode(node).then(
        (value) => queue.push({ ok: true, value }),
        (cause) => {
          stop(cause);
          queue.push({ ok: false, node, cause });
        },
      ).finally(notify);
    }
  };

  const processQueue = () => {
    for (const settlement of queue.splice(0)) {
      const node = settlement.ok ? settlement.value.node : settlement.node;
      running.delete(node.id);
      if (!settlement.ok) {
        status.set(node.id, 'failed');
        faults.push({
          flowId: plan.fqn,
          nodeId: node.id,
          topologyLayer: layers.get(node.id) ?? 0,
          declarationIndex: node.declarationIndex,
          cause: settlement.cause,
        });
        continue;
      }
      const { output } = settlement.value;
      if (output && (node.tag === 'EntryNode' || node.tag === 'TransformNode' || node.tag === 'SubFlowNode')) {
        for (const port of node.outputs) ports.set(`${node.id}/${port}`, output[port]);
      }
      if (settlement.value.returned) returned = settlement.value.returned;
      status.set(node.id, 'succeeded');
    }
  };

  try {
    while (true) {
      processQueue();
      startReady();
      if (running.size === 0) {
        if (stopped) break;
        if ([...status.values()].every((value) => value === 'succeeded')) break;
        throw new Error(`EagerDataFlow ${plan.fqn} scheduler stalled`);
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  } finally {
    options.signal?.removeEventListener('abort', externalAbort);
  }

  if (faults.length > 0) {
    faults.sort((left, right) =>
      left.topologyLayer - right.topologyLayer || left.declarationIndex - right.declarationIndex,
    );
    throw new EagerDataFlowExecutionError(plan.fqn, faults[0], faults);
  }
  if (stopped) throw new EagerDataFlowCancelledError(plan.fqn, controller.signal.reason);
  if (!returned) throw new Error(`EagerDataFlow ${plan.fqn} completed without Return output`);
  return returned;
}

export async function materializeEagerDataFlowSources<Runtime = unknown>(
  sources: EagerDataFlowSourceCollection,
  options: MaterializeEagerDataFlowSourcesOptions<Runtime>,
): Promise<EagerDataFlowExecutable<Runtime>> {
  const registry = {
    ...options.load?.registry,
    ...Object.fromEntries(Object.entries(options.subflows ?? {}).map(([id, flow]) => [id, flow.plan])),
  };
  const result = loadEagerDataFlowSources(sources, {
    ...options.load,
    ...(Object.keys(registry).length ? { registry } : {}),
  });
  if (!result.plan) throw new EagerDataFlowLoadError(result.diagnostics);
  return materializeEagerDataFlowPlan(result.plan, options);
}

export async function runEagerDataFlowPlan<Runtime = unknown>(
  plan: EagerDataFlowAuthoringPlan,
  options: RunEagerDataFlowPlanOptions<Runtime>,
): Promise<EagerDataFlowRecord> {
  const executable = await materializeEagerDataFlowPlan(plan, options);
  return executable.invoke(options.runtime, options.input, options);
}

export async function runEagerDataFlowSources<Runtime = unknown>(
  sources: EagerDataFlowSourceCollection,
  options: RunEagerDataFlowSourcesOptions<Runtime>,
): Promise<EagerDataFlowRecord> {
  const executable = await materializeEagerDataFlowSources(sources, options);
  return executable.invoke(options.runtime, options.input, options);
}
