import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  canonicalOwnDataDigest,
  type PatchTaskSpaceCommand,
  type TaskHistoryEvent,
  type TaskTransitionReceipt,
} from 'task-manager-contract';
import {
  claimTask,
  createTaskSpace,
  expireTaskClaim,
  settleTask,
  startTask,
} from '../../task-manager-logic/src/index.js';
import {
  FileTaskSpaceError,
  FileTaskSpaceOwner,
  taskArtifactBodyFromBytes,
} from '../src/index.js';

const at = (second: number) => `2026-08-24T00:00:${String(second).padStart(2, '0')}.000Z`;

function root(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'task-space-owner-'));
}

function createCommand(commandId = 'create-1') {
  return {
    kind: 'task-space.create' as const,
    commandId,
    taskSpaceId: 'space-1',
    createdAt: at(0),
    definition: {
      kind: 'task-space-definition' as const,
      taskSpaceId: 'space-1',
      name: 'File owner test',
      schemaVersion: 1,
      tasks: [{
        kind: 'task' as const,
        taskId: 'task-1',
        name: 'Task',
        order: 0,
        profile: {
          kind: 'task-profile' as const,
          profileKind: 'test.task' as const,
          schemaVersion: 1,
          facts: { queue: 'default' as const },
        },
        inputArtifacts: [],
      }],
      relations: [{
        kind: 'parent-child' as const,
        relationId: 'root:task-1',
        parentTaskId: null,
        childTaskId: 'task-1',
        order: 0,
      }],
    },
  };
}

describe('FileTaskSpaceOwner', () => {
  test('restarts from head and preserves immutable history and command receipts', async () => {
    const ownerRoot = root();
    const first = new FileTaskSpaceOwner({ root: ownerRoot });
    const created = await createTaskSpace({ owner: first }, createCommand(), {});
    const second = new FileTaskSpaceOwner({ root: ownerRoot });

    expect(await second.readSnapshot('space-1')).toEqual(created.snapshot);
    expect(await second.readHistory('space-1')).toHaveLength(1);
    expect(await second.readReceiptByCommand('space-1', 'create-1')).toEqual(created.receipt);
    const paths = second.diagnosticPaths('space-1');
    expect(fs.existsSync(paths.headFile)).toBe(true);
    expect(fs.readdirSync(paths.recordsDir)).toHaveLength(1);
    expect(fs.readdirSync(paths.treesDir)).toHaveLength(1);
    expect(fs.readdirSync(paths.receiptsDir)).toHaveLength(1);
  });

  test('writes content-addressed artifacts in the same CAS and verifies full readback', async () => {
    const owner = new FileTaskSpaceOwner({ root: root() });
    const created = await createTaskSpace({ owner }, createCommand(), {});
    const artifact = taskArtifactBodyFromBytes(new TextEncoder().encode('{"answer":42}'), 'application/json');
    const command: PatchTaskSpaceCommand = {
      kind: 'task-space.patch',
      commandId: 'artifact-command',
      taskSpaceId: 'space-1',
      expectedRevision: 0,
      patchedAt: at(1),
      patch: { kind: 'rename-task', taskId: 'task-1', name: 'Task' },
      artifactBodies: [artifact],
    };
    const commandDigest = canonicalOwnDataDigest(command);
    const event: TaskHistoryEvent = {
      kind: 'task-space.patched',
      eventId: 'event:artifact:0',
      commandId: 'artifact-command',
      taskSpaceId: 'space-1',
      sequence: 1,
      fromRevision: 0,
      toRevision: 1,
      occurredAt: at(1),
      taskId: 'task-1',
    };
    const receipt: TaskTransitionReceipt = {
      kind: 'task-transition-receipt',
      receiptId: 'receipt:artifact',
      commandId: 'artifact-command',
      commandDigest,
      taskSpaceId: 'space-1',
      taskId: 'task-1',
      fromRevision: 0,
      toRevision: 1,
      eventIds: [event.eventId],
      committedAt: at(1),
    };
    const snapshot = {
      ...created.snapshot,
      revision: 1,
      historyEventIds: [...created.snapshot.historyEventIds, event.eventId],
      issuedReceiptIds: [...created.snapshot.issuedReceiptIds, receipt.receiptId],
      updatedAt: at(1),
    };

    const committed = await owner.compareAndSwap({
      kind: 'task-space-commit',
      taskSpaceId: 'space-1',
      expectedRevision: 0,
      commandId: 'artifact-command',
      commandDigest,
      command,
      snapshot,
      events: [event],
      receipts: [receipt],
      artifacts: [artifact],
    });
    expect(committed.kind).toBe('commit-accepted');
    expect(await owner.readArtifact('space-1', artifact.digest)).toEqual(artifact);
    const artifactFile = path.join(owner.diagnosticPaths('space-1').artifactsDir, `${artifact.digest}.json`);
    fs.appendFileSync(artifactFile, ' ');
    await expect(owner.readArtifact('space-1', artifact.digest))
      .rejects.toMatchObject({ code: 'digest-mismatch' });
  });

  for (const faultPoint of ['after-journal', 'after-immutable-files', 'after-head-rename'] as const) {
    test(`rolls a durable journal forward after an injected ${faultPoint} crash`, async () => {
      const ownerRoot = root();
      let injected = false;
      const crashing = new FileTaskSpaceOwner({
        root: ownerRoot,
        faultInjector(point) {
          if (!injected && point === faultPoint) {
            injected = true;
            throw new Error(`simulated ${faultPoint} process crash`);
          }
        },
      });
      await expect(createTaskSpace({ owner: crashing }, createCommand(), {}))
        .rejects.toThrow(`simulated ${faultPoint} process crash`);
      const paths = crashing.diagnosticPaths('space-1');
      expect(fs.existsSync(paths.journalFile)).toBe(true);
      expect(fs.existsSync(paths.headFile)).toBe(faultPoint === 'after-head-rename');

      const recovered = new FileTaskSpaceOwner({ root: ownerRoot });
      expect((await recovered.readSnapshot('space-1'))?.revision).toBe(0);
      expect(fs.existsSync(paths.journalFile)).toBe(false);
      expect(fs.existsSync(paths.headFile)).toBe(true);
      expect(await recovered.readReceiptByCommand('space-1', 'create-1')).toBeDefined();
      expect(await recovered.readHistory('space-1')).toHaveLength(1);
    });
  }

  test('replays a recovered claim and terminal settlement across owner restarts', async () => {
    const ownerRoot = root();
    const owner = new FileTaskSpaceOwner({ root: ownerRoot });
    await createTaskSpace({ owner }, createCommand(), {});
    const firstClaim = await claimTask({ owner }, {
      kind: 'task.claim',
      commandId: 'claim-1',
      taskSpaceId: 'space-1',
      taskId: 'task-1',
      expectedRevision: 0,
      assigneeRef: 'member://first',
      claimedAt: at(1),
      leaseDurationMs: 2_000,
    }, {});
    await expireTaskClaim({ owner }, {
      kind: 'task.claim-expire',
      commandId: 'expire-1',
      taskSpaceId: 'space-1',
      expectedRevision: 1,
      claim: firstClaim.receipt.claim,
      observedAt: at(4),
    }, {});
    const recoveredClaim = await claimTask({ owner }, {
      kind: 'task.claim',
      commandId: 'claim-2',
      taskSpaceId: 'space-1',
      taskId: 'task-1',
      expectedRevision: 2,
      assigneeRef: 'member://second',
      claimedAt: at(5),
      leaseDurationMs: 10_000,
    }, {});
    await startTask({ owner }, {
      kind: 'task.start',
      commandId: 'start-2',
      taskSpaceId: 'space-1',
      expectedRevision: 3,
      claim: recoveredClaim.receipt.claim,
      occurredAt: at(6),
    }, {});
    const settled = await settleTask({ owner }, {
      kind: 'task.settle',
      commandId: 'settle-2',
      taskSpaceId: 'space-1',
      expectedRevision: 4,
      claim: recoveredClaim.receipt.claim,
      occurredAt: at(7),
      outputArtifacts: [],
      result: { decision: 'approved' },
    }, {});

    const restarted = new FileTaskSpaceOwner({ root: ownerRoot });
    const replay = await settleTask({ owner: restarted }, {
      kind: 'task.settle',
      commandId: 'settle-2',
      taskSpaceId: 'space-1',
      expectedRevision: 4,
      claim: recoveredClaim.receipt.claim,
      occurredAt: at(7),
      outputArtifacts: [],
      result: { decision: 'approved' },
    }, {});

    expect(recoveredClaim.receipt.claim).toMatchObject({ attempt: 2, leaseEpoch: 2 });
    expect(settled.snapshot.revision).toBe(5);
    expect(replay.replayed).toBe(true);
    expect(replay.receipt).toEqual(settled.receipt);
    expect(replay.snapshot.tasks[0]).toMatchObject({ status: 'Succeeded', activeClaim: null });
    expect((await restarted.readHistory('space-1')).map(({ kind }) => kind)).toEqual([
      'task-space.created',
      'task.claimed',
      'task.claim-expired',
      'task.claimed',
      'task.started',
      'task.settled',
    ]);
  });

  test('admits only one competing CAS writer across owner instances', async () => {
    const ownerRoot = root();
    const one = new FileTaskSpaceOwner({ root: ownerRoot });
    const two = new FileTaskSpaceOwner({ root: ownerRoot });
    const results = await Promise.allSettled([
      createTaskSpace({ owner: one }, createCommand('create-one'), {}),
      createTaskSpace({ owner: two }, createCommand('create-two'), {}),
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect((await one.readSnapshot('space-1'))?.revision).toBe(0);
  });

  test('rejects path traversal via symlinked space directories', async () => {
    const ownerRoot = root();
    const outside = root();
    const owner = new FileTaskSpaceOwner({ root: ownerRoot });
    const paths = owner.diagnosticPaths('space-1');
    fs.mkdirSync(path.dirname(paths.spaceDir), { recursive: true });
    fs.symlinkSync(outside, paths.spaceDir);

    await expect(owner.readSnapshot('space-1')).rejects.toBeInstanceOf(FileTaskSpaceError);
    await expect(owner.readSnapshot('space-1')).rejects.toMatchObject({ code: 'path-boundary' });
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  test('recovers a dead lock by atomic inode claim and never trusts its filename alone', async () => {
    const ownerRoot = root();
    const owner = new FileTaskSpaceOwner({ root: ownerRoot });
    await createTaskSpace({ owner }, createCommand(), {});
    const paths = owner.diagnosticPaths('space-1');
    fs.writeFileSync(paths.lockFile, JSON.stringify({
      kind: 'task-space-lock',
      token: 'dead-owner',
      pid: 99_999_999,
      acquiredAtMs: 0,
    }));

    expect((await new FileTaskSpaceOwner({ root: ownerRoot }).readSnapshot('space-1'))?.taskSpaceId).toBe('space-1');
    expect(fs.existsSync(paths.lockFile)).toBe(false);
  });

  test('fails closed when immutable record bytes no longer match the head digest', async () => {
    const ownerRoot = root();
    const owner = new FileTaskSpaceOwner({ root: ownerRoot });
    await createTaskSpace({ owner }, createCommand(), {});
    const paths = owner.diagnosticPaths('space-1');
    const head = JSON.parse(fs.readFileSync(paths.headFile, 'utf8')) as { recordDigest: string };
    fs.appendFileSync(path.join(paths.recordsDir, `${head.recordDigest}.json`), ' ');

    await expect(new FileTaskSpaceOwner({ root: ownerRoot }).readSnapshot('space-1'))
      .rejects.toMatchObject({ code: 'digest-mismatch' });
  });

  test('fails closed on corrupt journal, head, history and receipt material', async () => {
    const journalRoot = root();
    const journalOwner = new FileTaskSpaceOwner({ root: journalRoot });
    await createTaskSpace({ owner: journalOwner }, createCommand(), {});
    fs.writeFileSync(journalOwner.diagnosticPaths('space-1').journalFile, '{]');
    await expect(new FileTaskSpaceOwner({ root: journalRoot }).readSnapshot('space-1'))
      .rejects.toMatchObject({ code: 'journal-corrupt' });

    const headRoot = root();
    const headOwner = new FileTaskSpaceOwner({ root: headRoot });
    await createTaskSpace({ owner: headOwner }, createCommand(), {});
    fs.appendFileSync(headOwner.diagnosticPaths('space-1').headFile, ' ');
    await expect(new FileTaskSpaceOwner({ root: headRoot }).readSnapshot('space-1'))
      .rejects.toMatchObject({ code: 'digest-mismatch' });

    const historyRoot = root();
    const historyOwner = new FileTaskSpaceOwner({ root: historyRoot });
    await createTaskSpace({ owner: historyOwner }, createCommand(), {});
    const historyPaths = historyOwner.diagnosticPaths('space-1');
    fs.appendFileSync(path.join(historyPaths.historyDir, fs.readdirSync(historyPaths.historyDir)[0]!), ' ');
    await expect(new FileTaskSpaceOwner({ root: historyRoot }).readHistory('space-1'))
      .rejects.toMatchObject({ code: 'digest-mismatch' });

    const receiptRoot = root();
    const receiptOwner = new FileTaskSpaceOwner({ root: receiptRoot });
    await createTaskSpace({ owner: receiptOwner }, createCommand(), {});
    const receiptPaths = receiptOwner.diagnosticPaths('space-1');
    fs.appendFileSync(path.join(receiptPaths.receiptsDir, fs.readdirSync(receiptPaths.receiptsDir)[0]!), ' ');
    await expect(new FileTaskSpaceOwner({ root: receiptRoot }).readReceiptByCommand('space-1', 'create-1'))
      .rejects.toMatchObject({ code: 'digest-mismatch' });
  });
});
