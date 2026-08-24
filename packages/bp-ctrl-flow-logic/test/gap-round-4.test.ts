import { describe, expect, test } from 'bun:test';
import { bpTaskProfile, type BPTaskSpaceDTO, type BPTaskStatus } from 'bp-ctrl-flow-contract';
import type { TaskStatus } from 'task-manager-contract';
import {
  InMemoryTaskSpaceOwner,
  cancelTask,
  claimTask,
  createTaskSpace,
  settleTask,
  startTask,
} from 'task-manager-logic';
import {
  bpTaskSpaceView,
  bpTerminalStatusOf,
  findBPNode,
  legacyBPTaskSpaceToDefinition,
} from '../src/taskSpace.js';

const at = (second: number) => `2026-08-24T00:00:${String(second).padStart(2, '0')}.000Z`;

function nestedLegacy(taskSpaceId: string, executionMode: 'SEQUENTIAL' | 'ANY' | 'ALL' = 'ANY'): BPTaskSpaceDTO {
  return {
    id: taskSpaceId,
    name: 'Gap round 4 BP group authority',
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
        executionMode,
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

function statuses(snapshot: { readonly tasks: readonly { readonly taskId: string; readonly status: TaskStatus }[] }) {
  return Object.fromEntries(snapshot.tasks.map(({ taskId, status }) => [taskId, status]));
}

function bpTerminal(snapshot: Awaited<ReturnType<InMemoryTaskSpaceOwner['readSnapshot']>> & {}, taskId: string) {
  return bpTerminalStatusOf(findBPNode(bpTaskSpaceView(snapshot), taskId)!);
}

async function create(owner: InMemoryTaskSpaceOwner, taskSpaceId: string, mode: 'SEQUENTIAL' | 'ANY' | 'ALL' = 'ANY') {
  const definition = legacyBPTaskSpaceToDefinition(nestedLegacy(taskSpaceId, mode));
  return createTaskSpace({ owner }, {
    kind: 'task-space.create',
    commandId: `create:${taskSpaceId}`,
    taskSpaceId,
    definition,
    createdAt: at(0),
  }, {});
}

async function settleBP(
  owner: InMemoryTaskSpaceOwner,
  taskSpaceId: string,
  taskId: string,
  status: Extract<BPTaskStatus, 'Done' | 'Refused' | 'Forwarded'>,
  second: number,
) {
  const current = (await owner.readSnapshot(taskSpaceId))!;
  const claimed = await claimTask({ owner }, {
    kind: 'task.claim',
    commandId: `claim:${taskSpaceId}:${taskId}:${second}`,
    taskSpaceId,
    taskId,
    expectedRevision: current.revision,
    assigneeRef: `member://${taskId}`,
    claimedAt: at(second),
    leaseDurationMs: 30_000,
  }, {});
  const started = await startTask({ owner }, {
    kind: 'task.start',
    commandId: `start:${taskSpaceId}:${taskId}:${second}`,
    taskSpaceId,
    expectedRevision: claimed.snapshot.revision,
    claim: claimed.receipt.claim,
    occurredAt: at(second + 1),
    profile: bpTaskProfile({
      ownerAccount: `user:${taskId}`,
      status: 'Active',
      startedAtMs: Date.parse(at(second + 1)),
      lifecycleSequence: 1,
    }),
  }, {});
  return settleTask({ owner }, {
    kind: 'task.settle',
    commandId: `settle:${taskSpaceId}:${taskId}:${second}`,
    taskSpaceId,
    expectedRevision: started.snapshot.revision,
    claim: claimed.receipt.claim,
    occurredAt: at(second + 2),
    outputArtifacts: [],
    result: { bpOutcome: status },
    profile: bpTaskProfile({
      ownerAccount: `user:${taskId}`,
      status,
      startedAtMs: Date.parse(at(second + 1)),
      endedAtMs: Date.parse(at(second + 2)),
      lifecycleSequence: 2,
    }),
  }, {});
}

describe('gap round 4 BP group/profile authority', () => {
  test('Refused makes canonical ANY and BP ANY terminal together and unlocks the group successor', async () => {
    const owner = new InMemoryTaskSpaceOwner();
    const taskSpaceId = 'space-gap-4-refused';
    await create(owner, taskSpaceId);
    const refused = await settleBP(owner, taskSpaceId, 'c1', 'Refused', 1);

    expect(statuses(refused.snapshot)).toMatchObject({
      choice: 'Succeeded', c1: 'Succeeded', c2: 'Ready', next: 'Ready', outer: 'Ready',
    });
    expect(bpTerminal(refused.snapshot, 'choice')).toBe('Refused');
    expect(bpTerminal(refused.snapshot, 'outer')).toBeUndefined();
  });

  test('ANY keeps the earliest successful BP profile outcome stable, with child order as the timestamp tie-break', async () => {
    const owner = new InMemoryTaskSpaceOwner();
    const taskSpaceId = 'space-gap-4-stable';
    await create(owner, taskSpaceId);
    const first = await settleBP(owner, taskSpaceId, 'c2', 'Refused', 1);
    expect(bpTerminal(first.snapshot, 'choice')).toBe('Refused');

    const later = await settleBP(owner, taskSpaceId, 'c1', 'Done', 4);
    expect(bpTerminal(later.snapshot, 'choice')).toBe('Refused');

    const tieOwner = new InMemoryTaskSpaceOwner();
    const tieSpaceId = 'space-gap-4-tie';
    await create(tieOwner, tieSpaceId);
    await settleBP(tieOwner, tieSpaceId, 'c2', 'Forwarded', 1);
    const tied = await settleBP(tieOwner, tieSpaceId, 'c1', 'Done', 1);
    expect(bpTerminal(tied.snapshot, 'choice')).toBe('Done');
  });

  for (const mode of ['ALL', 'SEQUENTIAL'] as const) {
    test(`${mode} counts Refused as canonical success but waits for canonical group terminality`, async () => {
      const owner = new InMemoryTaskSpaceOwner();
      const taskSpaceId = `space-gap-4-${mode.toLowerCase()}`;
      await create(owner, taskSpaceId, mode);
      const first = await settleBP(owner, taskSpaceId, 'c1', 'Refused', 1);
      expect(statuses(first.snapshot).choice).not.toBe('Succeeded');
      expect(bpTerminal(first.snapshot, 'choice')).toBeUndefined();

      const second = await settleBP(owner, taskSpaceId, 'c2', 'Done', 4);
      expect(statuses(second.snapshot).choice).toBe('Succeeded');
      expect(bpTerminal(second.snapshot, 'choice')).toBe('Refused');
    });
  }

  test('Abandoned never counts as ANY success and cannot unlock the sequential successor', async () => {
    const owner = new InMemoryTaskSpaceOwner();
    const taskSpaceId = 'space-gap-4-abandoned';
    await create(owner, taskSpaceId);
    for (const [index, taskId] of ['c1', 'c2'].entries()) {
      const current = (await owner.readSnapshot(taskSpaceId))!;
      const cancelled = await cancelTask({ owner }, {
        kind: 'task.cancel',
        commandId: `cancel:${taskSpaceId}:${taskId}`,
        taskSpaceId,
        taskId,
        expectedRevision: current.revision,
        cancelledAt: at(index + 1),
        reason: 'bp.abandon',
        profile: bpTaskProfile({
          ownerAccount: `user:${taskId}`,
          status: 'Abandoned',
          endedAtMs: Date.parse(at(index + 1)),
          lifecycleSequence: 1,
        }),
      }, {});
      expect(statuses(cancelled.snapshot).next).toBe('Pending');
      if (index === 0) expect(bpTerminal(cancelled.snapshot, 'choice')).toBeUndefined();
      else {
        expect(statuses(cancelled.snapshot).choice).toBe('Failed');
        expect(bpTerminal(cancelled.snapshot, 'choice')).toBe('Refused');
      }
    }
  });
});
