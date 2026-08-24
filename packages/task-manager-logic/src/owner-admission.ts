import type {
  TaskArtifactBody,
  TaskArtifactDigest,
  TaskArtifactRef,
  TaskCommandDigest,
  TaskCommandReceipt,
  TaskSpaceCommit,
  TaskSpaceSnapshot,
} from 'task-manager-contract';
import { canonicalOwnDataDigest } from 'task-manager-contract';
import { TaskManagerError } from './errors.js';
import { assertArtifactBody, assertArtifactRef } from './validation.js';

export interface TaskSpaceCommitAdmissionContext {
  readonly currentSnapshot?: TaskSpaceSnapshot;
  readonly existingArtifacts: ReadonlyMap<TaskArtifactDigest, TaskArtifactBody>;
}

/**
 * Validates the command envelope before either owner performs replay lookup.
 * This keeps replay authentication identical across backend adapters.
 */
export function validateTaskSpaceCommitCommand(commit: TaskSpaceCommit): TaskCommandDigest {
  if (commit.kind !== 'task-space-commit'
    || commit.command.commandId !== commit.commandId
    || commit.command.taskSpaceId !== commit.taskSpaceId) {
    throw new TaskManagerError(
      'command-receipt-mismatch',
      'submitted command identity does not match its CAS envelope',
    );
  }
  const commandDigest = canonicalOwnDataDigest(commit.command);
  if (commandDigest !== commit.commandDigest) {
    throw new TaskManagerError(
      'command-receipt-mismatch',
      `command ${commit.commandId} digest does not match the submitted canonical command`,
    );
  }
  return commandDigest;
}

/**
 * Backend-neutral authority for a non-replay TaskSpace CAS admission.
 * Storage implementations add only their own lock, containment, material and
 * recovery checks around this shared identity/append-only/artifact validator.
 */
export function validateTaskSpaceCommitAdmission(
  commit: TaskSpaceCommit,
  context: TaskSpaceCommitAdmissionContext,
): TaskCommandReceipt {
  const commandDigest = validateTaskSpaceCommitCommand(commit);
  const current = context.currentSnapshot;
  const nextRevision = commit.expectedRevision === null ? 0 : commit.expectedRevision + 1;
  if (commit.snapshot.taskSpaceId !== commit.taskSpaceId
    || commit.snapshot.definition.taskSpaceId !== commit.taskSpaceId
    || commit.snapshot.revision !== nextRevision) {
    invalid('snapshot identity or revision disagrees with CAS');
  }
  assertSnapshotIdentity(commit.snapshot);

  if (commit.receipts.length !== 1) invalid('one CAS command must issue exactly one receipt');
  const receipt = commit.receipts[0]!;
  if (receipt.commandId !== commit.commandId
    || receipt.commandDigest !== commandDigest
    || receipt.taskSpaceId !== commit.taskSpaceId
    || receipt.fromRevision !== (commit.expectedRevision ?? 0)
    || receipt.toRevision !== nextRevision) {
    invalid('receipt identity or revision disagrees with CAS');
  }

  const priorHistoryIds = current?.historyEventIds ?? [];
  const priorReceiptIds = current?.issuedReceiptIds ?? [];
  const eventIds = commit.events.map(({ eventId }) => eventId);
  if (!sameStrings(commit.snapshot.historyEventIds, [...priorHistoryIds, ...eventIds])) {
    invalid('history prefix was rewritten');
  }
  if (!sameStrings(commit.snapshot.issuedReceiptIds, [...priorReceiptIds, receipt.receiptId])) {
    invalid('receipt prefix was rewritten');
  }
  if (priorReceiptIds.includes(receipt.receiptId)) invalid(`receipt ${receipt.receiptId} is not append-only`);
  if (!sameStrings(receipt.eventIds, eventIds)) invalid('receipt does not name the admitted event set');

  const seenEvents = new Set(priorHistoryIds);
  commit.events.forEach((event, index) => {
    if (event.taskSpaceId !== commit.taskSpaceId
      || event.commandId !== commit.commandId
      || event.sequence !== priorHistoryIds.length + index
      || event.fromRevision !== (commit.expectedRevision ?? 0)
      || event.toRevision !== nextRevision
      || seenEvents.has(event.eventId)) {
      invalid(`event ${event.eventId} violates append-only admission`);
    }
    seenEvents.add(event.eventId);
  });

  validateArtifactAuthority(commit, context);
  return receipt;
}

export function taskArtifactRefsOfSnapshot(snapshot: TaskSpaceSnapshot): readonly TaskArtifactRef[] {
  return [
    ...snapshot.definition.tasks.flatMap(({ inputArtifacts }) => inputArtifacts),
    ...snapshot.tasks.flatMap(({ outputArtifacts }) => outputArtifacts),
  ];
}

function assertSnapshotIdentity(snapshot: TaskSpaceSnapshot): void {
  if (snapshot.kind !== 'task-space-snapshot') invalid('snapshot kind is invalid');
  const definitions = new Map(snapshot.definition.tasks.map((task) => [task.taskId, task]));
  if (definitions.size !== snapshot.definition.tasks.length || snapshot.tasks.length !== definitions.size) {
    invalid('snapshot tree/task identity is invalid');
  }
  const seen = new Set<string>();
  for (const task of snapshot.tasks) {
    const definition = definitions.get(task.taskId);
    if (task.taskSpaceId !== snapshot.taskSpaceId
      || !definition
      || seen.has(task.taskId)
      || canonicalOwnDataDigest(definition) !== canonicalOwnDataDigest(task.definition)) {
      invalid(`snapshot task ${task.taskId} disagrees with its tree definition`);
    }
    seen.add(task.taskId);
  }
}

function validateArtifactAuthority(
  commit: TaskSpaceCommit,
  context: TaskSpaceCommitAdmissionContext,
): void {
  const availableArtifacts = new Map(context.existingArtifacts);
  for (const body of commit.artifacts) {
    assertArtifactBody(body, `artifact body ${body.digest}`);
    const prior = availableArtifacts.get(body.digest);
    if (prior && canonicalOwnDataDigest(prior) !== canonicalOwnDataDigest(body)) {
      conflict(`artifact ${body.digest} has conflicting content`);
    }
    availableArtifacts.set(body.digest, body);
  }

  const priorRefs = refsByDigest(context.currentSnapshot ? taskArtifactRefsOfSnapshot(context.currentSnapshot) : []);
  const nextRefs = refsByDigest(taskArtifactRefsOfSnapshot(commit.snapshot));
  for (const [digest, nextRef] of nextRefs) {
    const priorRef = priorRefs.get(digest);
    if (priorRef && !sameArtifactRef(priorRef, nextRef)) {
      conflict(`artifact ${digest} conflicts with the previously admitted reference`);
    }
    const body = availableArtifacts.get(digest);
    if (!body) {
      throw new TaskManagerError('artifact-not-found', `artifact ${digest} is not present in owner CAS`);
    }
    if (body.digest !== nextRef.digest
      || body.mediaType !== nextRef.mediaType
      || body.sizeBytes !== nextRef.sizeBytes) {
      conflict(`artifact ${digest} metadata disagrees with owner body`);
    }
  }
}

function refsByDigest(refs: readonly TaskArtifactRef[]): Map<TaskArtifactDigest, TaskArtifactRef> {
  const result = new Map<TaskArtifactDigest, TaskArtifactRef>();
  for (const ref of refs) {
    assertArtifactRef(ref, `artifact ref ${ref.digest}`);
    const prior = result.get(ref.digest);
    if (prior && !sameArtifactRef(prior, ref)) {
      conflict(`artifact ${ref.digest} has conflicting complete references`);
    }
    result.set(ref.digest, ref);
  }
  return result;
}

function sameArtifactRef(left: TaskArtifactRef, right: TaskArtifactRef): boolean {
  return left.digest === right.digest
    && left.name === right.name
    && left.mediaType === right.mediaType
    && left.sizeBytes === right.sizeBytes;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function invalid(message: string): never {
  throw new TaskManagerError('invalid-commit', message);
}

function conflict(message: string): never {
  throw new TaskManagerError('artifact-conflict', message);
}
