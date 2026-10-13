import type {
  AIWorkflowFlowRunCheckpoint,
  FlowClosedObject,
  FlowClosedValue,
  FlowDefinitionArtifactIdentity,
  FlowRunCheckpointCommit,
  FlowRunCheckpointKey,
  FlowRunCheckpointRuntime,
  FlowRunCheckpointStore,
  FlowRunProfileState,
} from 'ai-workflow-contract';
import type { WorkCtrlFlowSnapshot, WorkCtrlFlowStore } from 'work-ctrl-flow-contract';
import { normalizeFlowRunCheckpoint } from './run-checkpoint.js';
import {
  FlowRunCheckpointTransitionError,
  FlowRunCheckpointVersionConflictError,
} from './errors.js';
import {
  validateCheckpointAgainstFrozenProfile,
  type FlowRunCheckpointAdmissionRuntime,
} from './checkpoint-profile.js';

export {
  FlowRunCheckpointTransitionError,
  FlowRunCheckpointVersionConflictError,
} from './errors.js';

const compareCodeUnits = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

export interface WorkCtrlFlowCheckpointStoreOptions {
  readonly instanceId: string;
  readonly definition: FlowDefinitionArtifactIdentity;
  readonly config: FlowClosedValue;
  readonly projectOutput?: (snapshot: WorkCtrlFlowSnapshot) => FlowClosedValue;
}

/** Projects engine-owned faults and optional fields; business values remain subject to closed-data validation. */
export function projectWorkCtrlSnapshotToCheckpointData(
  snapshot: WorkCtrlFlowSnapshot,
): WorkCtrlFlowSnapshot {
  const projectState = (state: unknown): unknown => {
    if (!state || typeof state !== 'object') return state;
    const fault: unknown = Object.getOwnPropertyDescriptor(state,'fault')?.value;
    if(!(fault instanceof Error))return state;
    const code: unknown = Object.getOwnPropertyDescriptor(fault, 'code')?.value;
    return { ...state, fault: { name: fault.name, message: fault.message, ...(typeof code === 'string' ? { code } : {}) } };
  };
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      if(Reflect.ownKeys(value).length!==value.length+1)return value;
      const items:unknown[]=[];
      for(let index=0;index<value.length;index++){
        const descriptor=Object.getOwnPropertyDescriptor(value,String(index));
        if(!descriptor||!('value'in descriptor))return value;
        items.push(visit(descriptor.value));
      }
      return items;
    }
    if (value === null || typeof value !== 'object') return value;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;
    const descriptors=Object.getOwnPropertyDescriptors(value);
    if(Reflect.ownKeys(value).some(key=>typeof key!=='string'||!('value'in descriptors[key]!)))return value;
    return Object.fromEntries(Object.entries(descriptors).filter(([,descriptor])=>descriptor.value!==undefined).map(([key,descriptor])=>[key,visit(descriptor.value)]));
  };
  return visit({ ...snapshot, vars: { ...snapshot.vars, __flow_execution__: projectState(snapshot.vars.__flow_execution__) }, ...(snapshot.orchestration ? { orchestration: { ...snapshot.orchestration,
    lanes: Object.fromEntries(Object.entries(snapshot.orchestration.lanes).map(([key, lane]) => [key, { ...lane, ...(lane.flowState === undefined ? {} : { flowState: projectState(lane.flowState) }) }])),
  } } : {}) }) as WorkCtrlFlowSnapshot;
}

function workCtrlControllerSidecars(snapshot: WorkCtrlFlowSnapshot): FlowClosedObject {
  return {
    status: snapshot.status,
    lastTickNo: snapshot.lastTickNo,
    branchDecisions: snapshot.branchDecisions,
    orchestration: snapshot.orchestration,
    openWaitHandles: snapshot.openWaitHandles,
    closedWaitHandles: snapshot.closedWaitHandles,
    appliedResumeSignals: snapshot.appliedResumeSignals,
  } as unknown as FlowClosedObject;
}

function workCtrlNodeSidecars(snapshot: WorkCtrlFlowSnapshot): FlowClosedObject {
  return {
    nodeResults: snapshot.nodeResults,
    waitResults: snapshot.waitResults,
  } as unknown as FlowClosedObject;
}

/** Canonical WorkCtrl adapter; the detached snapshot is only an engine working copy. */
export function createWorkCtrlFlowCheckpointStore(
  runtime: FlowRunCheckpointRuntime,
  options: WorkCtrlFlowCheckpointStoreOptions,
): WorkCtrlFlowStore {
  return {
    async load(treeId) {
      const checkpoint = await loadFlowRunCheckpoint(runtime, {
        instanceId: options.instanceId,
        runId: treeId,
      });
      if (checkpoint === undefined) return undefined;
      if (checkpoint.profile.kind !== 'WorkCtrlFlow') {
        throw new FlowRunCheckpointTransitionError(`Flow run ${treeId} is not a WorkCtrlFlow checkpoint.`);
      }
      return structuredClone(checkpoint.profile.snapshot) as unknown as WorkCtrlFlowSnapshot;
    },
    async save(snapshot) {
      const durableSnapshot = projectWorkCtrlSnapshotToCheckpointData(snapshot);
      const key = { instanceId: options.instanceId, runId: snapshot.treeId };
      const current = await loadFlowRunCheckpoint(runtime, key);
      if (current !== undefined && current.profile.kind !== 'WorkCtrlFlow') {
        throw new FlowRunCheckpointTransitionError(`Flow run ${snapshot.treeId} is not a WorkCtrlFlow checkpoint.`);
      }
      const checkpoint: AIWorkflowFlowRunCheckpoint = {
        schemaVersion: 'depa.flow-run-checkpoint/v1',
        instanceId: options.instanceId,
        runId: snapshot.treeId,
        definition: options.definition,
        version: current === undefined ? 0 : current.version + 1,
        input: current?.input ?? snapshot.input as FlowClosedValue,
        config: current?.config ?? options.config,
        state: durableSnapshot.vars as FlowClosedValue,
        output: options.projectOutput?.(snapshot) ?? current?.output ?? null,
        controllerSidecars: workCtrlControllerSidecars(durableSnapshot),
        nodeSidecars: workCtrlNodeSidecars(durableSnapshot),
        profile: {
          kind: 'WorkCtrlFlow',
          snapshot: durableSnapshot as unknown as FlowClosedObject,
        },
      };
      await commitFlowRunCheckpoint(runtime, {
        expectedVersion: current?.version ?? null,
        checkpoint,
      });
    },
    async remove(treeId) {
      throw new FlowRunCheckpointTransitionError(
        `Canonical FlowRunCheckpoint removal is not supported for ${treeId}.`,
      );
    },
  };
}

function checkpointKey(key: FlowRunCheckpointKey): string {
  return JSON.stringify([key.instanceId, key.runId]);
}

function sameClosedValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function checkpointTerminalStatus(checkpoint: AIWorkflowFlowRunCheckpoint): string | undefined {
  if (checkpoint.profile.kind === 'WorkCtrlFlow' || checkpoint.profile.kind === 'AICtrlWorkflow') {
    const status = (checkpoint.profile.snapshot as { readonly status?: unknown }).status;
    return status === 'Completed' || status === 'Failed' ? status : undefined;
  }
  const status = checkpoint.controllerSidecars.status;
  return status === 'Succeeded' || status === 'Failed' || status === 'Cancelled' ? status : undefined;
}

function isTerminalAIDataNodeResult(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const status = (value as { readonly status?: unknown }).status;
  return status === 'Succeeded' || status === 'Failed' || status === 'Reused';
}

function assertAppendPrefix(name: string, before: readonly unknown[], after: readonly unknown[]): void {
  if (after.length < before.length
    || before.some((item, index) => !sameClosedValue(item, after[index]))) {
    throw new FlowRunCheckpointTransitionError(`AI Data ${name} must preserve its accepted append-only prefix.`);
  }
}

function validateAIDataInitialCheckpoint(checkpoint: AIWorkflowFlowRunCheckpoint): void {
  if (checkpoint.profile.kind !== 'AIDataWorkflow') return;
  const graph = checkpoint.profile.runGraph as unknown as {
    readonly currentGeneration: number;
    readonly declarationOrder: readonly string[];
    readonly patchHistory: readonly unknown[];
    readonly invalidations: readonly unknown[];
    readonly binding: {
      readonly definition: {
        readonly declarationOrder: readonly string[];
        readonly nodeById: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
      };
    };
    readonly platformDefaultPolicy?: 'semantic-hash' | 'never';
    readonly nodes: Readonly<Record<string, {
      readonly generation: number;
      readonly status: string;
      readonly nodeType: string;
      readonly config: Readonly<Record<string, unknown>>;
      readonly reusePolicy: unknown;
      readonly result?: unknown;
      readonly semanticFingerprint?: unknown;
      readonly invalidatedBy?: unknown;
    }>>;
  };
  const definitionOrder = graph.binding.definition.declarationOrder;
  if (graph.currentGeneration !== 0
    || graph.patchHistory.length !== 0
    || graph.invalidations.length !== 0
    || !sameClosedValue(graph.declarationOrder, definitionOrder)
    || Object.keys(graph.nodes).length !== definitionOrder.length) {
    throw new FlowRunCheckpointTransitionError(
      'AI Data checkpoint version zero must be the complete generation-zero binding projection.',
    );
  }
  for (const nodeId of definitionOrder) {
    const node = graph.nodes[nodeId];
    const definitionNode = graph.binding.definition.nodeById[nodeId];
    if (!node || !definitionNode || node.generation !== 0 || node.status !== 'Pending'
      || node.result !== undefined || node.semanticFingerprint !== undefined || node.invalidatedBy !== undefined) {
      throw new FlowRunCheckpointTransitionError(
        `AI Data checkpoint version zero node ${nodeId} must be a Pending generation-zero binding projection.`,
      );
    }
    const config = node.config;
    const expectedNodeType = config.node_type === 'manual' || config.nodeType === 'manual'
      || definitionNode.type === 'manual'
      ? 'manual'
      : definitionNode.tag === 'SinkNode'
        ? 'effect'
        : definitionNode.tag === 'SubFlowNode'
          ? 'subflow'
          : 'data';
    const explicitReuse = config.reuse_policy ?? config.reusePolicy;
    const expectedReusePolicy = explicitReuse === 'semantic-hash' || explicitReuse === 'never'
      ? { nodeType: expectedNodeType, policy: explicitReuse, source: 'node' }
      : expectedNodeType !== 'manual' && graph.platformDefaultPolicy !== undefined
        ? { nodeType: expectedNodeType, policy: graph.platformDefaultPolicy, source: 'platform-default' }
      : {
          nodeType: expectedNodeType,
          policy: expectedNodeType === 'manual' ? 'never' : 'semantic-hash',
          source: 'node-type-default',
        };
    if (node.nodeType !== expectedNodeType || !sameClosedValue(node.reusePolicy, expectedReusePolicy)) {
      throw new FlowRunCheckpointTransitionError(
        `AI Data checkpoint version zero node ${nodeId} has a non-canonical node type or reuse policy.`,
      );
    }
  }
}

function validateAIDataProfileTransition(
  current: AIWorkflowFlowRunCheckpoint & { readonly profile: { readonly kind: 'AIDataWorkflow'; readonly runGraph: FlowClosedObject } },
  next: AIWorkflowFlowRunCheckpoint & { readonly profile: { readonly kind: 'AIDataWorkflow'; readonly runGraph: FlowClosedObject } },
): void {
  const before = current.profile.runGraph as unknown as {
    readonly binding: unknown;
    readonly platformDefaultPolicy?: 'semantic-hash' | 'never';
    readonly currentGeneration: number;
    readonly declarationOrder: readonly string[];
    readonly patchHistory: readonly {
      readonly generation: number;
      readonly operations: readonly ({
        readonly op: string;
        readonly nodeId?: string;
        readonly node?: Readonly<Record<string, unknown>> & { readonly id: string };
        readonly changes?: Readonly<Record<string, unknown>>;
      })[];
    }[];
    readonly invalidations: readonly { readonly generation: number; readonly nodeId: string }[];
    readonly nodes: Readonly<Record<string, {
      readonly id: string;
      readonly tag: string;
      readonly nodeType: string;
      readonly generation: number;
      readonly status: string;
      readonly declarationIndex: number;
      readonly inputs: unknown;
      readonly outputs: unknown;
      readonly config: Readonly<Record<string, unknown>>;
      readonly dependsOn: unknown;
      readonly dependents: unknown;
      readonly reusePolicy: unknown;
      readonly result?: unknown;
      readonly semanticFingerprint?: unknown;
    }>>;
  };
  const after = next.profile.runGraph as unknown as typeof before;
  if (!sameClosedValue(before.binding, after.binding)) {
    throw new FlowRunCheckpointTransitionError('AI Data binding is immutable after checkpoint version zero.');
  }
  if (before.platformDefaultPolicy !== after.platformDefaultPolicy) {
    throw new FlowRunCheckpointTransitionError('AI Data platform default reuse policy is immutable after checkpoint version zero.');
  }
  if (after.currentGeneration < before.currentGeneration) {
    throw new FlowRunCheckpointTransitionError('AI Data currentGeneration cannot decrease.');
  }
  assertAppendPrefix('patchHistory', before.patchHistory, after.patchHistory);
  for (const [nodeId, node] of Object.entries(before.nodes)) {
    const candidate = after.nodes[nodeId];
    if (!candidate) {
      throw new FlowRunCheckpointTransitionError(`AI Data accepted node ${nodeId} cannot disappear.`);
    }
    if (candidate.generation < node.generation) {
      throw new FlowRunCheckpointTransitionError(
        `AI Data node ${nodeId} generation cannot decrease from ${node.generation} to ${candidate.generation}.`,
      );
    }
    const waitContext=node.result&&typeof node.result==='object'?Object.getOwnPropertyDescriptor(node.result,'waitContext')?.value:undefined;
    const nextContext=candidate.result&&typeof candidate.result==='object'?Object.getOwnPropertyDescriptor(candidate.result,'waitContext')?.value:undefined;
    if(node.generation===candidate.generation&&waitContext!==undefined&&!sameClosedValue(waitContext,nextContext))throw new FlowRunCheckpointTransitionError(`AI Data native wait context ${nodeId}@${node.generation} is immutable.`);
  }
  const appendedPatches = after.patchHistory.slice(before.patchHistory.length);
  const appendedInvalidations = after.invalidations.filter((fact) =>
    !before.invalidations.some((accepted) => sameClosedValue(accepted, fact))
  );
  if (after.currentGeneration > before.currentGeneration
    && appendedPatches.length === 0
    && appendedInvalidations.length === 0) {
    throw new FlowRunCheckpointTransitionError(
      'AI Data generation advancement requires an accepted patch or invalidation fact.',
    );
  }
  for (const accepted of before.invalidations) {
    if (after.invalidations.some((fact) => sameClosedValue(fact, accepted))) continue;
    const replacement = after.invalidations.find((fact) => fact.nodeId === accepted.nodeId);
    const target = after.nodes[accepted.nodeId];
    if (!replacement && target?.status === 'Invalidated') {
      throw new FlowRunCheckpointTransitionError(
        `AI Data active invalidation ${accepted.nodeId} cannot disappear while its target remains Invalidated.`,
      );
    }
  }
  const addedNodeIds: string[] = [];
  const explainedFields = new Map<string, Set<string>>();
  const structuralFields = [
    'tag', 'nodeType', 'declarationIndex', 'inputs', 'outputs', 'config', 'dependsOn', 'reusePolicy',
  ] as const;
  const explain = (nodeId: string, fields: readonly string[]) => {
    const accepted = explainedFields.get(nodeId) ?? new Set<string>();
    for (const field of fields) accepted.add(field);
    explainedFields.set(nodeId, accepted);
  };
  const derivedNodeType = (node: Readonly<Record<string, unknown>>): string => {
    if (typeof node.nodeType === 'string') return node.nodeType;
    const config = typeof node.config === 'object' && node.config !== null
      ? node.config as Readonly<Record<string, unknown>>
      : {};
    if (config.node_type === 'manual' || config.nodeType === 'manual') return 'manual';
    if (node.tag === 'SinkNode') return 'effect';
    if (node.tag === 'SubFlowNode') return 'subflow';
    return 'data';
  };
  const derivedReusePolicy = (
    nodeType: string,
    config: Readonly<Record<string, unknown>>,
  ): Readonly<Record<string, unknown>> => {
    const explicit = config.reuse_policy ?? config.reusePolicy;
    if (explicit === 'semantic-hash' || explicit === 'never') {
      return { nodeType, policy: explicit, source: 'node' };
    }
    if (nodeType !== 'manual' && after.platformDefaultPolicy !== undefined) {
      return { nodeType, policy: after.platformDefaultPolicy, source: 'platform-default' };
    }
    return {
      nodeType,
      policy: nodeType === 'manual' ? 'never' : 'semantic-hash',
      source: 'node-type-default',
    };
  };
  for (const patch of appendedPatches) {
    if (patch.generation !== after.currentGeneration) {
      throw new FlowRunCheckpointTransitionError(
        `AI Data appended patch generation ${patch.generation} must equal current generation ${after.currentGeneration}.`,
      );
    }
    for (const operation of patch.operations) {
      const nodeId = operation.op === 'add-node' ? operation.node?.id : operation.nodeId;
      if (!nodeId || after.nodes[nodeId]?.generation !== patch.generation) {
        throw new FlowRunCheckpointTransitionError(
          `AI Data appended patch target ${String(nodeId)} must project generation ${patch.generation}.`,
        );
      }
      const candidate = after.nodes[nodeId];
      if (operation.op === 'add-node') {
        if (!operation.node || before.nodes[nodeId]) {
          throw new FlowRunCheckpointTransitionError(`AI Data add-node target ${nodeId} must be new.`);
        }
        const declarationIndex = before.declarationOrder.length + addedNodeIds.length;
        const expectedNode = {
          tag: operation.node.tag ?? 'TransformNode',
          nodeType: derivedNodeType(operation.node),
          declarationIndex: operation.node.declarationIndex ?? declarationIndex,
          inputs: operation.node.inputs ?? {},
          outputs: operation.node.outputs ?? [],
          config: operation.node.config ?? {},
          dependsOn: operation.node.dependsOn ?? [],
        };
        const expectedReusePolicy = operation.node.reusePolicy
          ?? derivedReusePolicy(expectedNode.nodeType, expectedNode.config as Readonly<Record<string, unknown>>);
        for (const [field, expected] of Object.entries({ ...expectedNode, reusePolicy: expectedReusePolicy })) {
          if (!sameClosedValue(candidate[field as keyof typeof candidate], expected)) {
            throw new FlowRunCheckpointTransitionError(`AI Data add-node ${nodeId} does not project declared ${field}.`);
          }
        }
        addedNodeIds.push(nodeId);
        continue;
      }
      const accepted = before.nodes[nodeId];
      if (!accepted) {
        throw new FlowRunCheckpointTransitionError(`AI Data ${operation.op} target ${nodeId} must already be accepted.`);
      }
      if (operation.op === 'remove-node') {
        if (accepted.status === 'Removed') {
          throw new FlowRunCheckpointTransitionError(`AI Data Removed tombstone ${nodeId} cannot be removed again.`);
        }
        if (candidate.status !== 'Removed'
          || candidate.result !== undefined
          || candidate.semanticFingerprint !== undefined) {
          throw new FlowRunCheckpointTransitionError(`AI Data remove-node ${nodeId} must retain only a Removed tombstone without result facts.`);
        }
        continue;
      }
      if (operation.op !== 'update-node' || !operation.changes) {
        throw new FlowRunCheckpointTransitionError(`AI Data patch operation ${operation.op} is unsupported.`);
      }
      for (const [field, expected] of Object.entries(operation.changes)) {
        const actual = (candidate as Readonly<Record<string, unknown>>)[field];
        if (field === 'subflow' && expected === null && actual === undefined) continue;
        if (!sameClosedValue(actual, expected)) {
          throw new FlowRunCheckpointTransitionError(`AI Data update-node ${nodeId} does not project declared ${field}.`);
        }
      }
      const changedFields = Object.keys(operation.changes);
      if ((changedFields.includes('config') || changedFields.includes('nodeType'))
        && !changedFields.includes('reusePolicy')) {
        const expectedReusePolicy = derivedReusePolicy(candidate.nodeType, candidate.config);
        if (!sameClosedValue(candidate.reusePolicy, expectedReusePolicy)) {
          throw new FlowRunCheckpointTransitionError(`AI Data update-node ${nodeId} does not project its config-derived reuse policy.`);
        }
        changedFields.push('reusePolicy');
      }
      explain(nodeId, changedFields);
    }
  }
  const expectedDeclarationOrder = [...before.declarationOrder, ...addedNodeIds];
  if (!sameClosedValue(after.declarationOrder, expectedDeclarationOrder)) {
    throw new FlowRunCheckpointTransitionError('AI Data declarationOrder may append only declared add-node targets.');
  }
  for (const [nodeId, accepted] of Object.entries(before.nodes)) {
    const candidate = after.nodes[nodeId];
    const allowed = explainedFields.get(nodeId) ?? new Set<string>();
    for (const field of structuralFields) {
      if (!sameClosedValue(accepted[field], candidate[field]) && !allowed.has(field)) {
        throw new FlowRunCheckpointTransitionError(
          `AI Data node ${nodeId} cannot change structural field ${field} without a matching update-node operation.`,
        );
      }
    }
  }
  for (const nodeId of Object.keys(after.nodes)) {
    if (!before.nodes[nodeId] && !addedNodeIds.includes(nodeId)) {
      throw new FlowRunCheckpointTransitionError(`AI Data node ${nodeId} requires a matching add-node operation.`);
    }
  }
  for (const invalidation of appendedInvalidations) {
    if (invalidation.generation !== after.currentGeneration
      || after.nodes[invalidation.nodeId]?.generation !== invalidation.generation
      || after.nodes[invalidation.nodeId]?.status !== 'Invalidated'
      || after.nodes[invalidation.nodeId]?.result !== undefined
      || after.nodes[invalidation.nodeId]?.semanticFingerprint !== undefined) {
      throw new FlowRunCheckpointTransitionError(
        `AI Data appended invalidation target ${invalidation.nodeId} must project Invalidated at current generation ${after.currentGeneration} without a result or fingerprint.`,
      );
    }
  }
  for (const [nodeId, node] of Object.entries(before.nodes)) {
    if (!node.result || !isTerminalAIDataNodeResult(node.result)) continue;
    const candidate = after.nodes[nodeId];
    if (!candidate || (candidate.generation === node.generation
      && (!sameClosedValue(candidate.result, node.result)
        || !sameClosedValue(candidate.semanticFingerprint, node.semanticFingerprint)))) {
      throw new FlowRunCheckpointTransitionError(
        `AI Data terminal result ${nodeId}@${node.generation} is immutable.`,
      );
    }
  }
}

function validateAgentStateTransition(
  current: AIWorkflowFlowRunCheckpoint,
  next: AIWorkflowFlowRunCheckpoint,
): void {
  if ((current.profile.kind !== 'AICtrlWorkflow' && current.profile.kind !== 'AIDataWorkflow')
    || (next.profile.kind !== 'AICtrlWorkflow' && next.profile.kind !== 'AIDataWorkflow')) return;
  const before = current.profile.ai;
  const after = next.profile.ai;
  validateWorkflowDelegationTransition(before.delegationsByKey ?? {}, after.delegationsByKey ?? {});
  for (const [instanceId, instance] of Object.entries(before.instancesById)) {
    if (!sameClosedValue(instance, after.instancesById[instanceId])) {
      throw new FlowRunCheckpointTransitionError(`Accepted Agent instance ${instanceId} is immutable and cannot disappear.`);
    }
  }
  for (const [name, instanceId] of Object.entries(before.instanceIdByName)) {
    if (after.instanceIdByName[name] !== instanceId) {
      throw new FlowRunCheckpointTransitionError(`Accepted Agent instance name ${name} is immutable and cannot be rebound.`);
    }
  }
  for (const [invocationKey, receipt] of Object.entries(before.invocationsByKey)) {
    const candidate = after.invocationsByKey[invocationKey];
    if (!candidate) throw new FlowRunCheckpointTransitionError(`Accepted Agent invocation ${invocationKey} cannot disappear.`);
    if (receipt.status === 'completed') {
      if (!sameClosedValue(receipt, candidate)) throw new FlowRunCheckpointTransitionError(`Completed Agent invocation ${invocationKey} is immutable.`);
      continue;
    }
    if (candidate.status === 'pending') {
      if (!sameClosedValue(receipt, candidate)) throw new FlowRunCheckpointTransitionError(`Pending Agent invocation ${invocationKey} cannot rewrite its reservation.`);
      continue;
    }
    const completionBase = {
      ...candidate,
      status: 'pending',
      instanceId: receipt.instanceId,
      output: undefined,
      hostReceipt: undefined,
    } as Record<string, unknown>;
    delete completionBase.output;
    delete completionBase.hostReceipt;
    if (receipt.instanceId === undefined) delete completionBase.instanceId;
    if (!sameClosedValue(receipt, completionBase)) {
      throw new FlowRunCheckpointTransitionError(`Agent invocation ${invocationKey} completion rewrites its reservation.`);
    }
  }
  for (const [invocationKey, receipt] of Object.entries(after.invocationsByKey)) {
    if (!before.invocationsByKey[invocationKey] && receipt.status !== 'pending') {
      throw new FlowRunCheckpointTransitionError(`New Agent invocation ${invocationKey} must first be durably pending.`);
    }
  }
}

/** Shared logical transition gate used by every canonical checkpoint owner. */
export function validateFlowRunCheckpointTransition(
  current: AIWorkflowFlowRunCheckpoint | undefined,
  next: AIWorkflowFlowRunCheckpoint,
): void {
  const requiredVersion = current === undefined ? 0 : current.version + 1;
  if (next.version !== requiredVersion) {
    throw new FlowRunCheckpointTransitionError(
      `Checkpoint version must be ${requiredVersion}, got ${next.version}`,
    );
  }
  if (!current) {
    validateAIDataInitialCheckpoint(next);
    return;
  }
  const immutableFacts: readonly [string, unknown, unknown][] = [
    ['schemaVersion', current.schemaVersion, next.schemaVersion],
    ['instanceId', current.instanceId, next.instanceId],
    ['runId', current.runId, next.runId],
    ['definition', current.definition, next.definition],
    ['profile.kind', current.profile.kind, next.profile.kind],
    ['input', current.input, next.input],
    ['config', current.config, next.config],
  ];
  for (const [name, before, after] of immutableFacts) {
    if (!sameClosedValue(before, after)) {
      throw new FlowRunCheckpointTransitionError(`A run checkpoint cannot rewrite immutable ${name}.`);
    }
  }
  const terminal = checkpointTerminalStatus(current);
  if (terminal !== undefined) {
    throw new FlowRunCheckpointTransitionError(
      `Terminal checkpoint status ${terminal} does not accept another transition.`,
    );
  }
  if (current.profile.kind === 'AIDataWorkflow' && next.profile.kind === 'AIDataWorkflow') {
    validateAIDataProfileTransition(
      current as AIWorkflowFlowRunCheckpoint & { readonly profile: { readonly kind: 'AIDataWorkflow'; readonly runGraph: FlowClosedObject } },
      next as AIWorkflowFlowRunCheckpoint & { readonly profile: { readonly kind: 'AIDataWorkflow'; readonly runGraph: FlowClosedObject } },
    );
  }
  validateStepExtensionTransition(current, next);
  validateFrozenCtrlExpansion(current, next);
  validateAgentStateTransition(current, next);
}

function validateFrozenCtrlExpansion(current: AIWorkflowFlowRunCheckpoint, next: AIWorkflowFlowRunCheckpoint): void {
  if (current.profile.kind === 'AIDataWorkflow' || next.profile.kind === 'AIDataWorkflow') return;
  function object(value: FlowClosedValue | undefined): FlowClosedObject {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FlowRunCheckpointTransitionError('Ctrl orchestration facts are missing.');
    return value as FlowClosedObject;
  }
  const before = object(current.profile.snapshot.orchestration);
  const after = object(next.profile.snapshot.orchestration);
  const composites = object(before.composites);
  const nextComposites = object(after.composites);
  const lanes = object(before.lanes), nextLanes = object(after.lanes);
  for (const [key, value] of Object.entries(composites)) {
    const fact = object(value);
    if (!fact.expansion) continue;
    const candidate = object(nextComposites[key]);
    if (!sameClosedValue(fact.expansion, candidate.expansion)) throw new FlowRunCheckpointTransitionError(`ForEach ${key} cannot rewrite frozen expansion.`);
    for (const [laneKey, value] of Object.entries(lanes)) {
      const lane = object(value);
      if (lane.invocationKey !== key) continue;
      const candidateLane = object(nextLanes[laneKey]);
      for (const field of ['invocationKey', 'laneId', 'bodyId', 'item']) {
        if (!sameClosedValue(lane[field], candidateLane[field])) throw new FlowRunCheckpointTransitionError(`ForEach ${key} cannot rewrite frozen lane ${laneKey}.${field}.`);
      }
      if (lane.started === true && candidateLane.started !== true) throw new FlowRunCheckpointTransitionError(`ForEach ${key} cannot release an unsettled lane slot by rewriting its claim.`);
    }
  }
}

function validateStepExtensionTransition(
  current: AIWorkflowFlowRunCheckpoint,
  next: AIWorkflowFlowRunCheckpoint,
): void {
  const before = current.stepExtensions;
  const after = next.stepExtensions;
  if (before === undefined || after === undefined) {
    if (before !== after) {
      throw new FlowRunCheckpointTransitionError('Run step extension membership is immutable after checkpoint version zero.');
    }
    return;
  }
  const beforeSteps = Object.keys(before.byStepId).sort(compareCodeUnits);
  const afterSteps = Object.keys(after.byStepId).sort(compareCodeUnits);
  if (!sameClosedValue(beforeSteps, afterSteps)) {
    throw new FlowRunCheckpointTransitionError('Run step extension step membership is immutable.');
  }
  let changed = 0;
  for (const stepId of beforeSteps) {
    const beforeKinds = Object.keys(before.byStepId[stepId]).sort(compareCodeUnits);
    const afterKinds = Object.keys(after.byStepId[stepId]).sort(compareCodeUnits);
    if (!sameClosedValue(beforeKinds, afterKinds)) {
      throw new FlowRunCheckpointTransitionError(`Run step extension kind membership is immutable for ${stepId}.`);
    }
    for (const kind of beforeKinds) {
      const prior = before.byStepId[stepId][kind];
      const candidate = after.byStepId[stepId][kind];
      if (prior.schemaRef !== candidate.schemaRef) {
        throw new FlowRunCheckpointTransitionError(`Run step extension schema is immutable for ${stepId}/${kind}.`);
      }
      if (sameClosedValue(prior, candidate)) continue;
      changed += 1;
      if (candidate.revision !== prior.revision + 1) {
        throw new FlowRunCheckpointTransitionError(`Run step extension revision must advance exactly once for ${stepId}/${kind}.`);
      }
      if (sameClosedValue(prior.value, candidate.value)) {
        throw new FlowRunCheckpointTransitionError(`Run step extension ${stepId}/${kind} cannot advance without a value change.`);
      }
    }
  }
  if (changed > 1) {
    throw new FlowRunCheckpointTransitionError('One checkpoint transition may mutate at most one run step extension fact.');
  }
}

/** In-memory semantic owner used to validate the port before physical CAS is introduced. */
export class InMemoryFlowRunCheckpointStore implements FlowRunCheckpointStore<FlowRunProfileState> {
  readonly #checkpoints = new Map<string, AIWorkflowFlowRunCheckpoint>();
  readonly #admission: FlowRunCheckpointAdmissionRuntime;

  constructor(options: Partial<FlowRunCheckpointAdmissionRuntime> = {}) {
    this.#admission = Object.freeze({
      ...(options.profileAuthority === undefined ? {} : { profileAuthority: options.profileAuthority }),
      extensionCodecs: options.extensionCodecs ?? Object.freeze({ resolve: () => undefined }),
    });
  }

  async load(key: FlowRunCheckpointKey): Promise<AIWorkflowFlowRunCheckpoint | undefined> {
    const checkpoint = this.#checkpoints.get(checkpointKey(key));
    if (checkpoint) validateCheckpointAgainstFrozenProfile(checkpoint, this.#admission);
    return checkpoint;
  }

  async commit(input: FlowRunCheckpointCommit<FlowRunProfileState>): Promise<AIWorkflowFlowRunCheckpoint> {
    const checkpoint = normalizeFlowRunCheckpoint(input.checkpoint);
    const key = checkpointKey(checkpoint);
    const current = this.#checkpoints.get(key);
    const actualVersion = current?.version ?? null;
    if (input.expectedVersion !== actualVersion) {
      throw new FlowRunCheckpointVersionConflictError(input.expectedVersion, actualVersion);
    }
    validateFlowRunCheckpointTransition(current, checkpoint);
    validateCheckpointAgainstFrozenProfile(checkpoint, this.#admission);
    this.#checkpoints.set(key, checkpoint);
    return checkpoint;
  }
}

export async function loadFlowRunCheckpoint(
  runtime: FlowRunCheckpointRuntime,
  input: FlowRunCheckpointKey,
): Promise<AIWorkflowFlowRunCheckpoint | undefined> {
  return runtime.checkpointStore.load(input) as Promise<AIWorkflowFlowRunCheckpoint | undefined>;
}

export async function commitFlowRunCheckpoint(
  runtime: FlowRunCheckpointRuntime,
  input: FlowRunCheckpointCommit<FlowRunProfileState>,
): Promise<AIWorkflowFlowRunCheckpoint> {
  return runtime.checkpointStore.commit(input) as Promise<AIWorkflowFlowRunCheckpoint>;
}

/** Detached readonly projection; mutating it cannot affect the canonical store. */
export async function projectFlowRunCheckpoint(
  runtime: FlowRunCheckpointRuntime,
  input: FlowRunCheckpointKey,
): Promise<AIWorkflowFlowRunCheckpoint | undefined> {
  const checkpoint = await loadFlowRunCheckpoint(runtime, input);
  return checkpoint === undefined ? undefined : normalizeFlowRunCheckpoint(checkpoint);
}
import { validateWorkflowDelegationTransition } from './delegation.js';
