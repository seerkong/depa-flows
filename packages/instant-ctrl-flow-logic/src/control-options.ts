import type { FlowBundleSpec, FlowNodeSpec } from 'instant-ctrl-flow-contract';

function record(value: unknown, location: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError(`${location}: expected plain control options`);
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string')
    || Object.values(Object.getOwnPropertyDescriptors(value)).some(descriptor => !Object.hasOwn(descriptor, 'value'))) throw new TypeError(`${location}: control options must contain data fields`);
  return value as Record<string, unknown>;
}

function bounded(value: unknown, max: number, location: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) throw new RangeError(`${location}: expected integer 1..${max}`);
  return value;
}

/** 纯转换：保留模板/旧运行，拒绝未知字段、控制节点和超过64项的覆盖。 */
export function applyFlowControlOptions(spec: FlowBundleSpec, value: unknown): FlowBundleSpec {
  const options = value === undefined ? {} : record(value, 'controlOptions');
  if (Object.keys(options).length > 64) throw new RangeError('controlOptions: at most 64 node overrides');
  const frozen = structuredClone(spec);
  const nodes = new Map<string, FlowNodeSpec>();
  function visit(node: FlowNodeSpec): void {
    if (node.id) {
      if (nodes.has(node.id)) throw new TypeError(`controlOptions: ambiguous node ${node.id}`);
      nodes.set(node.id, node);
    }
    node.children.forEach(visit);
    Object.values(node.sections).forEach(visit);
  }
  frozen.statements.forEach(visit);
  Object.values(frozen.blocks ?? {}).forEach(statements => statements.forEach(visit));
  for (const [id, input] of Object.entries(options)) {
    const node = nodes.get(id);
    const row = record(input, `controlOptions.${id}`);
    const fields = Object.keys(row);
    if (node?.tag === 'Until') {
      if (!fields.length || fields.some(key => !['maxIterations', 'onExhausted'].includes(key))) throw new TypeError(`controlOptions.${id}: invalid Until fields`);
      if (Object.hasOwn(row, 'maxIterations')) node.attrs.maxIterations = bounded(row.maxIterations, 1000, `${id}.maxIterations`);
      if (Object.hasOwn(row, 'onExhausted')) {
        if (row.onExhausted !== 'fail' && row.onExhausted !== 'complete') throw new TypeError(`${id}.onExhausted: expected fail or complete`);
        node.attrs.onExhausted = row.onExhausted;
      }
    } else if (node?.tag === 'ForEach') {
      if (!fields.length || fields.some(key => !['maxItems', 'concurrency'].includes(key))) throw new TypeError(`controlOptions.${id}: invalid ForEach fields`);
      const maxItems = bounded(row.maxItems ?? node.attrs.maxItems ?? 1000, 1000, `${id}.maxItems`);
      node.attrs.maxItems = maxItems;
      node.attrs.concurrency = bounded(row.concurrency ?? node.attrs.concurrency ?? 1, Math.min(32, maxItems), `${id}.concurrency`);
    } else {
      throw new TypeError(`controlOptions.${id}: node is not an Until or ForEach`);
    }
  }
  return frozen;
}
