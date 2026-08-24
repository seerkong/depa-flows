import { describe, expect, test } from 'bun:test';
import type {
  CreateTaskSpaceCommand,
  PatchTaskSpaceCommand,
  ReplanTaskCommand,
  TaskArtifactBody,
  TaskArtifactRef,
  TaskHistoryEvent,
  TaskProfileEnvelope,
  TaskSpaceDefinition,
  TaskStatus,
  TaskTransitionReceipt,
} from 'task-manager-contract';
import { canonicalOwnDataDigest } from 'task-manager-contract';
import * as taskManagerLogic from '../src/index.js';

const at = (second: number) => `2026-08-24T00:00:${String(second).padStart(2, '0')}.000Z`;
const profile: TaskProfileEnvelope<'test.task', { readonly state: string }> = {
  kind: 'task-profile',
  profileKind: 'test.task',
  schemaVersion: 1,
  facts: { state: 'initial' },
};
const artifactRef: TaskArtifactRef = {
  kind: 'task-artifact-ref',
  digest: 'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
  mediaType: 'text/plain',
  sizeBytes: 5,
  name: 'hello.txt',
};
const artifactBody: TaskArtifactBody = {
  kind: 'task-artifact-body',
  digest: artifactRef.digest,
  mediaType: artifactRef.mediaType,
  sizeBytes: artifactRef.sizeBytes,
  encoding: 'base64',
  data: 'aGVsbG8=',
};

function leafDefinition(name = 'Gap round 2', inputArtifacts: readonly TaskArtifactRef[] = []): TaskSpaceDefinition<typeof profile> {
  return {
    kind: 'task-space-definition',
    taskSpaceId: 'space-gap-2',
    name,
    schemaVersion: 1,
    tasks: [{ kind: 'task', taskId: 'a', name: 'A', order: 0, profile, inputArtifacts }],
    relations: [{
      kind: 'parent-child', relationId: 'root:a', parentTaskId: null, childTaskId: 'a', order: 0,
    }],
  };
}

function createCommand(
  name = 'Gap round 2',
  inputArtifacts: readonly TaskArtifactRef[] = [],
): CreateTaskSpaceCommand<typeof profile> {
  return {
    kind: 'task-space.create',
    commandId: 'create-gap-2',
    taskSpaceId: 'space-gap-2',
    definition: leafDefinition(name, inputArtifacts),
    createdAt: at(0),
    ...(inputArtifacts.length === 0 ? {} : { artifactBodies: [artifactBody] }),
  };
}

function projectedStatuses(snapshot: { readonly tasks: readonly { readonly taskId: string; readonly status: TaskStatus }[] }) {
  return Object.fromEntries(snapshot.tasks.map(({ taskId, status }) => [taskId, status]));
}

async function settleReadyTask(
  owner: taskManagerLogic.InMemoryTaskSpaceOwner,
  taskId: string,
  sequence: number,
) {
  const snapshot = await owner.readSnapshot('space-gap-2');
  const claimed = await taskManagerLogic.claimTask({ owner }, {
    kind: 'task.claim', commandId: `claim-${taskId}`, taskSpaceId: 'space-gap-2', taskId,
    expectedRevision: snapshot!.revision, assigneeRef: `member://${taskId}`, claimedAt: at(sequence),
    leaseDurationMs: 30_000,
  }, {});
  const started = await taskManagerLogic.startTask({ owner }, {
    kind: 'task.start', commandId: `start-${taskId}`, taskSpaceId: 'space-gap-2',
    expectedRevision: claimed.snapshot.revision, claim: claimed.receipt.claim, occurredAt: at(sequence + 1),
  }, {});
  return taskManagerLogic.settleTask({ owner }, {
    kind: 'task.settle', commandId: `settle-${taskId}`, taskSpaceId: 'space-gap-2',
    expectedRevision: started.snapshot.revision, claim: claimed.receipt.claim, occurredAt: at(sequence + 2),
    outputArtifacts: [],
  }, {});
}

describe('gap round 2 TaskSpace authority', () => {
  test('raw memory-owner replay recomputes the submitted canonical command before trusting an old digest', async () => {
    const owner = new taskManagerLogic.InMemoryTaskSpaceOwner();
    const created = await taskManagerLogic.createTaskSpace({ owner }, createCommand(), {});
    const forged = createCommand('FORGED DIFFERENT BODY');

    await expect(owner.compareAndSwap({
      kind: 'task-space-commit',
      taskSpaceId: forged.taskSpaceId,
      expectedRevision: null,
      commandId: forged.commandId,
      commandDigest: created.receipt.commandDigest,
      command: forged,
      snapshot: created.snapshot,
      events: [],
      receipts: [],
      artifacts: [],
    })).rejects.toMatchObject({ code: 'command-receipt-mismatch' });
  });

  test('does not export a mutable terminal authority and keeps terminal replan/group guards closed', async () => {
    const owner = new taskManagerLogic.InMemoryTaskSpaceOwner();
    const definition: TaskSpaceDefinition<typeof profile> = {
      kind: 'task-space-definition', taskSpaceId: 'space-gap-2', name: 'Terminal group', schemaVersion: 1,
      tasks: [
        { kind: 'task-group', taskId: 'g', name: 'G', order: 0, mode: 'any', profile, inputArtifacts: [] },
        { kind: 'task', taskId: 'a', name: 'A', order: 0, profile, inputArtifacts: [] },
        { kind: 'task', taskId: 'b', name: 'B', order: 1, profile, inputArtifacts: [] },
      ],
      relations: [
        { kind: 'parent-child', relationId: 'root:g', parentTaskId: null, childTaskId: 'g', order: 0 },
        { kind: 'parent-child', relationId: 'g:a', parentTaskId: 'g', childTaskId: 'a', order: 0 },
        { kind: 'parent-child', relationId: 'g:b', parentTaskId: 'g', childTaskId: 'b', order: 1 },
      ],
    };
    await taskManagerLogic.createTaskSpace({ owner }, {
      kind: 'task-space.create', commandId: 'create-terminal-group', taskSpaceId: 'space-gap-2', definition,
      createdAt: at(0),
    }, {});
    const settled = await settleReadyTask(owner, 'a', 1);
    expect(projectedStatuses(settled.snapshot)).toMatchObject({ a: 'Succeeded', g: 'Succeeded' });

    const exported = (taskManagerLogic as unknown as {
      readonly TERMINAL_STATUSES?: Set<TaskStatus>;
    }).TERMINAL_STATUSES;
    try {
      exported?.delete('Succeeded');
      expect(taskManagerLogic.isTerminal('Succeeded')).toBe(true);
      await expect(taskManagerLogic.replanTask({ owner }, {
        kind: 'task.replan', commandId: 'remove-terminal-child', taskSpaceId: 'space-gap-2',
        expectedRevision: settled.snapshot.revision, replannedAt: at(5),
        plan: {
          kind: 'task-plan', planId: 'remove-a', reason: 'must fail closed',
          tasks: definition.tasks.filter(({ taskId }) => taskId !== 'a'),
          relations: definition.relations.filter((relation) =>
            relation.kind !== 'parent-child' || relation.childTaskId !== 'a'),
        },
      }, {})).rejects.toMatchObject({ code: 'terminal-task-immutable' });
      expect((await owner.readSnapshot('space-gap-2'))?.tasks.find(({ taskId }) => taskId === 'g')?.status)
        .toBe('Succeeded');
      expect(exported).toBeUndefined();
    } finally {
      exported?.add('Succeeded');
    }
  });

  test('rejects explicit reverse dependencies across implicit sequential order on create and nested replan', async () => {
    const direct: TaskSpaceDefinition<typeof profile> = {
      kind: 'task-space-definition', taskSpaceId: 'space-gap-2', name: 'Direct reverse', schemaVersion: 1,
      tasks: [
        { kind: 'task-group', taskId: 'g', name: 'G', order: 0, mode: 'sequential', profile, inputArtifacts: [] },
        { kind: 'task', taskId: 'a', name: 'A', order: 0, profile, inputArtifacts: [] },
        { kind: 'task', taskId: 'b', name: 'B', order: 1, profile, inputArtifacts: [] },
      ],
      relations: [
        { kind: 'parent-child', relationId: 'root:g', parentTaskId: null, childTaskId: 'g', order: 0 },
        { kind: 'parent-child', relationId: 'g:a', parentTaskId: 'g', childTaskId: 'a', order: 0 },
        { kind: 'parent-child', relationId: 'g:b', parentTaskId: 'g', childTaskId: 'b', order: 1 },
        { kind: 'dependency', relationId: 'b:a', predecessorTaskId: 'b', successorTaskId: 'a' },
      ],
    };
    await expect(taskManagerLogic.createTaskSpace({ owner: new taskManagerLogic.InMemoryTaskSpaceOwner() }, {
      kind: 'task-space.create', commandId: 'direct-reverse', taskSpaceId: 'space-gap-2', definition: direct,
      createdAt: at(0),
    }, {})).rejects.toMatchObject({ code: 'cyclic-task-forest' });

    const owner = new taskManagerLogic.InMemoryTaskSpaceOwner();
    const created = await taskManagerLogic.createTaskSpace({ owner }, createCommand(), {});
    const nestedTasks: TaskSpaceDefinition<typeof profile>['tasks'] = [
      { kind: 'task-group', taskId: 'outer', name: 'Outer', order: 0, mode: 'sequential', profile, inputArtifacts: [] },
      { kind: 'task-group', taskId: 'left', name: 'Left', order: 0, mode: 'all', profile, inputArtifacts: [] },
      { kind: 'task-group', taskId: 'right', name: 'Right', order: 1, mode: 'all', profile, inputArtifacts: [] },
      { kind: 'task', taskId: 'l', name: 'L', order: 0, profile, inputArtifacts: [] },
      { kind: 'task', taskId: 'r', name: 'R', order: 0, profile, inputArtifacts: [] },
    ];
    const nestedRelations: TaskSpaceDefinition['relations'] = [
      { kind: 'parent-child', relationId: 'root:outer', parentTaskId: null, childTaskId: 'outer', order: 0 },
      { kind: 'parent-child', relationId: 'outer:left', parentTaskId: 'outer', childTaskId: 'left', order: 0 },
      { kind: 'parent-child', relationId: 'outer:right', parentTaskId: 'outer', childTaskId: 'right', order: 1 },
      { kind: 'parent-child', relationId: 'left:l', parentTaskId: 'left', childTaskId: 'l', order: 0 },
      { kind: 'parent-child', relationId: 'right:r', parentTaskId: 'right', childTaskId: 'r', order: 0 },
      { kind: 'dependency', relationId: 'r:left', predecessorTaskId: 'r', successorTaskId: 'left' },
    ];
    const replan: ReplanTaskCommand = {
      kind: 'task.replan', commandId: 'nested-reverse', taskSpaceId: 'space-gap-2',
      expectedRevision: created.snapshot.revision, replannedAt: at(1),
      plan: { kind: 'task-plan', planId: 'nested-reverse', tasks: nestedTasks, relations: nestedRelations, reason: 'probe' },
    };
    await expect(taskManagerLogic.replanTask({ owner }, replan, {}))
      .rejects.toMatchObject({ code: 'cyclic-task-forest' });
  });

  test('keeps non-cyclic sequential, all and any groups reachable through inherited group dependencies', async () => {
    const owner = new taskManagerLogic.InMemoryTaskSpaceOwner();
    const tasks: TaskSpaceDefinition<typeof profile>['tasks'] = [
      { kind: 'task-group', taskId: 'seq', name: 'Sequential', order: 0, mode: 'sequential', profile, inputArtifacts: [] },
      { kind: 'task', taskId: 's1', name: 'S1', order: 0, profile, inputArtifacts: [] },
      { kind: 'task', taskId: 's2', name: 'S2', order: 1, profile, inputArtifacts: [] },
      { kind: 'task-group', taskId: 'all', name: 'All', order: 1, mode: 'all', profile, inputArtifacts: [] },
      { kind: 'task', taskId: 'a1', name: 'A1', order: 0, profile, inputArtifacts: [] },
      { kind: 'task', taskId: 'a2', name: 'A2', order: 1, profile, inputArtifacts: [] },
      { kind: 'task-group', taskId: 'any', name: 'Any', order: 2, mode: 'any', profile, inputArtifacts: [] },
      { kind: 'task', taskId: 'n1', name: 'N1', order: 0, profile, inputArtifacts: [] },
      { kind: 'task', taskId: 'n2', name: 'N2', order: 1, profile, inputArtifacts: [] },
    ];
    const relations: TaskSpaceDefinition['relations'] = [
      { kind: 'parent-child', relationId: 'root:seq', parentTaskId: null, childTaskId: 'seq', order: 0 },
      { kind: 'parent-child', relationId: 'seq:s1', parentTaskId: 'seq', childTaskId: 's1', order: 0 },
      { kind: 'parent-child', relationId: 'seq:s2', parentTaskId: 'seq', childTaskId: 's2', order: 1 },
      { kind: 'parent-child', relationId: 'root:all', parentTaskId: null, childTaskId: 'all', order: 1 },
      { kind: 'parent-child', relationId: 'all:a1', parentTaskId: 'all', childTaskId: 'a1', order: 0 },
      { kind: 'parent-child', relationId: 'all:a2', parentTaskId: 'all', childTaskId: 'a2', order: 1 },
      { kind: 'parent-child', relationId: 'root:any', parentTaskId: null, childTaskId: 'any', order: 2 },
      { kind: 'parent-child', relationId: 'any:n1', parentTaskId: 'any', childTaskId: 'n1', order: 0 },
      { kind: 'parent-child', relationId: 'any:n2', parentTaskId: 'any', childTaskId: 'n2', order: 1 },
      { kind: 'dependency', relationId: 'seq:all', predecessorTaskId: 'seq', successorTaskId: 'all' },
      { kind: 'dependency', relationId: 'all:any', predecessorTaskId: 'all', successorTaskId: 'any' },
    ];
    const created = await taskManagerLogic.createTaskSpace({ owner }, {
      kind: 'task-space.create', commandId: 'valid-groups', taskSpaceId: 'space-gap-2', createdAt: at(0),
      definition: { kind: 'task-space-definition', taskSpaceId: 'space-gap-2', name: 'Valid groups', schemaVersion: 1, tasks, relations },
    }, {});
    expect(projectedStatuses(created.snapshot)).toMatchObject({
      seq: 'Ready', s1: 'Ready', s2: 'Pending', all: 'Pending', a1: 'Pending', a2: 'Pending',
      any: 'Pending', n1: 'Pending', n2: 'Pending',
    });
    await settleReadyTask(owner, 's1', 1);
    expect(projectedStatuses((await owner.readSnapshot('space-gap-2'))!)).toMatchObject({ s2: 'Ready', all: 'Pending' });
    await settleReadyTask(owner, 's2', 4);
    expect(projectedStatuses((await owner.readSnapshot('space-gap-2'))!)).toMatchObject({ seq: 'Succeeded', a1: 'Ready', a2: 'Ready' });
    await settleReadyTask(owner, 'a1', 7);
    await settleReadyTask(owner, 'a2', 10);
    expect(projectedStatuses((await owner.readSnapshot('space-gap-2'))!)).toMatchObject({ all: 'Succeeded', n1: 'Ready', n2: 'Ready' });
    const finished = await settleReadyTask(owner, 'n1', 13);
    expect(projectedStatuses(finished.snapshot)).toMatchObject({ any: 'Succeeded', n2: 'Ready' });
  });

  test('deduplicates only exact artifact refs and rejects same-digest metadata conflicts in Processor and raw owner paths', async () => {
    const owner = new taskManagerLogic.InMemoryTaskSpaceOwner();
    const created = await taskManagerLogic.createTaskSpace({ owner }, createCommand('Artifacts', [artifactRef]), {});
    const exact = await taskManagerLogic.patchTaskSpace({ owner }, {
      kind: 'task-space.patch', commandId: 'attach-exact', taskSpaceId: 'space-gap-2', expectedRevision: 0,
      patchedAt: at(1), patch: { kind: 'attach-task-input-artifact', taskId: 'a', artifact: artifactRef },
    }, {});
    expect(exact.snapshot.definition.tasks[0]!.inputArtifacts).toEqual([artifactRef]);

    for (const [commandId, conflicting] of [
      ['attach-media-conflict', { ...artifactRef, mediaType: 'application/json' }],
      ['attach-size-conflict', { ...artifactRef, sizeBytes: 6 }],
      ['attach-name-conflict', { ...artifactRef, name: 'other.txt' }],
    ] as const) {
      await expect(taskManagerLogic.patchTaskSpace({ owner }, {
        kind: 'task-space.patch', commandId, taskSpaceId: 'space-gap-2', expectedRevision: exact.snapshot.revision,
        patchedAt: at(2), patch: { kind: 'attach-task-input-artifact', taskId: 'a', artifact: conflicting },
      }, {})).rejects.toMatchObject({ code: 'artifact-conflict' });
    }

    const conflicting = { ...artifactRef, mediaType: 'application/json' };
    const command: PatchTaskSpaceCommand = {
      kind: 'task-space.patch', commandId: 'raw-artifact-conflict', taskSpaceId: 'space-gap-2',
      expectedRevision: exact.snapshot.revision, patchedAt: at(3),
      patch: { kind: 'attach-task-input-artifact', taskId: 'a', artifact: conflicting },
    };
    const commandDigest = canonicalOwnDataDigest(command);
    const nextDefinition = {
      ...exact.snapshot.definition,
      tasks: exact.snapshot.definition.tasks.map((task) => ({ ...task, inputArtifacts: [conflicting] })),
    };
    const event: TaskHistoryEvent = {
      kind: 'task-space.patched', eventId: 'event:raw-artifact-conflict:0', commandId: command.commandId,
      taskSpaceId: command.taskSpaceId, sequence: exact.snapshot.historyEventIds.length,
      fromRevision: exact.snapshot.revision, toRevision: exact.snapshot.revision + 1,
      occurredAt: at(3), taskId: 'a',
    };
    const receipt: TaskTransitionReceipt = {
      kind: 'task-transition-receipt', receiptId: 'receipt:raw-artifact-conflict', commandId: command.commandId,
      commandDigest, taskSpaceId: command.taskSpaceId, fromRevision: exact.snapshot.revision,
      toRevision: exact.snapshot.revision + 1, eventIds: [event.eventId], committedAt: at(3), taskId: 'a',
    };
    await expect(owner.compareAndSwap({
      kind: 'task-space-commit', taskSpaceId: command.taskSpaceId, expectedRevision: exact.snapshot.revision,
      commandId: command.commandId, commandDigest, command,
      snapshot: {
        ...exact.snapshot, revision: exact.snapshot.revision + 1, definition: nextDefinition,
        tasks: exact.snapshot.tasks.map((task) => ({ ...task, definition: nextDefinition.tasks[0]! })),
        historyEventIds: [...exact.snapshot.historyEventIds, event.eventId],
        issuedReceiptIds: [...exact.snapshot.issuedReceiptIds, receipt.receiptId], updatedAt: at(3),
      },
      events: [event], receipts: [receipt], artifacts: [],
    })).rejects.toMatchObject({ code: 'artifact-conflict' });
    expect(created.snapshot.definition.tasks[0]!.inputArtifacts).toEqual([artifactRef]);
  });
});
