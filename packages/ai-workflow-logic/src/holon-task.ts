import {
  createAIOrganizationTaskProfile,
  normalizeHolonTaskTarget,
  normalizeHolonTaskSnapshotReceipt,
  type HolonTaskSnapshotReceipt,
  type AIOrganizationTaskProfile,
  type HolonTaskTarget,
} from 'ai-workflow-contract';
import {
  canonicalHolonEffectiveSnapshotIssuanceReceiptBytes,
  parseHolonEffectiveSnapshotBytes,
  parseHolonEffectiveSnapshotIssuanceReceiptBytes,
} from 'holarchy-core-contract';
import { sha256Digest } from 'halfcode-compiler.xnl/resource-core';
import type { TaskArtifactBody, TaskArtifactRef } from 'task-manager-contract';
import { createTaskSpace, type TaskManagerRuntime, type TaskProcessorResult } from 'task-manager-logic';
import type { TaskTransitionReceipt } from 'task-manager-contract';

export interface HolonOrganizationSnapshotReadInput {
  readonly rootHolonRef: string;
  readonly effectiveAt: string;
}

export interface HolonOrganizationSnapshotReadResult {
  readonly snapshotBytes: Uint8Array;
  readonly issuanceReceiptBytes: Uint8Array;
}

export interface HolonOrganizationSnapshotReadPort {
  readEffectiveSnapshot(input: HolonOrganizationSnapshotReadInput): Promise<HolonOrganizationSnapshotReadResult>;
}

export interface CreateHolonTaskSpaceRuntime {
  readonly taskManager: TaskManagerRuntime;
  readonly organizationSnapshots: HolonOrganizationSnapshotReadPort;
}

export interface CreateHolonTaskSpaceInput {
  readonly commandId: string;
  readonly taskSpaceId: string;
  readonly taskId: string;
  readonly taskName: string;
  readonly target: HolonTaskTarget;
  readonly createdAt: string;
}

export interface CreateHolonTaskSpaceConfig {
  readonly maxTasks: number;
  readonly maxRelations: number;
  readonly maxLeaseDurationMs: number;
}

export interface CreateHolonTaskSpaceResult extends TaskProcessorResult<TaskTransitionReceipt> {
  readonly snapshotReceipt: HolonTaskSnapshotReceipt;
}

export interface PreparedHolonTaskSnapshot {
  readonly target: HolonTaskTarget;
  readonly snapshotReceipt: HolonTaskSnapshotReceipt;
  readonly profile: AIOrganizationTaskProfile;
  readonly artifactRefs: readonly TaskArtifactRef[];
  readonly artifactBodies: readonly TaskArtifactBody[];
}

export async function prepareHolonTaskSnapshot(
  runtime: Pick<CreateHolonTaskSpaceRuntime, 'organizationSnapshots'>,
  input: Readonly<{
    readonly taskSpaceId: string;
    readonly target: HolonTaskTarget;
    readonly snapshotAdoptions?: readonly unknown[];
  }>,
): Promise<PreparedHolonTaskSnapshot> {
  const target = normalizeHolonTaskTarget(input.target);
  const issued = await runtime.organizationSnapshots.readEffectiveSnapshot({
    rootHolonRef: target.holon.rootHolonRef,
    effectiveAt: target.holon.effectiveAt,
  });
  const snapshotBytes = exactBytes(issued.snapshotBytes, 'snapshotBytes');
  const receiptBytes = exactBytes(issued.issuanceReceiptBytes, 'issuanceReceiptBytes');
  const snapshot = await parseHolonEffectiveSnapshotBytes(snapshotBytes);
  const issuerReceipt = parseHolonEffectiveSnapshotIssuanceReceiptBytes(receiptBytes, snapshot);
  if (snapshot.rootHolonRef !== target.holon.rootHolonRef || snapshot.effectiveAt !== target.holon.effectiveAt) {
    throw new Error('HOLON_TASK_SNAPSHOT_TARGET_MISMATCH: issuer snapshot does not bind the requested Holon/effectiveAt');
  }
  const canonicalReceiptBytes = canonicalHolonEffectiveSnapshotIssuanceReceiptBytes(issuerReceipt, snapshot);
  if (!sameBytes(receiptBytes, canonicalReceiptBytes)) {
    throw new Error('HOLON_TASK_ISSUER_RECEIPT_NON_CANONICAL: issuer receipt bytes changed during validation');
  }
  const snapshotArtifact = artifact(snapshotBytes, 'application/vnd.holarchy.effective-snapshot+json', 'holon-effective-snapshot.json');
  const receiptArtifact = artifact(receiptBytes, 'application/vnd.holarchy.snapshot-issuance-receipt+json', 'holon-effective-snapshot-receipt.json');
  const eligibleMemberRefs = Object.freeze(snapshot.records.filter((record) => record.kind === 'Member').map((record) => record.id).sort(compareUtf16));
  const eligibleRoleRefs = Object.freeze(snapshot.records.filter((record) => record.kind === 'Role').map((record) => record.id).sort(compareUtf16));
  const snapshotReceipt = normalizeHolonTaskSnapshotReceipt({
    kind: 'holon-task-snapshot-receipt',
    schemaVersion: 'ai-workflow.holon-task-snapshot-receipt/v1',
    taskSpaceId: exactString(input.taskSpaceId, 'taskSpaceId'),
    holonRef: snapshot.rootHolonRef,
    effectiveAt: snapshot.effectiveAt,
    holonSnapshotRef: snapshot.snapshotId,
    holonSnapshotDigest: snapshot.treeDigest,
    snapshotArtifactDigest: snapshotArtifact.ref.digest,
    issuerReceiptId: sha256Digest(receiptBytes),
    issuerReceiptArtifactDigest: receiptArtifact.ref.digest,
    executionBindingRef: target.executionBinding.ref,
    executionBindingDigest: target.executionBinding.digest,
    eligibleMemberRefs,
    eligibleRoleRefs,
  });
  return Object.freeze({
    target,
    snapshotReceipt,
    profile: createAIOrganizationTaskProfile(target, snapshotReceipt, input.snapshotAdoptions),
    artifactRefs: Object.freeze([snapshotArtifact.ref, receiptArtifact.ref]),
    artifactBodies: Object.freeze([snapshotArtifact.body, receiptArtifact.body]),
  });
}

export async function createHolonTaskSpace(
  runtime: CreateHolonTaskSpaceRuntime,
  input: CreateHolonTaskSpaceInput,
  config: CreateHolonTaskSpaceConfig,
): Promise<CreateHolonTaskSpaceResult> {
  const prepared = await prepareHolonTaskSnapshot(runtime, {
    taskSpaceId: input.taskSpaceId,
    target: input.target,
  });
  const result = await createTaskSpace(runtime.taskManager, {
    kind: 'task-space.create',
    commandId: exactString(input.commandId, 'commandId'),
    taskSpaceId: prepared.snapshotReceipt.taskSpaceId,
    createdAt: input.createdAt,
    definition: {
      kind: 'task-space-definition',
      taskSpaceId: prepared.snapshotReceipt.taskSpaceId,
      name: input.taskName,
      schemaVersion: 1,
      tasks: [{
        kind: 'task',
        taskId: exactString(input.taskId, 'taskId'),
        name: exactString(input.taskName, 'taskName'),
        order: 0,
        profile: prepared.profile,
        inputArtifacts: prepared.artifactRefs,
      }],
      relations: [{
        kind: 'parent-child',
        relationId: `root:${input.taskId}`,
        parentTaskId: null,
        childTaskId: input.taskId,
        order: 0,
      }],
    },
    artifactBodies: prepared.artifactBodies,
  }, config);
  return Object.freeze({ ...result, snapshotReceipt: prepared.snapshotReceipt });
}

function artifact(bytes: Uint8Array, mediaType: string, name: string): {
  readonly ref: TaskArtifactRef;
  readonly body: TaskArtifactBody;
} {
  const digest = sha256Digest(bytes);
  const ref = Object.freeze({
    kind: 'task-artifact-ref' as const,
    digest,
    mediaType,
    sizeBytes: bytes.byteLength,
    name,
  });
  return Object.freeze({
    ref,
    body: Object.freeze({
      kind: 'task-artifact-body' as const,
      digest,
      mediaType,
      sizeBytes: bytes.byteLength,
      encoding: 'base64' as const,
      data: Buffer.from(bytes).toString('base64'),
    }),
  });
}

function exactBytes(value: Uint8Array, name: string): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength === 0) throw new Error(`HOLON_TASK_${name.toUpperCase()}_INVALID`);
  return Uint8Array.from(value);
}

function exactString(value: string, name: string): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) throw new Error(`HOLON_TASK_${name.toUpperCase()}_INVALID`);
  return value;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

function compareUtf16(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
