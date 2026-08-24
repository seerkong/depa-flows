import { describe, expect, test } from 'bun:test';
import type {
  CreateTaskSpaceCommand,
  PatchTaskSpaceCommand,
  TaskArtifactBody,
  TaskArtifactRef,
  TaskHistoryEvent,
  TaskProfileEnvelope,
  TaskSpaceDefinition,
  TaskTransitionReceipt,
} from 'task-manager-contract';
import { canonicalOwnDataDigest } from 'task-manager-contract';
import {
  InMemoryTaskSpaceOwner,
  claimTask,
  createTaskSpace,
  patchTaskSpace,
  settleTask,
  startTask,
} from '../src/index.js';

const at = (second: number) => `2026-08-24T00:00:${String(second).padStart(2, '0')}.000Z`;
const profile: TaskProfileEnvelope<'test.task', { readonly state: string }> = {
  kind: 'task-profile',
  profileKind: 'test.task',
  schemaVersion: 1,
  facts: { state: 'initial' },
};

function leafDefinition(name = 'Exact command'): TaskSpaceDefinition<typeof profile> {
  return {
    kind: 'task-space-definition',
    taskSpaceId: 'space-gap',
    name,
    schemaVersion: 1,
    tasks: [{
      kind: 'task', taskId: 'a', name: 'A', order: 0, profile, inputArtifacts: [],
    }],
    relations: [{
      kind: 'parent-child', relationId: 'root:a', parentTaskId: null, childTaskId: 'a', order: 0,
    }],
  };
}

function createCommand(name = 'Exact command'): CreateTaskSpaceCommand<typeof profile> {
  return {
    kind: 'task-space.create',
    commandId: 'create-gap',
    taskSpaceId: 'space-gap',
    definition: leafDefinition(name),
    createdAt: at(0),
  };
}

async function terminalSpace(owner = new InMemoryTaskSpaceOwner()) {
  await createTaskSpace({ owner }, createCommand(), {});
  const claimed = await claimTask({ owner }, {
    kind: 'task.claim', commandId: 'claim-gap', taskSpaceId: 'space-gap', taskId: 'a',
    expectedRevision: 0, assigneeRef: 'member://a', claimedAt: at(1), leaseDurationMs: 10_000,
  }, {});
  await startTask({ owner }, {
    kind: 'task.start', commandId: 'start-gap', taskSpaceId: 'space-gap', expectedRevision: 1,
    claim: claimed.receipt.claim, occurredAt: at(2),
  }, {});
  const settled = await settleTask({ owner }, {
    kind: 'task.settle', commandId: 'settle-gap', taskSpaceId: 'space-gap', expectedRevision: 2,
    claim: claimed.receipt.claim, occurredAt: at(3), outputArtifacts: [], result: { ok: true },
  }, {});
  return { owner, settled };
}

describe('gap round 1 kernel authority', () => {
  test('binds replay to the complete canonical command, not only commandId and receipt kind', async () => {
    const owner = new InMemoryTaskSpaceOwner();
    const first = await createTaskSpace({ owner }, createCommand(), {});

    expect(first.receipt.commandDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    await expect(createTaskSpace({ owner }, createCommand('Different command body'), {}))
      .rejects.toMatchObject({ code: 'command-receipt-mismatch' });
    expect((await owner.readSnapshot('space-gap'))?.definition.name).toBe('Exact command');
  });

  test('deep-clones and deep-freezes all owner write/read/result boundaries', async () => {
    const owner = new InMemoryTaskSpaceOwner();
    const command = createCommand();
    const created = await createTaskSpace({ owner }, command, {});
    (command.definition.tasks as unknown as Array<unknown>).push({ poisoned: true });

    const read = await owner.readSnapshot('space-gap');
    expect(read?.tasks).toHaveLength(1);
    expect(Object.isFrozen(created)).toBe(true);
    expect(Object.isFrozen(created.snapshot)).toBe(true);
    expect(Object.isFrozen(created.snapshot.tasks)).toBe(true);
    expect(Object.isFrozen(created.snapshot.tasks[0]!.profile.facts)).toBe(true);
    expect(Object.isFrozen(read)).toBe(true);
    expect(Object.isFrozen(read!.definition.tasks)).toBe(true);
    expect(() => (read!.definition.tasks as unknown as Array<unknown>).push({})).toThrow();
  });

  test('rejects profile replacement after terminal settlement', async () => {
    const { owner, settled } = await terminalSpace();
    await expect(patchTaskSpace({ owner }, {
      kind: 'task-space.patch',
      commandId: 'replace-terminal-profile',
      taskSpaceId: 'space-gap',
      expectedRevision: settled.snapshot.revision,
      patchedAt: at(4),
      patch: {
        kind: 'replace-task-profile',
        taskId: 'a',
        profile: { ...profile, facts: { state: 'rewritten' } },
      },
    }, {})).rejects.toMatchObject({ code: 'terminal-task-immutable' });
  });

  test('projects TaskGroup lifecycle and makes group dependency endpoints reachable', async () => {
    const owner = new InMemoryTaskSpaceOwner();
    const definition: TaskSpaceDefinition<typeof profile> = {
      kind: 'task-space-definition',
      taskSpaceId: 'space-gap',
      name: 'Group projection',
      schemaVersion: 1,
      tasks: [
        { kind: 'task-group', taskId: 'g', name: 'G', order: 0, mode: 'sequential', profile, inputArtifacts: [] },
        { kind: 'task', taskId: 'a', name: 'A', order: 0, profile, inputArtifacts: [] },
        { kind: 'task', taskId: 'b', name: 'B', order: 1, profile, inputArtifacts: [] },
        { kind: 'task', taskId: 'c', name: 'C', order: 1, profile, inputArtifacts: [] },
      ],
      relations: [
        { kind: 'parent-child', relationId: 'root:g', parentTaskId: null, childTaskId: 'g', order: 0 },
        { kind: 'parent-child', relationId: 'g:a', parentTaskId: 'g', childTaskId: 'a', order: 0 },
        { kind: 'parent-child', relationId: 'g:b', parentTaskId: 'g', childTaskId: 'b', order: 1 },
        { kind: 'parent-child', relationId: 'root:c', parentTaskId: null, childTaskId: 'c', order: 1 },
        { kind: 'dependency', relationId: 'a:b', predecessorTaskId: 'a', successorTaskId: 'b' },
        { kind: 'dependency', relationId: 'g:c', predecessorTaskId: 'g', successorTaskId: 'c' },
      ],
    };
    let snapshot = (await createTaskSpace({ owner }, {
      kind: 'task-space.create', commandId: 'group-create', taskSpaceId: 'space-gap', definition, createdAt: at(0),
    }, {})).snapshot;
    expect(snapshot.tasks.map(({ taskId, status }) => [taskId, status])).toEqual([
      ['g', 'Ready'], ['a', 'Ready'], ['b', 'Pending'], ['c', 'Pending'],
    ]);

    for (const [taskId, second] of [['a', 1], ['b', 4]] as const) {
      const claimed = await claimTask({ owner }, {
        kind: 'task.claim', commandId: `claim-${taskId}`, taskSpaceId: 'space-gap', taskId,
        expectedRevision: snapshot.revision, assigneeRef: `member://${taskId}`, claimedAt: at(second), leaseDurationMs: 30_000,
      }, {});
      const started = await startTask({ owner }, {
        kind: 'task.start', commandId: `start-${taskId}`, taskSpaceId: 'space-gap',
        expectedRevision: claimed.snapshot.revision, claim: claimed.receipt.claim, occurredAt: at(second + 1),
      }, {});
      snapshot = (await settleTask({ owner }, {
        kind: 'task.settle', commandId: `settle-${taskId}`, taskSpaceId: 'space-gap',
        expectedRevision: started.snapshot.revision, claim: claimed.receipt.claim, occurredAt: at(second + 2),
        outputArtifacts: [],
      }, {})).snapshot;
    }

    expect(snapshot.tasks.find(({ taskId }) => taskId === 'g')?.status).toBe('Succeeded');
    expect(snapshot.tasks.find(({ taskId }) => taskId === 'c')?.status).toBe('Ready');
    expect((await owner.readHistory('space-gap')).map(({ kind }) => kind)).toContain('task.group-status-projected');
  });

  test('rejects cycles that alternate containment and dependency edges', async () => {
    const definition: TaskSpaceDefinition<typeof profile> = {
      kind: 'task-space-definition', taskSpaceId: 'space-gap', name: 'Mixed cycle', schemaVersion: 1,
      tasks: [
        { kind: 'task-group', taskId: 'g', name: 'G', order: 0, mode: 'all', profile, inputArtifacts: [] },
        { kind: 'task', taskId: 'a', name: 'A', order: 0, profile, inputArtifacts: [] },
      ],
      relations: [
        { kind: 'parent-child', relationId: 'root:g', parentTaskId: null, childTaskId: 'g', order: 0 },
        { kind: 'parent-child', relationId: 'g:a', parentTaskId: 'g', childTaskId: 'a', order: 0 },
        { kind: 'dependency', relationId: 'g:a-dependency', predecessorTaskId: 'g', successorTaskId: 'a' },
      ],
    };
    await expect(createTaskSpace({ owner: new InMemoryTaskSpaceOwner() }, {
      kind: 'task-space.create', commandId: 'mixed-cycle', taskSpaceId: 'space-gap', definition, createdAt: at(0),
    }, {})).rejects.toMatchObject({ code: 'cyclic-task-forest' });
  });

  test('requires every artifact ref to resolve in the same owner with exact metadata', async () => {
    const ref: TaskArtifactRef = {
      kind: 'task-artifact-ref',
      digest: 'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
      mediaType: 'text/plain',
      sizeBytes: 5,
    };
    const body: TaskArtifactBody = {
      kind: 'task-artifact-body',
      digest: ref.digest,
      mediaType: ref.mediaType,
      sizeBytes: ref.sizeBytes,
      encoding: 'base64',
      data: 'aGVsbG8=',
    };
    const dangling = {
      ...createCommand(),
      definition: {
        ...createCommand().definition,
        tasks: [{ ...createCommand().definition.tasks[0]!, inputArtifacts: [ref] }],
      },
    };
    await expect(createTaskSpace({ owner: new InMemoryTaskSpaceOwner() }, dangling, {}))
      .rejects.toMatchObject({ code: 'artifact-not-found' });

    const owner = new InMemoryTaskSpaceOwner();
    const admitted = {
      ...createCommand(),
      definition: {
        ...createCommand().definition,
        tasks: [{ ...createCommand().definition.tasks[0]!, inputArtifacts: [ref] }],
      },
      artifactBodies: [body],
    };
    await createTaskSpace({ owner }, admitted, {});
    expect(await owner.readArtifact('space-gap', ref.digest)).toEqual(body);

    const wrongMedia = { ...ref, mediaType: 'application/json' };
    const nextOwner = new InMemoryTaskSpaceOwner();
    const conflicting = {
      ...createCommand(),
      definition: {
        ...createCommand().definition,
        tasks: [{ ...createCommand().definition.tasks[0]!, inputArtifacts: [wrongMedia] }],
      },
      artifactBodies: [body],
    };
    await expect(createTaskSpace({ owner: nextOwner }, conflicting, {}))
      .rejects.toMatchObject({ code: 'artifact-conflict' });
  });

  test('in-memory raw CAS rejects a dangling artifact ref when processors are bypassed', async () => {
    const owner = new InMemoryTaskSpaceOwner();
    const created = await createTaskSpace({ owner }, createCommand(), {});
    const artifact: TaskArtifactRef = {
      kind: 'task-artifact-ref',
      digest: 'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
      mediaType: 'text/plain',
      sizeBytes: 5,
    };
    const command: PatchTaskSpaceCommand = {
      kind: 'task-space.patch', commandId: 'raw-memory-dangling', taskSpaceId: 'space-gap',
      expectedRevision: 0, patchedAt: at(1),
      patch: { kind: 'attach-task-input-artifact', taskId: 'a', artifact },
    };
    const commandDigest = canonicalOwnDataDigest(command);
    const nextDefinition = {
      ...created.snapshot.definition,
      tasks: created.snapshot.definition.tasks.map((task) => ({ ...task, inputArtifacts: [artifact] })),
    };
    const nextTasks = created.snapshot.tasks.map((task) => ({
      ...task,
      definition: nextDefinition.tasks.find(({ taskId }) => taskId === task.taskId)!,
    }));
    const event: TaskHistoryEvent = {
      kind: 'task-space.patched', eventId: 'event:raw-memory-dangling:0', commandId: command.commandId,
      taskSpaceId: command.taskSpaceId, sequence: 1, fromRevision: 0, toRevision: 1,
      occurredAt: at(1), taskId: 'a',
    };
    const receipt: TaskTransitionReceipt = {
      kind: 'task-transition-receipt', receiptId: 'receipt:raw-memory-dangling', commandId: command.commandId,
      commandDigest, taskSpaceId: command.taskSpaceId, fromRevision: 0, toRevision: 1,
      eventIds: [event.eventId], committedAt: at(1), taskId: 'a',
    };

    await expect(owner.compareAndSwap({
      kind: 'task-space-commit', taskSpaceId: command.taskSpaceId, expectedRevision: 0,
      commandId: command.commandId, commandDigest, command,
      snapshot: {
        ...created.snapshot, revision: 1, definition: nextDefinition, tasks: nextTasks,
        historyEventIds: [...created.snapshot.historyEventIds, event.eventId],
        issuedReceiptIds: [...created.snapshot.issuedReceiptIds, receipt.receiptId], updatedAt: at(1),
      },
      events: [event], receipts: [receipt], artifacts: [],
    })).rejects.toMatchObject({ code: 'artifact-not-found' });
  });
});
