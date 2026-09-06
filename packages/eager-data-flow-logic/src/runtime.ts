import type {
  EagerDataFlowAuthoringPlan,
  EagerDataFlowCode,
  EagerDataFlowCodeResolver,
  EagerDataFlowDurableNodeState,
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

function isPortReference(value: unknown): value is { readonly nodeId: string; readonly port: string } {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && typeof (value as { nodeId?: unknown }).nodeId === 'string'
    && typeof (value as { port?: unknown }).port === 'string'
    && typeof (value as { ref?: unknown }).ref === 'string');
}

function inputFor(node: Exclude<EagerDataFlowNodePlan, { tag: 'EntryNode' }>, ports: ReadonlyMap<string, unknown>) {
  return Object.freeze(Object.fromEntries(
    Object.entries(node.inputs).map(([input, binding]) => [
      input,
      isPortReference(binding) ? ports.get(`${binding.nodeId}/${binding.port}`) : binding,
    ]),
  ));
}

function isReady(
  node: EagerDataFlowNodePlan,
  status: ReadonlyMap<string, NodeStatus>,
  ports: ReadonlyMap<string, unknown>,
): boolean {
  if (status.get(node.id) !== 'pending') return false;
  if (node.tag !== 'EntryNode') {
    for (const binding of Object.values(node.inputs)) {
      if (isPortReference(binding) && !ports.has(`${binding.nodeId}/${binding.port}`)) return false;
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

  for (const [nodeId, durable] of Object.entries(options.completedNodes ?? {})) {
    const node = plan.nodeById[nodeId] ?? plan.nodes.find((candidate) => candidate.id === nodeId);
    if (!node || durable.nodeId !== nodeId) {
      throw new Error(`EagerDataFlow ${plan.fqn} durable node ${nodeId} does not match the materialized plan`);
    }
    if (node.tag === 'ReturnNode') {
      if (!durable.returned) throw new Error(`EagerDataFlow ${plan.fqn} durable ReturnNode ${nodeId} has no returned output`);
      returned = requireExactRecord(durable.returned, plan.contract.outputPorts, `${nodeId} durable output`);
    } else if (node.tag === 'EntryNode' || node.tag === 'TransformNode' || node.tag === 'SubFlowNode') {
      if (!durable.output) throw new Error(`EagerDataFlow ${plan.fqn} durable node ${nodeId} has no output`);
      const output = requireExactRecord(durable.output, node.outputs, `${nodeId} durable output`);
      for (const port of node.outputs) ports.set(`${node.id}/${port}`, output[port]);
    } else if (durable.output !== undefined || durable.returned !== undefined) {
      throw new Error(`EagerDataFlow ${plan.fqn} durable SinkNode ${nodeId} cannot retain output`);
    }
    status.set(nodeId, 'succeeded');
  }

  const runNode = async (node: EagerDataFlowNodePlan): Promise<NodeSuccess> => {
    await options.onNodeStart?.(node.id);
    let success: NodeSuccess;
    try {
      if (node.tag === 'EntryNode') {
        success = { node, output: exactInput };
      } else {
        const nodeInput = inputFor(node, ports);
        if (node.tag === 'ReturnNode') {
          success = { node, returned: requireExactRecord(nodeInput, plan.contract.outputPorts, `${node.id} output`) };
        } else if (node.tag === 'SubFlowNode') {
          const target = subflows[subflowId(node)];
          const output = options.invokeSubFlow
            ? await options.invokeSubFlow(
              effectiveRuntime,
              { nodeId: node.id, flowRef: node.flow },
              nodeInput,
              { signal: controller.signal },
            )
            : await target.invoke(runtime, nodeInput, {
              signal: controller.signal,
              ...(options.bindSignal ? { bindSignal: options.bindSignal } : {}),
            });
          success = { node, output: requireExactRecord(output, node.outputs, `${node.id} output`) };
        } else {
          const fn = code.get(node.id)!;
          const nodeRuntime = options.bindNode?.(effectiveRuntime, { nodeId: node.id }) ?? effectiveRuntime;
          const result = await fn(nodeRuntime, nodeInput, Object.freeze({ ...node.config }));
          if (node.tag === 'SinkNode') {
            if (result !== undefined) throw new TypeError(`${node.id} SinkNode must return void`);
            success = { node };
          } else {
            success = { node, output: requireExactRecord(result, node.outputs, `${node.id} output`) };
          }
        }
      }
    } catch (cause) {
      await options.onNodeFailure?.({ nodeId: node.id, cause });
      throw cause;
    }
    const durable: EagerDataFlowDurableNodeState = {
      nodeId: node.id,
      ...(success.output ? { output: success.output } : {}),
      ...(success.returned ? { returned: success.returned } : {}),
    };
    await options.onNodeSuccess?.(durable);
    return success;
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
