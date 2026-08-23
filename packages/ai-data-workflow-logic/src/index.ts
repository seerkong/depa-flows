import type {
  AIDataWorkflowGraphPatch,
  AIDataWorkflowGraphPatchNodeSpec,
  AIDataWorkflowInvalidation,
  AIDataWorkflowNodeConfig,
  AIDataWorkflowNodeInputs,
  AIDataWorkflowNodeTag,
  AIDataWorkflowReuseCandidate,
  AIDataWorkflowRunGraph,
  AIDataWorkflowRunCheckpoint,
  AIDataWorkflowRunNode,
  AIDataWorkflowRunNodeStatus,
  AIDataWorkflowSemanticInput,
} from 'ai-data-workflow-contract';
import type {
  AIDataWorkflowDefinitionBinding,
  AIDataWorkflowRunProfileState,
  AIDataWorkflowRuntime,
  AIAgentHostEffectPort,
  FrozenAIAgentTaskBinding,
  AIWorkflowAuthoredEffects,
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
  AIWorkflowProfileDurableState,
  AIWorkflowSemanticFingerprint,
  AIWorkflowStateProjection,
  FlowClosedObject,
  FlowClosedValue,
  FlowDefinitionArtifactIdentity,
  FlowRunCheckpointCommit,
  FlowRunCheckpointKey,
  FlowRunCheckpointRuntime,
  FlowRunStepExtensions,
  FlowRunProfileState,
} from 'ai-workflow-contract';
import type {
  EagerDataFlowAuthoringPlan,
  EagerDataFlowDiagnostic,
  EagerDataFlowNodePlan,
  EagerDataFlowSourceCollection,
  EagerDataFlowValue,
  LoadEagerDataFlowOptions,
} from 'eager-data-flow-contract';
import { loadEagerDataFlowProfileSources, loadEagerDataFlowProfileSourcesWithRuntime } from 'eager-data-flow-logic';
import { createDefinitionStepSourceRuntime, type DefinitionStepAssemblyRuntime } from 'flow-step-space-logic';
import {
  createAIWorkflowRuntimeContext,
  commitFlowRunCheckpoint,
  defineAIDataWorkflow,
  loadFlowRunCheckpoint,
  resolveAIWorkflowReusePolicy,
  bindAIAgentProcessors,
} from 'ai-workflow-logic';
import { assertFrozenAIAgentTaskBinding } from 'ai-workflow-logic/run-freeze';

export interface CreateAIDataWorkflowCheckpointInput {
  readonly instanceId: string;
  readonly definition: FlowDefinitionArtifactIdentity;
  readonly graph: AIDataWorkflowRunGraph;
  readonly input: FlowClosedValue;
  readonly config: FlowClosedValue;
  readonly state: FlowClosedValue;
  readonly output: FlowClosedValue;
  readonly controllerSidecars: FlowClosedObject;
  readonly nodeSidecars: FlowClosedObject;
  readonly ai: AIWorkflowProfileDurableState;
  readonly stepExtensions?: FlowRunStepExtensions;
}

/** Creates the first complete Data checkpoint as one runtime-owned transition. */
export function createAIDataWorkflowCheckpoint(
  runtime: FlowRunCheckpointRuntime,
  input: CreateAIDataWorkflowCheckpointInput,
): Promise<AIDataWorkflowRunCheckpoint> {
  return commitAIDataWorkflowCheckpoint(runtime, {
    expectedVersion: null,
    checkpoint: {
      schemaVersion: 'depa.flow-run-checkpoint/v1',
      instanceId: input.instanceId,
      runId: input.graph.runId,
      definition: input.definition,
      version: 0,
      input: input.input,
      config: input.config,
      state: input.state,
      output: input.output,
      controllerSidecars: input.controllerSidecars,
      nodeSidecars: input.nodeSidecars,
      ...(input.stepExtensions === undefined ? {} : { stepExtensions: input.stepExtensions }),
      profile: { kind: 'AIDataWorkflow', runGraph: input.graph, ai: input.ai },
    },
  });
}

export async function commitAIDataWorkflowCheckpoint(
  runtime: FlowRunCheckpointRuntime,
  input: FlowRunCheckpointCommit<AIDataWorkflowRunProfileState<AIDataWorkflowRunGraph>>,
): Promise<AIDataWorkflowRunCheckpoint> {
  const checkpoint = await commitFlowRunCheckpoint(
    runtime,
    input as unknown as FlowRunCheckpointCommit<FlowRunProfileState>,
  );
  if (checkpoint.profile.kind !== 'AIDataWorkflow') {
    throw new Error(`Flow run ${checkpoint.runId} is not an AI Data Workflow checkpoint.`);
  }
  return checkpoint as unknown as AIDataWorkflowRunCheckpoint;
}

export async function loadAIDataWorkflowCheckpoint(
  runtime: FlowRunCheckpointRuntime,
  input: FlowRunCheckpointKey,
): Promise<AIDataWorkflowRunCheckpoint | undefined> {
  const checkpoint = await loadFlowRunCheckpoint(runtime, input);
  if (checkpoint === undefined) return undefined;
  if (checkpoint.profile.kind !== 'AIDataWorkflow') {
    throw new Error(`Flow run ${input.runId} is not an AI Data Workflow checkpoint.`);
  }
  return checkpoint as unknown as AIDataWorkflowRunCheckpoint;
}

export class AIDataWorkflowRunGraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AIDataWorkflowRunGraphError';
  }
}

export interface CreateAIDataWorkflowRuntimeOptions<
  Effects extends AIWorkflowEffectProvider,
  Store extends AIWorkflowStateProjection,
> {
  readonly ai: AIWorkflowRuntimeContext<Effects, Store>;
}

export function createAIDataWorkflowRuntime<
  Effects extends AIWorkflowEffectProvider,
  Store extends AIWorkflowStateProjection,
>(
  options: CreateAIDataWorkflowRuntimeOptions<Effects, Store>,
): AIDataWorkflowRuntime<Effects, Store> {
  return {
    ai: createAIWorkflowRuntimeContext(options.ai),
  };
}

export interface CreateAIDataWorkflowAgentNodeRuntimeBinderOptions {
  readonly flowInstanceId: string;
  readonly runId: string;
  readonly checkpointRuntime: FlowRunCheckpointRuntime;
  readonly effects: AIAgentHostEffectPort;
  readonly workflowRef: `resource://${string}`;
  readonly taskProofs: Readonly<Record<string, FrozenAIAgentTaskBinding>>;
  readonly generationForNode: (nodeId: string) => number;
  readonly metadata?: FlowClosedObject;
}

/** Composition seam for ordinary TransformNode and SinkNode Processors. */
export function createAIDataWorkflowAgentNodeRuntimeBinder(
  options: CreateAIDataWorkflowAgentNodeRuntimeBinderOptions,
): (runtime: AIDataWorkflowRuntime<any, AIWorkflowStateProjection>, identity: { readonly nodeId: string }) => AIDataWorkflowRuntime<AIWorkflowAuthoredEffects, AIWorkflowStateProjection> {
  return (runtime, identity) => {
    const generation = options.generationForNode(identity.nodeId);
    const proof = options.taskProofs[identity.nodeId];
    if (!proof) throw new Error(`AI_AGENT_TASK_PROOF_REQUIRED: no frozen proof for node ${identity.nodeId}.`);
    const taskBinding = assertFrozenAIAgentTaskBinding(proof).task;
    const effects = bindAIAgentProcessors({
      checkpointRuntime: options.checkpointRuntime,
      checkpointKey: { instanceId: options.flowInstanceId, runId: options.runId },
      nodeId: identity.nodeId,
      invocationKey: `${identity.nodeId}#${generation}`,
      generation,
      workflowKind: 'AIDataWorkflow',
      workflowRef: options.workflowRef,
      taskBinding,
      effects: options.effects,
      ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
    });
    return Object.freeze({ ai: Object.freeze({ ...runtime.ai, effects }) });
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

export interface AIDataWorkflowSourceLoadRuntime {
  readonly extensionCodecs: DefinitionStepAssemblyRuntime['extensionCodecs'];
}

export interface AIDataWorkflowSourceLoadInput {
  readonly sources: EagerDataFlowSourceCollection;
}

export type AIDataWorkflowSourceLoadConfig = LoadEagerDataFlowOptions;

/** Processor form for profile admission with runtime-owned extension codecs. */
export function loadAIDataWorkflow(
  runtime: AIDataWorkflowSourceLoadRuntime,
  input: AIDataWorkflowSourceLoadInput,
  config: AIDataWorkflowSourceLoadConfig = {},
): AIDataWorkflowSourceLoadResult {
  const loaded = loadEagerDataFlowProfileSourcesWithRuntime(
    createDefinitionStepSourceRuntime(input.sources, runtime.extensionCodecs),
    input.sources,
    { ...config, profileRoot: 'AIDataWorkflow' },
  );
  if (!loaded.plan || loaded.diagnostics.length > 0) return { diagnostics: loaded.diagnostics };
  return {
    binding: defineEagerBackedAIDataWorkflow(loaded.plan),
    diagnostics: loaded.diagnostics,
  };
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
    if (nodes[dependency]?.status === 'Removed') {
      throw new AIDataWorkflowRunGraphError(
        `AI Data Workflow node ${nodeId} cannot depend on removed node ${dependency}`,
      );
    }
  }
}

function assertRunGraphInputReferences(
  nodes: Readonly<Record<string, AIDataWorkflowRunNode>>,
): void {
  for (const node of Object.values(nodes)) {
    for (const [inputName, input] of Object.entries(node.inputs)) {
      if (inputName.length === 0 || inputName !== inputName.trim()) {
        throw new AIDataWorkflowRunGraphError(`AI Data Workflow node ${node.id} has an invalid input identity`);
      }
      if (typeof input !== 'object' || input === null || Array.isArray(input)) continue;
      if (!('ref' in input) && !('nodeId' in input) && !('port' in input)) continue;
      const reference = input as { readonly ref?: unknown; readonly nodeId?: unknown; readonly port?: unknown };
      if (typeof reference.nodeId !== 'string' || typeof reference.port !== 'string'
        || reference.ref !== `flow-port://#${reference.nodeId}/${reference.port}`) {
        throw new AIDataWorkflowRunGraphError(
          `AI Data Workflow node ${node.id} input ${inputName} has an invalid flow-port reference`,
        );
      }
      const source = nodes[reference.nodeId];
      if (!source || source.status === 'Removed' || !source.outputs.includes(reference.port)) {
        throw new AIDataWorkflowRunGraphError(
          `AI Data Workflow node ${node.id} input ${inputName} references an undeclared source output`,
        );
      }
      if (!node.dependsOn.includes(reference.nodeId)) {
        throw new AIDataWorkflowRunGraphError(
          `AI Data Workflow node ${node.id} input ${inputName} is not projected by dependsOn`,
        );
      }
    }
  }
}

function assertReusePolicyAuthority(
  reusePolicy: AIWorkflowEffectiveReusePolicy,
  nodeType: AIWorkflowEffectiveReusePolicy['nodeType'],
  config: Readonly<Record<string, unknown>>,
  platformDefaultPolicy: AIWorkflowReusePolicy | undefined,
  nodeId: string,
): void {
  if (reusePolicy.nodeType !== nodeType) {
    throw new AIDataWorkflowRunGraphError(
      `AI Data Workflow node ${nodeId} reuse policy nodeType must equal ${nodeType}`,
    );
  }
  const explicitValue = config.reuse_policy ?? config.reusePolicy;
  const explicitPolicy = explicitValue === 'semantic-hash' || explicitValue === 'never'
    ? explicitValue
    : undefined;
  const expected = explicitPolicy
    ? { policy: explicitPolicy, source: 'node', nodeType }
    : nodeType === 'manual'
      ? { policy: 'never', source: 'node-type-default', nodeType }
      : platformDefaultPolicy
        ? { policy: platformDefaultPolicy, source: 'platform-default', nodeType }
        : { policy: 'semantic-hash', source: 'node-type-default', nodeType };
  if (reusePolicy.policy !== expected.policy || reusePolicy.source !== expected.source) {
    throw new AIDataWorkflowRunGraphError(
      `AI Data Workflow node ${nodeId} reuse policy must match its declared config and platform authority`,
    );
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
      assertReusePolicyAuthority(reusePolicy, nodeType, config, platformDefaultPolicy, planNode.id);
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

  const graph = {
    runId,
    binding,
    ...(platformDefaultPolicy === undefined ? {} : { platformDefaultPolicy }),
    currentGeneration: 0,
    nodes: recomputeDependents(nodes, declarationOrder),
    declarationOrder,
    patchHistory: [],
    invalidations: [],
  };
  assertRunGraphInputReferences(graph.nodes);
  return graph;
}

function makePatchNode(
  spec: AIDataWorkflowGraphPatchNodeSpec,
  generation: number,
  platformDefaultPolicy?: AIWorkflowReusePolicy,
): AIDataWorkflowRunNode {
  const tag = spec.tag ?? GENERATED_NODE_TAG;
  const config = cloneRecord(spec.config);
  const nodeType = nodeTypeForPatchNode({ ...spec, tag, config });
  const reusePolicy = spec.reusePolicy ?? resolveAIWorkflowReusePolicy({
    nodeType,
    explicitPolicy: configReusePolicy(config),
    platformDefaultPolicy,
  });
  assertReusePolicyAuthority(reusePolicy, nodeType, config, platformDefaultPolicy, spec.id);
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
    reusePolicy,
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
  let invalidations = existingInvalidations.map(cloneInvalidation);
  const emitted = new Set<string>();

  for (const source of sources) {
    for (const nodeId of collectTransitive(nextNodes, source.nodeId, source.includeSource)) {
      const node = nextNodes[nodeId];
      if (!node || node.status === 'Removed') continue;
      if (generation < node.generation) {
        throw new AIDataWorkflowRunGraphError(
          `AI Data Workflow invalidation generation ${generation} precedes node ${nodeId}@${node.generation}`,
        );
      }
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
      invalidations = invalidations.filter((fact) => fact.nodeId !== nodeId);
      invalidations.push(invalidation);
      const {
        result: _staleResult,
        semanticFingerprint: _staleFingerprint,
        ...currentFacts
      } = node;
      nextNodes = {
        ...nextNodes,
        [nodeId]: {
          ...currentFacts,
          status: 'Invalidated',
          generation,
          invalidatedBy: [invalidation],
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
  requireNode(graph.nodes, sourceNodeId);
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new AIDataWorkflowRunGraphError('AI Data Workflow invalidation generation must be a non-negative safe integer');
  }
  if (generation < graph.currentGeneration) {
    throw new AIDataWorkflowRunGraphError(
      `AI Data Workflow invalidation generation ${generation} precedes current generation ${graph.currentGeneration}`,
    );
  }
  const cloned = cloneGraph(graph);
  const { nodes, invalidations } = applyInvalidations(
    cloned.nodes,
    cloned.invalidations,
    [{ nodeId: sourceNodeId, includeSource: options.includeSource ?? true, reason }],
    generation,
    options.atMs,
  );
  if (invalidations.length === cloned.invalidations.length) return cloned;
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
  const patchTargets = new Set<string>();
  for (const operation of patch.operations) {
    const target = operation.op === 'add-node' ? operation.node.id : operation.nodeId;
    if (patchTargets.has(target)) {
      throw new AIDataWorkflowRunGraphError(
        `AI Data Workflow patch ${patch.patchId} targets node ${target} more than once`,
      );
    }
    patchTargets.add(target);
  }

  const generation = patch.generation ?? graph.currentGeneration + 1;
  if (!Number.isSafeInteger(generation) || generation < 1) {
    throw new AIDataWorkflowRunGraphError('AI Data Workflow patch generation must be a positive safe integer');
  }
  if (generation < graph.currentGeneration) {
    throw new AIDataWorkflowRunGraphError(
      `AI Data Workflow patch generation ${generation} precedes current generation ${graph.currentGeneration}`,
    );
  }
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
        graph.platformDefaultPolicy,
      );
      assertKnownDependencies(nodes, node.id, node.dependsOn);
      nodes = { ...nodes, [node.id]: node };
      declarationOrder = [...declarationOrder, node.id];
      continue;
    }

    if (operation.op === 'update-node') {
      const existing = requireNode(nodes, operation.nodeId);
      if (generation < existing.generation) {
        throw new AIDataWorkflowRunGraphError(
          `AI Data Workflow patch generation ${generation} precedes node ${existing.id}@${existing.generation}`,
        );
      }
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
        operation.changes.config || operation.changes.nodeType
          ? resolveAIWorkflowReusePolicy({
            nodeType,
            explicitPolicy: configReusePolicy(config),
            platformDefaultPolicy: graph.platformDefaultPolicy,
          })
          : existing.reusePolicy
      );
      assertReusePolicyAuthority(reusePolicy, nodeType, config, graph.platformDefaultPolicy, existing.id);
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
    if (existing.status === 'Removed') {
      throw new AIDataWorkflowRunGraphError(`AI Data Workflow node ${operation.nodeId} has already been removed`);
    }
    if (generation < existing.generation) {
      throw new AIDataWorkflowRunGraphError(
        `AI Data Workflow patch generation ${generation} precedes node ${existing.id}@${existing.generation}`,
      );
    }
    const {
      result: _staleResult,
      semanticFingerprint: _staleFingerprint,
      invalidatedBy: _activeInvalidation,
      ...currentFacts
    } = existing;
    nodes = {
      ...nodes,
      [existing.id]: {
        ...currentFacts,
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
    graph.invalidations.filter((fact) => nodes[fact.nodeId]?.status !== 'Removed'),
    invalidationSources,
    generation,
    atMs,
  );

  const nextGraph = {
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
  for (const node of Object.values(nextGraph.nodes)) {
    if (node.status !== 'Removed') assertKnownDependencies(nextGraph.nodes, node.id, node.dependsOn);
  }
  assertRunGraphInputReferences(nextGraph.nodes);
  return nextGraph;
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
    .sort(([left], [right]) => compareCodeUnits(left, right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableSemanticValue(item)}`).join(',')}}`;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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
  if (result.nodeId !== nodeId) {
    throw new AIDataWorkflowRunGraphError(`AI Data Workflow result identity ${result.nodeId} does not match node ${nodeId}`);
  }
  if (result.generation !== node.generation) {
    throw new AIDataWorkflowRunGraphError(
      `AI Data Workflow result generation ${result.generation} does not match node ${nodeId}@${node.generation}`,
    );
  }
  if (node.result
    && (node.result.status === 'Succeeded' || node.result.status === 'Failed' || node.result.status === 'Reused')) {
    if (JSON.stringify(node.result) === JSON.stringify(result)) return cloneGraph(graph);
    throw new AIDataWorkflowRunGraphError(
      `AI Data Workflow terminal result ${nodeId}@${node.generation} is immutable`,
    );
  }
  const {
    invalidatedBy: _acceptedInvalidation,
    ...nodeFacts
  } = node;
  const nodes = {
    ...graph.nodes,
    [nodeId]: {
      ...nodeFacts,
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
    invalidations: graph.invalidations.filter((fact) => fact.nodeId !== nodeId),
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
