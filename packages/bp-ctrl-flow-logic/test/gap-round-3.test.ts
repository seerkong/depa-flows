import { describe, expect, test } from 'bun:test';
import type { BPTaskSpaceDTO } from 'bp-ctrl-flow-contract';
import { loadFlowBundleFromSources } from 'instant-ctrl-flow-logic';
import type { TaskSpaceDefinition, TaskStatus } from 'task-manager-contract';
import {
  InMemoryTaskSpaceOwner,
  claimTask,
  createTaskSpace,
  settleTask,
  startTask,
} from 'task-manager-logic';
import {
  legacyBPTaskSpaceToDefinition,
  taskSpaceDefinitionFromSpec,
} from '../src/taskSpace.js';

const at = (second: number) => `2026-08-24T00:00:${String(second).padStart(2, '0')}.000Z`;

function nestedLegacy(taskSpaceId: string): BPTaskSpaceDTO {
  return {
    id: taskSpaceId,
    name: 'Nested canonical sequential dependency',
    version: 1,
    children: [{
      kind: 'group',
      id: 'outer',
      name: 'Outer',
      executionMode: 'SEQUENTIAL',
      order: 0,
      children: [{
        kind: 'group',
        id: 'choice',
        name: 'Choice',
        executionMode: 'ANY',
        order: 0,
        children: [
          { kind: 'task', id: 'c1', name: 'Choice 1', ownerAccount: 'user:c1', status: 'NotStarted', order: 0 },
          { kind: 'task', id: 'c2', name: 'Choice 2', ownerAccount: 'user:c2', status: 'NotStarted', order: 1 },
        ],
      }, {
        kind: 'task', id: 'next', name: 'Next', ownerAccount: 'user:next', status: 'NotStarted', order: 1,
      }],
    }],
  };
}

function authoredDefinition(taskSpaceId: string): TaskSpaceDefinition {
  const loaded = loadFlowBundleFromSources({
    'manifest.xnl': `<BPCtrlFlow #test.Gap3 apiVersion="depa.flows/v1" version="1" (
      <TaskSpace #test.Gap3 [
        <TaskGroup #outer { name = "Outer" executionMode = "SEQUENTIAL" order = 0 } [
          <TaskGroup #choice { name = "Choice" executionMode = "ANY" order = 0 } [
            <Task #c1 { name = "Choice 1" ownerAccount = "user:c1" status = "NotStarted" order = 0 }>
            <Task #c2 { name = "Choice 2" ownerAccount = "user:c2" status = "NotStarted" order = 1 }>
          ]>
          <Task #next { name = "Next" ownerAccount = "user:next" status = "NotStarted" order = 1 }>
        ]>
      ]>
    ) [<TaskStep #step { task = "task-space://#outer" }>]>`,
  });
  return taskSpaceDefinitionFromSpec(loaded.spec!.taskSpace!, taskSpaceId);
}

function statuses(snapshot: { readonly tasks: readonly { readonly taskId: string; readonly status: TaskStatus }[] }) {
  return Object.fromEntries(snapshot.tasks.map(({ taskId, status }) => [taskId, status]));
}

async function settle(owner: InMemoryTaskSpaceOwner, taskSpaceId: string, taskId: string, second: number) {
  const current = (await owner.readSnapshot(taskSpaceId))!;
  const claimed = await claimTask({ owner }, {
    kind: 'task.claim',
    commandId: `claim:${taskSpaceId}:${taskId}`,
    taskSpaceId,
    taskId,
    expectedRevision: current.revision,
    assigneeRef: `member://${taskId}`,
    claimedAt: at(second),
    leaseDurationMs: 30_000,
  }, {});
  const started = await startTask({ owner }, {
    kind: 'task.start',
    commandId: `start:${taskSpaceId}:${taskId}`,
    taskSpaceId,
    expectedRevision: claimed.snapshot.revision,
    claim: claimed.receipt.claim,
    occurredAt: at(second + 1),
  }, {});
  return settleTask({ owner }, {
    kind: 'task.settle',
    commandId: `settle:${taskSpaceId}:${taskId}`,
    taskSpaceId,
    expectedRevision: started.snapshot.revision,
    claim: claimed.receipt.claim,
    occurredAt: at(second + 2),
    outputArtifacts: [],
  }, {});
}

describe('gap round 3 BP canonical group dependencies', () => {
  test('authored and legacy nested sequential groups depend only on canonical sibling group identity', async () => {
    const definitions = [
      authoredDefinition('space-gap-3-authored'),
      legacyBPTaskSpaceToDefinition(nestedLegacy('space-gap-3-legacy')),
    ];

    for (const definition of definitions) {
      expect(definition.relations.filter(({ kind }) => kind === 'dependency')).toEqual([]);
      const owner = new InMemoryTaskSpaceOwner();
      const created = await createTaskSpace({ owner }, {
        kind: 'task-space.create',
        commandId: `create:${definition.taskSpaceId}`,
        taskSpaceId: definition.taskSpaceId,
        definition,
        createdAt: at(0),
      }, {});
      expect(statuses(created.snapshot)).toMatchObject({ outer: 'Ready', choice: 'Ready', c1: 'Ready', c2: 'Ready', next: 'Pending' });

      const choiceSettled = await settle(owner, definition.taskSpaceId, 'c1', 1);
      expect(statuses(choiceSettled.snapshot)).toMatchObject({
        choice: 'Succeeded',
        c1: 'Succeeded',
        c2: 'Ready',
        next: 'Ready',
        outer: 'Ready',
      });

      const outerSettled = await settle(owner, definition.taskSpaceId, 'next', 4);
      expect(statuses(outerSettled.snapshot)).toMatchObject({
        choice: 'Succeeded',
        c2: 'Ready',
        next: 'Succeeded',
        outer: 'Succeeded',
      });
    }
  });
});
