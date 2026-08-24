import { describe, expect, test } from 'bun:test';
import type {
  ReplanTaskCommand,
  TaskArtifactBody,
  TaskArtifactRef,
  TaskProfileEnvelope,
  TaskRelation,
  TaskSpaceDefinition,
} from 'task-manager-contract';
import {
  InMemoryTaskSpaceOwner,
  claimTask,
  createTaskSpace,
  replanTask,
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

function definition(): TaskSpaceDefinition<typeof profile> {
  return {
    kind: 'task-space-definition',
    taskSpaceId: 'space-gap-4',
    name: 'Gap round 4 terminal definition authority',
    schemaVersion: 1,
    tasks: [{
      kind: 'task',
      taskId: 'a',
      name: 'A',
      description: 'Original definition',
      order: 0,
      profile,
      inputArtifacts: [],
    }],
    relations: [{
      kind: 'parent-child',
      relationId: 'root:a',
      parentTaskId: null,
      childTaskId: 'a',
      order: 0,
    }],
  };
}

async function terminalOwner() {
  const owner = new InMemoryTaskSpaceOwner();
  const created = await createTaskSpace({ owner }, {
    kind: 'task-space.create',
    commandId: 'create-gap-4',
    taskSpaceId: 'space-gap-4',
    definition: definition(),
    createdAt: at(0),
  }, {});
  const claimed = await claimTask({ owner }, {
    kind: 'task.claim',
    commandId: 'claim-gap-4',
    taskSpaceId: 'space-gap-4',
    taskId: 'a',
    expectedRevision: created.snapshot.revision,
    assigneeRef: 'member://a',
    claimedAt: at(1),
    leaseDurationMs: 30_000,
  }, {});
  const started = await startTask({ owner }, {
    kind: 'task.start',
    commandId: 'start-gap-4',
    taskSpaceId: 'space-gap-4',
    expectedRevision: claimed.snapshot.revision,
    claim: claimed.receipt.claim,
    occurredAt: at(2),
  }, {});
  const settled = await settleTask({ owner }, {
    kind: 'task.settle',
    commandId: 'settle-gap-4',
    taskSpaceId: 'space-gap-4',
    expectedRevision: started.snapshot.revision,
    claim: claimed.receipt.claim,
    occurredAt: at(3),
    outputArtifacts: [],
    result: { accepted: true },
  }, {});
  return { owner, settled };
}

interface Mutation {
  readonly tasks: TaskSpaceDefinition['tasks'];
  readonly relations: readonly TaskRelation[];
  readonly artifactBodies?: readonly TaskArtifactBody[];
}

describe('gap round 4 terminal replan authority', () => {
  const mutations: readonly {
    readonly name: string;
    readonly build: (original: TaskSpaceDefinition) => Mutation;
  }[] = [
    { name: 'name', build: (original) => ({
      tasks: [{ ...original.tasks[0]!, name: 'MUTATED' }], relations: original.relations,
    }) },
    { name: 'profile facts', build: (original) => ({
      tasks: [{ ...original.tasks[0]!, profile: { ...profile, facts: { state: 'rewritten' } } }],
      relations: original.relations,
    }) },
    { name: 'profile identity', build: (original) => ({
      tasks: [{ ...original.tasks[0]!, profile: { ...profile, profileKind: 'test.other' } }],
      relations: original.relations,
    }) },
    { name: 'input artifacts', build: (original) => ({
      tasks: [{ ...original.tasks[0]!, inputArtifacts: [artifactRef] }],
      relations: original.relations,
      artifactBodies: [artifactBody],
    }) },
    { name: 'order', build: (original) => ({
      tasks: [{ ...original.tasks[0]!, order: 1 }], relations: original.relations,
    }) },
    { name: 'kind', build: (original) => ({
      tasks: [
        { ...original.tasks[0]!, kind: 'task-group', mode: 'all' },
        { kind: 'task', taskId: 'child', name: 'Child', order: 0, profile, inputArtifacts: [] },
      ],
      relations: [
        original.relations[0]!,
        { kind: 'parent-child', relationId: 'a:child', parentTaskId: 'a', childTaskId: 'child', order: 0 },
      ],
    }) },
    { name: 'task identity', build: (original) => ({
      tasks: [{ ...original.tasks[0]!, taskId: 'renamed' }],
      relations: [{ ...original.relations[0]!, relationId: 'root:renamed', childTaskId: 'renamed' }],
    }) },
    { name: 'incident relation identity/order', build: (original) => ({
      tasks: original.tasks,
      relations: [{ ...original.relations[0]!, relationId: 'root:a:rewritten', order: 1 }],
    }) },
  ];

  for (const [index, mutationCase] of mutations.entries()) {
    test(`rejects a surviving terminal ${mutationCase.name} rewrite canonically`, async () => {
      const { owner, settled } = await terminalOwner();
      const original = settled.snapshot.definition;
      const task = original.tasks[0]!;
      const mutation = mutationCase.build(original);
      const command: ReplanTaskCommand = {
        kind: 'task.replan',
        commandId: `replan-terminal-${index}`,
        taskSpaceId: 'space-gap-4',
        expectedRevision: settled.snapshot.revision,
        replannedAt: at(4 + index),
        plan: {
          kind: 'task-plan',
          planId: `plan-terminal-${mutationCase.name}`,
          reason: `must reject terminal ${mutationCase.name} rewrite`,
          tasks: mutation.tasks,
          relations: mutation.relations,
        },
        ...(mutation.artifactBodies === undefined ? {} : { artifactBodies: mutation.artifactBodies }),
      };
      await expect(replanTask({ owner }, command, {}))
        .rejects.toMatchObject({ code: 'terminal-task-immutable' });
      const current = await owner.readSnapshot('space-gap-4');
      expect(current?.revision).toBe(settled.snapshot.revision);
      expect(current?.definition).toEqual(original);
      expect(current?.tasks[0]?.definition).toEqual(task);
      expect(current?.tasks[0]?.profile).toEqual(profile);
    });
  }

  test('allows new tasks and relations that are not incident to the terminal task', async () => {
    const { owner, settled } = await terminalOwner();
    const original = settled.snapshot.definition;
    const addedTask = {
      kind: 'task' as const,
      taskId: 'b',
      name: 'B',
      order: 1,
      profile,
      inputArtifacts: [],
    };
    const addedRelation = {
      kind: 'parent-child' as const,
      relationId: 'root:b',
      parentTaskId: null,
      childTaskId: 'b',
      order: 1,
    };

    const replanned = await replanTask({ owner }, {
      kind: 'task.replan',
      commandId: 'replan-unrelated-addition',
      taskSpaceId: 'space-gap-4',
      expectedRevision: settled.snapshot.revision,
      replannedAt: at(12),
      plan: {
        kind: 'task-plan',
        planId: 'plan-unrelated-addition',
        reason: 'unrelated additions remain admissible',
        tasks: [...original.tasks, addedTask],
        relations: [...original.relations, addedRelation],
      },
    }, {});

    expect(replanned.snapshot.revision).toBe(settled.snapshot.revision + 1);
    expect(replanned.snapshot.tasks.find((task) => task.taskId === 'a')?.definition)
      .toEqual(original.tasks[0]);
    expect(replanned.snapshot.tasks.find((task) => task.taskId === 'b')?.status).toBe('Ready');
  });
});
