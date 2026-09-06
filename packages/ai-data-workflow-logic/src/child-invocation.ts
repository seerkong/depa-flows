import type {
  AIDataWorkflowAutonomousSubFlowBinding,
  AIDataWorkflowChildFreezeReceipt,
  AIDataWorkflowChildInvocationIdentity,
  AIDataWorkflowChildInvocationObservation,
  AIDataWorkflowChildTerminalReceipt,
  AIDataWorkflowRunGraph,
} from 'ai-data-workflow-contract';
import { AI_DATA_CHILD_INVOCATION_SCHEMA_VERSION } from 'ai-data-workflow-contract';
import { normalizeFlowClosedObject } from 'ai-workflow-logic';

export class AIDataWorkflowChildInvocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AIDataWorkflowChildInvocationError';
  }
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

const compareCodeUnits = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

function record(value: unknown, keys: readonly string[], location: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AIDataWorkflowChildInvocationError(`${location} must be an object.`);
  }
  const input = value as Readonly<Record<string, unknown>>;
  const actual = Object.keys(input).sort(compareCodeUnits);
  const expected = [...keys].sort(compareCodeUnits);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new AIDataWorkflowChildInvocationError(`${location} fields are invalid.`);
  }
  return input;
}

function nonEmpty(value: unknown, location: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new AIDataWorkflowChildInvocationError(`${location} must be a non-empty string.`);
  }
  return value;
}

function prefixed(value: unknown, prefix: string, location: string): string {
  const normalized = nonEmpty(value, location);
  if (!normalized.startsWith(prefix) || normalized.length === prefix.length) {
    throw new AIDataWorkflowChildInvocationError(`${location} must start with ${prefix}.`);
  }
  return normalized;
}

function schema(value: unknown, location: string): void {
  if (value !== AI_DATA_CHILD_INVOCATION_SCHEMA_VERSION) {
    throw new AIDataWorkflowChildInvocationError(`${location} uses an unsupported schema version.`);
  }
}

function normalizeSubflow(value: unknown, location: string): AIDataWorkflowAutonomousSubFlowBinding {
  const input = record(value, [
    'kind', 'schemaVersion', 'capabilityId', 'catalogDigest', 'definitionRef', 'flowRef', 'contractDigest',
  ], location);
  if (input.kind !== 'autonomous' || input.schemaVersion !== 'depa.ai-data-subflow-binding/v1') {
    throw new AIDataWorkflowChildInvocationError(`${location} must be an autonomous subflow binding.`);
  }
  return Object.freeze({
    kind: 'autonomous',
    schemaVersion: 'depa.ai-data-subflow-binding/v1',
    capabilityId: nonEmpty(input.capabilityId, `${location}.capabilityId`),
    catalogDigest: nonEmpty(input.catalogDigest, `${location}.catalogDigest`),
    definitionRef: prefixed(input.definitionRef, 'resource://', `${location}.definitionRef`) as `resource://${string}`,
    flowRef: prefixed(input.flowRef, 'eager-data-flow://', `${location}.flowRef`) as `eager-data-flow://${string}`,
    contractDigest: nonEmpty(input.contractDigest, `${location}.contractDigest`),
  });
}

function sameSubflow(
  left: AIDataWorkflowAutonomousSubFlowBinding,
  right: AIDataWorkflowAutonomousSubFlowBinding,
): boolean {
  return left.kind === right.kind
    && left.schemaVersion === right.schemaVersion
    && left.capabilityId === right.capabilityId
    && left.catalogDigest === right.catalogDigest
    && left.definitionRef === right.definitionRef
    && left.flowRef === right.flowRef
    && left.contractDigest === right.contractDigest;
}

export function createAIDataWorkflowChildInvocationIdentity(input: {
  readonly graph: AIDataWorkflowRunGraph;
  readonly parentInstanceId: string;
  readonly nodeId: string;
}): AIDataWorkflowChildInvocationIdentity {
  const node = input.graph.nodes[input.nodeId];
  if (!node || node.tag !== 'SubFlowNode' || node.subflow?.kind !== 'autonomous') {
    throw new AIDataWorkflowChildInvocationError(
      `AI Data Workflow node ${input.nodeId} is not an autonomous SubFlowNode.`,
    );
  }
  const canonical = JSON.stringify([
    input.parentInstanceId,
    input.graph.runId,
    node.id,
    node.generation,
    node.subflow.capabilityId,
    node.subflow.catalogDigest,
    node.subflow.definitionRef,
    node.subflow.flowRef,
    node.subflow.contractDigest,
  ]);
  const suffix = fnv1a64(canonical);
  return normalizeAIDataWorkflowChildInvocationIdentity({
    schemaVersion: AI_DATA_CHILD_INVOCATION_SCHEMA_VERSION,
    invocationKey: `ai-data-child:${suffix}`,
    parentInstanceId: input.parentInstanceId,
    parentRunId: input.graph.runId,
    parentNodeId: node.id,
    parentGeneration: node.generation,
    childInstanceId: `${input.parentInstanceId}--child-${suffix}`,
    childRunId: `${input.graph.runId}--child-${suffix}`,
    subflow: node.subflow,
  });
}

/** Pure parent-side reservation. A differing winner is rejected; an exact retry is idempotent. */
export function reserveAIDataWorkflowChildInvocation(input: {
  readonly graph: AIDataWorkflowRunGraph;
  readonly identity: AIDataWorkflowChildInvocationIdentity;
}): AIDataWorkflowRunGraph {
  const identity = normalizeAIDataWorkflowChildInvocationIdentity(input.identity);
  const node = input.graph.nodes[identity.parentNodeId];
  if (!node || node.tag !== 'SubFlowNode' || node.subflow?.kind !== 'autonomous') {
    throw new AIDataWorkflowChildInvocationError(
      `AI Data Workflow node ${identity.parentNodeId} is not an autonomous SubFlowNode.`,
    );
  }
  if (input.graph.runId !== identity.parentRunId || node.generation !== identity.parentGeneration
    || !sameSubflow(node.subflow, identity.subflow)) {
    throw new AIDataWorkflowChildInvocationError('Child invocation reservation does not match the current parent generation.');
  }
  if (node.status === 'Succeeded' || node.status === 'Failed' || node.status === 'Reused' || node.status === 'Removed') {
    throw new AIDataWorkflowChildInvocationError(`Cannot reserve a child for terminal node ${node.id}.`);
  }
  if (node.childInvocation) {
    const current = normalizeAIDataWorkflowChildInvocationIdentity(node.childInvocation);
    if (JSON.stringify(current) !== JSON.stringify(identity)) {
      throw new AIDataWorkflowChildInvocationError(`Node ${node.id} already reserved another child invocation.`);
    }
    return input.graph;
  }
  return Object.freeze({
    ...input.graph,
    nodes: Object.freeze({
      ...input.graph.nodes,
      [node.id]: Object.freeze({
        ...node,
        status: 'Running' as const,
        childInvocation: identity,
      }),
    }),
  });
}

export function recordAIDataWorkflowChildFreezeReceipt(input: {
  readonly graph: AIDataWorkflowRunGraph;
  readonly nodeId: string;
  readonly receipt: AIDataWorkflowChildFreezeReceipt;
}): AIDataWorkflowRunGraph {
  const node = input.graph.nodes[input.nodeId];
  if (!node?.childInvocation) {
    throw new AIDataWorkflowChildInvocationError(`Node ${input.nodeId} has no reserved child invocation.`);
  }
  const receipt = normalizeAIDataWorkflowChildFreezeReceipt(input.receipt, node.childInvocation);
  if (node.childFreezeReceipt) {
    if (JSON.stringify(node.childFreezeReceipt) === JSON.stringify(receipt)) return input.graph;
    throw new AIDataWorkflowChildInvocationError(`Node ${input.nodeId} already froze another child definition.`);
  }
  return Object.freeze({
    ...input.graph,
    nodes: Object.freeze({
      ...input.graph.nodes,
      [node.id]: Object.freeze({ ...node, childFreezeReceipt: receipt }),
    }),
  });
}

/** Accepts an immutable child terminal receipt as the exact parent node settlement. */
export function acceptAIDataWorkflowChildTerminalReceipt(input: {
  readonly graph: AIDataWorkflowRunGraph;
  readonly nodeId: string;
  readonly receipt: AIDataWorkflowChildTerminalReceipt;
}): AIDataWorkflowRunGraph {
  const node = input.graph.nodes[input.nodeId];
  if (!node?.childInvocation || !node.childFreezeReceipt) {
    throw new AIDataWorkflowChildInvocationError(`Node ${input.nodeId} is not frozen for child settlement.`);
  }
  const receipt = normalizeAIDataWorkflowChildTerminalReceipt(input.receipt, node.childInvocation);
  if (node.childTerminalReceipt) {
    if (JSON.stringify(node.childTerminalReceipt) === JSON.stringify(receipt)) return input.graph;
    throw new AIDataWorkflowChildInvocationError(`Node ${input.nodeId} already accepted another child terminal receipt.`);
  }
  if (node.status !== 'Running') {
    throw new AIDataWorkflowChildInvocationError(`Node ${input.nodeId} must be Running before child settlement.`);
  }
  if (receipt.status === 'Succeeded') {
    const expected = [...node.outputs].sort(compareCodeUnits);
    const actual = Object.keys(receipt.output).sort(compareCodeUnits);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new AIDataWorkflowChildInvocationError(`Node ${input.nodeId} child output does not match its FlowContract.`);
    }
  }
  const result = receipt.status === 'Succeeded'
    ? { nodeId: node.id, generation: node.generation, status: 'Succeeded' as const, output: receipt.output }
    : { nodeId: node.id, generation: node.generation, status: 'Failed' as const };
  return Object.freeze({
    ...input.graph,
    nodes: Object.freeze({
      ...input.graph.nodes,
      [node.id]: Object.freeze({
        ...node,
        status: receipt.status,
        result: Object.freeze(result),
        childTerminalReceipt: receipt,
      }),
    }),
    invalidations: Object.freeze(input.graph.invalidations.filter((fact) => fact.nodeId !== node.id)),
  });
}

export function normalizeAIDataWorkflowChildInvocationIdentity(
  value: unknown,
  location = 'childInvocation.identity',
): AIDataWorkflowChildInvocationIdentity {
  const input = record(value, [
    'schemaVersion', 'invocationKey', 'parentInstanceId', 'parentRunId', 'parentNodeId', 'parentGeneration',
    'childInstanceId', 'childRunId', 'subflow',
  ], location);
  schema(input.schemaVersion, `${location}.schemaVersion`);
  if (!Number.isSafeInteger(input.parentGeneration) || Number(input.parentGeneration) < 0) {
    throw new AIDataWorkflowChildInvocationError(`${location}.parentGeneration must be a non-negative safe integer.`);
  }
  return Object.freeze({
    schemaVersion: AI_DATA_CHILD_INVOCATION_SCHEMA_VERSION,
    invocationKey: nonEmpty(input.invocationKey, `${location}.invocationKey`),
    parentInstanceId: nonEmpty(input.parentInstanceId, `${location}.parentInstanceId`),
    parentRunId: nonEmpty(input.parentRunId, `${location}.parentRunId`),
    parentNodeId: nonEmpty(input.parentNodeId, `${location}.parentNodeId`),
    parentGeneration: Number(input.parentGeneration),
    childInstanceId: nonEmpty(input.childInstanceId, `${location}.childInstanceId`),
    childRunId: nonEmpty(input.childRunId, `${location}.childRunId`),
    subflow: normalizeSubflow(input.subflow, `${location}.subflow`),
  });
}

export function normalizeAIDataWorkflowChildFreezeReceipt(
  value: unknown,
  identity: AIDataWorkflowChildInvocationIdentity,
  location = 'childInvocation.freeze',
): AIDataWorkflowChildFreezeReceipt {
  const input = record(value, [
    'schemaVersion', 'invocationKey', 'childInstanceId', 'childRunId', 'definitionRef', 'flowRef',
    'contractDigest', 'definitionRevision', 'definitionDigest',
  ], location);
  schema(input.schemaVersion, `${location}.schemaVersion`);
  const normalized = Object.freeze({
    schemaVersion: AI_DATA_CHILD_INVOCATION_SCHEMA_VERSION,
    invocationKey: nonEmpty(input.invocationKey, `${location}.invocationKey`),
    childInstanceId: nonEmpty(input.childInstanceId, `${location}.childInstanceId`),
    childRunId: nonEmpty(input.childRunId, `${location}.childRunId`),
    definitionRef: prefixed(input.definitionRef, 'resource://', `${location}.definitionRef`) as `resource://${string}`,
    flowRef: prefixed(input.flowRef, 'eager-data-flow://', `${location}.flowRef`) as `eager-data-flow://${string}`,
    contractDigest: nonEmpty(input.contractDigest, `${location}.contractDigest`),
    definitionRevision: nonEmpty(input.definitionRevision, `${location}.definitionRevision`),
    definitionDigest: nonEmpty(input.definitionDigest, `${location}.definitionDigest`),
  });
  assertChildIdentity(normalized, identity, location);
  return normalized;
}

export function normalizeAIDataWorkflowChildInvocationObservation(
  value: unknown,
  identity: AIDataWorkflowChildInvocationIdentity,
  location = 'childInvocation.observation',
): AIDataWorkflowChildInvocationObservation {
  const input = record(value, ['schemaVersion', 'invocationKey', 'childInstanceId', 'childRunId', 'status'], location);
  schema(input.schemaVersion, `${location}.schemaVersion`);
  if (input.status !== 'Reserved' && input.status !== 'Running'
    && input.status !== 'Succeeded' && input.status !== 'Failed') {
    throw new AIDataWorkflowChildInvocationError(`${location}.status is invalid.`);
  }
  const normalized = Object.freeze({
    schemaVersion: AI_DATA_CHILD_INVOCATION_SCHEMA_VERSION,
    invocationKey: nonEmpty(input.invocationKey, `${location}.invocationKey`),
    childInstanceId: nonEmpty(input.childInstanceId, `${location}.childInstanceId`),
    childRunId: nonEmpty(input.childRunId, `${location}.childRunId`),
    status: input.status,
  });
  assertChildIdentity(normalized, identity, location);
  return normalized;
}

export function normalizeAIDataWorkflowChildTerminalReceipt(
  value: unknown,
  identity: AIDataWorkflowChildInvocationIdentity,
  location = 'childInvocation.terminalReceipt',
): AIDataWorkflowChildTerminalReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AIDataWorkflowChildInvocationError(`${location} must be an object.`);
  }
  const status = (value as Readonly<Record<string, unknown>>).status;
  const common = [
    'schemaVersion', 'invocationKey', 'childInstanceId', 'childRunId', 'definitionRef', 'flowRef',
    'contractDigest', 'status', 'receiptDigest',
  ];
  const input = record(value, status === 'Succeeded'
    ? [...common, 'output']
    : status === 'Failed'
      ? [...common, 'failureCode', 'failureMessage']
      : common, location);
  schema(input.schemaVersion, `${location}.schemaVersion`);
  if (status !== 'Succeeded' && status !== 'Failed') {
    throw new AIDataWorkflowChildInvocationError(`${location}.status must be terminal.`);
  }
  const commonResult = {
    schemaVersion: AI_DATA_CHILD_INVOCATION_SCHEMA_VERSION,
    invocationKey: nonEmpty(input.invocationKey, `${location}.invocationKey`),
    childInstanceId: nonEmpty(input.childInstanceId, `${location}.childInstanceId`),
    childRunId: nonEmpty(input.childRunId, `${location}.childRunId`),
    definitionRef: prefixed(input.definitionRef, 'resource://', `${location}.definitionRef`) as `resource://${string}`,
    flowRef: prefixed(input.flowRef, 'eager-data-flow://', `${location}.flowRef`) as `eager-data-flow://${string}`,
    contractDigest: nonEmpty(input.contractDigest, `${location}.contractDigest`),
    receiptDigest: nonEmpty(input.receiptDigest, `${location}.receiptDigest`),
  };
  assertChildIdentity(commonResult, identity, location);
  if (status === 'Succeeded') {
    return Object.freeze({
      ...commonResult,
      status,
      output: normalizeFlowClosedObject(input.output, `${location}.output`),
    });
  }
  return Object.freeze({
    ...commonResult,
    status,
    failureCode: nonEmpty(input.failureCode, `${location}.failureCode`),
    failureMessage: nonEmpty(input.failureMessage, `${location}.failureMessage`),
  });
}

function assertChildIdentity(
  value: Readonly<Record<string, unknown>>,
  identity: AIDataWorkflowChildInvocationIdentity,
  location: string,
): void {
  const expected: Readonly<Record<string, unknown>> = {
    invocationKey: identity.invocationKey,
    childInstanceId: identity.childInstanceId,
    childRunId: identity.childRunId,
    definitionRef: identity.subflow.definitionRef,
    flowRef: identity.subflow.flowRef,
    contractDigest: identity.subflow.contractDigest,
  };
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (value[field] !== undefined && value[field] !== expectedValue) {
      throw new AIDataWorkflowChildInvocationError(`${location}.${field} does not match the reserved child identity.`);
    }
  }
}
