import { describe, expect, test } from 'bun:test';
import {
  TASK_COMMAND_KINDS,
  TASK_EVENT_KINDS,
  TASK_STATUSES,
  type ClaimTaskCommand,
  type TaskArtifactRef,
  type TaskClaimToken,
  type TaskDefinition,
  type TaskProfileEnvelope,
  type TaskRelation,
  type TaskSettlementReceipt,
  type TaskSpaceDefinition,
  type TaskStatus,
} from '../src/index.js';

describe('profile-neutral TaskSpace contract', () => {
  test('closes the kernel lifecycle independently of BP outcomes', () => {
    expect(TASK_STATUSES).toEqual([
      'Pending',
      'Ready',
      'Claimed',
      'Running',
      'Waiting',
      'Succeeded',
      'Failed',
      'Cancelled',
    ]);
    expect(Object.isFrozen(TASK_STATUSES)).toBe(true);
    expect(TASK_STATUSES).not.toContain('Delegated');
    expect(TASK_STATUSES).not.toContain('Forwarded');
    expect(TASK_STATUSES).not.toContain('Refused');
    expect(TASK_STATUSES).not.toContain('Abandoned');

    const status: TaskStatus = 'Ready';
    expect(status).toBe('Ready');
  });

  test('defines closed immutable forest, relation, profile and artifact facts', () => {
    const profile: TaskProfileEnvelope<'example.review', { readonly severity: 'high' }> = {
      kind: 'task-profile',
      profileKind: 'example.review',
      schemaVersion: 1,
      facts: { severity: 'high' },
    };
    const artifact: TaskArtifactRef = {
      kind: 'task-artifact-ref',
      digest: 'sha256:abc',
      mediaType: 'application/json',
      sizeBytes: 12,
    };
    const task: TaskDefinition<typeof profile> = {
      kind: 'task',
      taskId: 'task-1',
      name: 'Review',
      order: 0,
      profile,
      inputArtifacts: [artifact],
    };
    const relation: TaskRelation = {
      kind: 'parent-child',
      relationId: 'relation-1',
      parentTaskId: null,
      childTaskId: 'task-1',
      order: 0,
    };
    const definition: TaskSpaceDefinition<typeof profile> = {
      kind: 'task-space-definition',
      taskSpaceId: 'space-1',
      name: 'Example',
      schemaVersion: 1,
      tasks: [task],
      relations: [relation],
    };

    expect(definition.tasks[0]?.profile).toEqual(profile);
    expect(definition.relations[0]).toEqual(relation);
  });

  test('closes commands, events, live claim token and terminal receipts', () => {
    expect(TASK_COMMAND_KINDS).toContain('task.claim');
    expect(TASK_COMMAND_KINDS).toContain('task.claim-expire');
    expect(TASK_COMMAND_KINDS).toContain('task.replan');
    expect(TASK_EVENT_KINDS).toContain('task.claim-expired');
    expect(TASK_EVENT_KINDS).toContain('task.settled');

    const token: TaskClaimToken = {
      kind: 'task-claim-token',
      claimId: 'claim-1',
      taskSpaceId: 'space-1',
      taskId: 'task-1',
      assigneeRef: 'member://reviewer',
      attempt: 1,
      leaseEpoch: 1,
      claimedAt: '2026-08-24T00:00:00.000Z',
      heartbeatAt: '2026-08-24T00:00:00.000Z',
      expiresAt: '2026-08-24T00:01:00.000Z',
    };
    const command: ClaimTaskCommand = {
      kind: 'task.claim',
      commandId: 'command-1',
      taskSpaceId: token.taskSpaceId,
      taskId: token.taskId,
      expectedRevision: 2,
      assigneeRef: token.assigneeRef,
      claimedAt: token.claimedAt,
      leaseDurationMs: 60_000,
    };
    const receipt: TaskSettlementReceipt = {
      kind: 'task-settlement-receipt',
      receiptId: 'receipt-1',
      commandId: 'command-2',
      commandDigest: `sha256:${'a'.repeat(64)}`,
      taskSpaceId: token.taskSpaceId,
      taskId: token.taskId,
      claimId: token.claimId,
      status: 'Succeeded',
      fromRevision: 3,
      toRevision: 4,
      eventIds: ['event-1'],
      committedAt: '2026-08-24T00:00:30.000Z',
    };

    expect(command.kind).toBe('task.claim');
    expect(receipt.status).toBe('Succeeded');
  });
});
