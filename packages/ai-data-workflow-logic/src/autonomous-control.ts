import {
  AI_DATA_CONTROL_SCHEMA_VERSION,
  type AIDataControlAdmission,
  type AIDataControlBudget,
  type AIDataControlBudgetProjection,
  type AIDataControlCapability,
  type AIDataControlCapabilityCatalog,
  type AIDataControlDecision,
  type AIDataControlFeedback,
  type AIDataControlFeedbackCode,
  type AIDataControlGoal,
  type AIDataControlInputBinding,
  type AIDataControlNodeContract,
  type AIDataControlObservation,
  type AIDataControlObservedNode,
  type AIDataControlRevisionOperation,
  type AIDataControlVerifierFact,
  type AIDataWorkflowGraphPatch,
  type AIDataWorkflowGraphPatchOperation,
  type AIDataWorkflowNodeConfig,
  type AIDataWorkflowNodeInputs,
  type AIDataWorkflowRunGraph,
  type AIDataWorkflowRunNode,
} from 'ai-data-workflow-contract';
import type { EagerDataFlowValue } from 'eager-data-flow-contract';

export const AI_DATA_CONTROL_CAPABILITY_ID_CONFIG_KEY = '__aiDataControlCapabilityId' as const;
export const AI_DATA_CONTROL_CATALOG_DIGEST_CONFIG_KEY = '__aiDataControlCatalogDigest' as const;

export class AIDataControlProtocolError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AIDataControlProtocolError';
  }
}

export interface AIDataControlRuntime {
  readonly stableDigest: (value: unknown) => string;
}

export interface FreezeAIDataControlCapabilityCatalogInput {
  readonly schemaVersion: typeof AI_DATA_CONTROL_SCHEMA_VERSION;
  readonly catalogId: string;
  readonly foundationNodes: Readonly<Record<string, AIDataControlNodeContract>>;
  readonly capabilities: Readonly<Record<string, AIDataControlCapability>>;
}

export interface ProjectAIDataControlObservationInput {
  readonly goal: AIDataControlGoal;
  readonly budget: AIDataControlBudget;
  readonly catalog: AIDataControlCapabilityCatalog;
  readonly graph: AIDataWorkflowRunGraph;
  readonly verifier: AIDataControlVerifierFact;
  readonly feedback: readonly AIDataControlFeedback[];
}

export interface ProjectAIDataControlObservationConfig {
  readonly maxObservedNodes: number;
}

export interface AdmitAIDataControlDecisionInput {
  readonly goal: AIDataControlGoal;
  readonly budget: AIDataControlBudget;
  readonly catalog: AIDataControlCapabilityCatalog;
  readonly graph: AIDataWorkflowRunGraph;
  /** Host-owned current verifier fact; observation.verifier is only its projection. */
  readonly verifier: AIDataControlVerifierFact;
  readonly observation: AIDataControlObservation;
  readonly decision: AIDataControlDecision;
}

export interface AIDataControlDecisionLimits {
  readonly maxOperations: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxArrayLength: number;
  readonly maxObjectKeys: number;
  readonly maxStringLength: number;
  readonly maxTotalStringLength: number;
}

export type NormalizeAIDataControlDecisionConfig = Partial<AIDataControlDecisionLimits>;

export interface AdmitAIDataControlDecisionConfig {
  readonly decisionLimits?: NormalizeAIDataControlDecisionConfig;
}

export const AI_DATA_CONTROL_DEFAULT_DECISION_LIMITS = Object.freeze({
  maxOperations: 64,
  maxDepth: 32,
  maxNodes: 4_096,
  maxArrayLength: 256,
  maxObjectKeys: 128,
  maxStringLength: 32_768,
  maxTotalStringLength: 131_072,
} satisfies AIDataControlDecisionLimits);

function fail(code: string, message: string): never {
  throw new AIDataControlProtocolError(code, message);
}

function assertNonEmptyString(value: unknown, location: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail('AI_DATA_CONTROL_INVALID_STRING', `${location} must be a non-empty string.`);
  }
}

function assertNonNegativeInteger(value: unknown, location: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail('AI_DATA_CONTROL_INVALID_INTEGER', `${location} must be a non-negative safe integer.`);
  }
}

function assertPositiveInteger(value: unknown, location: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    fail('AI_DATA_CONTROL_INVALID_INTEGER', `${location} must be a positive safe integer.`);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function stableJson(value: unknown, seen = new Set<object>(), location = '$'): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('AI_DATA_CONTROL_NON_SERIALIZABLE', `${location} must be a finite number.`);
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') {
    fail('AI_DATA_CONTROL_NON_SERIALIZABLE', `${location} contains a non-serializable ${typeof value} value.`);
  }
  if (seen.has(value)) fail('AI_DATA_CONTROL_NON_SERIALIZABLE', `${location} contains a cycle.`);
  if (Object.getOwnPropertySymbols(value).length > 0) {
    fail('AI_DATA_CONTROL_NON_SERIALIZABLE', `${location} must not contain symbol properties.`);
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const extraKeys = Object.keys(value).filter((key) => !/^(0|[1-9][0-9]*)$/.test(key));
      if (extraKeys.length > 0) {
        fail('AI_DATA_CONTROL_NON_SERIALIZABLE', `${location} must not contain named array properties.`);
      }
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          fail('AI_DATA_CONTROL_NON_SERIALIZABLE', `${location} contains a sparse array.`);
        }
      }
      return `[${value.map((item, index) => stableJson(item, seen, `${location}[${index}]`)).join(',')}]`;
    }
    if (!isPlainRecord(value)) {
      fail('AI_DATA_CONTROL_NON_SERIALIZABLE', `${location} must contain only plain records.`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors).sort(compareCodeUnits);
    const parts: string[] = [];
    for (const key of keys) {
      const descriptor = descriptors[key]!;
      if (!descriptor.enumerable) {
        fail('AI_DATA_CONTROL_NON_SERIALIZABLE', `${location}.${key} must be enumerable.`);
      }
      if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        fail('AI_DATA_CONTROL_NON_SERIALIZABLE', `${location}.${key} must be a data property.`);
      }
      parts.push(`${JSON.stringify(key)}:${stableJson(descriptor.value, seen, `${location}.${key}`)}`);
    }
    return `{${parts.join(',')}}`;
  } finally {
    seen.delete(value);
  }
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

function defaultStableDigest(value: unknown): string {
  return `fnv1a64:${fnv1a64(stableJson(value))}`;
}

export function createAIDataControlRuntime(): AIDataControlRuntime {
  return Object.freeze({ stableDigest: defaultStableDigest });
}

function cloneJson<T>(runtime: AIDataControlRuntime, value: T): T {
  runtime.stableDigest(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

function assertSchemaVersion(value: unknown, location: string): void {
  if (value !== AI_DATA_CONTROL_SCHEMA_VERSION) {
    fail('AI_DATA_CONTROL_SCHEMA_VERSION', `${location}.schemaVersion must equal ${AI_DATA_CONTROL_SCHEMA_VERSION}.`);
  }
}

function assertSchemaMap(value: unknown, location: string): asserts value is Readonly<Record<string, string>> {
  if (!isPlainRecord(value)) fail('AI_DATA_CONTROL_SCHEMA_MAP', `${location} must be a plain record.`);
  for (const [port, schemaRef] of Object.entries(value)) {
    assertNonEmptyString(port, `${location} port`);
    assertNonEmptyString(schemaRef, `${location}.${port}`);
  }
}

function assertNodeContract(value: AIDataControlNodeContract, location: string): void {
  if (typeof value.protected !== 'boolean') fail('AI_DATA_CONTROL_NODE_CONTRACT', `${location}.protected must be boolean.`);
  assertSchemaMap(value.inputSchemaRefs, `${location}.inputSchemaRefs`);
  assertSchemaMap(value.outputSchemaRefs, `${location}.outputSchemaRefs`);
}

function assertResourceRef(value: unknown, location: string): void {
  assertNonEmptyString(value, location);
  if (!value.startsWith('resource://') || value.length === 'resource://'.length) {
    fail('AI_DATA_CONTROL_RESOURCE_REF', `${location} must be an exact resource:// reference.`);
  }
}

function assertCapability(capability: AIDataControlCapability, key: string): void {
  assertNonEmptyString(capability.capabilityId, `capabilities.${key}.capabilityId`);
  if (capability.capabilityId !== key) {
    fail('AI_DATA_CONTROL_CAPABILITY_ID', `Capability key ${key} must equal capabilityId ${capability.capabilityId}.`);
  }
  if (capability.tag !== 'TransformNode' && capability.tag !== 'SinkNode') {
    fail('AI_DATA_CONTROL_CAPABILITY_TAG', `Capability ${key} must use TransformNode or SinkNode.`);
  }
  assertNonEmptyString(capability.nodeType, `capabilities.${key}.nodeType`);
  assertSchemaMap(capability.inputSchemaRefs, `capabilities.${key}.inputSchemaRefs`);
  assertSchemaMap(capability.outputSchemaRefs, `capabilities.${key}.outputSchemaRefs`);
  if (!isPlainRecord(capability.fixedConfig)) {
    fail('AI_DATA_CONTROL_CAPABILITY_CONFIG', `Capability ${key} fixedConfig must be a plain record.`);
  }
  if (
    Object.prototype.hasOwnProperty.call(capability.fixedConfig, AI_DATA_CONTROL_CAPABILITY_ID_CONFIG_KEY)
    || Object.prototype.hasOwnProperty.call(capability.fixedConfig, AI_DATA_CONTROL_CATALOG_DIGEST_CONFIG_KEY)
  ) {
    fail('AI_DATA_CONTROL_CAPABILITY_CONFIG', `Capability ${key} fixedConfig uses reserved control keys.`);
  }
  if (capability.implementation.kind === 'code') {
    assertResourceRef(capability.implementation.codeRef, `capabilities.${key}.implementation.codeRef`);
  } else if (capability.implementation.kind === 'agent') {
    assertResourceRef(capability.implementation.agentDefinitionRef, `capabilities.${key}.implementation.agentDefinitionRef`);
    assertResourceRef(capability.implementation.taskProofRef, `capabilities.${key}.implementation.taskProofRef`);
  } else {
    fail('AI_DATA_CONTROL_CAPABILITY_IMPLEMENTATION', `Capability ${key} has an unknown implementation kind.`);
  }
}

export function freezeAIDataControlCapabilityCatalog(
  runtime: AIDataControlRuntime,
  input: FreezeAIDataControlCapabilityCatalogInput,
  _config: Readonly<Record<string, never>>,
): AIDataControlCapabilityCatalog {
  assertSchemaVersion(input.schemaVersion, 'catalog');
  assertNonEmptyString(input.catalogId, 'catalog.catalogId');
  if (!isPlainRecord(input.foundationNodes) || !isPlainRecord(input.capabilities)) {
    fail('AI_DATA_CONTROL_CATALOG', 'Catalog node and capability indexes must be plain records.');
  }
  for (const [nodeId, contract] of Object.entries(input.foundationNodes)) {
    assertNonEmptyString(nodeId, 'catalog foundation node id');
    assertNodeContract(contract, `foundationNodes.${nodeId}`);
  }
  for (const [key, capability] of Object.entries(input.capabilities)) assertCapability(capability, key);
  const normalized = cloneJson(runtime, input);
  const catalog: AIDataControlCapabilityCatalog = {
    ...normalized,
    digest: runtime.stableDigest(normalized),
  };
  return deepFreeze(catalog);
}

function exactRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  location: string,
): Record<string, unknown> {
  if (!isPlainRecord(value)) fail('AI_DATA_CONTROL_DECISION_SHAPE', `${location} must be a plain record.`);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail('AI_DATA_CONTROL_DECISION_SHAPE', `${location}.${key} is not allowed.`);
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      fail('AI_DATA_CONTROL_DECISION_SHAPE', `${location}.${key} is required.`);
    }
  }
  return value;
}

function resolveDecisionLimits(
  config: NormalizeAIDataControlDecisionConfig,
): AIDataControlDecisionLimits {
  const limits = { ...AI_DATA_CONTROL_DEFAULT_DECISION_LIMITS, ...config };
  for (const [name, value] of Object.entries(limits)) {
    assertPositiveInteger(value, `decisionLimits.${name}`);
  }
  return limits;
}

function assertBoundedDecisionValue(
  value: unknown,
  limits: AIDataControlDecisionLimits,
): void {
  if (isPlainRecord(value)) {
    const rootDescriptors = Object.getOwnPropertyDescriptors(value);
    const kind = rootDescriptors.kind?.value;
    const operations = rootDescriptors.operations?.value;
    if (kind === 'revise' && Array.isArray(operations) && operations.length > limits.maxOperations) {
      fail(
        'AI_DATA_CONTROL_DECISION_LIMIT',
        `decision.operations exceeds the normalization limit ${limits.maxOperations}.`,
      );
    }
  }

  const pending: Array<{ readonly value: unknown; readonly depth: number; readonly location: string }> = [
    { value, depth: 0, location: 'decision' },
  ];
  const seen = new WeakSet<object>();
  let nodeCount = 0;
  let totalStringLength = 0;

  while (pending.length > 0) {
    const current = pending.pop()!;
    nodeCount += 1;
    if (nodeCount > limits.maxNodes) {
      fail('AI_DATA_CONTROL_DECISION_LIMIT', `decision exceeds ${limits.maxNodes} JSON values.`);
    }
    if (current.depth > limits.maxDepth) {
      fail('AI_DATA_CONTROL_DECISION_LIMIT', `decision exceeds depth ${limits.maxDepth}.`);
    }
    if (typeof current.value === 'string') {
      if (current.value.length > limits.maxStringLength) {
        fail('AI_DATA_CONTROL_DECISION_LIMIT', `${current.location} exceeds ${limits.maxStringLength} characters.`);
      }
      totalStringLength += current.value.length;
      if (totalStringLength > limits.maxTotalStringLength) {
        fail(
          'AI_DATA_CONTROL_DECISION_LIMIT',
          `decision exceeds ${limits.maxTotalStringLength} total string characters.`,
        );
      }
      continue;
    }
    if (current.value === null || typeof current.value === 'boolean') continue;
    if (typeof current.value === 'number') {
      if (!Number.isFinite(current.value)) {
        fail('AI_DATA_CONTROL_NON_SERIALIZABLE', `${current.location} must be a finite number.`);
      }
      continue;
    }
    if (typeof current.value !== 'object') {
      fail(
        'AI_DATA_CONTROL_NON_SERIALIZABLE',
        `${current.location} contains a non-serializable ${typeof current.value} value.`,
      );
    }
    if (seen.has(current.value)) {
      fail('AI_DATA_CONTROL_NON_SERIALIZABLE', `${current.location} contains a cycle or shared object.`);
    }
    seen.add(current.value);
    if (Object.getOwnPropertySymbols(current.value).length > 0) {
      fail('AI_DATA_CONTROL_NON_SERIALIZABLE', `${current.location} must not contain symbol properties.`);
    }

    const descriptors = Object.getOwnPropertyDescriptors(current.value);
    if (Array.isArray(current.value)) {
      if (current.value.length > limits.maxArrayLength) {
        fail(
          'AI_DATA_CONTROL_DECISION_LIMIT',
          `${current.location} exceeds array length ${limits.maxArrayLength}.`,
        );
      }
      for (let index = 0; index < current.value.length; index += 1) {
        const descriptor = descriptors[index];
        if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
          fail('AI_DATA_CONTROL_NON_SERIALIZABLE', `${current.location}[${index}] must be a dense data property.`);
        }
        pending.push({
          value: descriptor.value,
          depth: current.depth + 1,
          location: `${current.location}[${index}]`,
        });
      }
      const namedKeys = Object.keys(descriptors).filter((key) => key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key));
      if (namedKeys.length > 0) {
        fail('AI_DATA_CONTROL_NON_SERIALIZABLE', `${current.location} contains named array properties.`);
      }
      continue;
    }

    if (!isPlainRecord(current.value)) {
      fail('AI_DATA_CONTROL_NON_SERIALIZABLE', `${current.location} must contain only plain records.`);
    }
    const keys = Object.keys(descriptors);
    if (keys.length > limits.maxObjectKeys) {
      fail(
        'AI_DATA_CONTROL_DECISION_LIMIT',
        `${current.location} exceeds ${limits.maxObjectKeys} object keys.`,
      );
    }
    for (const key of keys) {
      const descriptor = descriptors[key]!;
      if (!descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        fail('AI_DATA_CONTROL_NON_SERIALIZABLE', `${current.location}.${key} must be an enumerable data property.`);
      }
      totalStringLength += key.length;
      if (key.length > limits.maxStringLength || totalStringLength > limits.maxTotalStringLength) {
        fail('AI_DATA_CONTROL_DECISION_LIMIT', `${current.location} contains oversized property names.`);
      }
      pending.push({
        value: descriptor.value,
        depth: current.depth + 1,
        location: `${current.location}.${key}`,
      });
    }
  }
}

function stringField(record: Record<string, unknown>, key: string, location: string): string {
  assertNonEmptyString(record[key], `${location}.${key}`);
  return record[key];
}

function normalizeDependsOn(value: unknown, location: string): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) fail('AI_DATA_CONTROL_DECISION_SHAPE', `${location} must be an array.`);
  return value.map((item, index) => {
    assertNonEmptyString(item, `${location}[${index}]`);
    return item;
  });
}

function normalizeInputBinding(
  runtime: AIDataControlRuntime,
  value: unknown,
  location: string,
): AIDataControlInputBinding {
  if (!isPlainRecord(value)) fail('AI_DATA_CONTROL_DECISION_SHAPE', `${location} must be a plain record.`);
  if (value.kind === 'port') {
    const record = exactRecord(value, ['kind', 'nodeId', 'port', 'schemaRef'], [], location);
    return {
      kind: 'port',
      nodeId: stringField(record, 'nodeId', location),
      port: stringField(record, 'port', location),
      schemaRef: stringField(record, 'schemaRef', location),
    };
  }
  if (value.kind === 'literal') {
    const record = exactRecord(value, ['kind', 'schemaRef', 'value'], [], location);
    runtime.stableDigest(record.value);
    return {
      kind: 'literal',
      schemaRef: stringField(record, 'schemaRef', location),
      value: cloneLiteral(record.value as EagerDataFlowValue),
    };
  }
  fail('AI_DATA_CONTROL_DECISION_SHAPE', `${location}.kind must be port or literal.`);
}

function normalizeInputs(
  runtime: AIDataControlRuntime,
  value: unknown,
  location: string,
): Readonly<Record<string, AIDataControlInputBinding>> {
  if (!isPlainRecord(value)) fail('AI_DATA_CONTROL_DECISION_SHAPE', `${location} must be a plain record.`);
  return Object.fromEntries(Object.entries(value).map(([port, binding]) => {
    assertNonEmptyString(port, `${location} port`);
    return [port, normalizeInputBinding(runtime, binding, `${location}.${port}`)];
  }));
}

function normalizeRevisionOperation(
  runtime: AIDataControlRuntime,
  value: unknown,
  index: number,
): AIDataControlRevisionOperation {
  const location = `decision.operations[${index}]`;
  if (!isPlainRecord(value)) fail('AI_DATA_CONTROL_DECISION_SHAPE', `${location} must be a plain record.`);
  if (value.op === 'remove-node') {
    const record = exactRecord(value, ['op', 'nodeId'], [], location);
    return { op: 'remove-node', nodeId: stringField(record, 'nodeId', location) };
  }
  if (value.op === 'add-capability' || value.op === 'rewire-capability') {
    const record = exactRecord(value, ['op', 'nodeId', 'capabilityId', 'inputs'], ['dependsOn'], location);
    const dependsOn = normalizeDependsOn(record.dependsOn, `${location}.dependsOn`);
    return {
      op: value.op,
      nodeId: stringField(record, 'nodeId', location),
      capabilityId: stringField(record, 'capabilityId', location),
      inputs: normalizeInputs(runtime, record.inputs, `${location}.inputs`),
      ...(dependsOn === undefined ? {} : { dependsOn }),
    };
  }
  fail('AI_DATA_CONTROL_DECISION_SHAPE', `${location}.op is unsupported.`);
}

const DECISION_BASE_FIELDS = [
  'schemaVersion',
  'kind',
  'decisionId',
  'goalId',
  'observationId',
  'observationDigest',
  'catalogDigest',
  'reason',
] as const;

function normalizedDecisionBase(record: Record<string, unknown>): {
  readonly schemaVersion: typeof AI_DATA_CONTROL_SCHEMA_VERSION;
  readonly decisionId: string;
  readonly goalId: string;
  readonly observationId: string;
  readonly observationDigest: string;
  readonly catalogDigest: string;
  readonly reason: string;
} {
  assertSchemaVersion(record.schemaVersion, 'decision');
  return {
    schemaVersion: AI_DATA_CONTROL_SCHEMA_VERSION,
    decisionId: stringField(record, 'decisionId', 'decision'),
    goalId: stringField(record, 'goalId', 'decision'),
    observationId: stringField(record, 'observationId', 'decision'),
    observationDigest: stringField(record, 'observationDigest', 'decision'),
    catalogDigest: stringField(record, 'catalogDigest', 'decision'),
    reason: stringField(record, 'reason', 'decision'),
  };
}

export function normalizeAIDataControlDecision(
  runtime: AIDataControlRuntime,
  value: unknown,
  config: NormalizeAIDataControlDecisionConfig,
): AIDataControlDecision {
  assertBoundedDecisionValue(value, resolveDecisionLimits(config));
  runtime.stableDigest(value);
  if (!isPlainRecord(value)) fail('AI_DATA_CONTROL_DECISION_SHAPE', 'decision must be a plain record.');
  if (value.kind === 'revise') {
    const record = exactRecord(value, [...DECISION_BASE_FIELDS, 'operations'], [], 'decision');
    if (!Array.isArray(record.operations)) {
      fail('AI_DATA_CONTROL_DECISION_SHAPE', 'decision.operations must be an array.');
    }
    return deepFreeze({
      ...normalizedDecisionBase(record),
      kind: 'revise',
      operations: record.operations.map((operation, index) => normalizeRevisionOperation(runtime, operation, index)),
    });
  }
  if (value.kind === 'complete') {
    const record = exactRecord(
      value,
      [...DECISION_BASE_FIELDS, 'verifierFactId', 'outputNodeId', 'outputPort', 'outputSchemaRef'],
      [],
      'decision',
    );
    return deepFreeze({
      ...normalizedDecisionBase(record),
      kind: 'complete',
      verifierFactId: stringField(record, 'verifierFactId', 'decision'),
      outputNodeId: stringField(record, 'outputNodeId', 'decision'),
      outputPort: stringField(record, 'outputPort', 'decision'),
      outputSchemaRef: stringField(record, 'outputSchemaRef', 'decision'),
    });
  }
  if (value.kind === 'fail') {
    const record = exactRecord(value, [...DECISION_BASE_FIELDS, 'failureCode'], [], 'decision');
    const failureCode = record.failureCode;
    if (
      failureCode !== 'CONTROLLER_DECLARED_FAILURE'
      && failureCode !== 'GOAL_UNREACHABLE'
      && failureCode !== 'BUDGET_EXHAUSTED'
      && failureCode !== 'NO_PROGRESS'
    ) {
      fail('AI_DATA_CONTROL_DECISION_SHAPE', 'decision.failureCode is unsupported.');
    }
    return deepFreeze({
      ...normalizedDecisionBase(record),
      kind: 'fail',
      failureCode,
    });
  }
  fail('AI_DATA_CONTROL_DECISION_SHAPE', 'decision.kind must be revise, complete or fail.');
}

function catalogContent(catalog: AIDataControlCapabilityCatalog): FreezeAIDataControlCapabilityCatalogInput {
  return {
    schemaVersion: catalog.schemaVersion,
    catalogId: catalog.catalogId,
    foundationNodes: catalog.foundationNodes,
    capabilities: catalog.capabilities,
  };
}

function assertCatalog(runtime: AIDataControlRuntime, catalog: AIDataControlCapabilityCatalog): void {
  const normalized = freezeAIDataControlCapabilityCatalog(runtime, catalogContent(catalog), {});
  if (normalized.digest !== catalog.digest) {
    fail('AI_DATA_CONTROL_CATALOG_DIGEST', 'Catalog digest does not match its frozen content.');
  }
}

function assertGoal(goal: AIDataControlGoal): void {
  assertSchemaVersion(goal.schemaVersion, 'goal');
  assertNonEmptyString(goal.goalId, 'goal.goalId');
  assertNonEmptyString(goal.objective, 'goal.objective');
  assertResourceRef(goal.verifierRef, 'goal.verifierRef');
  assertNonEmptyString(goal.requiredOutputSchemaRef, 'goal.requiredOutputSchemaRef');
}

function assertBudget(budget: AIDataControlBudget): void {
  assertSchemaVersion(budget.schemaVersion, 'budget');
  assertPositiveInteger(budget.limits.maxIterations, 'budget.limits.maxIterations');
  assertPositiveInteger(budget.limits.maxOperationsPerDecision, 'budget.limits.maxOperationsPerDecision');
  assertPositiveInteger(budget.limits.maxNoProgressIterations, 'budget.limits.maxNoProgressIterations');
  if (budget.limits.maxTokens !== undefined) assertPositiveInteger(budget.limits.maxTokens, 'budget.limits.maxTokens');
  if (budget.limits.deadlineEpochMs !== undefined) assertNonNegativeInteger(budget.limits.deadlineEpochMs, 'budget.limits.deadlineEpochMs');
  assertNonNegativeInteger(budget.usage.iteration, 'budget.usage.iteration');
  assertNonNegativeInteger(budget.usage.noProgressIterations, 'budget.usage.noProgressIterations');
  if (budget.usage.tokensUsed !== undefined) assertNonNegativeInteger(budget.usage.tokensUsed, 'budget.usage.tokensUsed');
  if (budget.usage.nowEpochMs !== undefined) assertNonNegativeInteger(budget.usage.nowEpochMs, 'budget.usage.nowEpochMs');
}

function projectBudget(budget: AIDataControlBudget): AIDataControlBudgetProjection {
  return {
    iteration: budget.usage.iteration,
    remainingIterations: Math.max(0, budget.limits.maxIterations - budget.usage.iteration),
    remainingOperations: budget.limits.maxOperationsPerDecision,
    noProgressIterations: budget.usage.noProgressIterations,
    remainingNoProgressIterations: Math.max(
      0,
      budget.limits.maxNoProgressIterations - budget.usage.noProgressIterations,
    ),
    ...(budget.limits.maxTokens === undefined ? {} : {
      remainingTokens: Math.max(0, budget.limits.maxTokens - (budget.usage.tokensUsed ?? 0)),
    }),
    ...(budget.limits.deadlineEpochMs === undefined ? {} : {
      remainingMs: Math.max(0, budget.limits.deadlineEpochMs - (budget.usage.nowEpochMs ?? 0)),
    }),
  };
}

function capabilityIdForNode(node: AIDataWorkflowRunNode): string | undefined {
  const value = node.config[AI_DATA_CONTROL_CAPABILITY_ID_CONFIG_KEY];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function contractForNode(
  node: AIDataWorkflowRunNode,
  catalog: AIDataControlCapabilityCatalog,
): { readonly known: boolean; readonly contract: AIDataControlNodeContract; readonly capabilityId?: string } {
  const foundation = catalog.foundationNodes[node.id];
  if (foundation) return { known: true, contract: foundation };
  const capabilityId = capabilityIdForNode(node);
  const capability = capabilityId === undefined ? undefined : catalog.capabilities[capabilityId];
  if (!capability || node.config[AI_DATA_CONTROL_CATALOG_DIGEST_CONFIG_KEY] !== catalog.digest) {
    return {
      known: false,
      contract: { protected: true, inputSchemaRefs: {}, outputSchemaRefs: {} },
      ...(capabilityId === undefined ? {} : { capabilityId }),
    };
  }
  return {
    known: true,
    capabilityId,
    contract: {
      protected: false,
      inputSchemaRefs: capability.inputSchemaRefs,
      outputSchemaRefs: capability.outputSchemaRefs,
    },
  };
}

function observedNodes(
  graph: AIDataWorkflowRunGraph,
  catalog: AIDataControlCapabilityCatalog,
): readonly AIDataControlObservedNode[] {
  return graph.declarationOrder.map((nodeId) => graph.nodes[nodeId]).filter(
    (node): node is AIDataWorkflowRunNode => node !== undefined,
  ).map((node) => {
    const resolved = contractForNode(node, catalog);
    return {
      nodeId: node.id,
      tag: node.tag,
      nodeType: node.nodeType,
      status: node.status,
      protected: resolved.contract.protected,
      ...(resolved.capabilityId === undefined ? {} : { capabilityId: resolved.capabilityId }),
      dependsOn: [...node.dependsOn],
      inputSchemaRefs: { ...resolved.contract.inputSchemaRefs },
      outputSchemaRefs: { ...resolved.contract.outputSchemaRefs },
    };
  });
}

function observationContent(observation: AIDataControlObservation): Omit<AIDataControlObservation, 'observationDigest'> {
  const { observationDigest: _digest, ...content } = observation;
  return content;
}

function assertVerifier(goal: AIDataControlGoal, graph: AIDataWorkflowRunGraph, verifier: AIDataControlVerifierFact): void {
  assertSchemaVersion(verifier.schemaVersion, 'verifier');
  if (
    verifier.goalId !== goal.goalId
    || verifier.verifierRef !== goal.verifierRef
    || verifier.requiredOutputSchemaRef !== goal.requiredOutputSchemaRef
  ) {
    fail('AI_DATA_CONTROL_VERIFIER', 'Verifier fact does not match the immutable goal contract.');
  }
  if (verifier.graphGeneration !== graph.currentGeneration) {
    fail('AI_DATA_CONTROL_VERIFIER', 'Verifier fact must describe the current canonical graph generation.');
  }
}

export function projectAIDataControlObservation(
  runtime: AIDataControlRuntime,
  input: ProjectAIDataControlObservationInput,
  config: ProjectAIDataControlObservationConfig,
): AIDataControlObservation {
  assertGoal(input.goal);
  assertBudget(input.budget);
  assertCatalog(runtime, input.catalog);
  assertVerifier(input.goal, input.graph, input.verifier);
  assertPositiveInteger(config.maxObservedNodes, 'config.maxObservedNodes');
  const nodes = observedNodes(input.graph, input.catalog);
  if (nodes.length > config.maxObservedNodes) {
    fail(
      'AI_DATA_CONTROL_OBSERVATION_LIMIT',
      `RunGraph has ${nodes.length} nodes, exceeding the observation limit ${config.maxObservedNodes}.`,
    );
  }
  const graphDigest = runtime.stableDigest(input.graph);
  const observationId = `${input.graph.runId}@${input.graph.currentGeneration}:${input.budget.usage.iteration}`;
  const content: Omit<AIDataControlObservation, 'observationDigest'> = {
    schemaVersion: AI_DATA_CONTROL_SCHEMA_VERSION,
    observationId,
    goalId: input.goal.goalId,
    catalogDigest: input.catalog.digest,
    graph: {
      runId: input.graph.runId,
      generation: input.graph.currentGeneration,
      digest: graphDigest,
      nodes,
    },
    verifier: cloneJson(runtime, input.verifier),
    budget: projectBudget(input.budget),
    feedback: cloneJson(runtime, input.feedback),
  };
  return deepFreeze({
    ...content,
    observationDigest: runtime.stableDigest(content),
  });
}

function feedback(
  code: AIDataControlFeedbackCode,
  message: string,
  details: Pick<AIDataControlFeedback, 'operationIndex' | 'nodeId' | 'port'> = {},
): AIDataControlFeedback {
  return { code, message, ...details };
}

function rejected(
  runtime: AIDataControlRuntime,
  decision: AIDataControlDecision,
  items: readonly AIDataControlFeedback[],
  terminal = false,
): AIDataControlAdmission {
  return {
    schemaVersion: AI_DATA_CONTROL_SCHEMA_VERSION,
    kind: 'rejected',
    decisionId: decision.decisionId,
    decisionDigest: runtime.stableDigest(decision),
    feedback: items,
    terminal,
  };
}

function budgetExhaustion(budget: AIDataControlBudget): string | undefined {
  if (budget.usage.iteration >= budget.limits.maxIterations) return 'iteration budget exhausted';
  if (budget.usage.noProgressIterations >= budget.limits.maxNoProgressIterations) return 'no-progress budget exhausted';
  if (
    budget.limits.maxTokens !== undefined
    && (budget.usage.tokensUsed ?? 0) >= budget.limits.maxTokens
  ) return 'token budget exhausted';
  if (
    budget.limits.deadlineEpochMs !== undefined
    && (budget.usage.nowEpochMs ?? 0) >= budget.limits.deadlineEpochMs
  ) return 'deadline budget exhausted';
  return undefined;
}

interface MutableNodeContract {
  readonly known: boolean;
  readonly protected: boolean;
  readonly inputSchemaRefs: Readonly<Record<string, string>>;
  readonly outputSchemaRefs: Readonly<Record<string, string>>;
  readonly removed: boolean;
}

function nodeContracts(
  graph: AIDataWorkflowRunGraph,
  catalog: AIDataControlCapabilityCatalog,
): Map<string, MutableNodeContract> {
  return new Map(Object.values(graph.nodes).map((node) => {
    const resolved = contractForNode(node, catalog);
    return [node.id, {
      known: resolved.known,
      ...resolved.contract,
      removed: node.status === 'Removed',
    }];
  }));
}

function validateInputs(
  runtime: AIDataControlRuntime,
  operation: Extract<AIDataControlRevisionOperation, { op: 'add-capability' | 'rewire-capability' }>,
  capability: AIDataControlCapability,
  contracts: ReadonlyMap<string, MutableNodeContract>,
  operationIndex: number,
): AIDataControlFeedback | undefined {
  const expectedPorts = Object.keys(capability.inputSchemaRefs).sort(compareCodeUnits);
  const actualPorts = Object.keys(operation.inputs).sort(compareCodeUnits);
  if (runtime.stableDigest(expectedPorts) !== runtime.stableDigest(actualPorts)) {
    return feedback(
      'INPUT_CONTRACT_MISMATCH',
      `Capability ${capability.capabilityId} requires exactly inputs ${expectedPorts.join(', ')}.`,
      { operationIndex, nodeId: operation.nodeId },
    );
  }
  for (const port of expectedPorts) {
    const binding = operation.inputs[port]!;
    const expectedSchema = capability.inputSchemaRefs[port]!;
    if (binding.schemaRef !== expectedSchema) {
      return feedback(
        'INPUT_CONTRACT_MISMATCH',
        `Input ${port} schema ${binding.schemaRef} does not match ${expectedSchema}.`,
        { operationIndex, nodeId: operation.nodeId, port },
      );
    }
    if (binding.kind === 'literal') {
      runtime.stableDigest(binding.value);
      continue;
    }
    const source = contracts.get(binding.nodeId);
    if (!source || source.removed || source.outputSchemaRefs[binding.port] !== binding.schemaRef) {
      return feedback(
        'INPUT_CONTRACT_MISMATCH',
        `Input ${port} does not reference an active output with schema ${binding.schemaRef}.`,
        { operationIndex, nodeId: operation.nodeId, port },
      );
    }
  }
  return undefined;
}

function graphInputs(inputs: Readonly<Record<string, AIDataControlInputBinding>>): AIDataWorkflowNodeInputs {
  return Object.fromEntries(Object.entries(inputs).map(([port, binding]) => [port, graphInput(binding)]));
}

function graphInput(binding: AIDataControlInputBinding): AIDataWorkflowNodeInputs[string] {
  if (binding.kind === 'literal') return cloneLiteral(binding.value);
  return {
    ref: `flow-port://#${binding.nodeId}/${binding.port}`,
    nodeId: binding.nodeId,
    port: binding.port,
  };
}

function flowPortBinding(
  value: AIDataWorkflowNodeInputs[string],
): { readonly nodeId: string; readonly port: string } | undefined {
  if (
    !isPlainRecord(value)
    || typeof value.ref !== 'string'
    || !value.ref.startsWith('flow-port://')
    || typeof value.nodeId !== 'string'
    || typeof value.port !== 'string'
  ) return undefined;
  return { nodeId: value.nodeId, port: value.port };
}

function validateCandidatePortContracts(
  runtime: AIDataControlRuntime,
  contracts: ReadonlyMap<string, MutableNodeContract>,
  inputsByNode: ReadonlyMap<string, AIDataWorkflowNodeInputs>,
  changedContractNodeIds: ReadonlySet<string>,
): AIDataControlFeedback | undefined {
  for (const [nodeId, contract] of contracts) {
    if (contract.removed) continue;
    const inputs = inputsByNode.get(nodeId) ?? {};
    if (contract.known) {
      const expectedPorts = Object.keys(contract.inputSchemaRefs).sort(compareCodeUnits);
      const actualPorts = Object.keys(inputs).sort(compareCodeUnits);
      if (runtime.stableDigest(expectedPorts) !== runtime.stableDigest(actualPorts)) {
        return feedback(
          'INPUT_CONTRACT_MISMATCH',
          `Active node ${nodeId} no longer has exactly its declared input ports.`,
          { nodeId },
        );
      }
    }
    for (const [port, value] of Object.entries(inputs)) {
      const source = flowPortBinding(value);
      if (!source) continue;
      const sourceContract = contracts.get(source.nodeId);
      const sourceSchema = sourceContract?.outputSchemaRefs[source.port];
      if (!sourceContract || sourceContract.removed || sourceSchema === undefined) {
        return feedback(
          'INPUT_CONTRACT_MISMATCH',
          `Active node ${nodeId}.${port} references an unavailable output ${source.nodeId}.${source.port}.`,
          { nodeId, port },
        );
      }
      if (!contract.known && changedContractNodeIds.has(source.nodeId)) {
        return feedback(
          'INPUT_CONTRACT_MISMATCH',
          `Active node ${nodeId}.${port} has no frozen contract to validate changed source ${source.nodeId}.`,
          { nodeId, port },
        );
      }
      if (contract.known && contract.inputSchemaRefs[port] !== sourceSchema) {
        return feedback(
          'INPUT_CONTRACT_MISMATCH',
          `Active node ${nodeId}.${port} expects ${contract.inputSchemaRefs[port]} but source provides ${sourceSchema}.`,
          { nodeId, port },
        );
      }
    }
  }
  return undefined;
}

function cloneLiteral(value: EagerDataFlowValue): EagerDataFlowValue {
  return JSON.parse(JSON.stringify(value)) as EagerDataFlowValue;
}

function capabilityConfig(
  capability: AIDataControlCapability,
  catalog: AIDataControlCapabilityCatalog,
): AIDataWorkflowNodeConfig {
  const base: AIDataWorkflowNodeConfig = {
    ...cloneLiteral(capability.fixedConfig) as AIDataWorkflowNodeConfig,
    [AI_DATA_CONTROL_CAPABILITY_ID_CONFIG_KEY]: capability.capabilityId,
    [AI_DATA_CONTROL_CATALOG_DIGEST_CONFIG_KEY]: catalog.digest,
  };
  if (capability.implementation.kind === 'code') {
    return { ...base, src: capability.implementation.codeRef };
  }
  return {
    ...base,
    agent: {
      agentDefinitionRef: capability.implementation.agentDefinitionRef,
      taskProofRef: capability.implementation.taskProofRef,
    },
  };
}

function operationDependencies(
  operation: Extract<AIDataControlRevisionOperation, { op: 'add-capability' | 'rewire-capability' }>,
): readonly string[] {
  return [...new Set([
    ...(operation.dependsOn ?? []),
    ...Object.values(operation.inputs).flatMap((binding) => binding.kind === 'port' ? [binding.nodeId] : []),
  ])].sort(compareCodeUnits);
}

function sameNodeRevision(
  runtime: AIDataControlRuntime,
  node: AIDataWorkflowRunNode,
  operation: Extract<AIDataWorkflowGraphPatchOperation, { op: 'update-node' }>,
): boolean {
  return runtime.stableDigest({
    tag: node.tag,
    nodeType: node.nodeType,
    inputs: node.inputs,
    outputs: node.outputs,
    config: node.config,
    dependsOn: node.dependsOn,
  }) === runtime.stableDigest({
    tag: operation.changes.tag ?? node.tag,
    nodeType: operation.changes.nodeType ?? node.nodeType,
    inputs: operation.changes.inputs ?? node.inputs,
    outputs: operation.changes.outputs ?? node.outputs,
    config: operation.changes.config ?? node.config,
    dependsOn: operation.changes.dependsOn ?? node.dependsOn,
  });
}

function validateObservation(
  runtime: AIDataControlRuntime,
  input: AdmitAIDataControlDecisionInput,
): AIDataControlFeedback | undefined {
  const { observation, decision, graph, catalog, goal } = input;
  if (decision.schemaVersion !== AI_DATA_CONTROL_SCHEMA_VERSION) {
    return feedback('SCHEMA_VERSION_MISMATCH', 'Decision schema version is unsupported.');
  }
  if (decision.goalId !== goal.goalId || observation.goalId !== goal.goalId) {
    return feedback('GOAL_MISMATCH', 'Decision or observation does not match the immutable goal.');
  }
  if (decision.catalogDigest !== catalog.digest || observation.catalogDigest !== catalog.digest) {
    return feedback('CATALOG_MISMATCH', 'Decision or observation does not match the frozen capability catalog.');
  }
  if (
    decision.observationId !== observation.observationId
    || decision.observationDigest !== observation.observationDigest
    || observation.observationDigest !== runtime.stableDigest(observationContent(observation))
    || observation.graph.runId !== graph.runId
    || observation.graph.generation !== graph.currentGeneration
    || observation.graph.digest !== runtime.stableDigest(graph)
    || observation.observationId !== `${graph.runId}@${graph.currentGeneration}:${input.budget.usage.iteration}`
    || runtime.stableDigest(observation.budget) !== runtime.stableDigest(projectBudget(input.budget))
    || runtime.stableDigest(observation.graph.nodes) !== runtime.stableDigest(observedNodes(graph, catalog))
    || runtime.stableDigest(observation.verifier) !== runtime.stableDigest(input.verifier)
    || observation.verifier.schemaVersion !== AI_DATA_CONTROL_SCHEMA_VERSION
    || observation.verifier.goalId !== goal.goalId
    || observation.verifier.graphGeneration !== graph.currentGeneration
    || observation.verifier.verifierRef !== goal.verifierRef
    || observation.verifier.requiredOutputSchemaRef !== goal.requiredOutputSchemaRef
  ) {
    return feedback('STALE_OBSERVATION', 'Decision does not reference the exact current canonical observation.');
  }
  return undefined;
}

function outputContractFeedback(
  observation: AIDataControlObservation,
  decision: Extract<AIDataControlDecision, { kind: 'complete' }>,
  goal: AIDataControlGoal,
): AIDataControlFeedback | undefined {
  if (decision.outputSchemaRef !== goal.requiredOutputSchemaRef) {
    return feedback('OUTPUT_CONTRACT_MISMATCH', 'Completion output schema does not match the goal.', {
      nodeId: decision.outputNodeId,
      port: decision.outputPort,
    });
  }
  const node = observation.graph.nodes.find((candidate) => candidate.nodeId === decision.outputNodeId);
  if (
    !node
    || (node.status !== 'Succeeded' && node.status !== 'Reused')
    || node.outputSchemaRefs[decision.outputPort] !== decision.outputSchemaRef
  ) {
    return feedback('OUTPUT_CONTRACT_MISMATCH', 'Completion does not reference an active output with the required schema.', {
      nodeId: decision.outputNodeId,
      port: decision.outputPort,
    });
  }
  return undefined;
}

export function admitAIDataControlDecision(
  runtime: AIDataControlRuntime,
  input: AdmitAIDataControlDecisionInput,
  config: AdmitAIDataControlDecisionConfig,
): AIDataControlAdmission {
  return admitNormalizedAIDataControlDecision(runtime, {
    ...input,
    decision: normalizeAIDataControlDecision(runtime, input.decision, config.decisionLimits ?? {}),
  });
}

function admitNormalizedAIDataControlDecision(
  runtime: AIDataControlRuntime,
  input: AdmitAIDataControlDecisionInput,
): AIDataControlAdmission {
  assertGoal(input.goal);
  assertBudget(input.budget);
  assertCatalog(runtime, input.catalog);
  assertVerifier(input.goal, input.graph, input.verifier);
  runtime.stableDigest(input.decision);

  const observationProblem = validateObservation(runtime, input);
  if (observationProblem) return rejected(runtime, input.decision, [observationProblem]);

  if (input.decision.kind === 'fail') {
    return {
      schemaVersion: AI_DATA_CONTROL_SCHEMA_VERSION,
      kind: 'fail',
      decisionId: input.decision.decisionId,
      decisionDigest: runtime.stableDigest(input.decision),
      failureCode: input.decision.failureCode,
      reason: input.decision.reason,
    };
  }

  if (input.decision.kind === 'complete') {
    const verifier = input.verifier;
    if (verifier.status !== 'passed') {
      return rejected(runtime, input.decision, [
        feedback('VERIFIER_REQUIRED', 'Completion requires a passing verifier fact for the current graph.'),
      ]);
    }
    if (
      input.decision.verifierFactId !== verifier.factId
      || verifier.goalId !== input.goal.goalId
      || verifier.graphGeneration !== input.graph.currentGeneration
      || verifier.verifierRef !== input.goal.verifierRef
      || verifier.requiredOutputSchemaRef !== input.goal.requiredOutputSchemaRef
    ) {
      return rejected(runtime, input.decision, [
        feedback('VERIFIER_MISMATCH', 'Completion does not reference the exact current verifier fact.'),
      ]);
    }
    const outputProblem = outputContractFeedback(input.observation, input.decision, input.goal);
    if (outputProblem) return rejected(runtime, input.decision, [outputProblem]);
    return {
      schemaVersion: AI_DATA_CONTROL_SCHEMA_VERSION,
      kind: 'complete',
      decisionId: input.decision.decisionId,
      decisionDigest: runtime.stableDigest(input.decision),
      verifierFactId: input.decision.verifierFactId,
      outputNodeId: input.decision.outputNodeId,
      outputPort: input.decision.outputPort,
      outputSchemaRef: input.decision.outputSchemaRef,
    };
  }

  const exhausted = budgetExhaustion(input.budget);
  if (exhausted) {
    return rejected(
      runtime,
      input.decision,
      [feedback('BUDGET_EXHAUSTED', `Cannot revise: ${exhausted}.`)],
      true,
    );
  }
  if (
    input.decision.operations.length < 1
    || input.decision.operations.length > input.budget.limits.maxOperationsPerDecision
  ) {
    return rejected(runtime, input.decision, [
      feedback(
        'INVALID_OPERATION_COUNT',
        `Revision must contain 1..${input.budget.limits.maxOperationsPerDecision} operations.`,
      ),
    ]);
  }

  const targets = new Set<string>();
  for (let index = 0; index < input.decision.operations.length; index += 1) {
    const operation = input.decision.operations[index]!;
    if (targets.has(operation.nodeId)) {
      return rejected(runtime, input.decision, [
        feedback('DUPLICATE_TARGET', `Revision targets ${operation.nodeId} more than once.`, {
          operationIndex: index,
          nodeId: operation.nodeId,
        }),
      ]);
    }
    targets.add(operation.nodeId);
  }

  const contracts = nodeContracts(input.graph, input.catalog);
  const candidateInputs = new Map<string, AIDataWorkflowNodeInputs>(
    Object.values(input.graph.nodes).map((node) => [node.id, node.inputs]),
  );
  const changedContractNodeIds = new Set<string>();
  const patchOperations: AIDataWorkflowGraphPatchOperation[] = [];
  const removed = new Set<string>();

  for (let index = 0; index < input.decision.operations.length; index += 1) {
    const operation = input.decision.operations[index]!;
    const existingContract = contracts.get(operation.nodeId);
    if (operation.op === 'remove-node') {
      if (!existingContract || existingContract.removed) {
        return rejected(runtime, input.decision, [feedback('UNKNOWN_NODE', `Node ${operation.nodeId} is not active.`, {
          operationIndex: index,
          nodeId: operation.nodeId,
        })]);
      }
      if (existingContract.protected) {
        return rejected(runtime, input.decision, [feedback('PROTECTED_NODE', `Node ${operation.nodeId} is protected.`, {
          operationIndex: index,
          nodeId: operation.nodeId,
        })]);
      }
      patchOperations.push({ op: 'remove-node', nodeId: operation.nodeId });
      contracts.set(operation.nodeId, { ...existingContract, removed: true });
      removed.add(operation.nodeId);
      continue;
    }

    if (operation.op === 'add-capability' && existingContract) {
      return rejected(runtime, input.decision, [feedback('INVALID_DECISION', `Node ${operation.nodeId} already exists.`, {
        operationIndex: index,
        nodeId: operation.nodeId,
      })]);
    }
    if (operation.op === 'rewire-capability') {
      if (!existingContract || existingContract.removed) {
        return rejected(runtime, input.decision, [feedback('UNKNOWN_NODE', `Node ${operation.nodeId} is not active.`, {
          operationIndex: index,
          nodeId: operation.nodeId,
        })]);
      }
      if (existingContract.protected) {
        return rejected(runtime, input.decision, [feedback('PROTECTED_NODE', `Node ${operation.nodeId} is protected.`, {
          operationIndex: index,
          nodeId: operation.nodeId,
        })]);
      }
    }

    const capability = input.catalog.capabilities[operation.capabilityId];
    if (!capability) {
      return rejected(runtime, input.decision, [feedback('UNKNOWN_CAPABILITY', `Capability ${operation.capabilityId} is not frozen.`, {
        operationIndex: index,
        nodeId: operation.nodeId,
      })]);
    }
    const inputProblem = validateInputs(runtime, operation, capability, contracts, index);
    if (inputProblem) return rejected(runtime, input.decision, [inputProblem]);
    const dependsOn = operationDependencies(operation);
    for (const dependency of dependsOn) {
      const dependencyContract = contracts.get(dependency);
      if (!dependencyContract || dependencyContract.removed) {
        return rejected(runtime, input.decision, [feedback('UNKNOWN_NODE', `Dependency ${dependency} is not active.`, {
          operationIndex: index,
          nodeId: operation.nodeId,
        })]);
      }
    }
    const nodeFacts = {
      tag: capability.tag,
      nodeType: capability.nodeType,
      inputs: graphInputs(operation.inputs),
      outputs: Object.keys(capability.outputSchemaRefs),
      config: capabilityConfig(capability, input.catalog),
      dependsOn,
    };
    if (operation.op === 'add-capability') {
      patchOperations.push({
        op: 'add-node',
        node: { id: operation.nodeId, ...nodeFacts },
      });
    } else {
      patchOperations.push({
        op: 'update-node',
        nodeId: operation.nodeId,
        changes: nodeFacts,
      });
    }
    contracts.set(operation.nodeId, {
      known: true,
      protected: false,
      inputSchemaRefs: capability.inputSchemaRefs,
      outputSchemaRefs: capability.outputSchemaRefs,
      removed: false,
    });
    candidateInputs.set(operation.nodeId, nodeFacts.inputs);
    changedContractNodeIds.add(operation.nodeId);
  }

  const candidatePortProblem = validateCandidatePortContracts(
    runtime,
    contracts,
    candidateInputs,
    changedContractNodeIds,
  );
  if (candidatePortProblem) return rejected(runtime, input.decision, [candidatePortProblem]);

  for (const node of Object.values(input.graph.nodes)) {
    if (node.status === 'Removed' || removed.has(node.id)) continue;
    const effectiveOperation = patchOperations.find(
      (operation): operation is Extract<AIDataWorkflowGraphPatchOperation, { op: 'update-node' }> => (
        operation.op === 'update-node' && operation.nodeId === node.id
      ),
    );
    const dependencies = effectiveOperation?.changes.dependsOn ?? node.dependsOn;
    if (dependencies.some((dependency) => removed.has(dependency))) {
      return rejected(runtime, input.decision, [feedback(
        'INVALID_DECISION',
        `Active node ${node.id} would retain a dependency on a removed node.`,
        { nodeId: node.id },
      )]);
    }
  }

  for (const operation of patchOperations) {
    if (operation.op === 'remove-node') continue;
    const dependencies = operation.op === 'add-node'
      ? operation.node.dependsOn ?? []
      : operation.changes.dependsOn ?? input.graph.nodes[operation.nodeId]?.dependsOn ?? [];
    if (dependencies.some((dependency) => removed.has(dependency))) {
      return rejected(runtime, input.decision, [feedback(
        'INVALID_DECISION',
        `Node ${operation.op === 'add-node' ? operation.node.id : operation.nodeId} would depend on a removed node.`,
      )]);
    }
  }

  const dependencyGraph = new Map<string, readonly string[]>();
  for (const node of Object.values(input.graph.nodes)) {
    if (node.status !== 'Removed') dependencyGraph.set(node.id, node.dependsOn);
  }
  for (const operation of patchOperations) {
    if (operation.op === 'remove-node') dependencyGraph.delete(operation.nodeId);
    if (operation.op === 'add-node') dependencyGraph.set(operation.node.id, operation.node.dependsOn ?? []);
    if (operation.op === 'update-node') {
      dependencyGraph.set(
        operation.nodeId,
        operation.changes.dependsOn ?? dependencyGraph.get(operation.nodeId) ?? [],
      );
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    visiting.add(nodeId);
    for (const dependency of dependencyGraph.get(nodeId) ?? []) {
      if (!dependencyGraph.has(dependency) || visit(dependency)) return true;
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return false;
  };
  if ([...dependencyGraph.keys()].some(visit)) {
    return rejected(runtime, input.decision, [feedback(
      'INVALID_DECISION',
      'Revision would create a cyclic or unresolved dependency graph.',
    )]);
  }

  if (patchOperations.every((operation) => (
    operation.op === 'update-node'
    && sameNodeRevision(runtime, input.graph.nodes[operation.nodeId]!, operation)
  ))) {
    const terminal = input.budget.usage.noProgressIterations + 1
      >= input.budget.limits.maxNoProgressIterations;
    return rejected(
      runtime,
      input.decision,
      [feedback('NO_PROGRESS', 'Revision does not change the canonical graph.')],
      terminal,
    );
  }

  const patch: AIDataWorkflowGraphPatch = {
    patchId: `control:${input.decision.decisionId}`,
    generation: input.graph.currentGeneration + 1,
    reason: input.decision.reason,
    operations: patchOperations,
  };
  return {
    schemaVersion: AI_DATA_CONTROL_SCHEMA_VERSION,
    kind: 'patch',
    decisionId: input.decision.decisionId,
    decisionDigest: runtime.stableDigest(input.decision),
    patch,
  };
}
