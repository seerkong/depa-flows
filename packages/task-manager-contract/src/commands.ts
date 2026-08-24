import type {
  ImmutableJsonValue,
  TaskArtifactBody,
  TaskArtifactRef,
  TaskClaimToken,
  TaskCommandId,
  TaskFailure,
  TaskId,
  TaskPlan,
  TaskProfileEnvelope,
  TaskRevision,
  TaskSpaceDefinition,
  TaskSpaceId,
  TaskTimestamp,
} from './kernel.js';

export const TASK_COMMAND_KINDS = Object.freeze([
  'task-space.create',
  'task-space.patch',
  'task.claim',
  'task.claim-heartbeat',
  'task.claim-expire',
  'task.start',
  'task.wait',
  'task.settle',
  'task.fail',
  'task.cancel',
  'task.replan',
] as const);

export type TaskCommandKind = (typeof TASK_COMMAND_KINDS)[number];

interface TaskCommandBase<Kind extends TaskCommandKind> {
  readonly kind: Kind;
  readonly commandId: TaskCommandId;
  readonly taskSpaceId: TaskSpaceId;
}

interface VersionedTaskCommandBase<Kind extends TaskCommandKind> extends TaskCommandBase<Kind> {
  readonly expectedRevision: TaskRevision;
}

export interface CreateTaskSpaceCommand<Profile extends TaskProfileEnvelope = TaskProfileEnvelope>
  extends TaskCommandBase<'task-space.create'> {
  readonly definition: TaskSpaceDefinition<Profile>;
  readonly createdAt: TaskTimestamp;
  readonly artifactBodies?: readonly TaskArtifactBody[];
}

export interface RenameTaskPatch {
  readonly kind: 'rename-task';
  readonly taskId: TaskId;
  readonly name: string;
  readonly description?: string;
}

export interface ReplaceTaskProfilePatch<Profile extends TaskProfileEnvelope = TaskProfileEnvelope> {
  readonly kind: 'replace-task-profile';
  readonly taskId: TaskId;
  readonly profile: Profile;
}

export interface AttachTaskInputArtifactPatch {
  readonly kind: 'attach-task-input-artifact';
  readonly taskId: TaskId;
  readonly artifact: TaskArtifactRef;
}

export type TaskSpacePatch<Profile extends TaskProfileEnvelope = TaskProfileEnvelope> =
  | RenameTaskPatch
  | ReplaceTaskProfilePatch<Profile>
  | AttachTaskInputArtifactPatch;

export interface PatchTaskSpaceCommand<Profile extends TaskProfileEnvelope = TaskProfileEnvelope>
  extends VersionedTaskCommandBase<'task-space.patch'> {
  readonly patch: TaskSpacePatch<Profile>;
  readonly patchedAt: TaskTimestamp;
  readonly artifactBodies?: readonly TaskArtifactBody[];
}

export interface ClaimTaskCommand extends VersionedTaskCommandBase<'task.claim'> {
  readonly taskId: TaskId;
  readonly assigneeRef: string;
  readonly claimedAt: TaskTimestamp;
  readonly leaseDurationMs: number;
}

export interface HeartbeatTaskClaimCommand extends VersionedTaskCommandBase<'task.claim-heartbeat'> {
  readonly claim: TaskClaimToken;
  readonly heartbeatAt: TaskTimestamp;
  readonly extendByMs: number;
}

export interface ExpireTaskClaimCommand extends VersionedTaskCommandBase<'task.claim-expire'> {
  readonly claim: TaskClaimToken;
  readonly observedAt: TaskTimestamp;
}

interface ClaimedTaskCommandBase<Kind extends TaskCommandKind> extends VersionedTaskCommandBase<Kind> {
  readonly claim: TaskClaimToken;
  readonly occurredAt: TaskTimestamp;
  readonly profile?: TaskProfileEnvelope;
}

export interface StartTaskCommand extends ClaimedTaskCommandBase<'task.start'> {}

export interface WaitTaskCommand extends ClaimedTaskCommandBase<'task.wait'> {
  readonly reason: string;
  readonly details?: ImmutableJsonValue;
}

export interface SettleTaskCommand extends ClaimedTaskCommandBase<'task.settle'> {
  readonly outputArtifacts: readonly TaskArtifactRef[];
  readonly artifactBodies?: readonly TaskArtifactBody[];
  readonly result?: ImmutableJsonValue;
}

export interface FailTaskCommand extends ClaimedTaskCommandBase<'task.fail'> {
  readonly failure: TaskFailure;
}

export interface CancelTaskCommand extends VersionedTaskCommandBase<'task.cancel'> {
  readonly taskId: TaskId;
  readonly cancelledAt: TaskTimestamp;
  readonly reason: string;
  readonly claim?: TaskClaimToken;
  readonly profile?: TaskProfileEnvelope;
}

export interface ReplanTaskCommand extends VersionedTaskCommandBase<'task.replan'> {
  readonly plan: TaskPlan;
  readonly replannedAt: TaskTimestamp;
  readonly artifactBodies?: readonly TaskArtifactBody[];
}

export type TaskCommand<Profile extends TaskProfileEnvelope = TaskProfileEnvelope> =
  | CreateTaskSpaceCommand<Profile>
  | PatchTaskSpaceCommand<Profile>
  | ClaimTaskCommand
  | HeartbeatTaskClaimCommand
  | ExpireTaskClaimCommand
  | StartTaskCommand
  | WaitTaskCommand
  | SettleTaskCommand
  | FailTaskCommand
  | CancelTaskCommand
  | ReplanTaskCommand;
