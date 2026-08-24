import type { ImmutableJsonValue, TaskProfileEnvelope } from 'task-manager-contract';
import { canonicalOwnDataClone } from 'task-manager-contract';

export const HOLON_TASK_TARGET_SCHEMA_VERSION = 'ai-workflow.holon-task-target/v1' as const;
export const HOLON_TASK_SNAPSHOT_RECEIPT_SCHEMA_VERSION = 'ai-workflow.holon-task-snapshot-receipt/v1' as const;
export const AI_ORGANIZATION_TASK_PROFILE_KIND = 'depa.ai.organization-task' as const;

export type HolonTaskResourceRef = `resource://${string}`;
export type HolonTaskDigest = `sha256:${string}`;
type ClosedRecord<Shape> = Readonly<Record<string, ImmutableJsonValue>> & Readonly<Shape>;

export type HolonTaskTarget = ClosedRecord<{
  readonly kind: 'holon-task-target';
  readonly schemaVersion: typeof HOLON_TASK_TARGET_SCHEMA_VERSION;
  readonly invocation: ClosedRecord<{
    readonly workflowKind: 'AICtrlWorkflow' | 'AIDataWorkflow';
    readonly workflowRef: HolonTaskResourceRef;
    readonly nodeId: string;
    readonly invocationId: string;
  }>;
  readonly holon: ClosedRecord<{
    readonly rootHolonRef: string;
    readonly effectiveAt: string;
  }>;
  readonly executionBinding: ClosedRecord<{
    readonly ref: HolonTaskResourceRef;
    readonly digest: HolonTaskDigest;
  }>;
  readonly taskSpace: ClosedRecord<{
    readonly profileRef: HolonTaskResourceRef;
    readonly policyRef: HolonTaskResourceRef;
    readonly requiredRoleRefs: readonly string[];
    readonly requiredCapabilityRefs: readonly HolonTaskResourceRef[];
  }>;
  readonly output: ClosedRecord<{
    readonly schemaRef: HolonTaskResourceRef;
    readonly materialPortRefs: readonly HolonTaskResourceRef[];
  }>;
}>;

export type HolonTaskSnapshotReceipt = ClosedRecord<{
  readonly kind: 'holon-task-snapshot-receipt';
  readonly schemaVersion: typeof HOLON_TASK_SNAPSHOT_RECEIPT_SCHEMA_VERSION;
  readonly taskSpaceId: string;
  readonly holonRef: string;
  readonly effectiveAt: string;
  readonly holonSnapshotRef: string;
  readonly holonSnapshotDigest: HolonTaskDigest;
  readonly snapshotArtifactDigest: HolonTaskDigest;
  readonly issuerReceiptId: HolonTaskDigest;
  readonly issuerReceiptArtifactDigest: HolonTaskDigest;
  readonly executionBindingRef: HolonTaskResourceRef;
  readonly executionBindingDigest: HolonTaskDigest;
  readonly eligibleMemberRefs: readonly string[];
  readonly eligibleRoleRefs: readonly string[];
}>;

export type HolonTaskSnapshotAdoptionReceipt = ClosedRecord<{
  readonly kind: 'holon-task-snapshot-adoption-receipt';
  readonly schemaVersion: 'ai-workflow.holon-task-snapshot-adoption-receipt/v1';
  readonly taskSpaceId: string;
  readonly previousTaskId: string;
  readonly successorTaskId: string;
  readonly previousIssuerReceiptId: HolonTaskDigest;
  readonly successorIssuerReceiptId: HolonTaskDigest;
  readonly executionBindingDigest: HolonTaskDigest;
  readonly adoptedAt: string;
}>;

export type AIOrganizationTaskProfileFacts = ClosedRecord<{
  target: HolonTaskTarget;
  snapshotReceipt: HolonTaskSnapshotReceipt;
  assignmentReceipt: null;
  memberRuntimeRef: null;
  settlementReceipt: null;
  snapshotAdoptions: readonly HolonTaskSnapshotAdoptionReceipt[];
}>;

export type AIOrganizationTaskProfile = TaskProfileEnvelope<
  typeof AI_ORGANIZATION_TASK_PROFILE_KIND,
  AIOrganizationTaskProfileFacts
>;

export interface AIWorkflowHolonTaskTargetFreezeReceipt {
  readonly schemaVersion: 'ai-workflow.holon-task-target-freeze/v1';
  readonly target: HolonTaskTarget;
  readonly dependencySnapshot: Readonly<{
    readonly registryRevision: string;
    readonly snapshotRevision: HolonTaskDigest;
    readonly closureResourceIds: readonly string[];
  }>;
  readonly semanticFingerprint: HolonTaskDigest;
}

/** In-memory capability projected only from an authentic target freeze receipt. */
export interface FrozenHolonTaskTarget {
  readonly schemaVersion: 'ai-workflow.frozen-holon-task-target/v1';
  readonly target: HolonTaskTarget;
  readonly semanticFingerprint: HolonTaskDigest;
  readonly snapshotRevision: HolonTaskDigest;
  readonly closureResourceIds: readonly string[];
}

export function holonTaskTargetFromNodeConfig(
  configInput: unknown,
  expected: Readonly<{
    readonly workflowKind: 'AICtrlWorkflow' | 'AIDataWorkflow';
    readonly workflowRef: HolonTaskResourceRef;
    readonly nodeId: string;
  }>,
): HolonTaskTarget | undefined {
  const config = record(canonicalOwnDataClone(configInput), '$config');
  if (!Object.prototype.hasOwnProperty.call(config, 'holonTaskTarget')) return undefined;
  const target = normalizeHolonTaskTarget(config.holonTaskTarget);
  if (target.invocation.workflowKind !== expected.workflowKind
    || target.invocation.workflowRef !== expected.workflowRef
    || target.invocation.nodeId !== expected.nodeId) {
    invalid('$config.holonTaskTarget.invocation', 'Target invocation identity does not match the authored node');
  }
  return target;
}

export class HolonTaskContractError extends Error {
  constructor(readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'HolonTaskContractError';
  }
}

export function normalizeHolonTaskTarget(value: unknown): HolonTaskTarget {
  const root = record(canonicalOwnDataClone(value), '$target');
  exactKeys(root, ['kind', 'schemaVersion', 'invocation', 'holon', 'executionBinding', 'taskSpace', 'output'], '$target');
  exactLiteral(root.kind, 'holon-task-target', '$target.kind');
  exactLiteral(root.schemaVersion, HOLON_TASK_TARGET_SCHEMA_VERSION, '$target.schemaVersion');

  const invocation = record(root.invocation, '$target.invocation');
  exactKeys(invocation, ['workflowKind', 'workflowRef', 'nodeId', 'invocationId'], '$target.invocation');
  const workflowKind = oneOf(invocation.workflowKind, ['AICtrlWorkflow', 'AIDataWorkflow'] as const, '$target.invocation.workflowKind');
  const holon = record(root.holon, '$target.holon');
  exactKeys(holon, ['rootHolonRef', 'effectiveAt'], '$target.holon');
  const executionBinding = record(root.executionBinding, '$target.executionBinding');
  exactKeys(executionBinding, ['ref', 'digest'], '$target.executionBinding');
  const taskSpace = record(root.taskSpace, '$target.taskSpace');
  exactKeys(taskSpace, ['profileRef', 'policyRef', 'requiredRoleRefs', 'requiredCapabilityRefs'], '$target.taskSpace');
  const output = record(root.output, '$target.output');
  exactKeys(output, ['schemaRef', 'materialPortRefs'], '$target.output');

  return Object.freeze({
    kind: 'holon-task-target',
    schemaVersion: HOLON_TASK_TARGET_SCHEMA_VERSION,
    invocation: Object.freeze({
      workflowKind,
      workflowRef: resourceRef(invocation.workflowRef, '$target.invocation.workflowRef'),
      nodeId: exactString(invocation.nodeId, '$target.invocation.nodeId'),
      invocationId: exactString(invocation.invocationId, '$target.invocation.invocationId'),
    }),
    holon: Object.freeze({
      rootHolonRef: exactString(holon.rootHolonRef, '$target.holon.rootHolonRef'),
      effectiveAt: utcInstant(holon.effectiveAt, '$target.holon.effectiveAt'),
    }),
    executionBinding: Object.freeze({
      ref: resourceRef(executionBinding.ref, '$target.executionBinding.ref'),
      digest: digest(executionBinding.digest, '$target.executionBinding.digest'),
    }),
    taskSpace: Object.freeze({
      profileRef: resourceRef(taskSpace.profileRef, '$target.taskSpace.profileRef'),
      policyRef: resourceRef(taskSpace.policyRef, '$target.taskSpace.policyRef'),
      requiredRoleRefs: stringArray(taskSpace.requiredRoleRefs, '$target.taskSpace.requiredRoleRefs'),
      requiredCapabilityRefs: resourceRefArray(taskSpace.requiredCapabilityRefs, '$target.taskSpace.requiredCapabilityRefs'),
    }),
    output: Object.freeze({
      schemaRef: resourceRef(output.schemaRef, '$target.output.schemaRef'),
      materialPortRefs: resourceRefArray(output.materialPortRefs, '$target.output.materialPortRefs'),
    }),
  });
}

export function normalizeHolonTaskSnapshotReceipt(value: unknown): HolonTaskSnapshotReceipt {
  const root = record(canonicalOwnDataClone(value), '$snapshotReceipt');
  exactKeys(root, [
    'kind', 'schemaVersion', 'taskSpaceId', 'holonRef', 'effectiveAt', 'holonSnapshotRef',
    'holonSnapshotDigest', 'snapshotArtifactDigest', 'issuerReceiptId',
    'issuerReceiptArtifactDigest', 'executionBindingRef', 'executionBindingDigest',
    'eligibleMemberRefs', 'eligibleRoleRefs',
  ], '$snapshotReceipt');
  exactLiteral(root.kind, 'holon-task-snapshot-receipt', '$snapshotReceipt.kind');
  exactLiteral(root.schemaVersion, HOLON_TASK_SNAPSHOT_RECEIPT_SCHEMA_VERSION, '$snapshotReceipt.schemaVersion');
  return Object.freeze({
    kind: 'holon-task-snapshot-receipt',
    schemaVersion: HOLON_TASK_SNAPSHOT_RECEIPT_SCHEMA_VERSION,
    taskSpaceId: exactString(root.taskSpaceId, '$snapshotReceipt.taskSpaceId'),
    holonRef: exactString(root.holonRef, '$snapshotReceipt.holonRef'),
    effectiveAt: utcInstant(root.effectiveAt, '$snapshotReceipt.effectiveAt'),
    holonSnapshotRef: exactString(root.holonSnapshotRef, '$snapshotReceipt.holonSnapshotRef'),
    holonSnapshotDigest: digest(root.holonSnapshotDigest, '$snapshotReceipt.holonSnapshotDigest'),
    snapshotArtifactDigest: digest(root.snapshotArtifactDigest, '$snapshotReceipt.snapshotArtifactDigest'),
    issuerReceiptId: digest(root.issuerReceiptId, '$snapshotReceipt.issuerReceiptId'),
    issuerReceiptArtifactDigest: digest(root.issuerReceiptArtifactDigest, '$snapshotReceipt.issuerReceiptArtifactDigest'),
    executionBindingRef: resourceRef(root.executionBindingRef, '$snapshotReceipt.executionBindingRef'),
    executionBindingDigest: digest(root.executionBindingDigest, '$snapshotReceipt.executionBindingDigest'),
    eligibleMemberRefs: stringArray(root.eligibleMemberRefs, '$snapshotReceipt.eligibleMemberRefs'),
    eligibleRoleRefs: stringArray(root.eligibleRoleRefs, '$snapshotReceipt.eligibleRoleRefs'),
  });
}

export function createAIOrganizationTaskProfile(
  targetInput: unknown,
  receiptInput: unknown,
  adoptionInputs: readonly unknown[] = [],
): AIOrganizationTaskProfile {
  const target = normalizeHolonTaskTarget(targetInput);
  const snapshotReceipt = normalizeHolonTaskSnapshotReceipt(receiptInput);
  if (snapshotReceipt.taskSpaceId.length === 0
    || snapshotReceipt.holonRef !== target.holon.rootHolonRef
    || snapshotReceipt.effectiveAt !== target.holon.effectiveAt
    || snapshotReceipt.executionBindingRef !== target.executionBinding.ref
    || snapshotReceipt.executionBindingDigest !== target.executionBinding.digest) {
    invalid('$profile', 'Snapshot receipt does not bind the exact target facts');
  }
  return Object.freeze({
    kind: 'task-profile',
    profileKind: AI_ORGANIZATION_TASK_PROFILE_KIND,
    schemaVersion: 1,
    facts: Object.freeze({
      target,
      snapshotReceipt,
      assignmentReceipt: null,
      memberRuntimeRef: null,
      settlementReceipt: null,
      snapshotAdoptions: Object.freeze(adoptionInputs.map(normalizeHolonTaskSnapshotAdoptionReceipt)),
    }),
  });
}

export function normalizeHolonTaskSnapshotAdoptionReceipt(value: unknown): HolonTaskSnapshotAdoptionReceipt {
  const root = record(canonicalOwnDataClone(value), '$snapshotAdoptionReceipt');
  exactKeys(root, [
    'kind', 'schemaVersion', 'taskSpaceId', 'previousTaskId', 'successorTaskId',
    'previousIssuerReceiptId', 'successorIssuerReceiptId', 'executionBindingDigest', 'adoptedAt',
  ], '$snapshotAdoptionReceipt');
  exactLiteral(root.kind, 'holon-task-snapshot-adoption-receipt', '$snapshotAdoptionReceipt.kind');
  exactLiteral(root.schemaVersion, 'ai-workflow.holon-task-snapshot-adoption-receipt/v1', '$snapshotAdoptionReceipt.schemaVersion');
  return Object.freeze({
    kind: 'holon-task-snapshot-adoption-receipt',
    schemaVersion: 'ai-workflow.holon-task-snapshot-adoption-receipt/v1',
    taskSpaceId: exactString(root.taskSpaceId, '$snapshotAdoptionReceipt.taskSpaceId'),
    previousTaskId: exactString(root.previousTaskId, '$snapshotAdoptionReceipt.previousTaskId'),
    successorTaskId: exactString(root.successorTaskId, '$snapshotAdoptionReceipt.successorTaskId'),
    previousIssuerReceiptId: digest(root.previousIssuerReceiptId, '$snapshotAdoptionReceipt.previousIssuerReceiptId'),
    successorIssuerReceiptId: digest(root.successorIssuerReceiptId, '$snapshotAdoptionReceipt.successorIssuerReceiptId'),
    executionBindingDigest: digest(root.executionBindingDigest, '$snapshotAdoptionReceipt.executionBindingDigest'),
    adoptedAt: utcInstant(root.adoptedAt, '$snapshotAdoptionReceipt.adoptedAt'),
  });
}

function record(value: unknown, path: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid(path, 'Expected an object');
  return value as Readonly<Record<string, unknown>>;
}

function exactKeys(value: Readonly<Record<string, unknown>>, expected: readonly string[], path: string): void {
  const actual = Object.keys(value);
  const expectedSet = new Set(expected);
  const extra = actual.find((key) => !expectedSet.has(key));
  if (extra !== undefined) invalid(`${path}.${extra}`, 'Unsupported field');
  const missing = expected.find((key) => !Object.prototype.hasOwnProperty.call(value, key));
  if (missing !== undefined) invalid(`${path}.${missing}`, 'Required field is missing');
}

function exactString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) invalid(path, 'Expected an exact non-empty string');
  return value;
}

function exactLiteral<const Value extends string>(value: unknown, expected: Value, path: string): Value {
  if (value !== expected) invalid(path, `Expected '${expected}'`);
  return expected;
}

function oneOf<const Values extends readonly string[]>(value: unknown, expected: Values, path: string): Values[number] {
  if (typeof value !== 'string' || !expected.includes(value)) invalid(path, `Expected one of ${expected.join('|')}`);
  return value as Values[number];
}

function resourceRef(value: unknown, path: string): HolonTaskResourceRef {
  const ref = exactString(value, path);
  if (!/^resource:\/\/[^/\s][^\s]*$/.test(ref)) invalid(path, 'Expected a canonical resource:// reference');
  return ref as HolonTaskResourceRef;
}

function digest(value: unknown, path: string): HolonTaskDigest {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value)) invalid(path, 'Expected a canonical SHA-256 digest');
  return value as HolonTaskDigest;
}

function utcInstant(value: unknown, path: string): string {
  const instant = exactString(value, path);
  const parsed = Date.parse(instant);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(instant)
    || Number.isNaN(parsed) || new Date(parsed).toISOString() !== instant) invalid(path, 'Expected a canonical UTC instant');
  return instant;
}

function stringArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) invalid(path, 'Expected an array');
  const result = Object.freeze(value.map((item, index) => exactString(item, `${path}[${index}]`)));
  if (new Set(result).size !== result.length) invalid(path, 'Duplicate values are not allowed');
  return result;
}

function resourceRefArray(value: unknown, path: string): readonly HolonTaskResourceRef[] {
  if (!Array.isArray(value)) invalid(path, 'Expected an array');
  const result = Object.freeze(value.map((item, index) => resourceRef(item, `${path}[${index}]`)));
  if (new Set(result).size !== result.length) invalid(path, 'Duplicate values are not allowed');
  return result;
}

function invalid(path: string, message: string): never {
  throw new HolonTaskContractError(path, message);
}
