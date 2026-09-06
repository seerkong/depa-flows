import fs from 'node:fs';
import path from 'node:path';
import type {
  AIDataWorkflowChildInvocationIdentity,
  AIDataWorkflowChildInvocationRuntimePort,
  AIDataWorkflowChildTerminalReceipt,
  AIDataWorkflowRunCheckpoint,
  AIDataWorkflowRunGraph,
} from 'ai-data-workflow-contract';
import type {
  AIDataWorkflowRuntime,
  AIAgentHostEffectPort,
  FrozenAIAgentTaskBinding,
  AIWorkflowProfileDurableState,
  AIWorkflowReusePolicy,
  FlowClosedValue,
} from 'ai-workflow-contract';
import type { EagerDataFlowModuleImporter } from 'eager-data-flow-logic';
import type {
  EagerDataFlowDurableNodeState,
  EagerDataFlowExecutable,
  EagerDataFlowExecutableRegistry,
  EagerDataFlowRecord,
} from 'eager-data-flow-contract';
import {
  createFilesystemCodeResolver,
  materializeEagerDataFlowPlan,
} from 'eager-data-flow-logic';
import {
  assembleDefinitionStepProfileDirectory,
  createFilesystemDefinitionStepProfileRuntime,
} from 'flow-step-space-logic/filesystem';
import {
  createFilesystemFlowRunCheckpointRuntime,
  createFilesystemFlowRunCheckpointStore,
} from 'ai-workflow-logic/checkpoint-filesystem';
import {
  createInitialRunStepExtensions,
  FlowRunCheckpointVersionConflictError,
  normalizeAIWorkflowProfileDurableState,
  normalizeFlowClosedObject,
  normalizeFlowClosedValue,
  type FlowRunProfileAuthorityPort,
  type FlowRunProfileAuthorityRequest,
  type FrozenFlowRunProfileAuthority,
} from 'ai-workflow-logic';
import type { DefinitionStepAssemblyRuntime, DefinitionStepForest } from 'flow-step-space-logic';
import {
  loadMaterializedFlowInstance,
  materializeFlowInstance,
  type FlowInstanceSourceIdentity,
} from 'work-ctrl-flow-logic';
import {
  commitAIDataWorkflowCheckpoint,
  acceptAIDataWorkflowChildTerminalReceipt,
  createAIDataWorkflowChildInvocationIdentity,
  createAIDataWorkflowCheckpoint,
  createAIDataWorkflowRunGraph,
  createAIDataWorkflowAgentNodeRuntimeBinder,
  loadAIDataWorkflowCheckpoint,
  loadAIDataWorkflowSources,
  normalizeAIDataWorkflowChildInvocationObservation,
  normalizeAIDataWorkflowChildTerminalReceipt,
  projectAIDataWorkflowRunGraphPlan,
  recordAIDataWorkflowNodeResult,
  recordAIDataWorkflowChildFreezeReceipt,
  reserveAIDataWorkflowChildInvocation,
} from './index.js';

export interface MaterializedAIDataWorkflowChildFlow {
  readonly definitionRef?: `resource://${string}`;
  readonly contractDigest?: string;
  readonly executable: EagerDataFlowExecutable<any>;
}

export interface MaterializedAIDataWorkflowRuntime {
  readonly supportRoot: string;
  readonly workflow: AIDataWorkflowRuntime;
  readonly importModule: EagerDataFlowModuleImporter;
  readonly extensionCodecs?: DefinitionStepAssemblyRuntime['extensionCodecs'];
  readonly agentEffects?: AIAgentHostEffectPort;
  readonly agentTaskProofs?: Readonly<Record<string, FrozenAIAgentTaskBinding>>;
  /** Exact admitted child definitions keyed by their eager-data-flow id. */
  readonly childFlows?: Readonly<Record<string, MaterializedAIDataWorkflowChildFlow>>;
  readonly childInvocations?: AIDataWorkflowChildInvocationRuntimePort;
  /** Read-only lifecycle observation/fault-injection seam; it owns no parent or child facts. */
  readonly childInvocationObserver?: (event: {
    readonly phase: 'settled-before-parent-accept';
    readonly identity: AIDataWorkflowChildInvocationIdentity;
    readonly receipt: AIDataWorkflowChildTerminalReceipt;
  }) => void | Promise<void>;
  readonly checkpointObserver?: (event: {
    readonly checkpoint: AIDataWorkflowRunCheckpoint;
    readonly nodeId: string;
    readonly phase: 'before' | 'after' | 'failed';
  }) => void | Promise<void>;
}

export interface StartMaterializedAIDataWorkflowInput {
  readonly instanceId: string;
  readonly runId: string;
  readonly bundleDir?: string;
  readonly source?: FlowInstanceSourceIdentity;
  readonly input: Readonly<Record<string, unknown>>;
}

export interface StartMaterializedAIDataWorkflowConfig {
  readonly checkpointConfig: FlowClosedValue;
  readonly platformDefaultPolicy?: AIWorkflowReusePolicy;
  readonly initialState?: FlowClosedValue;
  readonly durableAI: AIWorkflowProfileDurableState;
}

export interface MaterializedAIDataWorkflowResult {
  readonly checkpoint: AIDataWorkflowRunCheckpoint;
  readonly graph: AIDataWorkflowRunGraph;
}

export interface ContinueMaterializedAIDataWorkflowInput {
  readonly instanceId: string;
  readonly runId: string;
}

export type ContinueMaterializedAIDataWorkflowConfig = Readonly<Record<never, never>>;

const emptyExtensionCodecs = Object.freeze({ resolve: () => undefined });

function checkpointStoreForRuntime(runtime: MaterializedAIDataWorkflowRuntime) {
  const extensionCodecs = runtime.extensionCodecs ?? emptyExtensionCodecs;
  return createFilesystemFlowRunCheckpointStore(
    createFilesystemFlowRunCheckpointRuntime({
      storeRoot: runtime.supportRoot,
      extensionCodecs,
      profileAuthority: createMaterializedAIDataWorkflowProfileAuthority(runtime),
    }),
    {},
    {},
  );
}

/** Runtime-first canonical Data execution from a frozen instance. */
export async function startMaterializedAIDataWorkflow(
  runtime: MaterializedAIDataWorkflowRuntime,
  input: StartMaterializedAIDataWorkflowInput,
  config: StartMaterializedAIDataWorkflowConfig,
): Promise<MaterializedAIDataWorkflowResult> {
  requireAgentTaskBindings(runtime);
  const instance = ensureAIDataInstance(runtime, input);
  const binding = loadAIDataBinding(instance.definitionDir, runtime.extensionCodecs ?? emptyExtensionCodecs);
  const checkpointStore = checkpointStoreForRuntime(runtime);
  const checkpointRuntime = { checkpointStore };
  const existing = await loadAIDataWorkflowCheckpoint(checkpointRuntime, input);
  if (existing) {
    assertStartMatchesCheckpoint(existing, input, config);
    return executeAIDataCheckpoint(runtime, binding, existing);
  }
  const graph = createAIDataWorkflowRunGraph({
    binding,
    runId: input.runId,
    platformDefaultPolicy: config.platformDefaultPolicy,
  });
  const initialState = { status: 'Pending', generation: graph.currentGeneration } as const;
  if (config.initialState !== undefined
    && JSON.stringify(normalizeFlowClosedValue(config.initialState, 'aiData.start.state')) !== JSON.stringify(initialState)) {
    throw new Error('AI Data Workflow initialState must equal the canonical Pending RunGraph projection.');
  }
  const v0 = await createAIDataWorkflowCheckpoint(checkpointRuntime, {
    instanceId: input.instanceId,
    definition: instance.descriptor.definition,
    graph: durableGraph(graph),
    input: input.input as FlowClosedValue,
    config: config.checkpointConfig,
    state: initialState,
    output: null,
    controllerSidecars: { status: 'Pending' },
    nodeSidecars: nodeStatuses(graph),
    ai: config.durableAI,
    stepExtensions: createInitialRunStepExtensions(profileAuthorityFromBinding(binding)),
  });
  return executeAIDataCheckpoint(runtime, binding, v0);
}

/** Runtime-first continuation from a checkpoint reconstructed in a fresh process. */
export async function continueMaterializedAIDataWorkflow(
  runtime: MaterializedAIDataWorkflowRuntime,
  input: ContinueMaterializedAIDataWorkflowInput,
  _config: ContinueMaterializedAIDataWorkflowConfig,
): Promise<MaterializedAIDataWorkflowResult> {
  requireAgentTaskBindings(runtime);
  const instanceDir = path.join(runtime.supportRoot, 'instances', input.instanceId);
  const codecs = runtime.extensionCodecs ?? emptyExtensionCodecs;
  const instance = loadMaterializedFlowInstance(instanceDir, input.instanceId, (definitionDir) => validateAIDataDefinition(definitionDir, codecs));
  const binding = loadAIDataBinding(instance.definitionDir, codecs);
  const checkpoint = await loadAIDataWorkflowCheckpoint(
    { checkpointStore: checkpointStoreForRuntime(runtime) },
    input,
  );
  if (!checkpoint) throw new Error(`AI Data Workflow run ${input.runId} does not have a canonical checkpoint.`);
  return executeAIDataCheckpoint(runtime, binding, checkpoint);
}

function requireAgentTaskBindings(runtime: MaterializedAIDataWorkflowRuntime): void {
  if (runtime.agentEffects && (!runtime.agentTaskProofs || Object.keys(runtime.agentTaskProofs).length === 0)) {
    throw new Error('AI_AGENT_TASK_PROOF_REQUIRED: materialized AI Data Agent effects require run-freeze task proofs.');
  }
}

async function executeAIDataCheckpoint(
  runtime: MaterializedAIDataWorkflowRuntime,
  binding: ReturnType<typeof loadAIDataBinding>,
  checkpoint: AIDataWorkflowRunCheckpoint,
): Promise<MaterializedAIDataWorkflowResult> {
  let accepted = checkpoint;
  let graph: AIDataWorkflowRunGraph = {
    ...checkpoint.profile.runGraph,
    binding,
  };
  const status = checkpointStatus(checkpoint);
  if (status === 'Succeeded' || status === 'Failed') return { checkpoint, graph };
  if (status !== 'Pending' && status !== 'Running') {
    throw new Error(`AI Data Workflow checkpoint ${checkpoint.runId} has unsupported continuation status ${String(status)}.`);
  }
  if (typeof checkpoint.input !== 'object' || checkpoint.input === null || Array.isArray(checkpoint.input)) {
    throw new Error(`AI Data Workflow checkpoint ${checkpoint.runId} input must be a closed object.`);
  }
  const invocationInput = checkpoint.input as Readonly<Record<string, FlowClosedValue>>;
  const checkpointRuntime = {
    checkpointStore: checkpointStoreForRuntime(runtime),
  };
  let transitionTail = Promise.resolve();
  const transition = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = transitionTail.then(operation);
    transitionTail = result.then(() => undefined, () => undefined);
    return result;
  };
  const commitGraph = (
    updateGraph: (current: AIDataWorkflowRunGraph) => AIDataWorkflowRunGraph,
    nodeId: string,
    phase: 'before' | 'after' | 'failed',
  ): Promise<void> => transition(async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const owner = await loadAIDataWorkflowCheckpoint(checkpointRuntime, {
        instanceId: checkpoint.instanceId,
        runId: checkpoint.runId,
      });
      if (!owner) throw new Error(`AI Data Workflow checkpoint ${checkpoint.runId} disappeared during node transition.`);
      accepted = owner;
      graph = { ...owner.profile.runGraph, binding };
      const nextGraph = updateGraph(graph);
      if (nextGraph === graph) return;
      const nextStatus = graphCheckpointStatus(nextGraph);
      try {
        accepted = await commitAIDataWorkflowCheckpoint(checkpointRuntime, {
          expectedVersion: accepted.version,
          checkpoint: {
            ...accepted,
            version: accepted.version + 1,
            state: { status: nextStatus, generation: nextGraph.currentGeneration },
            output: graphCheckpointOutput(nextGraph, nextStatus),
            controllerSidecars: { status: nextStatus },
            nodeSidecars: nodeStatuses(nextGraph),
            profile: { ...accepted.profile, runGraph: durableGraph(nextGraph) },
          },
        });
      } catch (cause) {
        if (cause instanceof FlowRunCheckpointVersionConflictError) continue;
        throw cause;
      }
      graph = { ...accepted.profile.runGraph, binding };
      if (runtime.checkpointObserver) {
        try {
          await runtime.checkpointObserver({ checkpoint: accepted, nodeId, phase });
        } catch (cause) {
          throw new AIDataCheckpointObserverError(cause);
        }
      }
      return;
    }
    throw new Error(`AI Data Workflow node ${nodeId} checkpoint CAS did not converge.`);
  });
  let output: unknown;
  try {
    const executionPlan = projectAIDataWorkflowRunGraphPlan(graph);
    const executable = await materializeEagerDataFlowPlan(executionPlan, {
      resolveCode: createFilesystemCodeResolver(runtime.importModule),
      subflows: createMaterializedChildRegistry(runtime, () => graph),
    });
    output = await executable.invoke(runtime.workflow, invocationInput, {
      completedNodes: completedEagerNodes(graph),
      invokeSubFlow: createMaterializedChildInvoker(runtime, () => graph, commitGraph),
      ...(runtime.agentEffects ? {
        bindNode: ((binder) => (nodeRuntime: unknown, identity: { readonly nodeId: string }) => binder(
          nodeRuntime as AIDataWorkflowRuntime,
          identity,
        ))(createAIDataWorkflowAgentNodeRuntimeBinder({
          flowInstanceId: checkpoint.instanceId,
          runId: checkpoint.runId,
          checkpointRuntime,
          effects: runtime.agentEffects,
          workflowRef: `resource://${binding.definition.fqn}`,
          taskProofs: runtime.agentTaskProofs ?? {},
          generationForNode: (nodeId) => graph.nodes[nodeId]?.generation ?? 0,
        })),
      } : {}),
      onNodeStart: (nodeId) => {
        return commitGraph((current) => {
          const node = current.nodes[nodeId];
          if (!node) throw new Error(`AI Data Workflow node ${nodeId} does not exist in the durable graph.`);
          if (node.tag === 'SubFlowNode' && node.subflow?.kind === 'autonomous') {
            const identity = node.childInvocation ?? createAIDataWorkflowChildInvocationIdentity({
              graph: current,
              parentInstanceId: checkpoint.instanceId,
              nodeId,
            });
            return reserveAIDataWorkflowChildInvocation({ graph: current, identity });
          }
          return recordAIDataWorkflowNodeResult(current, nodeId, {
            nodeId,
            generation: node.generation,
            status: 'Running',
          });
        }, nodeId, 'before');
      },
      onNodeSuccess: (settlement) => {
        return commitGraph((current) => {
          const node = current.nodes[settlement.nodeId];
          if (!node) throw new Error(`AI Data Workflow node ${settlement.nodeId} does not exist in the durable graph.`);
          if (node.tag === 'SubFlowNode' && node.childTerminalReceipt) return current;
          return recordAIDataWorkflowNodeResult(current, settlement.nodeId, {
            nodeId: settlement.nodeId,
            generation: node.generation,
            status: 'Succeeded',
            ...(settlement.output !== undefined ? { output: settlement.output } : {}),
            ...(settlement.returned !== undefined ? { output: settlement.returned } : {}),
          });
        }, settlement.nodeId, 'after');
      },
      onNodeFailure: ({ nodeId, cause }) => {
        return commitGraph((current) => {
          const node = current.nodes[nodeId];
          if (!node) throw new Error(`AI Data Workflow node ${nodeId} does not exist in the durable graph.`);
          if (cause instanceof AIDataChildInvocationSuspendedError
            || cause instanceof AIDataChildInvocationTerminalFailure
            || findCheckpointObserverError(cause)) return current;
          return recordAIDataWorkflowNodeResult(current, nodeId, {
            nodeId,
            generation: node.generation,
            status: 'Failed',
          });
        }, nodeId, 'failed');
      },
    });
  } catch (error) {
    const observerError = findCheckpointObserverError(error);
    if (observerError) throw observerError.cause;
    throw error;
  }
  if (checkpointStatus(accepted) !== 'Succeeded') {
    throw new Error(`AI Data Workflow ${checkpoint.runId} completed without a terminal RunGraph projection.`);
  }
  if (JSON.stringify(accepted.output) !== JSON.stringify(normalizeFlowClosedValue(output, 'aiData.execution.output'))) {
    throw new Error(`AI Data Workflow ${checkpoint.runId} Return output does not match its durable RunGraph result.`);
  }
  return { checkpoint: accepted, graph };
}

class AIDataChildInvocationSuspendedError extends Error {
  constructor(nodeId: string, status: string) {
    super(`AI Data child invocation ${nodeId} is ${status}; continue the parent checkpoint to resume it.`);
    this.name = 'AIDataChildInvocationSuspendedError';
  }
}

class AIDataChildInvocationTerminalFailure extends Error {
  constructor(nodeId: string, code: string, message: string) {
    super(`AI Data child invocation ${nodeId} failed (${code}): ${message}`);
    this.name = 'AIDataChildInvocationTerminalFailure';
  }
}

function createMaterializedChildRegistry(
  runtime: MaterializedAIDataWorkflowRuntime,
  currentGraph: () => AIDataWorkflowRunGraph,
): EagerDataFlowExecutableRegistry<any> {
  const registry: Record<string, EagerDataFlowExecutable<any>> = {};
  for (const nodeId of currentGraph().declarationOrder) {
    const node = currentGraph().nodes[nodeId];
    if (!node || node.status === 'Removed' || node.tag !== 'SubFlowNode' || !node.subflow) continue;
    const flowId = node.subflow.flowRef.slice('eager-data-flow://'.length);
    const admitted = runtime.childFlows?.[flowId];
    if (!admitted || admitted.executable.plan.fqn !== flowId) {
      throw new Error(`AI Data child flow ${flowId} is not present in the admitted executable registry.`);
    }
    if (node.subflow.kind === 'autonomous' && (admitted.definitionRef !== node.subflow.definitionRef
      || admitted.contractDigest !== node.subflow.contractDigest)) {
      throw new Error(`AI Data child flow ${flowId} does not match its frozen definition and contract.`);
    }
    if (node.subflow.kind === 'autonomous' && !runtime.childInvocations) {
      throw new Error(`AI Data autonomous child flow ${flowId} requires a child invocation runtime port.`);
    }
    registry[flowId] = admitted.executable;
  }
  return Object.freeze(registry);
}

function createMaterializedChildInvoker(
  runtime: MaterializedAIDataWorkflowRuntime,
  currentGraph: () => AIDataWorkflowRunGraph,
  commitGraph: (
    updateGraph: (current: AIDataWorkflowRunGraph) => AIDataWorkflowRunGraph,
    nodeId: string,
    phase: 'before' | 'after' | 'failed',
  ) => Promise<void>,
) {
  return async (
    workflow: AIDataWorkflowRuntime,
    invocation: { readonly nodeId: string; readonly flowRef: string },
    input: Readonly<EagerDataFlowRecord>,
    options: { readonly signal: AbortSignal },
  ): Promise<EagerDataFlowRecord> => {
    const node = currentGraph().nodes[invocation.nodeId];
    if (!node || node.tag !== 'SubFlowNode' || node.subflow?.flowRef !== invocation.flowRef) {
      throw new Error(`AI Data child dispatch ${invocation.nodeId} does not match the current RunGraph.`);
    }
    const flowId = invocation.flowRef.slice('eager-data-flow://'.length);
    const admitted = runtime.childFlows?.[flowId];
    if (!admitted) throw new Error(`AI Data child flow ${flowId} is not admitted.`);
    if (node.subflow.kind === 'declared') {
      return admitted.executable.invoke(workflow, input, { signal: options.signal });
    }
    if (!node.childInvocation || !runtime.childInvocations) {
      throw new Error(`AI Data child node ${invocation.nodeId} was not reserved before dispatch.`);
    }
    const identity = node.childInvocation;
    let freeze = node.childFreezeReceipt;
    if (!freeze) {
      freeze = await runtime.childInvocations.resolveAndFreeze({ identity });
      await commitGraph(
        (graph) => recordAIDataWorkflowChildFreezeReceipt({ graph, nodeId: node.id, receipt: freeze! }),
        node.id,
        'before',
      );
      freeze = currentGraph().nodes[node.id].childFreezeReceipt;
    }
    if (!freeze) throw new Error(`AI Data child node ${node.id} freeze receipt was not committed.`);
    let observation = normalizeAIDataWorkflowChildInvocationObservation(
      await runtime.childInvocations.startOrContinue({
        identity,
        freeze,
        input: normalizeFlowClosedObject(input, `aiData.child.${node.id}.input`),
      }),
      identity,
    );
    if (observation.status === 'Reserved' || observation.status === 'Running') {
      observation = normalizeAIDataWorkflowChildInvocationObservation(
        await runtime.childInvocations.load({ identity, freeze }),
        identity,
      );
    }
    if (observation.status === 'Reserved' || observation.status === 'Running') {
      throw new AIDataChildInvocationSuspendedError(node.id, observation.status);
    }
    const receipt = normalizeAIDataWorkflowChildTerminalReceipt(
      await runtime.childInvocations.settle({ identity, freeze, terminalStatus: observation.status }),
      identity,
    );
    if (runtime.childInvocationObserver) {
      try {
        await runtime.childInvocationObserver({ phase: 'settled-before-parent-accept', identity, receipt });
      } catch (cause) {
        throw new AIDataCheckpointObserverError(cause);
      }
    }
    await commitGraph(
      (graph) => acceptAIDataWorkflowChildTerminalReceipt({ graph, nodeId: node.id, receipt }),
      node.id,
      receipt.status === 'Succeeded' ? 'after' : 'failed',
    );
    if (receipt.status === 'Failed') {
      throw new AIDataChildInvocationTerminalFailure(node.id, receipt.failureCode, receipt.failureMessage);
    }
    return receipt.output as EagerDataFlowRecord;
  };
}

class AIDataCheckpointObserverError extends Error {
  constructor(public override readonly cause: unknown) {
    super('AI Data checkpoint observer interrupted execution.');
    this.name = 'AIDataCheckpointObserverError';
  }
}

function findCheckpointObserverError(value: unknown): AIDataCheckpointObserverError | undefined {
  if (value instanceof AIDataCheckpointObserverError) return value;
  if (typeof value !== 'object' || value === null || !('cause' in value)) return undefined;
  return findCheckpointObserverError(value.cause);
}

function completedEagerNodes(
  graph: AIDataWorkflowRunGraph,
): Readonly<Record<string, EagerDataFlowDurableNodeState>> {
  return Object.fromEntries(graph.declarationOrder.flatMap((nodeId) => {
    const node = graph.nodes[nodeId];
    if (!node || (node.status !== 'Succeeded' && node.status !== 'Reused') || !node.result) return [];
    const state: EagerDataFlowDurableNodeState = {
      nodeId,
      ...(node.tag === 'ReturnNode'
        ? { returned: node.result.output as Readonly<Record<string, unknown>> }
        : node.tag === 'SinkNode'
          ? {}
          : { output: node.result.output as Readonly<Record<string, unknown>> }),
    };
    return [[nodeId, state] as const];
  }));
}

/** Fresh reconstruction reads only the frozen instance and canonical checkpoint. */
export async function loadMaterializedAIDataWorkflowRun(
  runtime: MaterializedAIDataWorkflowRuntime,
  input: Pick<StartMaterializedAIDataWorkflowInput, 'instanceId' | 'runId'>,
): Promise<MaterializedAIDataWorkflowResult | undefined> {
  const instanceDir = path.join(runtime.supportRoot, 'instances', input.instanceId);
  const codecs = runtime.extensionCodecs ?? emptyExtensionCodecs;
  const instance = loadMaterializedFlowInstance(instanceDir, input.instanceId, (definitionDir) => validateAIDataDefinition(definitionDir, codecs));
  const binding = loadAIDataBinding(instance.definitionDir, codecs);
  const checkpoint = await loadAIDataWorkflowCheckpoint(
    { checkpointStore: checkpointStoreForRuntime(runtime) },
    input,
  );
  if (!checkpoint) return undefined;
  return {
    checkpoint,
    graph: {
      ...checkpoint.profile.runGraph,
      binding,
    },
  };
}

function ensureAIDataInstance(
  runtime: MaterializedAIDataWorkflowRuntime,
  input: StartMaterializedAIDataWorkflowInput,
) {
  const instancesDir = path.join(runtime.supportRoot, 'instances');
  const instanceDir = path.join(instancesDir, input.instanceId);
  if (fs.existsSync(instanceDir)) {
    return loadMaterializedFlowInstance(instanceDir, input.instanceId, (definitionDir) => validateAIDataDefinition(
      definitionDir,
      runtime.extensionCodecs ?? emptyExtensionCodecs,
    ));
  }
  if (!input.bundleDir || !input.source) {
    if (input.bundleDir || input.source) throw new Error('bundleDir and source identity must be provided together.');
    throw new Error('bundleDir and source identity are required for first admission.');
  }
  return materializeFlowInstance({
    definitionDir: input.bundleDir,
    instancesDir,
    instanceId: input.instanceId,
    source: input.source,
    validateDefinition: (definitionDir) => validateAIDataDefinition(
      definitionDir,
      runtime.extensionCodecs ?? emptyExtensionCodecs,
    ),
  });
}

function validateAIDataDefinition(
  definitionDir: string,
  extensionCodecs: DefinitionStepAssemblyRuntime['extensionCodecs'],
): void {
  loadAIDataBinding(definitionDir, extensionCodecs);
}

function loadAIDataBinding(
  definitionDir: string,
  extensionCodecs: DefinitionStepAssemblyRuntime['extensionCodecs'],
) {
  const assembled = assembleDefinitionStepProfileDirectory(
    createFilesystemDefinitionStepProfileRuntime({ rootDir: definitionDir, extensionCodecs }),
    {},
    { profileRoot: 'AIDataWorkflow' },
  );
  if (assembled.diagnostics.length > 0) {
    throw new Error(`AIDataWorkflow StepSpace is invalid: ${assembled.diagnostics.map((item) => item.code).join(', ')}`);
  }
  const sources = Object.fromEntries((assembled.sources as readonly ({ readonly ref: string; readonly content: string } | { readonly name: string; readonly content: string })[])
    .map((source) => ['name' in source ? source.name : source.ref, source.content]));
  const loaded = loadAIDataWorkflowSources(sources, { baseUri: definitionDir });
  if (!loaded.binding || loaded.diagnostics.length > 0) {
    throw new Error(`AIDataWorkflow definition is invalid: ${loaded.diagnostics.map((item) => item.code).join(', ')}`);
  }
  return assembled.forest
    ? { ...loaded.binding, definition: { ...loaded.binding.definition, definitionStepForest: assembled.forest } }
    : loaded.binding;
}

function profileAuthorityFromBinding(
  binding: ReturnType<typeof loadAIDataBinding>,
): FrozenFlowRunProfileAuthority {
  const forest = binding.definition.definitionStepForest as DefinitionStepForest | undefined;
  const definitionStepIds = forest?.stepOrder ?? binding.definition.declarationOrder;
  return Object.freeze({
    profileKind: 'AIDataWorkflow' as const,
    definitionStepIds: Object.freeze([...definitionStepIds]),
    binding: durableBinding(binding) as unknown as import('ai-workflow-contract').FlowClosedObject,
    extensionsByStepId: Object.freeze(Object.fromEntries((forest?.stepOrder ?? []).flatMap((stepId) => {
      const extensions = Object.fromEntries(Object.entries(forest!.steps[stepId].extensions).map(([kind, extension]) => [kind, Object.freeze({
        ...(extension.schemaRef === undefined ? {} : { schemaRef: extension.schemaRef }),
        initialValue: extension.value as import('ai-workflow-contract').FlowClosedValue,
      })]));
      return Object.keys(extensions).length === 0 ? [] : [[stepId, Object.freeze(extensions)]];
    }))),
  });
}

export function createMaterializedAIDataWorkflowProfileAuthority(
  runtime: Pick<MaterializedAIDataWorkflowRuntime, 'supportRoot' | 'extensionCodecs'>,
): FlowRunProfileAuthorityPort {
  const extensionCodecs = runtime.extensionCodecs ?? emptyExtensionCodecs;
  return Object.freeze({
    load(request: FlowRunProfileAuthorityRequest) {
      if (request.profileKind !== 'AIDataWorkflow') {
        throw new Error(`AI Data profile authority cannot load ${request.profileKind}.`);
      }
      const instanceDir = path.join(runtime.supportRoot, 'instances', request.instanceId);
      const instance = loadMaterializedFlowInstance(instanceDir, request.instanceId, (definitionDir) => {
        validateAIDataDefinition(definitionDir, extensionCodecs);
      });
      if (canonicalClosed(normalizeFlowClosedValue(instance.descriptor.definition, 'profileAuthority.instanceDefinition'))
        !== canonicalClosed(normalizeFlowClosedValue(request.definition, 'profileAuthority.requestDefinition'))) {
        throw new Error('AI Data profile authority definition identity differs from the checkpoint.');
      }
      return profileAuthorityFromBinding(loadAIDataBinding(instance.definitionDir, extensionCodecs));
    },
  });
}

const compareCodeUnits = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

function canonicalClosed(value: import('ai-workflow-contract').FlowClosedValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalClosed).join(',')}]`;
  const record = value as import('ai-workflow-contract').FlowClosedObject;
  return `{${Object.keys(record).sort(compareCodeUnits).map((key) => (
    `${JSON.stringify(key)}:${canonicalClosed(record[key])}`
  )).join(',')}}`;
}

function durableBinding(binding: ReturnType<typeof loadAIDataBinding>) {
  const {
    baseUri: _baseUri,
    definitionStepForest: _definitionStepForest,
    ...definition
  } = binding.definition;
  return { ...binding, definition };
}

function durableGraph(graph: AIDataWorkflowRunGraph): AIDataWorkflowRunGraph {
  return {
    ...graph,
    binding: durableBinding(graph.binding as ReturnType<typeof loadAIDataBinding>),
  };
}

function nodeStatuses(graph: AIDataWorkflowRunGraph) {
  return Object.fromEntries(
    graph.declarationOrder.map((nodeId) => [nodeId, {
      status: graph.nodes[nodeId].status,
      generation: graph.nodes[nodeId].generation,
    }]),
  );
}

function graphCheckpointStatus(
  graph: AIDataWorkflowRunGraph,
): 'Pending' | 'Running' | 'Succeeded' | 'Failed' {
  const nodes = Object.values(graph.nodes).filter((node) => node.status !== 'Removed');
  if (nodes.some((node) => node.status === 'Failed')) return 'Failed';
  if (nodes.some((node) => node.status === 'Running')) return 'Running';
  if (nodes.length > 0 && nodes.every((node) => node.status === 'Succeeded' || node.status === 'Reused')) {
    return 'Succeeded';
  }
  return 'Pending';
}

function graphCheckpointOutput(
  graph: AIDataWorkflowRunGraph,
  status: ReturnType<typeof graphCheckpointStatus>,
): FlowClosedValue {
  if (status !== 'Succeeded') return null;
  const returnNode = graph.declarationOrder
    .map((nodeId) => graph.nodes[nodeId])
    .find((node) => node?.tag === 'ReturnNode');
  if (!returnNode?.result || returnNode.result.output === undefined) {
    throw new Error(`AI Data Workflow ${graph.runId} terminal RunGraph has no Return result.`);
  }
  return normalizeFlowClosedValue(returnNode.result.output, 'aiData.execution.output');
}

function checkpointStatus(checkpoint: AIDataWorkflowRunCheckpoint): unknown {
  return checkpoint.controllerSidecars.status;
}

function assertStartMatchesCheckpoint(
  checkpoint: AIDataWorkflowRunCheckpoint,
  input: StartMaterializedAIDataWorkflowInput,
  config: StartMaterializedAIDataWorkflowConfig,
): void {
  const normalizedInput = normalizeFlowClosedObject(input.input, 'aiData.start.input');
  const normalizedConfig = normalizeFlowClosedValue(config.checkpointConfig, 'aiData.start.config');
  if (JSON.stringify(normalizedInput) !== JSON.stringify(checkpoint.input)
    || JSON.stringify(normalizedConfig) !== JSON.stringify(checkpoint.config)
    || config.platformDefaultPolicy !== checkpoint.profile.runGraph.platformDefaultPolicy) {
    throw new Error(`AI Data Workflow run ${input.runId} is already bound to different start facts.`);
  }
  if (checkpointStatus(checkpoint) === 'Pending') {
    const normalizedAI = normalizeAIWorkflowProfileDurableState(config.durableAI, 'aiData.start.ai');
    if ((config.initialState !== undefined
      && JSON.stringify(normalizeFlowClosedValue(config.initialState, 'aiData.start.state')) !== JSON.stringify(checkpoint.state))
      || JSON.stringify(normalizedAI) !== JSON.stringify(checkpoint.profile.ai)) {
      throw new Error(`AI Data Workflow run ${input.runId} has different pending initialization facts.`);
    }
  }
}
