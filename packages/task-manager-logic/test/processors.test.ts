import { describe, expect, test } from 'bun:test';
import type {
  ClaimTaskCommand,
  CreateTaskSpaceCommand,
  TaskClaimToken,
  TaskProfileEnvelope,
  TaskSpaceDefinition,
} from 'task-manager-contract';
import {
  InMemoryTaskSpaceOwner,
  TaskManagerError,
  cancelTask,
  claimTask,
  createTaskSpace,
  expireTaskClaim,
  failTask,
  heartbeatTaskClaim,
  patchTaskSpace,
  replanTask,
  settleTask,
  startTask,
  waitTask,
} from '../src/index.js';

const at = (second: number) => `2026-08-24T00:00:${String(second).padStart(2, '0')}.000Z`;
const profile: TaskProfileEnvelope<'test.task', { readonly queue: 'default' }> = {
  kind: 'task-profile',
  profileKind: 'test.task',
  schemaVersion: 1,
  facts: { queue: 'default' },
};

function definition(
  dependencyRelations: TaskSpaceDefinition['relations'] = [
    { kind: 'parent-child', relationId: 'root:a', parentTaskId: null, childTaskId: 'a', order: 0 },
    { kind: 'parent-child', relationId: 'root:b', parentTaskId: null, childTaskId: 'b', order: 1 },
    { kind: 'dependency', relationId: 'dependency:a:b', predecessorTaskId: 'a', successorTaskId: 'b' },
  ],
): TaskSpaceDefinition<typeof profile> {
  return {
    kind: 'task-space-definition',
    taskSpaceId: 'space-1',
    name: 'Processor test',
    schemaVersion: 1,
    tasks: [
      { kind: 'task', taskId: 'a', name: 'A', order: 0, profile, inputArtifacts: [] },
      { kind: 'task', taskId: 'b', name: 'B', order: 1, profile, inputArtifacts: [] },
    ],
    relations: dependencyRelations,
  };
}

function createCommand(commandId = 'create-1'): CreateTaskSpaceCommand<typeof profile> {
  return {
    kind: 'task-space.create',
    commandId,
    taskSpaceId: 'space-1',
    definition: definition(),
    createdAt: at(0),
  };
}

describe('runtime-first TaskSpace processors', () => {
  test('keeps every effectful entry point in the runtime-input-config Processor form', () => {
    for (const processor of [
      createTaskSpace,
      patchTaskSpace,
      claimTask,
      heartbeatTaskClaim,
      expireTaskClaim,
      startTask,
      waitTask,
      settleTask,
      failTask,
      cancelTask,
      replanTask,
    ]) {
      expect(processor.length).toBe(3);
    }
  });

  test('creates a forest, derives dependency readiness and replays by command identity', async () => {
    const owner = new InMemoryTaskSpaceOwner();
    const runtime = { owner };
    const first = await createTaskSpace(runtime, createCommand(), {});
    const replay = await createTaskSpace(runtime, createCommand(), {});

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.receipt).toEqual(first.receipt);
    expect(first.snapshot.tasks.map(({ taskId, status }) => [taskId, status])).toEqual([
      ['a', 'Ready'],
      ['b', 'Pending'],
    ]);
    expect(first.snapshot.revision).toBe(0);
  });

  test('uses an owner-issued live claim for heartbeat, work and settlement', async () => {
    const owner = new InMemoryTaskSpaceOwner();
    const runtime = { owner };
    await createTaskSpace(runtime, createCommand(), {});
    const claimed = await claimTask(runtime, {
      kind: 'task.claim',
      commandId: 'claim-a-1',
      taskSpaceId: 'space-1',
      taskId: 'a',
      expectedRevision: 0,
      assigneeRef: 'member://worker-a',
      claimedAt: at(1),
      leaseDurationMs: 10_000,
    }, {});

    expect(claimed.receipt.claim).toMatchObject({ attempt: 1, leaseEpoch: 1 });
    const heartbeat = await heartbeatTaskClaim(runtime, {
      kind: 'task.claim-heartbeat',
      commandId: 'heartbeat-a-1',
      taskSpaceId: 'space-1',
      expectedRevision: 1,
      claim: claimed.receipt.claim,
      heartbeatAt: at(2),
      extendByMs: 20_000,
    }, {});

    await expect(startTask(runtime, {
      kind: 'task.start',
      commandId: 'start-with-stale-token',
      taskSpaceId: 'space-1',
      expectedRevision: 2,
      claim: claimed.receipt.claim,
      occurredAt: at(3),
    }, {})).rejects.toMatchObject({ code: 'claim-token-mismatch' });

    const started = await startTask(runtime, {
      kind: 'task.start',
      commandId: 'start-a-1',
      taskSpaceId: 'space-1',
      expectedRevision: 2,
      claim: heartbeat.receipt.claim,
      occurredAt: at(3),
    }, {});
    const settled = await settleTask(runtime, {
      kind: 'task.settle',
      commandId: 'settle-a-1',
      taskSpaceId: 'space-1',
      expectedRevision: 3,
      claim: heartbeat.receipt.claim,
      occurredAt: at(4),
      outputArtifacts: [],
      result: { approved: true },
    }, {});
    const replay = await settleTask(runtime, {
      kind: 'task.settle',
      commandId: 'settle-a-1',
      taskSpaceId: 'space-1',
      expectedRevision: 3,
      claim: heartbeat.receipt.claim,
      occurredAt: at(4),
      outputArtifacts: [],
      result: { approved: true },
    }, {});

    expect(started.snapshot.tasks.find(({ taskId }) => taskId === 'a')?.status).toBe('Running');
    expect(settled.receipt.status).toBe('Succeeded');
    expect(settled.snapshot.tasks.find(({ taskId }) => taskId === 'b')?.status).toBe('Ready');
    expect(replay.replayed).toBe(true);

    await expect(cancelTask(runtime, {
      kind: 'task.cancel',
      commandId: 'rewrite-terminal',
      taskSpaceId: 'space-1',
      taskId: 'a',
      expectedRevision: 4,
      cancelledAt: at(5),
      reason: 'too late',
    }, {})).rejects.toMatchObject({ code: 'terminal-task-immutable' });
  });

  test('expires an exact claim and preserves claim history while increasing attempt and epoch', async () => {
    const owner = new InMemoryTaskSpaceOwner();
    const runtime = { owner };
    await createTaskSpace(runtime, createCommand(), {});
    const claimed = await claimTask(runtime, {
      kind: 'task.claim', commandId: 'claim-a-1', taskSpaceId: 'space-1', taskId: 'a',
      expectedRevision: 0, assigneeRef: 'member://first', claimedAt: at(1), leaseDurationMs: 2_000,
    }, {});

    await expect(expireTaskClaim(runtime, {
      kind: 'task.claim-expire', commandId: 'expire-early', taskSpaceId: 'space-1', expectedRevision: 1,
      claim: claimed.receipt.claim, observedAt: at(2),
    }, {})).rejects.toMatchObject({ code: 'claim-not-expired' });

    const expired = await expireTaskClaim(runtime, {
      kind: 'task.claim-expire', commandId: 'expire-a-1', taskSpaceId: 'space-1', expectedRevision: 1,
      claim: claimed.receipt.claim, observedAt: at(4),
    }, {});
    const recovered = await claimTask(runtime, {
      kind: 'task.claim', commandId: 'claim-a-2', taskSpaceId: 'space-1', taskId: 'a',
      expectedRevision: 2, assigneeRef: 'member://second', claimedAt: at(5), leaseDurationMs: 5_000,
    }, {});
    const history = await owner.readHistory('space-1');

    expect(expired.snapshot.tasks.find(({ taskId }) => taskId === 'a')).toMatchObject({
      status: 'Ready', attempt: 2, leaseEpoch: 2, activeClaim: null,
    });
    expect(recovered.receipt.claim).toMatchObject({ attempt: 2, leaseEpoch: 2 });
    expect(history.map(({ kind }) => kind)).toContain('task.claim-expired');
    expect(history.find(({ kind }) => kind === 'task.claimed')).toMatchObject({ claim: claimed.receipt.claim });
  });

  test('supports wait/fail/cancel and rejects stale CAS or cross-space claims', async () => {
    const owner = new InMemoryTaskSpaceOwner();
    const runtime = { owner };
    await createTaskSpace(runtime, createCommand(), {});
    const claimed = await claimTask(runtime, {
      kind: 'task.claim', commandId: 'claim-a-1', taskSpaceId: 'space-1', taskId: 'a',
      expectedRevision: 0, assigneeRef: 'member://worker', claimedAt: at(1), leaseDurationMs: 20_000,
    }, {});
    await startTask(runtime, {
      kind: 'task.start', commandId: 'start-a-1', taskSpaceId: 'space-1', expectedRevision: 1,
      claim: claimed.receipt.claim, occurredAt: at(2),
    }, {});
    const waiting = await waitTask(runtime, {
      kind: 'task.wait', commandId: 'wait-a-1', taskSpaceId: 'space-1', expectedRevision: 2,
      claim: claimed.receipt.claim, occurredAt: at(3), reason: 'external input',
    }, {});
    const failed = await failTask(runtime, {
      kind: 'task.fail', commandId: 'fail-a-1', taskSpaceId: 'space-1', expectedRevision: 3,
      claim: claimed.receipt.claim, occurredAt: at(4),
      failure: { kind: 'task-failure', code: 'rejected', message: 'No', retryable: false },
    }, {});

    expect(waiting.snapshot.tasks.find(({ taskId }) => taskId === 'a')?.status).toBe('Waiting');
    expect(failed.receipt.status).toBe('Failed');

    await expect(claimTask(runtime, {
      kind: 'task.claim', commandId: 'stale', taskSpaceId: 'space-1', taskId: 'b',
      expectedRevision: 0, assigneeRef: 'member://worker', claimedAt: at(5), leaseDurationMs: 1_000,
    }, {})).rejects.toMatchObject({ code: 'revision-conflict' });

    const forged: TaskClaimToken = { ...claimed.receipt.claim, taskSpaceId: 'space-other' };
    await expect(startTask(runtime, {
      kind: 'task.start', commandId: 'cross-space', taskSpaceId: 'space-1', expectedRevision: 4,
      claim: forged, occurredAt: at(5),
    }, {})).rejects.toMatchObject({ code: 'cross-space-identity' });

    const cancelled = await cancelTask(runtime, {
      kind: 'task.cancel', commandId: 'cancel-b', taskSpaceId: 'space-1', taskId: 'b',
      expectedRevision: 4, cancelledAt: at(5), reason: 'upstream failed',
    }, {});
    expect(cancelled.receipt.status).toBe('Cancelled');
  });

  test('rejects cyclic forests and cyclic replans before owner admission', async () => {
    const owner = new InMemoryTaskSpaceOwner();
    const runtime = { owner };
    const cyclic = createCommand();
    const badCreate: CreateTaskSpaceCommand = {
      ...cyclic,
      definition: definition([
        { kind: 'parent-child', relationId: 'root:a', parentTaskId: null, childTaskId: 'a', order: 0 },
        { kind: 'parent-child', relationId: 'root:b', parentTaskId: null, childTaskId: 'b', order: 1 },
        { kind: 'dependency', relationId: 'a:b', predecessorTaskId: 'a', successorTaskId: 'b' },
        { kind: 'dependency', relationId: 'b:a', predecessorTaskId: 'b', successorTaskId: 'a' },
      ]),
    };
    await expect(createTaskSpace(runtime, badCreate, {})).rejects.toMatchObject({ code: 'cyclic-task-forest' });

    await createTaskSpace(runtime, createCommand('create-good'), {});
    await expect(replanTask(runtime, {
      kind: 'task.replan', commandId: 'replan-cycle', taskSpaceId: 'space-1', expectedRevision: 0,
      replannedAt: at(1),
      plan: {
        kind: 'task-plan', planId: 'plan-cycle', reason: 'bad plan',
        tasks: definition().tasks,
        relations: badCreate.definition.relations,
      },
    }, {})).rejects.toMatchObject({ code: 'cyclic-task-forest' });
  });

  test('admits only one of two competing claims through CAS', async () => {
    const owner = new InMemoryTaskSpaceOwner();
    const runtime = { owner };
    await createTaskSpace(runtime, createCommand(), {});
    const command = (id: string, assigneeRef: string): ClaimTaskCommand => ({
      kind: 'task.claim', commandId: id, taskSpaceId: 'space-1', taskId: 'a', expectedRevision: 0,
      assigneeRef, claimedAt: at(1), leaseDurationMs: 10_000,
    });
    const results = await Promise.allSettled([
      claimTask(runtime, command('claim-one', 'member://one'), {}),
      claimTask(runtime, command('claim-two', 'member://two'), {}),
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    const rejected = results.find(({ status }) => status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(TaskManagerError);
    expect(rejected.reason.code).toBe('revision-conflict');
  });
});
