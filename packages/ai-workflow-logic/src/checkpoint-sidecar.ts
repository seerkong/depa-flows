import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { AIWorkflowFlowRunCheckpoint, FlowClosedObject, FlowClosedValue } from 'ai-workflow-contract';
import type { DefinitionStepDigest, ImmutableStepRecord, StepMerkleNode, StepMerkleTree } from 'flow-step-space-contract';
import { buildStepMerkleTree, createImmutableStepRecord, diffStepMerkleTrees } from 'flow-step-space-logic';
import { normalizeFlowRunCheckpoint } from './run-checkpoint.js';

export type CheckpointDurabilityRole = 'record' | 'tree' | 'receipt' | 'head';
export type CheckpointDurabilityOperation = 'directory-create' | 'file-fsync' | 'rename' | 'directory-fsync';
export interface CheckpointDurabilityEvent {
  readonly operation: CheckpointDurabilityOperation;
  readonly role: CheckpointDurabilityRole;
  readonly path: string;
  readonly targetPath?: string;
}
export interface CheckpointDurabilityRuntime {
  beforeEvent?(event: CheckpointDurabilityEvent): void;
  onEvent?(event: CheckpointDurabilityEvent): void;
}

export interface FlowRunCheckpointHead {
  readonly schemaVersion: 'depa.flow-run-checkpoint-head/v1';
  readonly instanceId: string;
  readonly runId: string;
  readonly definition: AIWorkflowFlowRunCheckpoint['definition'];
  readonly version: number;
  readonly logicalDigest: DefinitionStepDigest;
  readonly control: FlowClosedObject;
  readonly runStepStateRootDigest: DefinitionStepDigest;
}
export interface FlowRunCheckpointSidecarReceipt {
  readonly schemaVersion: 'depa.flow-run-checkpoint-sidecar-receipt/v1';
  readonly version: number;
  readonly previousRootDigest: DefinitionStepDigest | null;
  readonly rootDigest: DefinitionStepDigest;
  readonly logicalDigest: DefinitionStepDigest;
  readonly controlRecordDigests: readonly DefinitionStepDigest[];
  readonly addedMaterialRecordDigests: readonly DefinitionStepDigest[];
  readonly addedRecordDigests: readonly DefinitionStepDigest[];
  readonly addedTreeNodeDigests: readonly DefinitionStepDigest[];
}
export interface CheckpointSidecarEncodeConfig {
  readonly definitionStepIds?: readonly string[];
  readonly previousMaterialRecordDigests?: readonly DefinitionStepDigest[];
}
type EncodedCheckpoint = {
  readonly head: FlowRunCheckpointHead;
  readonly controlRecords: readonly ImmutableStepRecord[];
  readonly records: readonly ImmutableStepRecord[];
  readonly materialRecords: readonly ImmutableStepRecord[];
  readonly tree: StepMerkleTree;
  readonly receipt: FlowRunCheckpointSidecarReceipt;
};

const NO_FOLLOW = fs.constants.O_NOFOLLOW ?? 0;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record).sort(compare).map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}
const digest = (value: unknown): DefinitionStepDigest => `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
function digestFileName(value: DefinitionStepDigest): string {
  if (!/^sha256:[0-9a-f]{64}$/.test(value)) throw new Error(`Invalid sidecar digest ${value}`);
  return `${value.slice(7)}.json`;
}
function object(value: unknown, label: string): FlowClosedObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a closed object.`);
  return value as FlowClosedObject;
}
const entries = (value: unknown, label: string): readonly [string, FlowClosedValue][] => {
  const record = object(value, label);
  return Object.keys(record).sort(compare).map((key) => [key, record[key]] as const);
};

function envelope(checkpoint: AIWorkflowFlowRunCheckpoint): FlowClosedObject {
  return {
    schemaVersion: checkpoint.schemaVersion,
    input: checkpoint.input,
    config: checkpoint.config,
    state: checkpoint.state,
    output: checkpoint.output,
  };
}

/** Membership = frozen binding plus accepted add/update/remove patch facts. */
function dataMembership(
  runGraph: FlowClosedObject,
  bindingValue: unknown = runGraph.binding,
  frozenDefinitionStepIds?: readonly string[],
): readonly string[] {
  const binding = object(bindingValue, 'data binding');
  const definition = object(binding.definition, 'data definition');
  if (!Array.isArray(definition.declarationOrder)) throw new Error('Data binding declarationOrder is required.');
  if (!frozenDefinitionStepIds || canonicalJson(definition.declarationOrder) !== canonicalJson(frozenDefinitionStepIds)) {
    throw new Error('Data binding membership differs from frozen StepSpace authority.');
  }
  const members = new Set<string>();
  for (const id of definition.declarationOrder) {
    if (typeof id !== 'string' || !id || members.has(id)) throw new Error('Data binding membership is invalid.');
    members.add(id);
  }
  if (!Array.isArray(runGraph.patchHistory)) throw new Error('Data patchHistory is required.');
  for (const patchValue of runGraph.patchHistory) {
    const patch = object(patchValue, 'data patch');
    if (!Array.isArray(patch.operations)) throw new Error('Data patch operations are required.');
    for (const operationValue of patch.operations) {
      const operation = object(operationValue, 'data patch operation');
      if (operation.op === 'add-node') {
        const node = object(operation.node, 'data add-node');
        if (typeof node.id !== 'string' || !node.id || members.has(node.id)) throw new Error('Data add-node membership is invalid.');
        members.add(node.id);
      } else if (operation.op === 'update-node' || operation.op === 'remove-node') {
        if (typeof operation.nodeId !== 'string' || !members.has(operation.nodeId)) throw new Error(`Data ${String(operation.op)} membership is invalid.`);
      } else throw new Error('Data patch operation is invalid.');
    }
  }
  return [...members].sort(compare);
}

const ORCHESTRATION_FIELDS = ['attempts', 'deadlines', 'lanes', 'winners', 'cancellations', 'composites'] as const;
type OrchestrationField = typeof ORCHESTRATION_FIELDS[number];

function runtimeCtrlMembers(orchestrationValue: unknown, definitionStepIds: readonly string[]): readonly string[] {
  const orchestration = object(orchestrationValue, 'ctrl orchestration');
  const members = new Set<string>();
  for (const field of ORCHESTRATION_FIELDS) {
    for (const [identity] of entries(orchestration[field], `ctrl orchestration.${field}`)) {
      if (!definitionOwner(identity, definitionStepIds)) members.add(identity);
    }
  }
  return [...members].sort(compare);
}
const ctrlKey = (memberId: string) => `ctrl/${JSON.stringify(memberId)}`;
const dataKey = (nodeId: string) => `data/${JSON.stringify(nodeId)}`;
const coreKey = (key: string) => `core/${key}`;
const extensionKey = (stepId: string, kind: string) => `extension/${JSON.stringify(stepId)}/${JSON.stringify(kind)}`;

function stepExtensionFacts(checkpoint: AIWorkflowFlowRunCheckpoint, stepId: string): FlowClosedObject {
  return checkpoint.stepExtensions?.byStepId[stepId] as unknown as FlowClosedObject ?? {};
}

function createRunStepLeaf(
  key: string,
  stepId: string | undefined,
  coreValue: FlowClosedValue,
  extensions: FlowClosedObject,
) {
  const coreRecord = createImmutableStepRecord(coreKey(key), coreValue);
  const extensionRecords = entries(extensions, `run step extensions ${stepId ?? key}`).map(([kind, fact]) => ({
    kind,
    record: createImmutableStepRecord(extensionKey(stepId ?? key, kind), fact),
  }));
  const leaf = createImmutableStepRecord(key, {
    schemaVersion: 'depa.run-step-state-leaf/v1',
    stepId: stepId ?? null,
    coreRecordDigest: coreRecord.digest,
    extensionRecordDigests: Object.fromEntries(extensionRecords.map(({ kind, record }) => [kind, record.digest])),
  });
  return { leaf, materialRecords: [coreRecord, ...extensionRecords.map(({ record }) => record)] as readonly ImmutableStepRecord[] };
}
function definitionOwner(invocationKey: string, definitionStepIds: readonly string[]): string | undefined {
  const visit = invocationKey.lastIndexOf('#');
  const stablePath = visit >= 0 ? invocationKey.slice(0, visit) : invocationKey;
  const id = stablePath.slice(stablePath.lastIndexOf('/') + 1);
  return definitionStepIds.includes(id) ? id : undefined;
}

function partitionCtrl(checkpoint: AIWorkflowFlowRunCheckpoint, idsValue?: readonly string[]) {
  if (!idsValue?.length || idsValue.some((id) => typeof id !== 'string' || !id) || new Set(idsValue).size !== idsValue.length) {
    throw new Error('Ctrl sidecar requires unique frozen definition step identities.');
  }
  if (checkpoint.profile.kind !== 'WorkCtrlFlow' && checkpoint.profile.kind !== 'AICtrlWorkflow') throw new Error('Ctrl profile expected.');
  const definitionStepIds = [...idsValue];
  const snapshot = checkpoint.profile.snapshot as FlowClosedObject;
  const { branchDecisions, nodeResults, waitResults, orchestration, ...snapshotControl } = snapshot;
  const runtimeMembers = runtimeCtrlMembers(orchestration, definitionStepIds);
  const memberIds = [...definitionStepIds.map((id) => `definition:${id}`), ...runtimeMembers.map((id) => `runtime:${id}`)].sort(compare);
  const facts = new Map(memberIds.map((id) => [id, {
    branchDecisions: {},
    nodeResults: {},
    waitResults: {},
    orchestration: Object.fromEntries(ORCHESTRATION_FIELDS.map((field) => [field, {}])),
  }]));
  const runtimeSet = new Set(runtimeMembers);
  const ownerOf = (identity: string) => {
    const owner = definitionOwner(identity, definitionStepIds);
    return owner ? `definition:${owner}` : runtimeSet.has(identity) ? `runtime:${identity}` : undefined;
  };
  const place = (field: 'branchDecisions' | 'nodeResults' | 'waitResults', value: unknown) => {
    for (const [invocationKey, fact] of entries(value, `ctrl ${field}`)) {
      const memberId = ownerOf(invocationKey);
      if (!memberId) throw new Error(`Ctrl ${field} identity ${invocationKey} is not admitted by frozen binding/orchestration.`);
      (facts.get(memberId)![field] as Record<string, FlowClosedValue>)[invocationKey] = fact;
    }
  };
  place('branchDecisions', branchDecisions);
  place('nodeResults', nodeResults);
  place('waitResults', waitResults);
  for (const field of ORCHESTRATION_FIELDS) {
    for (const [identity, fact] of entries(object(orchestration, 'ctrl orchestration')[field], `ctrl orchestration.${field}`)) {
      const memberId = ownerOf(identity);
      if (!memberId) throw new Error(`Ctrl orchestration.${field} identity ${identity} is not admitted.`);
      const memberOrchestration = facts.get(memberId)!.orchestration as Record<OrchestrationField, Record<string, FlowClosedValue>>;
      memberOrchestration[field][identity] = fact;
    }
  }
  const leaves = memberIds.map((memberId) => {
    const definitionStepId = memberId.startsWith('definition:') ? memberId.slice(11) : undefined;
    return createRunStepLeaf(ctrlKey(memberId), definitionStepId, {
      schemaVersion: 'depa.ctrl-run-step-state/v1',
      memberId,
      definitionStepId: definitionStepId ?? null,
      ...facts.get(memberId)!,
    }, definitionStepId ? stepExtensionFacts(checkpoint, definitionStepId) : {});
  });
  return {
    control: {
      schemaVersion: 'depa.flow-run-checkpoint-control/v1',
      checkpoint: envelope(checkpoint),
      profile: {
        kind: checkpoint.profile.kind,
        definitionStepIds,
        snapshot: {
          ...snapshotControl,
          orchestration: Object.fromEntries(ORCHESTRATION_FIELDS.map((field) => [field, {}])),
        },
        ...(checkpoint.profile.kind === 'AICtrlWorkflow' ? { ai: checkpoint.profile.ai } : {}),
      },
    } as unknown as FlowClosedObject,
    controlRecords: [] as readonly ImmutableStepRecord[],
    records: leaves.map(({ leaf }) => leaf),
    materialRecords: leaves.flatMap(({ materialRecords }) => materialRecords),
  };
}

function partitionData(checkpoint: AIWorkflowFlowRunCheckpoint, definitionStepIds?: readonly string[]) {
  if (checkpoint.profile.kind !== 'AIDataWorkflow') throw new Error('Data profile expected.');
  const { binding, nodes, ...runGraphControl } = checkpoint.profile.runGraph as FlowClosedObject;
  const nodeMap = object(nodes, 'data nodes');
  const expected = dataMembership(runGraphControl, binding, definitionStepIds);
  if (canonicalJson(expected) !== canonicalJson(Object.keys(nodeMap).sort(compare))) {
    throw new Error('Data membership differs from frozen binding plus accepted patch facts.');
  }
  const bindingRecord = createImmutableStepRecord('data-binding', binding);
  const leaves = expected.map((nodeId) => createRunStepLeaf(dataKey(nodeId), nodeId, {
    schemaVersion: 'depa.data-run-step-state/v1', nodeId, node: nodeMap[nodeId],
  }, stepExtensionFacts(checkpoint, nodeId)));
  return {
    control: {
      schemaVersion: 'depa.flow-run-checkpoint-control/v1',
      checkpoint: envelope(checkpoint),
      profile: {
        kind: 'AIDataWorkflow',
        runGraph: { ...runGraphControl, bindingRecordDigest: bindingRecord.digest },
        ai: checkpoint.profile.ai,
      },
    } as unknown as FlowClosedObject,
    controlRecords: [bindingRecord],
    records: leaves.map(({ leaf }) => leaf),
    materialRecords: leaves.flatMap(({ materialRecords }) => materialRecords),
  };
}

function reconstruct(
  head: FlowRunCheckpointHead,
  records: readonly ImmutableStepRecord[],
  controlRecords: ReadonlyMap<DefinitionStepDigest, ImmutableStepRecord>,
  readMaterial: (digest: DefinitionStepDigest) => ImmutableStepRecord,
): AIWorkflowFlowRunCheckpoint {
  const control = object(head.control, 'checkpoint control');
  if (control.schemaVersion !== 'depa.flow-run-checkpoint-control/v1') throw new Error('Checkpoint control schema is invalid.');
  const root = object(control.checkpoint, 'checkpoint envelope');
  const profileControl = object(control.profile, 'profile control');
  let profile: FlowClosedObject;
  let controllerSidecars: FlowClosedObject;
  let nodeSidecars: FlowClosedObject;
  const stepExtensionsByStepId: Record<string, Record<string, FlowClosedValue>> = {};
  const readLeaf = (record: ImmutableStepRecord, expectedStepId: string | undefined): ImmutableStepRecord => {
    const leaf = exact(record.value, ['schemaVersion', 'stepId', 'coreRecordDigest', 'extensionRecordDigests'], 'run step leaf');
    if (leaf.schemaVersion !== 'depa.run-step-state-leaf/v1' || leaf.stepId !== (expectedStepId ?? null)
      || typeof leaf.coreRecordDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(leaf.coreRecordDigest)) {
      throw new Error('Run step leaf identity is invalid.');
    }
    const core = readMaterial(leaf.coreRecordDigest as DefinitionStepDigest);
    if (core.key !== coreKey(record.key)) throw new Error('Run step core record identity is invalid.');
    const extensionDigests = object(leaf.extensionRecordDigests, 'run step extension digests');
    if (Object.keys(extensionDigests).length > 0 && !expectedStepId) {
      throw new Error('Runtime-only RunStepState cannot own definition extensions.');
    }
    for (const [kind, value] of entries(extensionDigests, 'run step extension digests')) {
      if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value)) throw new Error('Run step extension digest is invalid.');
      const extension = readMaterial(value as DefinitionStepDigest);
      if (extension.key !== extensionKey(expectedStepId!, kind)) throw new Error('Run step extension record identity is invalid.');
      (stepExtensionsByStepId[expectedStepId!] ??= {})[kind] = extension.value;
    }
    return core;
  };
  if (profileControl.kind === 'AIDataWorkflow') {
    if (controlRecords.size !== 1) throw new Error('Data checkpoint requires exactly one binding control record.');
    const runGraphControl = object(profileControl.runGraph, 'data runGraph control');
    if (typeof runGraphControl.bindingRecordDigest !== 'string') throw new Error('Data binding record digest is invalid.');
    const bindingRecordDigest = runGraphControl.bindingRecordDigest as DefinitionStepDigest;
    const bindingRecord = controlRecords.get(bindingRecordDigest);
    if (!bindingRecord || bindingRecord.key !== 'data-binding') throw new Error('Data binding control record is missing.');
    const { bindingRecordDigest: _bindingRecordDigest, ...runGraph } = runGraphControl;
    const binding = object(bindingRecord.value, 'data binding control record');
    const bindingDefinition = object(binding.definition, 'data binding definition');
    if (!Array.isArray(bindingDefinition.declarationOrder)) throw new Error('Data binding declarationOrder is required.');
    const expected = dataMembership(runGraph, binding, bindingDefinition.declarationOrder as readonly string[]);
    const nodes: Record<string, FlowClosedValue> = {};
    for (const record of records) {
      if (!record.key.startsWith('data/')) throw new Error('Data step leaf key is invalid.');
      const leafStepId = JSON.parse(record.key.slice(5)) as unknown;
      if (typeof leafStepId !== 'string') throw new Error('Data step leaf identity is invalid.');
      const value = object(readLeaf(record, leafStepId).value, 'data step record');
      if (value.schemaVersion !== 'depa.data-run-step-state/v1' || typeof value.nodeId !== 'string' || record.key !== dataKey(value.nodeId) || nodes[value.nodeId] !== undefined) {
        throw new Error('Data step record identity is invalid.');
      }
      nodes[value.nodeId] = object(value.node, `data step ${value.nodeId}`);
    }
    if (canonicalJson(expected) !== canonicalJson(Object.keys(nodes).sort(compare))) throw new Error('Data sidecar membership is invalid.');
    const restoredRunGraph: FlowClosedObject = { ...runGraph, binding, nodes };
    profile = { kind: 'AIDataWorkflow', runGraph: restoredRunGraph, ai: profileControl.ai as FlowClosedValue };
    const declarationOrder = restoredRunGraph.declarationOrder as readonly string[];
    const statuses = declarationOrder.map((nodeId) => object(nodes[nodeId], `data step ${nodeId}`).status).filter((status) => status !== 'Removed');
    const status = statuses.some((item) => item === 'Failed') ? 'Failed'
      : statuses.some((item) => item === 'Running') ? 'Running'
        : statuses.length > 0 && statuses.every((item) => item === 'Succeeded' || item === 'Reused') ? 'Succeeded' : 'Pending';
    controllerSidecars = { status };
    nodeSidecars = Object.fromEntries(declarationOrder.map((nodeId) => {
      const node = object(nodes[nodeId], `data step ${nodeId}`);
      return [nodeId, { status: node.status as FlowClosedValue, generation: node.generation as FlowClosedValue }];
    }));
  } else if (profileControl.kind === 'WorkCtrlFlow' || profileControl.kind === 'AICtrlWorkflow') {
    if (controlRecords.size !== 0) throw new Error('Ctrl checkpoint cannot admit data control records.');
    if (!Array.isArray(profileControl.definitionStepIds) || profileControl.definitionStepIds.some((id) => typeof id !== 'string' || !id)) throw new Error('Ctrl definition membership is invalid.');
    const definitionStepIds = profileControl.definitionStepIds as readonly string[];
    if (new Set(definitionStepIds).size !== definitionStepIds.length) throw new Error('Ctrl definition membership is duplicated.');
    const snapshotControl = object(profileControl.snapshot, 'ctrl snapshot control');
    const orchestrationOutput = Object.fromEntries(
      ORCHESTRATION_FIELDS.map((field) => [field, {}]),
    ) as Record<OrchestrationField, Record<string, FlowClosedValue>>;
    const branchDecisions: Record<string, FlowClosedValue> = {};
    const nodeResults: Record<string, FlowClosedValue> = {};
    const waitResults: Record<string, FlowClosedValue> = {};
    const output = {
      branchDecisions,
      nodeResults,
      waitResults,
      orchestration: orchestrationOutput,
    };
    const actual: string[] = [];
    for (const record of records) {
      if (!record.key.startsWith('ctrl/')) throw new Error('Ctrl step leaf key is invalid.');
      const memberId = JSON.parse(record.key.slice(5)) as unknown;
      if (typeof memberId !== 'string') throw new Error('Ctrl step leaf identity is invalid.');
      const expectedStepId = memberId.startsWith('definition:') ? memberId.slice(11) : undefined;
      const value = object(readLeaf(record, expectedStepId).value, 'ctrl step record');
      if (value.schemaVersion !== 'depa.ctrl-run-step-state/v1' || typeof value.memberId !== 'string' || record.key !== ctrlKey(value.memberId)) throw new Error('Ctrl step record identity is invalid.');
      const projectedDefinition = value.memberId.startsWith('definition:') ? value.memberId.slice(11) : null;
      if (value.definitionStepId !== projectedDefinition) throw new Error('Ctrl definition member projection is invalid.');
      actual.push(value.memberId);
      for (const field of ['branchDecisions', 'nodeResults', 'waitResults'] as const) {
        for (const [key, fact] of entries(value[field], `ctrl ${field}`)) {
          const owner = definitionOwner(key, definitionStepIds);
          if (projectedDefinition !== null ? owner !== projectedDefinition : value.memberId !== `runtime:${key}`) throw new Error(`Ctrl ${field} member is invalid.`);
          if (Object.prototype.hasOwnProperty.call(output[field], key)) throw new Error(`Ctrl ${field} member is duplicated.`);
          output[field][key] = fact;
        }
      }
      const recordOrchestration = object(value.orchestration, 'ctrl record orchestration');
      for (const field of ORCHESTRATION_FIELDS) {
        for (const [key, fact] of entries(recordOrchestration[field], `ctrl orchestration.${field}`)) {
          const owner = definitionOwner(key, definitionStepIds);
          if (projectedDefinition !== null ? owner !== projectedDefinition : value.memberId !== `runtime:${key}`) throw new Error(`Ctrl orchestration.${field} member is invalid.`);
          if (Object.prototype.hasOwnProperty.call(orchestrationOutput[field], key)) throw new Error(`Ctrl orchestration.${field} member is duplicated.`);
          orchestrationOutput[field][key] = fact;
        }
      }
    }
    const runtimeMembers = runtimeCtrlMembers(orchestrationOutput, definitionStepIds);
    const expected = [...definitionStepIds.map((id) => `definition:${id}`), ...runtimeMembers.map((id) => `runtime:${id}`)].sort(compare);
    if (canonicalJson(expected) !== canonicalJson(actual.sort(compare))) throw new Error('Ctrl sidecar membership is invalid.');
    const snapshot: FlowClosedObject = { ...snapshotControl, ...output };
    profile = profileControl.kind === 'AICtrlWorkflow'
      ? { kind: 'AICtrlWorkflow', snapshot, ai: profileControl.ai as FlowClosedValue }
      : { kind: 'WorkCtrlFlow', snapshot };
    controllerSidecars = {
      status: snapshot.status as FlowClosedValue,
      lastTickNo: snapshot.lastTickNo as FlowClosedValue,
      branchDecisions: output.branchDecisions,
      orchestration: output.orchestration,
      openWaitHandles: snapshot.openWaitHandles as FlowClosedValue,
      closedWaitHandles: snapshot.closedWaitHandles as FlowClosedValue,
      appliedResumeSignals: snapshot.appliedResumeSignals as FlowClosedValue,
    };
    nodeSidecars = { nodeResults: output.nodeResults, waitResults: output.waitResults };
  } else throw new Error('Checkpoint profile control kind is invalid.');
  const stepExtensions = Object.keys(stepExtensionsByStepId).length === 0 ? undefined : {
    schemaVersion: 'depa.flow-run-step-extensions/v1',
    byStepId: stepExtensionsByStepId,
  };
  return normalizeFlowRunCheckpoint({
    ...root,
    instanceId: head.instanceId,
    runId: head.runId,
    definition: head.definition,
    version: head.version,
    controllerSidecars,
    nodeSidecars,
    ...(stepExtensions === undefined ? {} : { stepExtensions }),
    profile,
  });
}

function exact(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
  const record = object(value, label) as Record<string, unknown>;
  if (canonicalJson(Object.keys(record).sort(compare)) !== canonicalJson([...fields].sort(compare))) throw new Error(`${label} fields are invalid.`);
  return record;
}
function normalizeHead(value: unknown): FlowRunCheckpointHead {
  const record = exact(value, ['schemaVersion', 'instanceId', 'runId', 'definition', 'version', 'logicalDigest', 'control', 'runStepStateRootDigest'], 'checkpoint head');
  if (record.schemaVersion !== 'depa.flow-run-checkpoint-head/v1' || typeof record.instanceId !== 'string' || !record.instanceId
    || typeof record.runId !== 'string' || !record.runId || !Number.isSafeInteger(record.version) || (record.version as number) < 0
    || typeof record.logicalDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(record.logicalDigest)
    || typeof record.runStepStateRootDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(record.runStepStateRootDigest)) throw new Error('Checkpoint head scalar fields are invalid.');
  const definition = exact(record.definition, ['revision', 'digest', 'provenance'], 'checkpoint definition');
  if (typeof definition.revision !== 'string' || !definition.revision || typeof definition.digest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(definition.digest)) throw new Error('Checkpoint definition identity is invalid.');
  object(record.control, 'checkpoint control');
  return Object.freeze(record as unknown as FlowRunCheckpointHead);
}
function readJson(file: string): unknown {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Sidecar path ${file} must be regular.`);
  let fd: number | undefined;
  try { fd = fs.openSync(file, fs.constants.O_RDONLY | NO_FOLLOW); return JSON.parse(fs.readFileSync(fd, 'utf8')) as unknown; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
function readNode(dir: string, nodeDigest: DefinitionStepDigest): StepMerkleNode {
  const decoded = readJson(path.join(dir, digestFileName(nodeDigest)));
  const kind = object(decoded, 'tree node').kind;
  const value = exact(decoded, kind === 'leaf' ? ['kind', 'key', 'recordDigest', 'digest'] : ['kind', 'firstKey', 'lastKey', 'leftDigest', 'rightDigest', 'digest'], 'tree node') as unknown as StepMerkleNode;
  const expected = value.kind === 'leaf' ? digest({ kind: 'leaf', key: value.key, recordDigest: value.recordDigest })
    : value.kind === 'branch' ? digest({ kind: 'branch', firstKey: value.firstKey, lastKey: value.lastKey, leftDigest: value.leftDigest, rightDigest: value.rightDigest }) : undefined;
  if (expected !== nodeDigest || value.digest !== nodeDigest) throw new Error('Tree node digest mismatch.');
  return value;
}
function readRecord(dir: string, recordDigest: DefinitionStepDigest): ImmutableStepRecord {
  const value = exact(readJson(path.join(dir, digestFileName(recordDigest))), ['schemaVersion', 'key', 'value', 'digest'], 'step record') as unknown as ImmutableStepRecord;
  const expected = createImmutableStepRecord(value.key, value.value);
  if (expected.digest !== recordDigest || canonicalJson(expected) !== canonicalJson(value)) throw new Error('Step record digest mismatch.');
  return expected;
}
function collectRecords(root: string, rootDigest: DefinitionStepDigest): ImmutableStepRecord[] {
  const records = new Map<string, ImmutableStepRecord>(); const visited = new Set<string>();
  const visit = (value: DefinitionStepDigest): void => {
    if (visited.has(value)) return; visited.add(value);
    const node = readNode(path.join(root, 'trees'), value);
    if (node.kind === 'leaf') { const record = readRecord(path.join(root, 'records'), node.recordDigest); if (record.key !== node.key || records.has(record.key)) throw new Error('Step leaf identity is invalid.'); records.set(record.key, record); }
    else { visit(node.leftDigest); visit(node.rightDigest); }
  };
  visit(rootDigest); return [...records.values()].sort((a, b) => compare(a.key, b.key));
}

function runEvent(runtime: CheckpointDurabilityRuntime | undefined, event: CheckpointDurabilityEvent, operation: () => void): void {
  runtime?.beforeEvent?.(event); operation(); runtime?.onEvent?.(event);
}
function syncDirectory(directory: string, role: CheckpointDurabilityRole, runtime?: CheckpointDurabilityRuntime): void {
  let fd: number | undefined;
  try { fd = fs.openSync(directory, fs.constants.O_RDONLY); runEvent(runtime, { operation: 'directory-fsync', role, path: directory }, () => fs.fsyncSync(fd!)); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
export function createDirectoryDurably(directory: string, role: CheckpointDurabilityRole, runtime?: CheckpointDurabilityRuntime): void {
  runEvent(runtime, { operation: 'directory-create', role, path: directory }, () => fs.mkdirSync(directory));
  syncDirectory(path.dirname(directory), role, runtime);
}
export function writeDurableCandidate(file: string, bytes: string, role: CheckpointDurabilityRole, runtime?: CheckpointDurabilityRuntime): void {
  let fd: number | undefined;
  try { fd = fs.openSync(file, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | NO_FOLLOW, 0o600); fs.writeFileSync(fd, bytes, 'utf8'); runEvent(runtime, { operation: 'file-fsync', role, path: file }, () => fs.fsyncSync(fd!)); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
export function renameDurably(source: string, target: string, role: CheckpointDurabilityRole, runtime?: CheckpointDurabilityRuntime): void {
  runEvent(runtime, { operation: 'rename', role, path: source, targetPath: target }, () => fs.renameSync(source, target));
  syncDirectory(path.dirname(target), role, runtime);
}
function writeImmutable(file: string, value: unknown, role: 'record' | 'tree' | 'receipt', runtime?: CheckpointDurabilityRuntime): void {
  const parent = fs.lstatSync(path.dirname(file));
  if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error(`Immutable ${role} parent must be a real directory.`);
  if (fs.existsSync(file)) { if (canonicalJson(readJson(file)) !== canonicalJson(value)) throw new Error(`Immutable collision at ${file}`); return; }
  const candidate = `${file}.candidate-${randomUUID()}`;
  try {
    writeDurableCandidate(candidate, canonicalJson(value), role, runtime);
    if (canonicalJson(readJson(candidate)) !== canonicalJson(value)) throw new Error('Immutable candidate readback differs.');
    renameDurably(candidate, file, role, runtime);
  } finally { if (fs.existsSync(candidate)) fs.unlinkSync(candidate); }
}

export function encodeCheckpointSidecars(checkpointValue: AIWorkflowFlowRunCheckpoint, previousTree: StepMerkleTree | undefined, config: CheckpointSidecarEncodeConfig = {}): EncodedCheckpoint {
  const checkpoint = normalizeFlowRunCheckpoint(checkpointValue);
  const partitioned = checkpoint.profile.kind === 'AIDataWorkflow' ? partitionData(checkpoint, config.definitionStepIds) : partitionCtrl(checkpoint, config.definitionStepIds);
  const tree = buildStepMerkleTree(partitioned.records); const treeDiff = diffStepMerkleTrees(previousTree, tree);
  const previousRecords = new Set<string>(); Object.values(previousTree?.nodes ?? {}).forEach((node) => { if (node.kind === 'leaf') previousRecords.add(node.recordDigest); });
  const addedRecordDigests = partitioned.records.map((record) => record.digest).filter((value) => !previousRecords.has(value)).sort(compare);
  const logicalDigest = digest(checkpoint);
  const head: FlowRunCheckpointHead = Object.freeze({ schemaVersion: 'depa.flow-run-checkpoint-head/v1', instanceId: checkpoint.instanceId, runId: checkpoint.runId, definition: checkpoint.definition, version: checkpoint.version, logicalDigest, control: partitioned.control, runStepStateRootDigest: tree.rootDigest });
  const previousMaterials = new Set(config.previousMaterialRecordDigests ?? []);
  const addedMaterialRecordDigests = partitioned.materialRecords.map((record) => record.digest)
    .filter((value) => !previousMaterials.has(value)).sort(compare);
  return { head, controlRecords: partitioned.controlRecords, records: partitioned.records, materialRecords: partitioned.materialRecords, tree, receipt: Object.freeze({ schemaVersion: 'depa.flow-run-checkpoint-sidecar-receipt/v1', version: checkpoint.version, previousRootDigest: previousTree?.rootDigest ?? null, rootDigest: tree.rootDigest, logicalDigest, controlRecordDigests: Object.freeze(partitioned.controlRecords.map((record) => record.digest).sort(compare)), addedMaterialRecordDigests: Object.freeze(addedMaterialRecordDigests), addedRecordDigests: Object.freeze(addedRecordDigests), addedTreeNodeDigests: treeDiff.addedNodeDigests }) };
}
export function persistCheckpointSidecars(runDir: string, encoded: EncodedCheckpoint, runtime?: CheckpointDurabilityRuntime): void {
  const root = path.join(runDir, 'step-space'); const addedRecords = new Set(encoded.receipt.addedRecordDigests); const addedMaterials = new Set(encoded.receipt.addedMaterialRecordDigests); const addedNodes = new Set(encoded.receipt.addedTreeNodeDigests);
  for (const record of encoded.controlRecords) writeImmutable(path.join(root, 'controls', digestFileName(record.digest)), record, 'record', runtime);
  for (const record of encoded.materialRecords.filter((item) => addedMaterials.has(item.digest))) writeImmutable(path.join(root, 'records', digestFileName(record.digest)), record, 'record', runtime);
  for (const record of encoded.records.filter((item) => addedRecords.has(item.digest))) writeImmutable(path.join(root, 'records', digestFileName(record.digest)), record, 'record', runtime);
  for (const node of Object.values(encoded.tree.nodes).filter((item) => addedNodes.has(item.digest))) writeImmutable(path.join(root, 'trees', digestFileName(node.digest)), node, 'tree', runtime);
  writeImmutable(path.join(root, 'receipts', `${encoded.head.version}.json`), encoded.receipt, 'receipt', runtime);
}
function assertReceipt(root: string, head: FlowRunCheckpointHead): Record<string, unknown> {
  const value = exact(readJson(path.join(root, 'receipts', `${head.version}.json`)), ['schemaVersion', 'version', 'previousRootDigest', 'rootDigest', 'logicalDigest', 'controlRecordDigests', 'addedMaterialRecordDigests', 'addedRecordDigests', 'addedTreeNodeDigests'], 'receipt');
  for (const field of ['controlRecordDigests', 'addedMaterialRecordDigests', 'addedRecordDigests', 'addedTreeNodeDigests'] as const) { const list = value[field]; if (!Array.isArray(list) || list.some((item) => typeof item !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(item)) || canonicalJson(list) !== canonicalJson([...list].sort(compare)) || new Set(list).size !== list.length) throw new Error(`Receipt ${field} is invalid.`); }
  if (value.schemaVersion !== 'depa.flow-run-checkpoint-sidecar-receipt/v1' || value.version !== head.version || value.rootDigest !== head.runStepStateRootDigest || value.logicalDigest !== head.logicalDigest || (value.previousRootDigest !== null && (typeof value.previousRootDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value.previousRootDigest)))) throw new Error('Receipt does not bind head.');
  return value;
}
export function readCheckpointHeadAndLogical(file: string) {
  const head = normalizeHead(readJson(file)); const root = path.join(path.dirname(file), 'step-space'); const receipt = assertReceipt(root, head);
  const controlRecords = new Map<DefinitionStepDigest, ImmutableStepRecord>();
  for (const value of receipt.controlRecordDigests as readonly DefinitionStepDigest[]) {
    controlRecords.set(value, readRecord(path.join(root, 'controls'), value));
  }
  const materialDigests = new Set<DefinitionStepDigest>();
  const readMaterial = (value: DefinitionStepDigest) => {
    materialDigests.add(value);
    return readRecord(path.join(root, 'records'), value);
  };
  const checkpoint = reconstruct(head, collectRecords(root, head.runStepStateRootDigest), controlRecords, readMaterial);
  if (digest(checkpoint) !== head.logicalDigest || checkpoint.instanceId !== head.instanceId || checkpoint.runId !== head.runId || checkpoint.version !== head.version || canonicalJson(checkpoint.definition) !== canonicalJson(head.definition)) throw new Error('Head and logical checkpoint differ.');
  const nodes: Record<string, StepMerkleNode> = {}; const leafByKey: Record<string, DefinitionStepDigest> = {}; const keyOrder: string[] = [];
  const visit = (value: DefinitionStepDigest): void => { if (nodes[value]) return; const node = readNode(path.join(root, 'trees'), value); nodes[value] = node; if (node.kind === 'leaf') { leafByKey[node.key] = value; keyOrder.push(node.key); } else { visit(node.leftDigest); visit(node.rightDigest); } };
  visit(head.runStepStateRootDigest); keyOrder.sort(compare);
  return { head, checkpoint, materialRecordDigests: Object.freeze([...materialDigests].sort(compare)), tree: Object.freeze({ schemaVersion: 'depa.step-merkle-tree/v1' as const, rootDigest: head.runStepStateRootDigest, keyOrder: Object.freeze(keyOrder), leafByKey: Object.freeze(leafByKey), nodes: Object.freeze(nodes) }) };
}
export const isCheckpointHead = (value: unknown): boolean => !!value && typeof value === 'object' && !Array.isArray(value) && (value as { schemaVersion?: unknown }).schemaVersion === 'depa.flow-run-checkpoint-head/v1';
export const checkpointHeadJson = (head: FlowRunCheckpointHead): string => canonicalJson(head);
