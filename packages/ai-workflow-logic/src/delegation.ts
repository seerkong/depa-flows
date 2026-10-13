import type {
  AIAgentProcessorRuntime, AIWorkflowFlowRunCheckpoint, FlowClosedValue,
  WorkflowTaskDelegation, WorkflowDelegationRequest, WorkflowDelegationObservation,
  WorkflowDelegationRecord, WorkflowDelegationEffectPort, WorkflowDelegationOwnerTarget,
} from 'ai-workflow-contract';
import { normalizeFlowClosedValue } from './run-checkpoint.js';
import { assertAIAgentNodeTaskBinding } from './agent-state.js';

export class WorkflowDelegationError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'WorkflowDelegationError'; }
}

export class WorkflowDelegationSuspendedError extends Error {
  constructor(readonly invocationKey: string, readonly status: string, readonly cause?: unknown) {
    super(`Workflow delegation ${invocationKey} is ${status}; observe the original invocation.`);
    this.name = 'WorkflowDelegationSuspendedError';
  }
}

function assert(condition: unknown, code: string): asserts condition {
  if (!condition) throw new WorkflowDelegationError(code);
}
function dataRecord(value: unknown): Record<string, FlowClosedValue> {
  // Normalize before accessing properties: getters, symbols and non-data values are rejected.
  const data = normalizeFlowClosedValue(value, 'delegation');
  assert(data !== null && typeof data === 'object' && !Array.isArray(data), 'DELEGATION_OBJECT_REQUIRED');
  return data as Record<string, FlowClosedValue>;
}
function object(value: unknown, required: string[], optional: string[] = []): Record<string, FlowClosedValue> {
  const row = dataRecord(value);
  assert(required.every(key => Object.hasOwn(row, key)) && Object.keys(row).every(key => [...required, ...optional].includes(key)), 'DELEGATION_FIELDS_INVALID');
  return row;
}
function identity(value: unknown): asserts value is string {
  assert(typeof value === 'string' && value.length > 0 && value.trim() === value && value.normalize('NFC') === value, 'DELEGATION_IDENTITY_INVALID');
}
function identityValue(value: unknown): string { identity(value); return value; }
function integer(value: unknown): asserts value is number {
  assert(Number.isSafeInteger(value) && (value as number) >= 0, 'DELEGATION_INTEGER_INVALID');
}
function same(a: unknown, b: unknown): boolean {
  function sorted(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sorted);
    if (!value || typeof value !== 'object') return value;
    const row = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(row).sort().map(key => [key, sorted(row[key])]));
  }
  return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
}
function target(value: unknown): WorkflowDelegationOwnerTarget {
  const row = object(value, ['owner', 'providerScope', 'targetId']);
  return Object.freeze({ owner: identityValue(row.owner), providerScope: identityValue(row.providerScope), targetId: identityValue(row.targetId) });
}

export function normalizeWorkflowDelegation(value: unknown): WorkflowTaskDelegation {
  const row = object(value, ['kind', 'task', 'context', 'sessionPolicy', 'materials'], ['execution']);
  assert(row.kind === 'workflow.task-delegation/v1', 'DELEGATION_KIND_INVALID');
  const task = object(row.task, ['nodeId', 'agentDefinitionRef', 'input']);
  identity(task.nodeId); identity(task.agentDefinitionRef);
  assert(task.agentDefinitionRef.startsWith('resource://') && task.agentDefinitionRef.length > 11, 'DELEGATION_TASK_REF_INVALID');
  const contextInput = object(row.context, ['mode'], ['owner', 'providerScope', 'targetId', 'nodeId']);
  let context: WorkflowTaskDelegation['context'];
  if (contextInput.mode === 'fresh') {
    object(contextInput, ['mode', 'owner', 'providerScope']);
    context = { mode: 'fresh', owner: identityValue(contextInput.owner), providerScope: identityValue(contextInput.providerScope) };
  } else if (contextInput.mode === 'reuse') {
    object(contextInput, ['mode', 'owner', 'providerScope', 'targetId']);
    context = { mode: 'reuse', ...target({ owner: contextInput.owner, providerScope: contextInput.providerScope, targetId: contextInput.targetId }) };
  } else {
    object(contextInput, ['mode', 'nodeId']); assert(contextInput.mode === 'from-node', 'DELEGATION_CONTEXT_INVALID');
    context = { mode: 'from-node', nodeId: identityValue(contextInput.nodeId) };
  }
  assert(row.sessionPolicy === 'shared' || row.sessionPolicy === 'independent-per-generation', 'DELEGATION_SESSION_POLICY_INVALID');
  assert(row.sessionPolicy !== 'independent-per-generation' || context.mode === 'fresh', 'DELEGATION_INDEPENDENCE_REQUIRED');
  assert(Array.isArray(row.materials) && row.materials.length <= 17, 'DELEGATION_MATERIALS_INVALID');
  let total = 0;
  const ids = new Set<string>();
  let instructions = 0;
  const materials = row.materials.map((item: unknown) => {
    const material = object(item, ['id', 'role', 'ref', 'sha256', 'bytes']);
    identity(material.id); identity(material.ref); identity(material.sha256); integer(material.bytes);
    assert((material.role === 'instruction' || material.role === 'auxiliary') && /^[a-f0-9]{64}$/.test(material.sha256), 'DELEGATION_MATERIAL_INVALID');
    assert(!ids.has(material.id) && material.bytes <= 1048576, 'DELEGATION_MATERIAL_LIMIT');
    ids.add(material.id); total += material.bytes;
    if (material.role === 'instruction') instructions++;
    return Object.freeze({ id: material.id, ref: material.ref, sha256: material.sha256, bytes: material.bytes, role: material.role });
  });
  assert(instructions <= 1 && materials.length - instructions <= 16 && total <= 8388608, 'DELEGATION_MATERIAL_LIMIT');
  const execution=Object.hasOwn(row,'execution')?normalizeFlowClosedValue(row.execution,'delegation.execution'):undefined;
  if(execution!==undefined)assert(new TextEncoder().encode(JSON.stringify(execution)).length<=16384,'DELEGATION_EXECUTION_LIMIT');
  return Object.freeze({ kind: row.kind, task: Object.freeze({ nodeId: task.nodeId, agentDefinitionRef: task.agentDefinitionRef as `resource://${string}`, input: task.input }), context: Object.freeze(context), sessionPolicy: row.sessionPolicy, materials: Object.freeze(materials),...(execution===undefined?{}:{execution}) });
}

function normalizeRequest(value: unknown): WorkflowDelegationRequest {
  const row = object(value, ['delegation', 'lineage', 'attempt'], ['target']);
  const lineage = object(row.lineage, ['instanceId', 'runId', 'nodeId', 'invocationKey', 'visit', 'generation'], ['sourceInvocationKey']);
  for (const [key, value] of Object.entries(lineage)) key === 'generation' ? integer(value) : identity(value);
  integer(lineage.generation);
  integer(row.attempt);
  const delegation = normalizeWorkflowDelegation(row.delegation);
  assert(delegation.task.nodeId === lineage.nodeId, 'DELEGATION_LINEAGE_MISMATCH');
  assert((delegation.context.mode === 'from-node') === Object.hasOwn(lineage, 'sourceInvocationKey'), 'DELEGATION_SOURCE_MISMATCH');
  assert((delegation.context.mode !== 'fresh') === Object.hasOwn(row, 'target'), 'DELEGATION_TARGET_MISMATCH');
  return { delegation, lineage: Object.freeze({
    instanceId: identityValue(lineage.instanceId), runId: identityValue(lineage.runId), nodeId: identityValue(lineage.nodeId),
    invocationKey: identityValue(lineage.invocationKey), visit: identityValue(lineage.visit), generation: lineage.generation,
    ...(lineage.sourceInvocationKey === undefined ? {} : { sourceInvocationKey: identityValue(lineage.sourceInvocationKey) }),
  }), attempt: row.attempt, ...(row.target === undefined ? {} : { target: target(row.target) }) };
}

export function normalizeWorkflowDelegationObservation(value: unknown, request: WorkflowDelegationRequest): WorkflowDelegationObservation {
  const row = object(value, ['invocationKey', 'attempt', 'receiptId', 'status'], ['target', 'output', 'settled', 'reason']);
  identity(row.receiptId);
  assert(row.invocationKey === request.lineage.invocationKey && row.attempt === request.attempt, 'DELEGATION_RECEIPT_IDENTITY_MISMATCH');
  if (row.status === 'completed') {
    object(row, ['invocationKey', 'attempt', 'receiptId', 'status', 'target', 'output']);
    const actual = target(row.target);
    assertObservationTarget(actual, request);
  } else if (row.status === 'failed') {
    object(row, ['invocationKey', 'attempt', 'receiptId', 'status', 'target', 'settled', 'reason']);
    assert(row.settled === true, 'DELEGATION_FAILURE_UNSETTLED'); identity(row.reason);
    assertObservationTarget(target(row.target), request);
  } else if (row.status === 'rejected' || row.status === 'not-dispatched') {
    object(row, ['invocationKey', 'attempt', 'receiptId', 'status', 'settled', 'reason']);
    assert(row.settled === true, 'DELEGATION_REJECTION_UNSETTLED'); identity(row.reason);
  } else {
    object(row, ['invocationKey', 'attempt', 'receiptId', 'status'], ['target']);
    assert(['pending', 'busy', 'awaiting-user', 'unknown'].includes(identityValue(row.status)), 'DELEGATION_STATUS_INVALID');
    if (row.target !== undefined) assertObservationTarget(target(row.target), request);
  }
  return Object.freeze(row) as WorkflowDelegationObservation;
}

function assertObservationTarget(actual: WorkflowDelegationOwnerTarget, request: WorkflowDelegationRequest): void {
  if (request.target) assert(same(actual, request.target), 'DELEGATION_OWNER_TARGET_MISMATCH');
  const context = request.delegation.context;
  if (context.mode === 'fresh') assert(actual.owner === context.owner && actual.providerScope === context.providerScope, 'DELEGATION_OWNER_TARGET_MISMATCH');
}

export function normalizeWorkflowDelegations(value: unknown): Readonly<Record<string, WorkflowDelegationRecord>> {
  const normalized = normalizeFlowClosedValue(value, 'delegationsByKey');
  assert(normalized && typeof normalized === 'object' && !Array.isArray(normalized), 'DELEGATION_INDEX_INVALID');
  const result: Record<string, WorkflowDelegationRecord> = {};
  for (const key of Object.keys(normalized).sort()) {
    identity(key);
    const row = object(dataRecord(normalized)[key], ['attempts']);
    assert(Array.isArray(row.attempts) && row.attempts.length > 0, 'DELEGATION_ATTEMPTS_REQUIRED');
    const attempts = row.attempts.map((item: unknown, index: number) => {
      const attempt = object(item, ['request', 'dispatchClaimed'], ['observation']);
      assert(typeof attempt.dispatchClaimed === 'boolean' && (attempt.observation === undefined || attempt.dispatchClaimed), 'DELEGATION_DISPATCH_CLAIM_INVALID');
      const request = normalizeRequest(attempt.request);
      assert(request.attempt === index && request.lineage.invocationKey === key, 'DELEGATION_ATTEMPT_IDENTITY_MISMATCH');
      return Object.freeze({ request, dispatchClaimed: attempt.dispatchClaimed, ...(attempt.observation === undefined ? {} : { observation: normalizeWorkflowDelegationObservation(attempt.observation, request) }) });
    });
    for (let index = 1; index < attempts.length; index++) {
      const previous = attempts[index - 1];
      assert(previous.observation?.status === 'rejected' || previous.observation?.status === 'not-dispatched', 'DELEGATION_RETRY_FORBIDDEN');
      assert(same({ ...previous.request, attempt: index }, attempts[index].request), 'DELEGATION_RETRY_INTENT_CHANGED');
    }
    result[key] = Object.freeze({ attempts: Object.freeze(attempts) });
  }
  return Object.freeze(result);
}

export function validateWorkflowDelegationTransition(before: Readonly<Record<string, WorkflowDelegationRecord>>, after: Readonly<Record<string, WorkflowDelegationRecord>>): void {
  for (const [key, record] of Object.entries(before)) {
    const next = after[key];
    assert(next && next.attempts.length >= record.attempts.length && next.attempts.length <= record.attempts.length + 1, 'DELEGATION_HISTORY_IMMUTABLE');
    record.attempts.forEach((attempt, index) => {
      const candidate = next.attempts[index]!;
      assert(same(attempt.request, candidate.request), 'DELEGATION_RESERVATION_IMMUTABLE');
      assert(!attempt.dispatchClaimed || candidate.dispatchClaimed, 'DELEGATION_DISPATCH_CLAIM_IMMUTABLE');
      if (attempt.observation && ['completed', 'failed', 'rejected', 'not-dispatched'].includes(attempt.observation.status)) {
        assert(same(attempt, candidate), 'DELEGATION_TERMINAL_IMMUTABLE');
      }
    });
    if (next.attempts.length > record.attempts.length) assert(!next.attempts.at(-1)!.observation, 'DELEGATION_RESERVATION_REQUIRED');
  }
  for (const [key, record] of Object.entries(after)) if (!before[key]) {
    assert(record.attempts.length === 1 && !record.attempts[0]!.observation, 'DELEGATION_RESERVATION_REQUIRED');
  }
}

export interface WorkflowDelegationRuntime extends Omit<AIAgentProcessorRuntime, 'effects'> {
  readonly effects: WorkflowDelegationEffectPort;
  readonly visit: string;
  readonly generation: number;
  /** Native scheduler/admission projection, never supplied by authored task input. */
  readonly dependencyInvocations: Readonly<Record<string, string>>;
}

async function load(runtime: WorkflowDelegationRuntime): Promise<AIWorkflowFlowRunCheckpoint> {
  const checkpoint = await runtime.checkpointRuntime.checkpointStore.load(runtime.checkpointKey);
  assert(checkpoint && checkpoint.instanceId === runtime.checkpointKey.instanceId && checkpoint.runId === runtime.checkpointKey.runId, 'DELEGATION_CHECKPOINT_MISSING');
  assert(checkpoint.profile.kind === runtime.workflowKind && ['AICtrlWorkflow', 'AIDataWorkflow'].includes(checkpoint.profile.kind), 'DELEGATION_PROFILE_MISMATCH');
  return checkpoint as AIWorkflowFlowRunCheckpoint;
}
function records(checkpoint: AIWorkflowFlowRunCheckpoint): Readonly<Record<string, WorkflowDelegationRecord>> {
  assert(checkpoint.profile.kind === 'AICtrlWorkflow' || checkpoint.profile.kind === 'AIDataWorkflow', 'DELEGATION_PROFILE_MISMATCH');
  return checkpoint.profile.ai.delegationsByKey ?? {};
}

/** Native loop frames and accepted data revisions establish serial order across visits.
 * These identities come from the scheduler/checkpoint, never the authored task input.
 * Same-visit sharing still requires the ordinary explicit predecessor relation.
 */
function isNativeSerialPredecessor(runtime: WorkflowDelegationRuntime, checkpoint: AIWorkflowFlowRunCheckpoint, previous: WorkflowDelegationRequest): boolean {
  const before = previous.lineage;
  if (before.instanceId !== checkpoint.instanceId || before.runId !== checkpoint.runId) return false;
  if (checkpoint.profile.kind === 'AICtrlWorkflow') {
    const frames = (visit: string, generation: number): { scope: string; loops: { key: string; iteration: number }[] } | undefined => {
      let value: unknown;
      try { value = JSON.parse(visit); } catch { return; }
      if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'string' || !Array.isArray(value[1]) || !value[1].length) return;
      const loops: { key: string; iteration: number }[] = [];
      for (const item of value[1]) {
        if (item === null || typeof item !== 'object' || Array.isArray(item)) return;
        const row = dataRecord(item);
        if (Object.keys(row).length !== 2 || typeof row.key !== 'string' || !row.key || typeof row.iteration !== 'number' || !Number.isSafeInteger(row.iteration) || row.iteration < 0) return;
        loops.push({ key: row.key, iteration: row.iteration });
      }
      if (loops.at(-1)!.iteration !== generation) return;
      return { scope: value[0], loops };
    };
    const oldVisit = frames(before.visit, before.generation), currentVisit = frames(runtime.visit, runtime.generation);
    if (!oldVisit || !currentVisit || oldVisit.scope !== currentVisit.scope || oldVisit.loops.length !== currentVisit.loops.length) return false;
    if (oldVisit.loops.some((frame, index) => frame.key !== currentVisit.loops[index]!.key)) return false;
    // An outer iteration also orders all of its inner iterations, even after an inner reset.
    const changed = oldVisit.loops.findIndex((frame, index) => frame.iteration !== currentVisit.loops[index]!.iteration);
    return changed >= 0 && oldVisit.loops[changed]!.iteration < currentVisit.loops[changed]!.iteration;
  }
  if (checkpoint.profile.kind === 'AIDataWorkflow') {
    if (before.nodeId !== runtime.nodeId || before.generation >= runtime.generation || before.visit !== `generation:${before.generation}` || runtime.visit !== `generation:${runtime.generation}`) return false;
    const graph = dataRecord(checkpoint.profile.runGraph), nodes = dataRecord(graph.nodes), node = dataRecord(nodes[runtime.nodeId]);
    if (graph.currentGeneration !== runtime.generation || node.generation !== runtime.generation) return false;
    // A number supplied by a caller is insufficient: require the persisted native revision
    // which actually reopened this node, or its still-active reciprocal invalidation fact.
    const invalidations = Array.isArray(graph.invalidations) ? graph.invalidations : [];
    if (invalidations.some(value => { const fact = dataRecord(value); return fact.nodeId === runtime.nodeId && fact.generation === runtime.generation; })) return true;
    const patches = Array.isArray(graph.patchHistory) ? graph.patchHistory : [];
    return patches.some(value => {
      const patch = dataRecord(value);
      return patch.generation === runtime.generation && Array.isArray(patch.operations) && patch.operations.some(value => {
        const operation = dataRecord(value);
        return operation.op === 'update-node' && operation.nodeId === runtime.nodeId;
      });
    });
  }
  return false;
}
async function commit(runtime: WorkflowDelegationRuntime, checkpoint: AIWorkflowFlowRunCheckpoint, key: string, record: WorkflowDelegationRecord): Promise<void> {
  assert(checkpoint.profile.kind === 'AICtrlWorkflow' || checkpoint.profile.kind === 'AIDataWorkflow', 'DELEGATION_PROFILE_MISMATCH');
  await runtime.checkpointRuntime.checkpointStore.commit({ expectedVersion: checkpoint.version, checkpoint: {
    ...checkpoint, version: checkpoint.version + 1,
    profile: { ...checkpoint.profile, ai: { ...checkpoint.profile.ai, delegationsByKey: { ...records(checkpoint), [key]: record } } },
  } });
}

/** A typed result is returned while pending; native adapters suspend rather than inventing output. */
export async function delegateWorkflowTask(runtime: WorkflowDelegationRuntime, input: WorkflowTaskDelegation): Promise<WorkflowDelegationObservation> {
  const delegation = normalizeWorkflowDelegation(input);
  assert(delegation.task.nodeId === runtime.nodeId, 'DELEGATION_NODE_MISMATCH');
  assertAIAgentNodeTaskBinding(runtime.taskBinding, { workflowKind: runtime.workflowKind, workflowRef: runtime.workflowRef, nodeId: runtime.nodeId }, { agentDefinitionRef: delegation.task.agentDefinitionRef });
  identity(runtime.visit); integer(runtime.generation);
  let checkpoint = await load(runtime);
  // Target, policy, and materials are admitted with the immutable run config, not task input.
  const binding = { ...delegation, task: { ...delegation.task, input: null } };
  const bindings = dataRecord(dataRecord(checkpoint.config).workflowDelegations);
  assert(same(bindings[runtime.nodeId], binding), 'DELEGATION_FROZEN_BINDING_MISMATCH');
  const key = runtime.invocationKey;
  let record = records(checkpoint)[key];
  let request: WorkflowDelegationRequest;
  let winner = false;
  if (record) {
    request = record.attempts.at(-1)!.request;
    assert(same(request.delegation, delegation) && request.lineage.visit === runtime.visit && request.lineage.generation === runtime.generation && request.lineage.instanceId === checkpoint.instanceId && request.lineage.runId === checkpoint.runId && request.lineage.nodeId === runtime.nodeId, 'DELEGATION_INVOCATION_CONFLICT');
  } else {
    let sourceInvocationKey: string | undefined;
    let selected: WorkflowDelegationOwnerTarget | undefined;
    const context = delegation.context;
    if (context.mode === 'reuse') selected = target({ owner: context.owner, providerScope: context.providerScope, targetId: context.targetId });
    if (context.mode === 'from-node') {
      sourceInvocationKey = runtime.dependencyInvocations[context.nodeId];
      assert(sourceInvocationKey && context.nodeId !== runtime.nodeId, 'DELEGATION_DEPENDENCY_REQUIRED');
      const source = records(checkpoint)[sourceInvocationKey]?.attempts.at(-1);
      assert(source?.observation?.status === 'completed' && source.request.lineage.nodeId === context.nodeId, 'DELEGATION_SOURCE_UNFINISHED');
      assert(source.request.lineage.instanceId === checkpoint.instanceId && source.request.lineage.runId === checkpoint.runId, 'DELEGATION_SOURCE_SCOPE_MISMATCH');
      assert(source.request.lineage.generation === runtime.generation && source.request.lineage.visit === runtime.visit, 'DELEGATION_SOURCE_STALE');
      assert(source.request.delegation.sessionPolicy !== 'independent-per-generation', 'DELEGATION_INDEPENDENCE_REQUIRED');
      selected = source.observation.target;
    }
    for (const existing of Object.values(records(checkpoint))) {
      const last = existing.attempts.at(-1)!;
      const terminal = last.observation && ['completed', 'failed', 'rejected', 'not-dispatched'].includes(last.observation.status);
      const actual = last.observation && 'target' in last.observation ? last.observation.target ?? last.request.target : last.request.target;
      if (selected && actual && same(selected, actual)) {
        assert(terminal && (Object.values(runtime.dependencyInvocations).includes(last.request.lineage.invocationKey) || isNativeSerialPredecessor(runtime, checkpoint, last.request)), 'DELEGATION_SHARED_TARGET_CONCURRENT');
      }
    }
    request = normalizeRequest({ delegation, lineage: { ...runtime.checkpointKey, nodeId: runtime.nodeId, invocationKey: key, visit: runtime.visit, generation: runtime.generation, ...(sourceInvocationKey ? { sourceInvocationKey } : {}) }, attempt: 0, ...(selected ? { target: selected } : {}) });
    record = { attempts: [{ request, dispatchClaimed: false }] };
    await runtime.effects.verifyMaterials(delegation.materials);
    try { await commit(runtime, checkpoint, key, record); }
    catch (error) {
      const latest = await load(runtime);
      const accepted = records(latest)[key];
      if (!accepted || !same(accepted.attempts.at(-1)!.request, request)) throw error;
      record = accepted;
    }
  }
  const last = record.attempts.at(-1)!;
  if (last.observation && ['completed', 'failed', 'rejected', 'not-dispatched'].includes(last.observation.status)) return last.observation;
  await runtime.effects.verifyMaterials(delegation.materials);
  if (!last.dispatchClaimed) {
    checkpoint = await load(runtime);
    record = records(checkpoint)[key]!;
    if (!record.attempts.at(-1)!.dispatchClaimed) {
      const claimed = { attempts: [...record.attempts.slice(0, -1), { ...record.attempts.at(-1)!, dispatchClaimed: true }] };
      try { await commit(runtime, checkpoint, key, claimed); winner = true; }
      catch (error) {
        const accepted = records(await load(runtime))[key]?.attempts.at(-1);
        if (!accepted?.dispatchClaimed || !same(accepted.request, request)) throw error;
      }
    }
  }
  // A lost submit receipt is uncertain. Never call submit again on recovery.
  let response: WorkflowDelegationObservation;
  try { response = await (winner ? runtime.effects.submit(request) : runtime.effects.observe(request)); }
  catch (cause) { throw new WorkflowDelegationSuspendedError(key, 'unknown', cause); }
  const observation = normalizeWorkflowDelegationObservation(response, request);
  checkpoint = await load(runtime);
  record = records(checkpoint)[key]!;
  const latest = record.attempts.at(-1)!;
  if (latest.observation && ['completed', 'failed', 'rejected', 'not-dispatched'].includes(latest.observation.status)) return latest.observation;
  assert(same(latest.request, request), 'DELEGATION_ATTEMPT_CHANGED');
  if (observation.status === 'completed' && delegation.context.mode === 'fresh') {
    for (const [otherKey, other] of Object.entries(records(checkpoint))) {
      if (otherKey === key) continue;
      for (const attempt of other.attempts) {
        assert(attempt.observation?.status !== 'completed' || !same(attempt.observation.target, observation.target), 'DELEGATION_FRESH_CONTEXT_REUSED');
      }
    }
  }
  const updated = { attempts: [...record.attempts.slice(0, -1), { request, dispatchClaimed: true, observation }] };
  try { await commit(runtime, checkpoint, key, updated); }
  catch (error) {
    const accepted = records(await load(runtime))[key]?.attempts.at(-1)?.observation;
    if (!accepted || !same(accepted, observation)) throw error;
  }
  return observation;
}

/** Explicit audited retry reservation. It never dispatches and never rewrites the failed attempt. */
export async function prepareWorkflowDelegationRetry(runtime: WorkflowDelegationRuntime, input: { expectedVersion: number; invocationKey: string; receiptId: string }): Promise<void> {
  const checkpoint = await load(runtime);
  assert(checkpoint.version === input.expectedVersion && input.invocationKey === runtime.invocationKey, 'DELEGATION_RETRY_CAS_MISMATCH');
  const record = records(checkpoint)[input.invocationKey];
  const last = record?.attempts.at(-1);
  assert(last && last.observation && ['rejected', 'not-dispatched'].includes(last.observation.status) && last.observation.receiptId === input.receiptId, 'DELEGATION_RETRY_FORBIDDEN');
  await commit(runtime, checkpoint, input.invocationKey, { attempts: [...record!.attempts, { request: { ...last.request, attempt: last.request.attempt + 1 }, dispatchClaimed: false }] });
}

/** Bound by native node adapters. Authored code supplies only this task's business input. */
export function bindWorkflowTaskDelegation(runtime: Omit<WorkflowDelegationRuntime, 'dependencyInvocations'>): { delegateTask(input: FlowClosedValue): Promise<FlowClosedValue> } {
  return Object.freeze({ async delegateTask(input: FlowClosedValue): Promise<FlowClosedValue> {
    const checkpoint = await load({ ...runtime, dependencyInvocations: {} });
    const config = dataRecord(checkpoint.config);
    const binding = dataRecord(config.workflowDelegations)[runtime.nodeId];
    assert(binding, 'DELEGATION_FROZEN_BINDING_MISSING');
    const dependencies = (config.workflowDelegationDependencies === undefined ? {} : dataRecord(config.workflowDelegationDependencies))[runtime.nodeId] ?? [];
    assert(Array.isArray(dependencies) && dependencies.every((id: unknown) => typeof id === 'string'), 'DELEGATION_DEPENDENCIES_INVALID');
    const dependencyInvocations: Record<string, string> = {};
    for (const nodeId of dependencies.map((id: unknown) => identityValue(id))) {
      const matches = Object.values(records(checkpoint)).map(record => record.attempts.at(-1)!).filter(attempt => attempt.request.lineage.nodeId === nodeId && attempt.request.lineage.generation === runtime.generation && attempt.request.lineage.visit === runtime.visit);
      assert(matches.length <= 1, 'DELEGATION_SOURCE_AMBIGUOUS');
      if (matches.length === 1) dependencyInvocations[nodeId] = matches[0]!.request.lineage.invocationKey;
    }
    const normalizedBinding = normalizeWorkflowDelegation(binding);
    // 已存在的调用沿保存的原lineage观察；新的循环寻址不能改写旧恢复身份。
    const original = records(checkpoint)[runtime.invocationKey]?.attempts.at(-1)?.request;
    const admittedRuntime = original ? { ...runtime, visit: original.lineage.visit, generation: original.lineage.generation } : runtime;
    const observation = await delegateWorkflowTask({ ...admittedRuntime, dependencyInvocations }, { ...normalizedBinding, task: { ...normalizedBinding.task, input } });
    if(observation.status==='failed')throw new WorkflowDelegationError(`DELEGATION_OWNER_FAILED:${observation.reason}`);
    if (observation.status !== 'completed') throw new WorkflowDelegationSuspendedError(runtime.invocationKey, observation.status);
    return observation.output;
  } });
}
