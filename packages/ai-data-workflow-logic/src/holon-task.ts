import {
  deepFrozenCanonicalOwnDataClone,
  type ImmutableJsonValue,
  type TaskArtifactBody,
  type TaskArtifactRef,
  type TaskRecord,
  type TaskSettlementReceipt,
} from 'task-manager-contract';
import type { FrozenHolonTaskTarget, HolonTaskTarget } from 'ai-workflow-contract';
import { normalizeHolonTaskTarget } from 'ai-workflow-contract';
import { assertFrozenHolonTaskTarget } from 'ai-workflow-logic/run-freeze';
import type { TaskManagerRuntime } from 'task-manager-logic';

export interface AIDataHolonTaskMaterial {
  readonly materialPortRef: `resource://${string}`;
  readonly artifact: TaskArtifactRef;
  readonly body: TaskArtifactBody;
}

export interface AIDataHolonTaskMaterialValidationInput {
  readonly schemaRef: `resource://${string}`;
  readonly materials: readonly AIDataHolonTaskMaterial[];
}

/** Runtime-owned ResourcePackage schema/material validation port. */
export interface AIDataHolonTaskMaterialValidationPort {
  validateSettlementMaterial(input: AIDataHolonTaskMaterialValidationInput): Promise<ImmutableJsonValue>;
}

export interface AIDataHolonTaskRuntime {
  readonly taskManager: TaskManagerRuntime;
  readonly materials: AIDataHolonTaskMaterialValidationPort;
}

export interface ConsumeAIDataHolonTaskInput {
  readonly frozenTarget: FrozenHolonTaskTarget;
  readonly taskSpaceId: string;
  readonly taskId: string;
  readonly settlementCommandId: string;
}

export interface ConsumeAIDataHolonTaskResult {
  readonly kind: 'ai-data-holon-task-settlement';
  readonly taskSpaceId: string;
  readonly taskId: string;
  readonly settlementReceiptId: string;
  readonly materialDigests: readonly `sha256:${string}`[];
  readonly output: ImmutableJsonValue;
}

/**
 * Processor that projects a settled organization task into an AI Data value.
 * Generic actor/session state and live Holon sources are intentionally absent
 * from this runtime boundary.
 */
export async function consumeAIDataHolonTask(
  runtime: AIDataHolonTaskRuntime,
  input: ConsumeAIDataHolonTaskInput,
  _config: Readonly<Record<string, never>>,
): Promise<ConsumeAIDataHolonTaskResult> {
  const proof = assertFrozenHolonTaskTarget(input.frozenTarget);
  const snapshot = await runtime.taskManager.owner.readSnapshot(input.taskSpaceId);
  if (!snapshot) fail('TASK_SPACE_MISSING', input.taskSpaceId);
  const task = snapshot.tasks.find((candidate) => candidate.taskId === input.taskId);
  if (!task || task.profile.profileKind !== 'depa.ai.organization-task' || task.profile.schemaVersion !== 1) {
    fail('TASK_PROFILE_MISMATCH', input.taskId);
  }
  const target = normalizeHolonTaskTarget(task.profile.facts.target);
  assertSameTarget(target, proof.target);
  const receipt = await runtime.taskManager.owner.readReceiptByCommand(
    input.taskSpaceId,
    input.settlementCommandId,
  );
  assertSettlement(receipt, task, input.taskId);
  if (task.status !== 'Succeeded') fail('TASK_NOT_SUCCEEDED', `${task.taskId}:${task.status}`);

  const materials = await readExactMaterials(runtime, input.taskSpaceId, task, target);
  const output = deepFrozenCanonicalOwnDataClone(await runtime.materials.validateSettlementMaterial({
    schemaRef: target.output.schemaRef,
    materials,
  }));
  return deepFrozenCanonicalOwnDataClone({
    kind: 'ai-data-holon-task-settlement',
    taskSpaceId: input.taskSpaceId,
    taskId: input.taskId,
    settlementReceiptId: receipt.receiptId,
    materialDigests: materials.map(({ artifact }) => artifact.digest),
    output,
  });
}

async function readExactMaterials(
  runtime: AIDataHolonTaskRuntime,
  taskSpaceId: string,
  task: TaskRecord,
  target: HolonTaskTarget,
): Promise<readonly AIDataHolonTaskMaterial[]> {
  if (task.outputArtifacts.length !== target.output.materialPortRefs.length) {
    fail('MATERIAL_PORT_MISMATCH', 'settlement artifact count does not match the frozen target');
  }
  const byPort = new Map<string, TaskArtifactRef>();
  for (const artifact of task.outputArtifacts) {
    if (artifact.name === undefined || !target.output.materialPortRefs.includes(artifact.name as `resource://${string}`)
      || byPort.has(artifact.name)) {
      fail('MATERIAL_PORT_MISMATCH', 'artifact names must map one-to-one to declared MaterialPorts');
    }
    byPort.set(artifact.name, artifact);
  }
  const materials: AIDataHolonTaskMaterial[] = [];
  for (const materialPortRef of target.output.materialPortRefs) {
    const artifact = byPort.get(materialPortRef);
    if (!artifact) fail('MATERIAL_PORT_MISSING', materialPortRef);
    const body = await runtime.taskManager.owner.readArtifact(taskSpaceId, artifact.digest);
    if (!body || body.digest !== artifact.digest || body.mediaType !== artifact.mediaType
      || body.sizeBytes !== artifact.sizeBytes) {
      fail('MATERIAL_BODY_MISMATCH', artifact.digest);
    }
    materials.push(deepFrozenCanonicalOwnDataClone({ materialPortRef, artifact, body }));
  }
  return deepFrozenCanonicalOwnDataClone(materials);
}

function assertSettlement(
  receipt: Awaited<ReturnType<TaskManagerRuntime['owner']['readReceiptByCommand']>>,
  task: TaskRecord,
  taskId: string,
): asserts receipt is TaskSettlementReceipt {
  if (!receipt || receipt.kind !== 'task-settlement-receipt' || receipt.taskId !== taskId
    || receipt.status !== task.status || receipt.toRevision < receipt.fromRevision) {
    fail('SETTLEMENT_RECEIPT_MISMATCH', taskId);
  }
}

function assertSameTarget(actual: HolonTaskTarget, expected: HolonTaskTarget): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail('FROZEN_TARGET_MISMATCH', expected.invocation.nodeId);
  }
}

function fail(code: string, detail: string): never {
  throw new Error(`AI_DATA_HOLON_TASK_${code}: ${detail}`);
}
