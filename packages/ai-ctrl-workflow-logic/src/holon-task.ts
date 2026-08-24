import {
  createAIOrganizationTaskProfile,
  normalizeHolonTaskSnapshotReceipt,
  normalizeHolonTaskTarget,
  type FrozenHolonTaskTarget,
  type HolonTaskSnapshotAdoptionReceipt,
  type HolonTaskSnapshotReceipt,
} from 'ai-workflow-contract';
import { assertFrozenHolonTaskTarget } from 'ai-workflow-logic/run-freeze';
import {
  createHolonTaskSpace,
  prepareHolonTaskSnapshot,
  type CreateHolonTaskSpaceConfig,
  type CreateHolonTaskSpaceRuntime,
  type HolonOrganizationSnapshotReadPort,
} from 'ai-workflow-logic';
import type {
  TaskClaimToken,
  TaskCommandReceipt,
  TaskRecord,
  TaskSettlementReceipt,
  TaskSpaceSnapshot,
} from 'task-manager-contract';
import {
  cancelTask,
  replanTask,
  type TaskManagerRuntime,
  type TaskProcessorResult,
} from 'task-manager-logic';

export interface AICtrlHolonTaskRuntime {
  readonly taskManager: TaskManagerRuntime;
  readonly organizationSnapshots: HolonOrganizationSnapshotReadPort;
}

export interface OpenAICtrlHolonTaskInput {
  readonly frozenTarget: FrozenHolonTaskTarget;
  readonly commandId: string;
  readonly taskSpaceId: string;
  readonly taskId: string;
  readonly taskName: string;
  readonly createdAt: string;
}

export interface OpenAICtrlHolonTaskResult {
  readonly snapshot: TaskSpaceSnapshot;
  readonly receipt: TaskCommandReceipt;
  readonly snapshotReceipt: HolonTaskSnapshotReceipt;
  readonly created: boolean;
  readonly replayed: boolean;
}

export async function openAICtrlHolonTask(
  runtime: AICtrlHolonTaskRuntime,
  input: OpenAICtrlHolonTaskInput,
  config: CreateHolonTaskSpaceConfig,
): Promise<OpenAICtrlHolonTaskResult> {
  const proof = assertFrozenHolonTaskTarget(input.frozenTarget);
  const existing = await runtime.taskManager.owner.readSnapshot(input.taskSpaceId);
  if (existing) {
    const task = exactOrganizationTask(existing, input.taskId);
    const target = normalizeHolonTaskTarget(task.profile.facts.target);
    if (JSON.stringify(target) !== JSON.stringify(proof.target)) {
      throw new Error('AI_CTRL_HOLON_TASK_TARGET_CONFLICT: existing TaskSpace is bound to another frozen target');
    }
    const receipt = await runtime.taskManager.owner.readReceiptByCommand(input.taskSpaceId, input.commandId);
    if (!receipt) throw new Error('AI_CTRL_HOLON_TASK_OPEN_RECEIPT_MISSING: existing TaskSpace has no matching create receipt');
    return Object.freeze({
      snapshot: existing,
      receipt,
      snapshotReceipt: normalizeHolonTaskSnapshotReceipt(task.profile.facts.snapshotReceipt),
      created: false,
      replayed: true,
    });
  }
  const created = await createHolonTaskSpace(runtime as CreateHolonTaskSpaceRuntime, {
    commandId: input.commandId,
    taskSpaceId: input.taskSpaceId,
    taskId: input.taskId,
    taskName: input.taskName,
    target: proof.target,
    createdAt: input.createdAt,
  }, config);
  return Object.freeze({ ...created, created: true });
}

export type ObserveAICtrlHolonTaskResult =
  | Readonly<{
      readonly kind: 'waiting';
      readonly taskSpaceId: string;
      readonly taskId: string;
      readonly expectedSettlementCommandId: string;
      readonly observedRevision: number;
    }>
  | Readonly<{
      readonly kind: 'settled';
      readonly receipt: TaskSettlementReceipt;
      readonly task: TaskRecord;
    }>;

export async function observeAICtrlHolonTask(
  runtime: Pick<AICtrlHolonTaskRuntime, 'taskManager'>,
  input: Readonly<{
    readonly taskSpaceId: string;
    readonly taskId: string;
    readonly settlementCommandId: string;
  }>,
  _config: Readonly<Record<string, never>>,
): Promise<ObserveAICtrlHolonTaskResult> {
  const snapshot = await runtime.taskManager.owner.readSnapshot(input.taskSpaceId);
  if (!snapshot) throw new Error(`AI_CTRL_HOLON_TASK_SPACE_MISSING: ${input.taskSpaceId}`);
  const task = exactOrganizationTask(snapshot, input.taskId);
  const receipt = await runtime.taskManager.owner.readReceiptByCommand(input.taskSpaceId, input.settlementCommandId);
  if (!receipt) return Object.freeze({
    kind: 'waiting',
    taskSpaceId: input.taskSpaceId,
    taskId: input.taskId,
    expectedSettlementCommandId: input.settlementCommandId,
    observedRevision: snapshot.revision,
  });
  if (receipt.kind !== 'task-settlement-receipt' || receipt.taskId !== input.taskId
    || !['Succeeded', 'Failed', 'Cancelled'].includes(task.status)
    || receipt.status !== task.status) {
    throw new Error('AI_CTRL_HOLON_TASK_SETTLEMENT_RECEIPT_MISMATCH: receipt does not bind the terminal task projection');
  }
  return Object.freeze({ kind: 'settled', receipt, task });
}

export interface ReplanAICtrlHolonTaskInput {
  readonly frozenSuccessorTarget: FrozenHolonTaskTarget;
  readonly taskSpaceId: string;
  readonly previousTaskId: string;
  readonly successorTaskId: string;
  readonly successorTaskName: string;
  readonly cancelCommandId: string;
  readonly replanCommandId: string;
  readonly planId: string;
  readonly replannedAt: string;
  readonly activeClaim?: TaskClaimToken;
}

export interface ReplanAICtrlHolonTaskResult extends TaskProcessorResult {
  readonly adoptionReceipt: HolonTaskSnapshotAdoptionReceipt;
  readonly successorSnapshotReceipt: HolonTaskSnapshotReceipt;
}

export async function replanAICtrlHolonTask(
  runtime: AICtrlHolonTaskRuntime,
  input: ReplanAICtrlHolonTaskInput,
  config: CreateHolonTaskSpaceConfig,
): Promise<ReplanAICtrlHolonTaskResult> {
  const successorProof = assertFrozenHolonTaskTarget(input.frozenSuccessorTarget);
  const initial = await requiredSnapshot(runtime.taskManager, input.taskSpaceId);
  const previous = exactOrganizationTask(initial, input.previousTaskId);
  const previousTarget = normalizeHolonTaskTarget(previous.profile.facts.target);
  const previousSnapshotReceipt = normalizeHolonTaskSnapshotReceipt(previous.profile.facts.snapshotReceipt);
  if (previousTarget.executionBinding.ref !== successorProof.target.executionBinding.ref
    || previousTarget.executionBinding.digest !== successorProof.target.executionBinding.digest) {
    throw new Error('AI_CTRL_HOLON_TASK_REPLAN_SUCCESSOR_INSTANCE_REQUIRED: execution binding changed');
  }
  if (previousTarget.invocation.workflowKind !== successorProof.target.invocation.workflowKind
    || previousTarget.invocation.workflowRef !== successorProof.target.invocation.workflowRef
    || previousTarget.invocation.nodeId !== successorProof.target.invocation.nodeId) {
    throw new Error('AI_CTRL_HOLON_TASK_REPLAN_SUCCESSOR_INSTANCE_REQUIRED: workflow executable identity changed');
  }

  // Read and validate the successor authority before mutating the current task.
  // The following cancel + replan commands are independently idempotent, so a
  // retry can converge after an interruption between their commits.
  const prepared = await prepareHolonTaskSnapshot(runtime, {
    taskSpaceId: input.taskSpaceId,
    target: successorProof.target,
  });

  let current = initial;
  if (!['Succeeded', 'Failed', 'Cancelled'].includes(previous.status)) {
    if (previous.activeClaim && (!input.activeClaim || JSON.stringify(previous.activeClaim) !== JSON.stringify(input.activeClaim))) {
      throw new Error('AI_CTRL_HOLON_TASK_REPLAN_CLAIM_REQUIRED: active task requires its exact claim capability');
    }
    const cancelled = await cancelTask(runtime.taskManager, {
      kind: 'task.cancel',
      commandId: input.cancelCommandId,
      taskSpaceId: input.taskSpaceId,
      expectedRevision: current.revision,
      taskId: previous.taskId,
      cancelledAt: input.replannedAt,
      reason: 'organization-snapshot-replan',
      ...(input.activeClaim === undefined ? {} : { claim: input.activeClaim }),
    }, config);
    current = cancelled.snapshot;
  }

  const adoptionReceipt: HolonTaskSnapshotAdoptionReceipt = Object.freeze({
    kind: 'holon-task-snapshot-adoption-receipt',
    schemaVersion: 'ai-workflow.holon-task-snapshot-adoption-receipt/v1',
    taskSpaceId: input.taskSpaceId,
    previousTaskId: input.previousTaskId,
    successorTaskId: input.successorTaskId,
    previousIssuerReceiptId: previousSnapshotReceipt.issuerReceiptId,
    successorIssuerReceiptId: prepared.snapshotReceipt.issuerReceiptId,
    executionBindingDigest: previousTarget.executionBinding.digest,
    adoptedAt: input.replannedAt,
  });
  const priorAdoptions = Array.isArray(previous.profile.facts.snapshotAdoptions)
    ? previous.profile.facts.snapshotAdoptions
    : [];
  const successorProfile = createAIOrganizationTaskProfile(
    prepared.target,
    prepared.snapshotReceipt,
    [...priorAdoptions, adoptionReceipt],
  );
  const successorDefinition = Object.freeze({
    kind: 'task' as const,
    taskId: input.successorTaskId,
    name: input.successorTaskName,
    order: current.definition.tasks.length,
    profile: successorProfile,
    inputArtifacts: prepared.artifactRefs,
  });
  const rootCount = current.definition.relations.filter((relation) => relation.kind === 'parent-child' && relation.parentTaskId === null).length;
  const replanned = await replanTask(runtime.taskManager, {
    kind: 'task.replan',
    commandId: input.replanCommandId,
    taskSpaceId: input.taskSpaceId,
    expectedRevision: current.revision,
    replannedAt: input.replannedAt,
    plan: {
      kind: 'task-plan',
      planId: input.planId,
      tasks: [...current.definition.tasks, successorDefinition],
      relations: [
        ...current.definition.relations,
        {
          kind: 'parent-child',
          relationId: `root:${input.successorTaskId}`,
          parentTaskId: null,
          childTaskId: input.successorTaskId,
          order: rootCount,
        },
      ],
      reason: 'organization-snapshot-replan',
    },
    artifactBodies: prepared.artifactBodies,
  }, config);
  return Object.freeze({
    ...replanned,
    adoptionReceipt,
    successorSnapshotReceipt: prepared.snapshotReceipt,
  });
}

function exactOrganizationTask(snapshot: TaskSpaceSnapshot, taskId: string): TaskRecord {
  const task = snapshot.tasks.find((candidate) => candidate.taskId === taskId);
  if (!task || task.profile.profileKind !== 'depa.ai.organization-task' || task.profile.schemaVersion !== 1) {
    throw new Error(`AI_CTRL_HOLON_TASK_PROFILE_MISMATCH: ${taskId}`);
  }
  return task;
}

async function requiredSnapshot(runtime: TaskManagerRuntime, taskSpaceId: string): Promise<TaskSpaceSnapshot> {
  const snapshot = await runtime.owner.readSnapshot(taskSpaceId);
  if (!snapshot) throw new Error(`AI_CTRL_HOLON_TASK_SPACE_MISSING: ${taskSpaceId}`);
  return snapshot;
}
