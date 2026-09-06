import {
  DEPA_AI_RESOURCE_KIND_READER_REGISTRATIONS,
  type AIAgentCodeResourceProjection,
  type AIAgentResolvedResourceIdentity,
  type AIWorkflowAgentResourceProjection,
} from 'ai-workflow-contract';
import {
  composeLayeredResourceRegistry,
  digestCanonical,
  resolveEffectiveResourceContentIdentities,
  type EffectiveResourceRegistry,
  type ResourceContentIdentity,
  type ResourceLayerContentIdentityInput,
  type ResourceRecord,
  type ResolvedResourceRecord,
  type ResourceTombstone,
} from 'halfcode-compiler.xnl/resource-core';
import { projectAIWorkflowAgentResources } from './agent-resources.js';
import { resolveAIWorkflowResourceTree, type AIWorkflowResourceResolutionContext } from './resource-resolution.js';

export interface ResolveAIAgentExecutionResourcesRuntime {
  readonly resolutionContexts: ReadonlyMap<string, AIWorkflowResourceResolutionContext>;
}
export interface ResolveAIAgentExecutionResourcesInput {
  readonly registry: EffectiveResourceRegistry;
  readonly layers: readonly ResourceLayerContentIdentityInput[];
}
declare const executionResourceBrand: unique symbol;
/** Process-local derived observation; rebuild from authored bytes and exact readers on recovery. */
export interface AIAgentExecutionResourceObservation {
  readonly [executionResourceBrand]: true;
  readonly registry: EffectiveResourceRegistry;
  readonly projection: AIWorkflowAgentResourceProjection;
  readonly contentIdentities: ReadonlyMap<string, ResourceContentIdentity>;
  readonly resolutionIdentities: ReadonlyMap<string, AIAgentResolvedResourceIdentity>;
  /** Exact native effective records. Custom readerValue semantics remain owned by that Kind. */
  readonly resolvedResources: ReadonlyMap<string, ResolvedResourceRecord>;
}
interface ExecutionAuthority extends ResolveAIAgentExecutionResourcesInput {
  readonly layerBindings: readonly ResourceLayerContentIdentityInput[];
}
const authorities = new WeakMap<AIAgentExecutionResourceObservation, ExecutionAuthority>();
const codeResolutions = new WeakMap<AIAgentCodeResourceProjection, AIAgentResolvedResourceIdentity>();
const executionRegistries = new WeakSet<EffectiveResourceRegistry>();
const executionCodeResources = new WeakSet<ResourceRecord>();
const nodeReaderSubjects = new Set(DEPA_AI_RESOURCE_KIND_READER_REGISTRATIONS.map(reader => reader.subjectFqn));

export function resolveAIAgentExecutionResources(
  runtime: ResolveAIAgentExecutionResourcesRuntime,
  input: ResolveAIAgentExecutionResourcesInput,
): AIAgentExecutionResourceObservation {
  // Native owner validates registry provenance, exact authored trees, layer order and origins.
  const contentIdentities = resolveEffectiveResourceContentIdentities(input);
  if (runtime.resolutionContexts.size !== input.layers.length
    || input.layers.some(layer => !runtime.resolutionContexts.get(layer.id))) {
    fail('Reader context keys must exactly match the authored layer ids.');
  }
  // Tombstones are facts of the authentic composer result. Reuse the native composer
  // to replay them, including tombstones that were subsequently shadowed by a layer.
  const tombstones = new Map<string, ResourceTombstone[]>();
  for (const entry of input.registry.byId.values()) for (const tombstone of entry.tombstones) {
    const values = tombstones.get(tombstone.layerId) ?? [];
    values.push({ resourceId: tombstone.resourceId,
      ...(tombstone.expectedKind === undefined ? {} : { expectedKind: tombstone.expectedKind }),
      ...(tombstone.reason === undefined ? {} : { reason: tombstone.reason }) });
    tombstones.set(tombstone.layerId, values);
  }
  const resolvedLayers = input.layers.map(layer => ({
    id: layer.id,
    tree: resolveAIWorkflowResourceTree(layer.tree, runtime.resolutionContexts.get(layer.id)!),
    tombstones: tombstones.get(layer.id) ?? [],
  }));
  const registry = composeLayeredResourceRegistry({ layers: resolvedLayers });
  if (digestCanonical(topology(registry)) !== digestCanonical(topology(input.registry))) {
    fail('Resolved composition must retain the exact authored layer, origin, shadow and tombstone topology.');
  }
  const resolutions: Array<readonly [string, AIAgentResolvedResourceIdentity]> = [];
  const resolvedResources: Array<readonly [string, ResolvedResourceRecord]> = [];
  for (const entry of registry.byId.values()) {
    if (!entry.resource) continue;
    const layer = resolvedLayers.find(value => value.id === entry.effectiveLayerId);
    const record = layer?.tree.registry.byKind.get(entry.kind)?.find(value => value.resourceId === entry.resourceId);
    if (!record || !layer) fail(`Missing native resolution for '${entry.resourceId}'.`);
    resolvedResources.push([entry.resourceId, record]);
    // This projector's explicit input protocol is resolved PortableSpec/node. It does
    // not execute arbitrary Kind reader outputs with different business semantics.
    if (nodeReaderSubjects.has(record.subjectFqn)
      && digestCanonical(record.readerValue) !== digestCanonical(record.resolvedSpec)) {
      fail(`Kind '${record.kind}' requires a reader whose value preserves the resolved node input protocol.`);
    }
    resolutions.push([entry.resourceId, Object.freeze({
      resourceId: record.resourceId, readerId: record.readerId, readerSpecVersion: record.readerSpecVersion,
      effectiveContentDigest: record.effectiveContentDigest, readerProfileId: layer.tree.readerProfileId,
      resolutionReceiptDigest: digestCanonical(record.resolution),
    })]);
  }
  const resolutionIdentities = immutableMap(resolutions.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  const projection = projectAIWorkflowAgentResources(registry);
  for (const code of projection.codeResources ?? []) {
    codeResolutions.set(code, resolutionIdentities.get(code.resource.resourceId)!);
    executionCodeResources.add(code.resource);
  }
  const observation = Object.freeze({ registry, projection, contentIdentities, resolutionIdentities,
    resolvedResources: immutableMap(resolvedResources.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)),
  }) as AIAgentExecutionResourceObservation;
  authorities.set(observation, Object.freeze({ registry: input.registry, layers: input.layers,
    layerBindings: Object.freeze(input.layers.map(layer => Object.freeze({ id: layer.id, tree: layer.tree }))) }));
  executionRegistries.add(registry);
  return observation;
}

/** Internal admission guard; never exported as a public branding operation. */
export function assertAIAgentExecutionResources(
  observation: AIAgentExecutionResourceObservation,
  registry: EffectiveResourceRegistry,
  layers?: readonly ResourceLayerContentIdentityInput[],
): AIAgentExecutionResourceObservation {
  const authority = authorities.get(observation);
  if (!authority || authority.registry !== registry || (layers !== undefined && authority.layers !== layers)
    || authority.layers.length !== authority.layerBindings.length
    || authority.layerBindings.some((layer, index) => authority.layers[index]?.id !== layer.id || authority.layers[index]?.tree !== layer.tree)) {
    fail('Execution resources require the exact authentic observation for this authored registry and layers.');
  }
  return observation;
}

export function resolutionForAIAgentCodeProjection(projection: AIAgentCodeResourceProjection): AIAgentResolvedResourceIdentity | undefined {
  const resolution = codeResolutions.get(projection);
  if (!resolution && executionCodeResources.has(projection.resource)) {
    fail('Code compilation and restore require the exact execution observation projection.');
  }
  return resolution;
}

/** Prevents discarding reader identities by passing a bridge registry to the old freeze path. */
export function assertAIAgentFreezeRegistry(registry: EffectiveResourceRegistry): void {
  if (executionRegistries.has(registry)) fail('Freeze requires the original authored registry and its executionResources observation.');
}

function topology(registry: EffectiveResourceRegistry): unknown {
  return { layers: registry.layers, entries: [...registry.byId.values()].map(entry => ({
    resourceId: entry.resourceId, kind: entry.kind, present: entry.resource !== undefined,
    origin: entry.effectiveOrigin ?? null, shadowed: entry.shadowed,
    tombstone: entry.tombstone ?? null, tombstones: entry.tombstones,
  })) };
}
function immutableMap<K, V>(entries: readonly (readonly [K, V])[]): ReadonlyMap<K, V> {
  const values = new Map(entries);
  const view: ReadonlyMap<K, V> = Object.freeze({
    get size() { return values.size; },
    get: (key: K) => values.get(key), has: (key: K) => values.has(key),
    keys: () => values.keys(), values: () => values.values(), entries: () => values.entries(),
    [Symbol.iterator]: () => values[Symbol.iterator](),
    forEach: (callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown) => {
      values.forEach((value, key) => callback.call(thisArg, value, key, view));
    },
  });
  return view;
}
function fail(message: string): never { throw new Error(`AI_AGENT_EXECUTION_RESOURCES_UNTRUSTED: ${message}`); }
