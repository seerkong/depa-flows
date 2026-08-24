/** BPCtrlFlow domain profile over the shared profile-neutral TaskSpace kernel. */
import type { TaskProfileEnvelope, TaskStatus } from 'task-manager-contract';
import type { TickOutcome } from 'work-ctrl-flow-contract';

export const BP_TASK_STATUSES = Object.freeze([
  'NotStarted',
  'Active',
  'Delegated',
  'Forwarded',
  'Done',
  'Refused',
  'Abandoned',
] as const);

export type BPTaskStatus = (typeof BP_TASK_STATUSES)[number];
export const BP_EXECUTION_MODES = Object.freeze(['SEQUENTIAL', 'ANY', 'ALL'] as const);
export type BPExecutionMode = (typeof BP_EXECUTION_MODES)[number];

export type BPTaskOperation =
  | 'start'
  | 'complete'
  | 'refuse'
  | 'forward'
  | 'delegate'
  | 'reactivate'
  | 'abandon';

export const BP_OPERATION_TARGET: Readonly<Record<BPTaskOperation, BPTaskStatus>> = Object.freeze({
  start: 'Active',
  complete: 'Done',
  refuse: 'Refused',
  forward: 'Forwarded',
  delegate: 'Delegated',
  reactivate: 'Active',
  abandon: 'Abandoned',
});

export interface BPTaskProfileFacts extends Readonly<Record<string, string | number | boolean | null>> {
  readonly ownerAccount: string;
  readonly status: BPTaskStatus;
  readonly operatorAccount: string | null;
  readonly transferredBy: string | null;
  readonly startedAtMs: number | null;
  readonly endedAtMs: number | null;
  readonly lifecycleSequence: number;
}

export type BPTaskProfile = TaskProfileEnvelope<'depa.bp.task', BPTaskProfileFacts>;

export interface BPTaskGroupProfileFacts extends Readonly<Record<string, string | number | boolean | null>> {
  readonly executionMode: BPExecutionMode;
}

export type BPTaskGroupProfile = TaskProfileEnvelope<'depa.bp.task-group', BPTaskGroupProfileFacts>;
export type BPTaskSpaceProfile = BPTaskProfile | BPTaskGroupProfile;

export function bpTaskProfile(input: {
  readonly ownerAccount: string;
  readonly status?: BPTaskStatus;
  readonly operatorAccount?: string | null;
  readonly transferredBy?: string | null;
  readonly startedAtMs?: number | null;
  readonly endedAtMs?: number | null;
  readonly lifecycleSequence?: number;
}): BPTaskProfile {
  return {
    kind: 'task-profile',
    profileKind: 'depa.bp.task',
    schemaVersion: 1,
    facts: {
      ownerAccount: input.ownerAccount,
      status: input.status ?? 'NotStarted',
      operatorAccount: input.operatorAccount ?? null,
      transferredBy: input.transferredBy ?? null,
      startedAtMs: input.startedAtMs ?? null,
      endedAtMs: input.endedAtMs ?? null,
      lifecycleSequence: input.lifecycleSequence ?? 0,
    },
  };
}

export function bpTaskGroupProfile(executionMode: BPExecutionMode): BPTaskGroupProfile {
  return {
    kind: 'task-profile',
    profileKind: 'depa.bp.task-group',
    schemaVersion: 1,
    facts: { executionMode },
  };
}

export function isBPTaskProfile(profile: TaskProfileEnvelope): profile is BPTaskProfile {
  return profile.kind === 'task-profile'
    && profile.profileKind === 'depa.bp.task'
    && profile.schemaVersion === 1
    && typeof profile.facts.ownerAccount === 'string'
    && Number.isSafeInteger(profile.facts.lifecycleSequence)
    && Number(profile.facts.lifecycleSequence) >= 0
    && BP_TASK_STATUSES.includes(profile.facts.status as BPTaskStatus);
}

export function isBPTaskGroupProfile(profile: TaskProfileEnvelope): profile is BPTaskGroupProfile {
  return profile.kind === 'task-profile'
    && profile.profileKind === 'depa.bp.task-group'
    && profile.schemaVersion === 1
    && BP_EXECUTION_MODES.includes(profile.facts.executionMode as BPExecutionMode);
}

/** BP refusal/forward are successful business handling, never kernel technical failure. */
export function kernelStatusForBPStatus(status: BPTaskStatus, dependenciesBlocked: boolean): TaskStatus {
  switch (status) {
    case 'NotStarted': return dependenciesBlocked ? 'Pending' : 'Ready';
    case 'Active': return 'Running';
    case 'Delegated': return 'Waiting';
    case 'Done':
    case 'Refused':
    case 'Forwarded': return 'Succeeded';
    case 'Abandoned': return 'Cancelled';
  }
}

export interface TaskOperationRequest {
  readonly taskId: string;
  readonly operation: BPTaskOperation;
  readonly operatorAccount: string;
}

export interface TaskOperationResult {
  readonly taskStatus: BPTaskStatus;
  readonly outcome: TickOutcome;
  readonly advancedFlow: boolean;
}

export type TaskStepStatus = Extract<BPTaskStatus, 'Done' | 'Refused' | 'Forwarded' | 'Abandoned'>;
export type TaskStepOutcome = 'approved' | 'refused' | 'forwarded' | 'abandoned';

export interface TaskStepResult<Payload = unknown> {
  readonly taskId: string;
  readonly status: TaskStepStatus;
  readonly outcome: TaskStepOutcome;
  readonly payload?: Payload;
}

const TASK_OUTCOME_BY_STATUS: Readonly<Record<TaskStepStatus, TaskStepOutcome>> = Object.freeze({
  Done: 'approved',
  Refused: 'refused',
  Forwarded: 'forwarded',
  Abandoned: 'abandoned',
});

export function taskStepResultOf<Payload>(
  taskId: string,
  status: TaskStepStatus,
  payload?: Payload,
): TaskStepResult<Payload> {
  return {
    taskId,
    status,
    outcome: TASK_OUTCOME_BY_STATUS[status],
    ...(payload === undefined ? {} : { payload }),
  };
}

/** Explicit legacy view used only at BP product boundaries. */
export interface BPTaskDTO {
  readonly kind: 'task';
  readonly id: string;
  readonly name: string;
  readonly ownerAccount: string;
  readonly status: BPTaskStatus;
  readonly order: number;
  readonly description?: string;
  readonly operatorAccount?: string;
  readonly transferredBy?: string;
  readonly startedAtMs?: number;
  readonly endedAtMs?: number;
}

export interface BPTaskGroupDTO {
  readonly kind: 'group';
  readonly id: string;
  readonly name: string;
  readonly executionMode: BPExecutionMode;
  readonly order: number;
  readonly children: readonly BPTaskTreeNode[];
}

export type BPTaskTreeNode = BPTaskDTO | BPTaskGroupDTO;

export interface BPTaskSpaceDTO {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly children: readonly BPTaskTreeNode[];
}
