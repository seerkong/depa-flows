import type {
  AIDataWorkflowGraphPatch,
  AIDataWorkflowGraphPatchNodeSpec,
  AIDataWorkflowInvalidation,
  AIDataWorkflowNodeConfig,
  AIDataWorkflowNodeInputs,
  AIDataWorkflowNodeTag,
  AIDataWorkflowReuseCandidate,
  AIDataWorkflowRunGraph,
  AIDataWorkflowRunNode,
  AIDataWorkflowRunNodeStatus,
  AIDataWorkflowSemanticInput,
} from 'ai-data-workflow-contract';
import type {
  AIDataWorkflowDefinitionBinding,
  AIDataWorkflowRuntime,
  AIWorkflowDefinitionRef,
  AIWorkflowEffectProvider,
  AIWorkflowEffectiveReusePolicy,
  AIWorkflowNodeResult,
  AIWorkflowNodeStatus,
  AIWorkflowNodeType,
  AIWorkflowReusePolicy,
  AIWorkflowRunState,
  AIWorkflowRunStatus,
  AIWorkflowRuntimeContext,
  AIWorkflowSemanticFingerprint,
  AIWorkflowStateStore,
} from 'ai-workflow-contract';
import type {
  EagerDataFlowAuthoringPlan,
  EagerDataFlowDiagnostic,
  EagerDataFlowNodePlan,
  EagerDataFlowSourceCollection,
  EagerDataFlowValue,
  LoadEagerDataFlowOptions,
} from 'eager-data-flow-contract';
import { loadEagerDataFlowProfileSources } from 'eager-data-flow-logic';
import {
  createAIWorkflowRuntimeContext,
  defineAIDataWorkflow,
  resolveAIWorkflowReusePolicy,
} from 'ai-workflow-logic';

export class AIDataWorkflowRunGraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AIDataWorkflowRunGraphError';
  }
}

export interface CreateAIDataWorkflowRuntimeOptions<
  Effects extends AIWorkflowEffectProvider,
  Store extends AIWorkflowStateStore,
> {
  readonly ai: AIWorkflowRuntimeContext<Effects, Store>;
}

export function createAIDataWorkflowRuntime<
  Effects extends AIWorkflowEffectProvider,
  Store extends AIWorkflowStateStore,
>(
  options: CreateAIDataWorkflowRuntimeOptions<Effects, Store>,
): AIDataWorkflowRuntime<Effects, Store> {
  return {
    ai: createAIWorkflowRuntimeContext(options.ai),
  };
}

export function defineEagerBackedAIDataWorkflow(
  definition: AIDataWorkflowDefinitionBinding['definition'],
): AIDataWorkflowDefinitionBinding {
  return defineAIDataWorkflow(definition);
}

export interface AIDataWorkflowSourceLoadResult {
  readonly binding?: AIDataWorkflowDefinitionBinding;
  readonly diagnostics: readonly EagerDataFlowDiagnostic[];
}

export function loadAIDataWorkflowSources(
  sources: EagerDataFlowSourceCollection,
  options: LoadEagerDataFlowOptions = {},
): AIDataWorkflowSourceLoadResult {
  const loaded = loadEagerDataFlowProfileSources(sources, {
    ...options,
    profileRoot: 'AIDataWorkflow',
  });
  if (!loaded.plan || loaded.diagnostics.length > 0) {
    return { diagnostics: loaded.diagnostics };
  }
  return {
    binding: defineEagerBackedAIDataWorkflow(loaded.plan),
    diagnostics: loaded.diagnostics,
  };
}

export interface CreateAIDataWorkflowRunGraphOptions {
  readonly binding: AIDataWorkflowDefinitionBinding;
  readonly runId: string;
  readonly platformDefaultPolicy?: AIWorkflowReusePolicy;
}

export interface InvalidateAIDataWorkflowNodeOptions {
  readonly generation?: number;
  readonly sourceNodeId?: string;
  readonly includeSource?: boolean;
  readonly atMs?: number;
}

export interface FindReusableAIDataWorkflowNodeResultInput {
  readonly runId: string;
  readonly nodeId: string;
  readonly fingerprint: AIWorkflowSemanticFingerprint;
  readonly policy: AIWorkflowEffectiveReusePolicy;
  readonly candidates: readonly AIDataWorkflowReuseCandidate[];
}

type NodeOperationSource = {
  readonly nodeId: string;
  readonly includeSource: boolean;
  readonly reason: string;
};

const GENERATED_NODE_TAG = 'TransformNode' satisfies AIDataWorkflowNodeTag;

function uniqueStrings(values: Iterable<string>): string[] {
  return [...new Set([...values].filter((value) => value.length > 0))];
}

function cloneRecord<T>(record: Readonly<Record<string, T>> | undefined): Record<string, T> {
  return record ? { ...record } : {};
}

function cloneInvalidation(invalidation: AIDataWorkflowInvalidation): AIDataWorkflowInvalidation {
  return { ...invalidation };
}

function cloneNode(node: AIDataWorkflowRunNode): AIDataWorkflowRunNode {
  return {
    ...node,
    inputs: cloneRecord(node.inputs),
    outputs: [...node.outputs],
    config: cloneRecord(node.config),
    dependsOn: [...node.dependsOn],
    dependents: [...node.dependents],
    reusePolicy: { ...node.reusePolicy },
    ...(node.semanticFingerprint ? { semanticFingerprint: cloneFingerprint(node.semanticFingerprint) } : {}),
    ...(node.result ? { result: cloneNodeResult(node.result) } : {}),
    ...(node.invalidatedBy ? { invalidatedBy: node.invalidatedBy.map(cloneInvalidation) } : {}),
  };
}

function cloneNodeResult(result: AIWorkflowNodeResult): AIWorkflowNodeResult {
  return {
    ...result,
    ...(result.semanticFingerprint ? { semanticFingerprint: cloneFingerprint(result.semanticFingerprint) } : {}),
    ...(result.reusedFrom ? { reusedFrom: { ...result.reusedFrom } } : {}),
  };
}

function cloneFingerprint(fingerprint: AIWorkflowSemanticFingerprint): AIWorkflowSemanticFingerprint {
  return {
    ...fingerprint,
    ...(fingerprint.parts ? { parts: fingerprint.parts.map((part) => ({ ...part })) } : {}),
  };
}

function cloneGraph(graph: AIDataWorkflowRunGraph): AIDataWorkflowRunGraph {
  return {
    ...graph,
    nodes: Object.fromEntries(
      Object.entries(graph.nodes).map(([nodeId, node]) => [nodeId, cloneNode(node)]),
    ),
    declarationOrder: [...graph.declarationOrder],
    patchHistory: graph.patchHistory.map((record) => ({
      ...record,
      operations: record.operations.map((operation) => ({ ...operation })),
    })),
    invalidations: graph.invalidations.map(cloneInvalidation),
  };
}

function planDeclarationOrder(plan: EagerDataFlowAuthoringPlan): string[] {
  if (plan.declarationOrder.length > 0) return [...plan.declarationOrder];
  return [...plan.nodes].sort(
    (left, right) => left.declarationIndex - right.declarationIndex,
  ).map((node) => node.id);
}

function nodeInputs(node: EagerDataFlowNodePlan): AIDataWorkflowNodeInputs {
  if ('inputs' in node) return cloneRecord(node.inputs);
  return {};
}

function nodeOutputs(node: EagerDataFlowNodePlan): readonly string[] {
  if ('outputs' in node) return [...node.outputs];
  return [];
}

function nodeConfig(node: EagerDataFlowNodePlan): AIDataWorkflowNodeConfig {
  if ('config' in node) return cloneRecord(node.config);
  return {};
}

function configReusePolicy(config: AIDataWorkflowNodeConfig): AIWorkflowReusePolicy | undefined {
  const raw = config.reuse_policy ?? config.reusePolicy;
  return raw === 'semantic-hash' || raw === 'never' ? raw : undefined;
}

function nodeTypeForEagerNode(node: EagerDataFlowNodePlan): AIWorkflowNodeType {
  if ('config' in node && (node.config.node_type === 'manual' || node.config.nodeType === 'manual')) {
    return 'manual';
  }
  if ('type' in node && node.type === 'manual') return 'manual';
  if (node.tag === 'SinkNode') return 'effect';
  if (node.tag === 'SubFlowNode') return 'subflow';
  return 'data';
}

function nodeTypeForPatchNode(node: AIDataWorkflowGraphPatchNodeSpec): AIWorkflowNodeType {
  if (node.nodeType) return node.nodeType;
  if (node.config?.node_type === 'manual' || node.config?.nodeType === 'manual') return 'manual';
  if (node.tag === 'SinkNode') return 'effect';
  if (node.tag === 'SubFlowNode') return 'subflow';
  return 'data';
}

function dependenciesForPlan(plan: EagerDataFlowAuthoringPlan): Map<string, string[]> {
  const dependencies = new Map<string, Set<string>>();
  for (const node of plan.nodes) dependencies.set(node.id, new Set());

  for (const edge of [...plan.dataEdges, ...plan.waitForEdges]) {
    dependencies.get(edge.toNodeId)?.add(edge.fromNodeId);
  }

  for (const node of plan.nodes) {
    for (const wait of node.waitFor) {
      dependencies.get(node.id)?.add(wait.nodeId);
    }
    if ('inputs' in node) {
      for (const ref of Object.values(node.inputs)) {
        dependencies.get(node.id)?.add(ref.nodeId);
      }
    }
  }

  return new Map(
    [...dependencies.entries()].map(([nodeId, deps]) => [nodeId, uniqueStrings(deps)]),
  );
}

function recomputeDependents(
  nodes: Readonly<Record<string, AIDataWorkflowRunNode>>,
  declarationOrder: readonly string[],
): Record<string, AIDataWorkflowRunNode> {
  const order = new Map(declarationOrder.map((nodeId, index) => [nodeId, index]));
  const dependents = new Map(Object.keys(nodes).map((nodeId) => [nodeId, new Set<string>()]));

  for (const node of Object.values(nodes)) {
    for (const dependency of node.dependsOn) {
      dependents.get(dependency)?.add(node.id);
    }
  }

  return Object.fromEntries(
    Object.entries(nodes).map(([nodeId, node]) => {
      const sortedDependents = [...(dependents.get(nodeId) ?? [])].sort(
        (left, right) => (order.get(left) ?? Number.MAX_SAFE_INTEGER) - (order.get(right) ?? Number.MAX_SAFE_INTEGER),
      );
      return [nodeId, { ...node, dependents: sortedDependents }];
    }),
  );
}

function requireNode(
  nodes: Readonly<Record<string, AIDataWorkflowRunNode>>,
  nodeId: string,
): AIDataWorkflowRunNode {
  const node = nodes[nodeId];
  if (!node) throw new AIDataWorkflowRunGraphError(`AI Data Workflow node ${nodeId} does not exist`);
  return node;
}

function assertKnownDependencies(
  nodes: Readonly<Record<string, AIDataWorkflowRunNode>>,
  nodeId: string,
  dependsOn: readonly string[],
): void {
  for (const dependency of dependsOn) {
    if (dependency === nodeId) {
      throw new AIDataWorkflowRunGraphError(`AI Data Workflow node ${nodeId} cannot depend on itself`);
    }
    if (!nodes[dependency]) {
      throw new AIDataWorkflowRunGraphError(
        `AI Data Workflow node ${nodeId} depends on unknown node ${dependency}`,
      );
    }
  }
}

export function createAIDataWorkflowRunGraph(
  options: CreateAIDataWorkflowRunGraphOptions,
): AIDataWorkflowRunGraph {
  const { binding, runId, platformDefaultPolicy } = options;
  const plan = binding.definition;
  const dependencies = dependenciesForPlan(plan);
  const declarationOrder = planDeclarationOrder(plan);
  const nodes = Object.fromEntries(
    declarationOrder.map((nodeId) => {
      const planNode = plan.nodeById[nodeId] ?? plan.nodes.find((node) => node.id === nodeId);
      if (!planNode) {
        throw new AIDataWorkflowRunGraphError(`EagerDataFlow declarationOrder references missing node ${nodeId}`);
      }
      const config = nodeConfig(planNode);
      const nodeType = nodeTypeForEagerNode(planNode);
      const reusePolicy = resolveAIWorkflowReusePolicy({
        nodeType,
        explicitPolicy: configReusePolicy(config),
        platformDefaultPolicy,
      });
      const runNode: AIDataWorkflowRunNode = {
        id: planNode.id,
        tag: planNode.tag,
        nodeType,
        generation: 0,
        status: 'Pending',
        declarationIndex: planNode.declarationIndex,
        inputs: nodeInputs(planNode),
        outputs: nodeOutputs(planNode),
        config,
        dependsOn: dependencies.get(planNode.id) ?? [],
        dependents: [],
        reusePolicy,
      };
      return [planNode.id, runNode];
    }),
  );

  for (const node of Object.values(nodes)) {
    assertKnownDependencies(nodes, node.id, node.dependsOn);
  }

  return {
    runId,
    binding,
    currentGeneration: 0,
    nodes: recomputeDependents(nodes, declarationOrder),
    declarationOrder,
    patchHistory: [],
    invalidations: [],
  };
}

function makePatchNode(
  spec: AIDataWorkflowGraphPatchNodeSpec,
  generation: number,
  platformDefaultPolicy?: AIWorkflowReusePolicy,
): AIDataWorkflowRunNode {
  const tag = spec.tag ?? GENERATED_NODE_TAG;
  const config = cloneRecord(spec.config);
  const nodeType = nodeTypeForPatchNode({ ...spec, tag, config });
  return {
    id: spec.id,
    tag,
    nodeType,
    generation,
    status: 'Pending',
    declarationIndex: spec.declarationIndex ?? 0,
    inputs: cloneRecord(spec.inputs),
    outputs: [...(spec.outputs ?? [])],
    config,
    dependsOn: uniqueStrings(spec.dependsOn ?? []),
    dependents: [],
    reusePolicy: spec.reusePolicy ?? resolveAIWorkflowReusePolicy({
      nodeType,
      explicitPolicy: configReusePolicy(config),
      platformDefaultPolicy,
    }),
  };
}

function collectTransitive(
  nodes: Readonly<Record<string, AIDataWorkflowRunNode>>,
  sourceNodeId: string,
  includeSource: boolean,
): string[] {
  const visited = new Set<string>();
  const queue = includeSource ? [sourceNodeId] : [...(nodes[sourceNodeId]?.dependents ?? [])];

  for (const nodeId of queue) {
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    const node = nodes[nodeId];
    if (!node || node.status === 'Removed') continue;
    queue.push(...node.dependents);
  }

  return [...visited].filter((nodeId) => nodes[nodeId]?.status !== 'Removed');
}

function applyInvalidations(
  nodes: Readonly<Record<string, AIDataWorkflowRunNode>>,
  existingInvalidations: readonly AIDataWorkflowInvalidation[],
  sources: readonly NodeOperationSource[],
  generation: number,
  atMs?: number,
): {
  readonly nodes: Record<string, AIDataWorkflowRunNode>;
  readonly invalidations: readonly AIDataWorkflowInvalidation[];
} {
  let nextNodes: Record<string, AIDataWorkflowRunNode> = Object.fromEntries(
    Object.entries(nodes).map(([nodeId, node]) => [nodeId, cloneNode(node)]),
  );
  const invalidations = existingInvalidations.map(cloneInvalidation);
  const emitted = new Set<string>();

  for (const source of sources) {
    for (const nodeId of collectTransitive(nextNodes, source.nodeId, source.includeSource)) {
      const node = nextNodes[nodeId];
      if (!node || node.status === 'Removed') continue;
      const key = `${source.nodeId}:${nodeId}:${generation}`;
      if (emitted.has(key)) continue;
      emitted.add(key);
      const invalidation: AIDataWorkflowInvalidation = {
        nodeId,
        generation,
        reason: source.reason,
        sourceNodeId: source.nodeId,
        ...(atMs === undefined ? {} : { atMs }),
      };
      invalidations.push(invalidation);
      nextNodes = {
        ...nextNodes,
        [nodeId]: {
          ...node,
          status: 'Invalidated',
          generation,
          invalidatedBy: [...(node.invalidatedBy ?? []), invalidation],
        },
      };
    }
  }

  return { nodes: nextNodes, invalidations };
}

export function invalidateAIDataWorkflowNode(
  graph: AIDataWorkflowRunGraph,
  nodeId: string,
  reason: string,
  options: InvalidateAIDataWorkflowNodeOptions = {},
): AIDataWorkflowRunGraph {
  requireNode(graph.nodes, nodeId);
  const generation = options.generation ?? graph.currentGeneration;
  const sourceNodeId = options.sourceNodeId ?? nodeId;
  const cloned = cloneGraph(graph);
  const { nodes, invalidations } = applyInvalidations(
    cloned.nodes,
    cloned.invalidations,
    [{ nodeId: sourceNodeId, includeSource: options.includeSource ?? true, reason }],
    generation,
    options.atMs,
  );
  return {
    ...cloned,
    currentGeneration: Math.max(cloned.currentGeneration, generation),
    nodes,
    invalidations,
  };
}

export function applyAIDataWorkflowGraphPatch(
  graph: AIDataWorkflowRunGraph,
  patch: AIDataWorkflowGraphPatch,
): AIDataWorkflowRunGraph {
  if (graph.patchHistory.some((record) => record.patchId === patch.patchId)) {
    throw new AIDataWorkflowRunGraphError(`AI Data Workflow patch ${patch.patchId} already applied`);
  }

  const generation = graph.currentGeneration + 1;
  const atMs = patch.atMs ?? Date.now();
  let declarationOrder = [...graph.declarationOrder];
  let nodes = Object.fromEntries(
    Object.entries(graph.nodes).map(([nodeId, node]) => [nodeId, cloneNode(node)]),
  );
  const invalidationSources: NodeOperationSource[] = [];

  for (const operation of patch.operations) {
    if (operation.op === 'add-node') {
      if (nodes[operation.node.id]) {
        throw new AIDataWorkflowRunGraphError(
          `AI Data Workflow node ${operation.node.id} already exists`,
        );
      }
      const node = makePatchNode(
        {
          ...operation.node,
          declarationIndex: operation.node.declarationIndex ?? declarationOrder.length,
        },
        generation,
      );
      assertKnownDependencies(nodes, node.id, node.dependsOn);
      nodes = { ...nodes, [node.id]: node };
      declarationOrder = [...declarationOrder, node.id];
      continue;
    }

    if (operation.op === 'update-node') {
      const existing = requireNode(nodes, operation.nodeId);
      if (existing.status === 'Removed') {
        throw new AIDataWorkflowRunGraphError(
          `AI Data Workflow node ${operation.nodeId} has been removed`,
        );
      }
      const config = operation.changes.config ? cloneRecord(operation.changes.config) : existing.config;
      const nodeType = operation.changes.nodeType ?? existing.nodeType;
      const dependsOn = operation.changes.dependsOn
        ? uniqueStrings(operation.changes.dependsOn)
        : existing.dependsOn;
      assertKnownDependencies(nodes, existing.id, dependsOn);
      const reusePolicy = operation.changes.reusePolicy ?? (
        operation.changes.config
          ? resolveAIWorkflowReusePolicy({
            nodeType,
            explicitPolicy: configReusePolicy(config),
          })
          : existing.reusePolicy
      );
      nodes = {
        ...nodes,
        [existing.id]: {
          ...existing,
          ...operation.changes,
          tag: operation.changes.tag ?? existing.tag,
          nodeType,
          generation,
          inputs: operation.changes.inputs ? cloneRecord(operation.changes.inputs) : existing.inputs,
          outputs: operation.changes.outputs ? [...operation.changes.outputs] : existing.outputs,
          config,
          dependsOn,
          reusePolicy,
        },
      };
      invalidationSources.push({
        nodeId: existing.id,
        includeSource: true,
        reason: patch.reason ?? `patch:${patch.patchId}`,
      });
      continue;
    }

    const existing = requireNode(nodes, operation.nodeId);
    nodes = {
      ...nodes,
      [existing.id]: {
        ...existing,
        generation,
        status: 'Removed',
      },
    };
    invalidationSources.push({
      nodeId: existing.id,
      includeSource: false,
      reason: patch.reason ?? `patch:${patch.patchId}`,
    });
  }

  nodes = recomputeDependents(nodes, declarationOrder);
  const invalidated = applyInvalidations(
    nodes,
    graph.invalidations,
    invalidationSources,
    generation,
    atMs,
  );

  return {
    ...graph,
    currentGeneration: generation,
    nodes: invalidated.nodes,
    declarationOrder,
    patchHistory: [
      ...graph.patchHistory,
      {
        patchId: patch.patchId,
        generation,
        ...(patch.reason ? { reason: patch.reason } : {}),
        operations: patch.operations,
        atMs,
      },
    ],
    invalidations: invalidated.invalidations,
  };
}

function stableSemanticValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return '{"$undefined":true}';
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return '{"$number":"NaN"}';
    if (value === Infinity) return '{"$number":"Infinity"}';
    if (value === -Infinity) return '{"$number":"-Infinity"}';
  }
  if (typeof value === 'bigint') return `{"$bigint":${JSON.stringify(value.toString())}}`;
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSemanticValue).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => typeof item !== 'function' && typeof item !== 'symbol')
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableSemanticValue(item)}`).join(',')}}`;
}

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

export function createAIDataWorkflowSemanticFingerprint(
  input: AIDataWorkflowSemanticInput,
): AIWorkflowSemanticFingerprint {
  const canonical = stableSemanticValue({
    nodeId: input.nodeId,
    nodeTag: input.nodeTag,
    effectiveInput: input.effectiveInput,
    config: input.config ?? {},
    materialRevisions: input.materialRevisions ?? {},
    effectPolicy: input.effectPolicy ?? {},
  });
  return {
    algorithm: 'semantic-hash/v1',
    value: `fnv1a64:${fnv1a64(canonical)}`,
    parts: [{ name: 'canonical', value: canonical }],
  };
}

export function findReusableAIDataWorkflowNodeResult(
  input: FindReusableAIDataWorkflowNodeResultInput,
): AIWorkflowNodeResult | undefined {
  if (input.policy.policy === 'never') return undefined;
  return input.candidates.find((candidate) =>
    candidate.runId === input.runId &&
    candidate.nodeId === input.nodeId &&
    candidate.semanticFingerprint.algorithm === input.fingerprint.algorithm &&
    candidate.semanticFingerprint.value === input.fingerprint.value
  )?.result;
}

function toRunNodeStatus(status: AIWorkflowNodeStatus): AIDataWorkflowRunNodeStatus {
  switch (status) {
    case 'Pending':
    case 'Running':
    case 'Succeeded':
    case 'Failed':
    case 'Invalidated':
    case 'Reused':
      return status;
    case 'Waiting':
      return 'Running';
    case 'Cancelled':
      return 'Failed';
  }
}

function toWorkflowNodeStatus(status: AIDataWorkflowRunNodeStatus): AIWorkflowNodeStatus {
  switch (status) {
    case 'Pending':
    case 'Ready':
      return 'Pending';
    case 'Running':
      return 'Running';
    case 'Succeeded':
      return 'Succeeded';
    case 'Failed':
      return 'Failed';
    case 'Invalidated':
      return 'Invalidated';
    case 'Reused':
      return 'Reused';
    case 'Removed':
      return 'Cancelled';
  }
}

export function recordAIDataWorkflowNodeResult(
  graph: AIDataWorkflowRunGraph,
  nodeId: string,
  result: AIWorkflowNodeResult,
): AIDataWorkflowRunGraph {
  const node = requireNode(graph.nodes, nodeId);
  const nodes = {
    ...graph.nodes,
    [nodeId]: {
      ...node,
      generation: result.generation,
      status: toRunNodeStatus(result.status),
      result: cloneNodeResult(result),
      ...(result.semanticFingerprint ? { semanticFingerprint: cloneFingerprint(result.semanticFingerprint) } : {}),
    },
  };
  return {
    ...graph,
    currentGeneration: Math.max(graph.currentGeneration, result.generation),
    nodes: recomputeDependents(nodes, graph.declarationOrder),
  };
}

export function listReadyAIDataWorkflowNodes(
  graph: AIDataWorkflowRunGraph,
): readonly AIDataWorkflowRunNode[] {
  return graph.declarationOrder
    .map((nodeId) => graph.nodes[nodeId])
    .filter((node): node is AIDataWorkflowRunNode => Boolean(node))
    .filter((node) =>
      (node.status === 'Pending' || node.status === 'Invalidated') &&
      node.dependsOn.every((dependency) => {
        const dependencyNode = graph.nodes[dependency];
        return dependencyNode?.status === 'Succeeded' || dependencyNode?.status === 'Reused';
      })
    );
}

function graphStatus(graph: AIDataWorkflowRunGraph): AIWorkflowRunStatus {
  const nodes = Object.values(graph.nodes).filter((node) => node.status !== 'Removed');
  if (nodes.some((node) => node.status === 'Failed')) return 'Failed';
  if (nodes.some((node) => node.status === 'Running')) return 'Running';
  if (nodes.length > 0 && nodes.every((node) => node.status === 'Succeeded' || node.status === 'Reused')) {
    return 'Succeeded';
  }
  return 'Pending';
}

export function projectAIDataWorkflowRunState(
  graph: AIDataWorkflowRunGraph,
  workflow: AIWorkflowDefinitionRef,
): AIWorkflowRunState {
  const nodes = Object.fromEntries(
    Object.entries(graph.nodes)
      .filter(([, node]) => node.status !== 'Removed')
      .map(([nodeId, node]) => {
        const result = node.result ?? {
          nodeId,
          generation: node.generation,
          status: toWorkflowNodeStatus(node.status),
          ...(node.semanticFingerprint ? { semanticFingerprint: node.semanticFingerprint } : {}),
        };
        return [nodeId, result];
      }),
  );

  return {
    ref: {
      workflow,
      runId: graph.runId,
      generation: graph.currentGeneration,
    },
    status: graphStatus(graph),
    nodes,
    metadata: {
      kind: 'AIDataWorkflow',
      fqn: graph.binding.definition.fqn,
    },
  };
}

export function restoreAIDataWorkflowRunGraph(graph: AIDataWorkflowRunGraph): AIDataWorkflowRunGraph {
  return cloneGraph(graph);
}
