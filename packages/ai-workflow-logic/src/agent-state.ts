import type {
  AIAgentEffectConfig,
  AIAgentInstanceReference,
  AIAgentInvocation,
  AIAgentInvocationReceipt,
  AIAgentSelector,
  AIWorkflowProfileDurableState,
  AIWorkflowAgentTaskRef,
  AIWorkflowKind,
  FlowClosedObject,
  FlowClosedValue,
  LegacyAIWorkflowProfileDurableState,
} from 'ai-workflow-contract';
import { normalizeFlowClosedObject, normalizeFlowClosedValue } from './run-checkpoint.js';

export class AIAgentInvocationError extends Error {
  constructor(public readonly code: string, public readonly location: string, message: string) {
    super(`${location}: ${message}`);
    this.name = 'AIAgentInvocationError';
  }
}

function fail(code: string, location: string, message: string): never {
  throw new AIAgentInvocationError(code, location, message);
}

function record(value: unknown, required: readonly string[], optional: readonly string[], location: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('AI_AGENT_OBJECT_REQUIRED', location, 'Expected a plain data object.');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail('AI_AGENT_OBJECT_REQUIRED', location, 'Expected a plain data object.');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const allowed = new Set([...required, ...optional]);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string') fail('AI_AGENT_SYMBOL_UNSUPPORTED', location, 'Symbol fields are not supported.');
    const descriptor = descriptors[key]!;
    if (!('value' in descriptor)) fail('AI_AGENT_ACCESSOR_UNSUPPORTED', `${location}.${key}`, 'Accessor fields are not supported.');
    if (!allowed.has(key)) fail('AI_AGENT_FIELD_UNSUPPORTED', `${location}.${key}`, 'Unexpected field.');
  }
  for (const key of required) if (!Object.prototype.hasOwnProperty.call(descriptors, key)) fail('AI_AGENT_FIELD_REQUIRED', `${location}.${key}`, 'Required field is missing.');
  return value as Record<string, unknown>;
}

function objectMap(value: unknown, location: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('AI_AGENT_INDEX_REQUIRED', location, 'Expected a plain data index.');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail('AI_AGENT_INDEX_REQUIRED', location, 'Expected a plain data index.');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(descriptors).sort(compareCodeUnits)) {
    const descriptor = descriptors[key]!;
    if (!('value' in descriptor)) fail('AI_AGENT_ACCESSOR_UNSUPPORTED', `${location}.${key}`, 'Accessor fields are not supported.');
    output[key] = descriptor.value;
  }
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string')) fail('AI_AGENT_SYMBOL_UNSUPPORTED', location, 'Symbol fields are not supported.');
  return output;
}

function compareCodeUnits(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function identity(value: unknown, location: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value || value.normalize('NFC') !== value) {
    fail('AI_AGENT_IDENTITY_INVALID', location, 'Expected one non-empty NFC identity without surrounding whitespace.');
  }
  return value;
}

function resourceRef(value: unknown, location: string): `resource://${string}` {
  const result = identity(value, location);
  if (!result.startsWith('resource://') || result.length === 11) fail('AI_AGENT_DEFINITION_REF_INVALID', location, 'Expected an exact resource:// identity.');
  return result as `resource://${string}`;
}

function optionalClosedObject(value: unknown, location: string): FlowClosedObject {
  return normalizeFlowClosedObject(value, location);
}

const FORBIDDEN_RUNTIME_STATE_KEYS = new Set([
  'actor', 'actorstate', 'compaction', 'conversation', 'history', 'providertranscript', 'transcript',
]);

function safeOpaqueObject(value: unknown, location: string): FlowClosedObject {
  const normalized = optionalClosedObject(value, location);
  const visit = (item: FlowClosedValue, itemLocation: string): void => {
    if (Array.isArray(item)) {
      item.forEach((nested, index) => visit(nested, `${itemLocation}[${index}]`));
      return;
    }
    if (item === null || typeof item !== 'object') return;
    for (const [key, nested] of Object.entries(item)) {
      const semanticKey = key.normalize('NFC').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (FORBIDDEN_RUNTIME_STATE_KEYS.has(semanticKey)) {
        fail('AI_AGENT_RUNTIME_STATE_FIELD_FORBIDDEN', `${itemLocation}.${key}`, 'Runtime-owned Agent state cannot enter the Flow checkpoint.');
      }
      visit(nested, `${itemLocation}.${key}`);
    }
  };
  visit(normalized, location);
  return normalized;
}

function optionalStringArray(value: unknown, location: string): readonly string[] {
  if (!Array.isArray(value)) fail('AI_AGENT_ARRAY_REQUIRED', location, 'Expected an array.');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(descriptors, String(index))) fail('AI_AGENT_ARRAY_SPARSE', `${location}[${index}]`, 'Sparse arrays are not supported.');
  }
  return Object.freeze(value.map((item, index) => identity(item, `${location}[${index}]`)));
}

export function normalizeAIAgentSelector(value: unknown, location = 'selector'): AIAgentSelector {
  const input = record(value, [], ['byId', 'byName'], location);
  const hasId = Object.prototype.hasOwnProperty.call(input, 'byId');
  const hasName = Object.prototype.hasOwnProperty.call(input, 'byName');
  if (hasId === hasName) fail('AI_AGENT_SELECTOR_EXACTLY_ONE', location, 'Selector must contain exactly one supported key.');
  return Object.freeze(hasId
    ? { byId: identity(input.byId, `${location}.byId`) }
    : { byName: identity(input.byName, `${location}.byName`) });
}

export function normalizeAIAgentEffectConfig(value: unknown, location = 'config'): AIAgentEffectConfig {
  const input = record(value, ['agentDefinitionRef'], ['instanceName', 'materialRefs', 'effectPolicy'], location);
  return Object.freeze({
    agentDefinitionRef: resourceRef(input.agentDefinitionRef, `${location}.agentDefinitionRef`),
    ...(Object.prototype.hasOwnProperty.call(input, 'instanceName') ? { instanceName: identity(input.instanceName, `${location}.instanceName`) } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'materialRefs') ? { materialRefs: optionalStringArray(input.materialRefs, `${location}.materialRefs`) } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'effectPolicy') ? { effectPolicy: safeOpaqueObject(input.effectPolicy, `${location}.effectPolicy`) } : {}),
  });
}

export interface AIAgentNodeBindingIdentity {
  readonly workflowKind: AIWorkflowKind;
  readonly workflowRef: `resource://${string}`;
  readonly nodeId: string;
}

/** Exact frozen task proof used by Ctrl/Data loaders before constructing a node runtime. */
export function assertAIAgentNodeTaskBinding(
  task: AIWorkflowAgentTaskRef,
  identityInput: AIAgentNodeBindingIdentity,
  configInput: AIAgentEffectConfig,
): AIAgentEffectConfig {
  const taskValue = record(task, ['workflowKind', 'workflowRef', 'nodeId', 'agentDefinitionRef'], [], 'task');
  const identityValue = record(identityInput, ['workflowKind', 'workflowRef', 'nodeId'], [], 'identity');
  if (identityValue.workflowKind !== 'AICtrlWorkflow' && identityValue.workflowKind !== 'AIDataWorkflow') fail('AI_AGENT_TASK_WORKFLOW_KIND_INVALID', 'identity.workflowKind', 'Unsupported AI workflow kind.');
  const identity = {
    workflowKind: identityValue.workflowKind,
    workflowRef: resourceRef(identityValue.workflowRef, 'identity.workflowRef'),
    nodeId: identityValue.nodeId,
  } as const;
  const config = normalizeAIAgentEffectConfig(configInput);
  if (taskValue.workflowKind !== identity.workflowKind) fail('AI_AGENT_TASK_WORKFLOW_KIND_MISMATCH', 'task.workflowKind', 'Frozen task workflow kind differs from the node.');
  if (resourceRef(taskValue.workflowRef, 'task.workflowRef') !== identity.workflowRef) fail('AI_AGENT_TASK_WORKFLOW_REF_MISMATCH', 'task.workflowRef', 'Frozen task workflow identity differs from the node.');
  if (identityValue.nodeId !== taskValue.nodeId) fail('AI_AGENT_TASK_NODE_ID_MISMATCH', 'task.nodeId', 'Frozen task node identity differs from the node.');
  if (resourceRef(taskValue.agentDefinitionRef, 'task.agentDefinitionRef') !== config.agentDefinitionRef) fail('AI_AGENT_TASK_DEFINITION_MISMATCH', 'config.agentDefinitionRef', 'Frozen task Agent definition differs from config.');
  return config;
}

export function normalizeAIAgentInvocation<Input extends FlowClosedValue = FlowClosedValue>(value: unknown, location = 'invocation'): AIAgentInvocation<Input> {
  const input = record(value, ['kind', 'payload'], ['metadata'], location);
  if (input.kind !== 'ai.agent') fail('AI_AGENT_INVOCATION_KIND_INVALID', `${location}.kind`, 'Invocation kind must be ai.agent.');
  return Object.freeze({
    kind: 'ai.agent',
    payload: normalizeFlowClosedValue(input.payload, `${location}.payload`) as Input,
    ...(Object.prototype.hasOwnProperty.call(input, 'metadata') ? { metadata: safeOpaqueObject(input.metadata, `${location}.metadata`) } : {}),
  });
}

function normalizeInstance(value: unknown, id: string, location: string): AIAgentInstanceReference {
  const input = record(value, ['authority', 'instanceId', 'agentDefinitionRef'], ['instanceName', 'sessionId', 'metadata'], location);
  const instanceId = identity(input.instanceId, `${location}.instanceId`);
  if (instanceId !== id) fail('AI_AGENT_INSTANCE_ID_INDEX_MISMATCH', `${location}.instanceId`, 'Instance id must equal its index key.');
  return Object.freeze({
    authority: identity(input.authority, `${location}.authority`),
    instanceId,
    agentDefinitionRef: resourceRef(input.agentDefinitionRef, `${location}.agentDefinitionRef`),
    ...(Object.prototype.hasOwnProperty.call(input, 'instanceName') ? { instanceName: identity(input.instanceName, `${location}.instanceName`) } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'sessionId') ? { sessionId: identity(input.sessionId, `${location}.sessionId`) } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'metadata') ? { metadata: safeOpaqueObject(input.metadata, `${location}.metadata`) } : {}),
  });
}

function normalizeReceipt(value: unknown, key: string, instances: Readonly<Record<string, AIAgentInstanceReference>>, location: string): AIAgentInvocationReceipt {
  const input = record(value, ['invocationKey', 'nodeId', 'status', 'mode', 'agentDefinitionRef', 'input', 'semanticFacts'], ['instanceName', 'instanceId', 'generation', 'metadata', 'output', 'hostReceipt'], location);
  const invocationKey = identity(input.invocationKey, `${location}.invocationKey`);
  if (invocationKey !== key) fail('AI_AGENT_INVOCATION_KEY_INDEX_MISMATCH', `${location}.invocationKey`, 'Invocation key must equal its index key.');
  if (input.status !== 'pending' && input.status !== 'completed') fail('AI_AGENT_INVOCATION_STATUS_INVALID', `${location}.status`, 'Status must be pending or completed.');
  if (input.mode !== 'new' && input.mode !== 'targeted') fail('AI_AGENT_INVOCATION_MODE_INVALID', `${location}.mode`, 'Mode must be new or targeted.');
  const instanceId = Object.prototype.hasOwnProperty.call(input, 'instanceId') ? identity(input.instanceId, `${location}.instanceId`) : undefined;
  if (input.mode === 'targeted' && instanceId === undefined) fail('AI_AGENT_TARGETED_INSTANCE_REQUIRED', location, 'Targeted invocation requires an instance id.');
  if (input.status === 'completed' && (instanceId === undefined || instances[instanceId] === undefined || !Object.prototype.hasOwnProperty.call(input, 'output'))) {
    fail('AI_AGENT_COMPLETED_INVOCATION_INCOMPLETE', location, 'Completed invocation requires an indexed instance and output.');
  }
  const agentDefinitionRef = resourceRef(input.agentDefinitionRef, `${location}.agentDefinitionRef`);
  if (instanceId !== undefined && instances[instanceId] !== undefined
    && instances[instanceId].agentDefinitionRef !== agentDefinitionRef) {
    fail('AI_AGENT_RECEIPT_DEFINITION_MISMATCH', `${location}.agentDefinitionRef`, 'Invocation receipt definition must equal its indexed instance definition.');
  }
  if (instanceId !== undefined && instances[instanceId] !== undefined) {
    const receiptName = Object.prototype.hasOwnProperty.call(input, 'instanceName')
      ? identity(input.instanceName, `${location}.instanceName`)
      : undefined;
    if (receiptName !== instances[instanceId].instanceName) {
      fail('AI_AGENT_RECEIPT_INSTANCE_NAME_MISMATCH', `${location}.instanceName`, 'Invocation receipt name must equal its indexed instance name.');
    }
  }
  if (Object.prototype.hasOwnProperty.call(input, 'generation') && (typeof input.generation !== 'number' || !Number.isSafeInteger(input.generation) || input.generation < 0)) {
    fail('AI_AGENT_GENERATION_INVALID', `${location}.generation`, 'Generation must be a non-negative safe integer.');
  }
  return Object.freeze({
    invocationKey,
    nodeId: identity(input.nodeId, `${location}.nodeId`),
    status: input.status,
    mode: input.mode,
    agentDefinitionRef,
    input: normalizeFlowClosedValue(input.input, `${location}.input`),
    semanticFacts: safeOpaqueObject(input.semanticFacts, `${location}.semanticFacts`),
    ...(Object.prototype.hasOwnProperty.call(input, 'instanceName') ? { instanceName: identity(input.instanceName, `${location}.instanceName`) } : {}),
    ...(instanceId === undefined ? {} : { instanceId }),
    ...(Object.prototype.hasOwnProperty.call(input, 'generation') ? { generation: input.generation as number } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'metadata') ? { metadata: safeOpaqueObject(input.metadata, `${location}.metadata`) } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'output') ? { output: normalizeFlowClosedValue(input.output, `${location}.output`) } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'hostReceipt') ? { hostReceipt: safeOpaqueObject(input.hostReceipt, `${location}.hostReceipt`) } : {}),
  });
}

export function normalizeCanonicalAIAgentState(value: unknown, location = 'ai'): AIWorkflowProfileDurableState {
  const input = record(value, ['schemaVersion', 'instancesById', 'instanceIdByName', 'invocationsByKey'], [], location);
  if (input.schemaVersion !== 'depa.ai-agent-state/v1') fail('AI_AGENT_STATE_SCHEMA_UNSUPPORTED', `${location}.schemaVersion`, 'Unsupported Agent state schema.');
  const instanceValues = objectMap(input.instancesById, `${location}.instancesById`);
  const instancesById: Record<string, AIAgentInstanceReference> = {};
  for (const id of Object.keys(instanceValues).sort(compareCodeUnits)) instancesById[identity(id, `${location}.instancesById`)] = normalizeInstance(instanceValues[id], id, `${location}.instancesById.${id}`);
  const nameValues = objectMap(input.instanceIdByName, `${location}.instanceIdByName`);
  const instanceIdByName: Record<string, string> = {};
  const seenIds = new Set<string>();
  for (const rawName of Object.keys(nameValues).sort(compareCodeUnits)) {
    const name = identity(rawName, `${location}.instanceIdByName`);
    const id = identity(nameValues[name], `${location}.instanceIdByName.${name}`);
    if (!instancesById[id] || instancesById[id].instanceName !== name) fail('AI_AGENT_INSTANCE_NAME_INDEX_MISMATCH', `${location}.instanceIdByName.${name}`, 'Name index must be reciprocal.');
    if (seenIds.has(id)) fail('AI_AGENT_INSTANCE_NAME_DUPLICATE', `${location}.instanceIdByName.${name}`, 'One instance cannot have multiple names.');
    seenIds.add(id);
    instanceIdByName[name] = id;
  }
  for (const instance of Object.values(instancesById)) if (instance.instanceName !== undefined && instanceIdByName[instance.instanceName] !== instance.instanceId) fail('AI_AGENT_INSTANCE_NAME_INDEX_MISSING', `${location}.instancesById.${instance.instanceId}.instanceName`, 'Named instance requires reciprocal index.');
  const receiptValues = objectMap(input.invocationsByKey, `${location}.invocationsByKey`);
  const invocationsByKey: Record<string, AIAgentInvocationReceipt> = {};
  const reservations = new Set<string>();
  for (const key of Object.keys(receiptValues).sort(compareCodeUnits)) {
    const receipt = normalizeReceipt(receiptValues[key], identity(key, `${location}.invocationsByKey`), instancesById, `${location}.invocationsByKey.${key}`);
    if (receipt.status === 'pending' && receipt.mode === 'new' && receipt.instanceName !== undefined) {
      if (reservations.has(receipt.instanceName) || instanceIdByName[receipt.instanceName] !== undefined) fail('AI_AGENT_INSTANCE_NAME_RESERVED', `${location}.invocationsByKey.${key}.instanceName`, 'Name has another accepted binding or reservation.');
      reservations.add(receipt.instanceName);
    }
    invocationsByKey[key] = receipt;
  }
  return Object.freeze({ schemaVersion: 'depa.ai-agent-state/v1', instancesById: Object.freeze(instancesById), instanceIdByName: Object.freeze(instanceIdByName), invocationsByKey: Object.freeze(invocationsByKey) });
}

export function upgradeLegacyAIWorkflowProfileDurableState(value: LegacyAIWorkflowProfileDurableState, agentDefinitionRefs: Readonly<Record<string, `resource://${string}`>>, location = 'legacyAI'): AIWorkflowProfileDurableState {
  const input = record(value, ['externalRuntimeRefs', 'receipts'], [], location);
  const refs = objectMap(input.externalRuntimeRefs, `${location}.externalRuntimeRefs`);
  const instancesById: Record<string, AIAgentInstanceReference> = {};
  const instanceIdByName: Record<string, string> = {};
  for (const name of Object.keys(refs).sort(compareCodeUnits)) {
    const refLocation = `${location}.externalRuntimeRefs.${name}`;
    const ref = record(refs[name], ['authority', 'instanceId'], ['sessionId', 'metadata'], refLocation);
    const instanceId = identity(ref.instanceId, `${refLocation}.instanceId`);
    if (instancesById[instanceId]) fail('AI_AGENT_LEGACY_INSTANCE_DUPLICATE', refLocation, 'Legacy instance id is not unique.');
    const agentDefinitionRef = agentDefinitionRefs[name];
    if (!agentDefinitionRef) fail('AI_AGENT_LEGACY_DEFINITION_REQUIRED', refLocation, 'Explicit Agent definition is required for legacy upgrade.');
    instanceIdByName[name] = instanceId;
    instancesById[instanceId] = { authority: identity(ref.authority, `${refLocation}.authority`), instanceId, instanceName: identity(name, refLocation), agentDefinitionRef: resourceRef(agentDefinitionRef, `${refLocation}.agentDefinitionRef`), ...(Object.prototype.hasOwnProperty.call(ref, 'sessionId') ? { sessionId: identity(ref.sessionId, `${refLocation}.sessionId`) } : {}), ...(Object.prototype.hasOwnProperty.call(ref, 'metadata') ? { metadata: optionalClosedObject(ref.metadata, `${refLocation}.metadata`) } : {}) };
  }
  if (!Array.isArray(input.receipts)) fail('AI_AGENT_ARRAY_REQUIRED', `${location}.receipts`, 'Expected receipts array.');
  const invocationsByKey: Record<string, AIAgentInvocationReceipt> = {};
  input.receipts.forEach((item, index) => {
    const receiptLocation = `${location}.receipts[${index}]`;
    const receipt = record(item, ['nodeId', 'externalRuntimeRef'], ['metadata'], receiptLocation);
    const nodeId = identity(receipt.nodeId, `${receiptLocation}.nodeId`);
    const name = identity(receipt.externalRuntimeRef, `${receiptLocation}.externalRuntimeRef`);
    const instanceId = instanceIdByName[name];
    if (!instanceId) fail('AI_WORKFLOW_EXTERNAL_RUNTIME_REF_UNKNOWN', `${receiptLocation}.externalRuntimeRef`, 'Legacy receipt reference is unknown.');
    const key = `${nodeId}#legacy-${index + 1}`;
    invocationsByKey[key] = { invocationKey: key, nodeId, status: 'completed', mode: 'targeted', agentDefinitionRef: instancesById[instanceId]!.agentDefinitionRef, instanceId, instanceName: name, input: null, semanticFacts: {}, output: null, ...(Object.prototype.hasOwnProperty.call(receipt, 'metadata') ? { metadata: safeOpaqueObject(receipt.metadata, `${receiptLocation}.metadata`) } : {}) };
  });
  return normalizeCanonicalAIAgentState({ schemaVersion: 'depa.ai-agent-state/v1', instancesById, instanceIdByName, invocationsByKey }, location);
}
