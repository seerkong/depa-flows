import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  PatchTaskSpaceCommand,
  TaskArtifactRef,
  TaskHistoryEvent,
  TaskSpaceCommit,
  TaskTransitionReceipt,
} from 'task-manager-contract';
import { canonicalOwnDataDigest } from 'task-manager-contract';
import { createTaskSpace } from '../../task-manager-logic/src/index.js';
import { FileTaskSpaceOwner, taskArtifactBodyFromBytes } from '../src/index.js';

const at = (second: number) => `2026-08-24T00:00:${String(second).padStart(2, '0')}.000Z`;

function root(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'task-space-gap-2-owner-'));
}

function createCommand(name = 'Gap round 2 file owner', artifact?: TaskArtifactRef) {
  return {
    kind: 'task-space.create' as const,
    commandId: 'create-gap-2-file',
    taskSpaceId: 'space-gap-2-file',
    createdAt: at(0),
    definition: {
      kind: 'task-space-definition' as const,
      taskSpaceId: 'space-gap-2-file',
      name,
      schemaVersion: 1,
      tasks: [{
        kind: 'task' as const, taskId: 'a', name: 'A', order: 0,
        profile: {
          kind: 'task-profile' as const, profileKind: 'test.task' as const, schemaVersion: 1,
          facts: { queue: 'default' as const },
        },
        inputArtifacts: artifact ? [artifact] : [],
      }],
      relations: [{
        kind: 'parent-child' as const, relationId: 'root:a', parentTaskId: null, childTaskId: 'a', order: 0,
      }],
    },
  };
}

function rawArtifactPatchCommit(
  snapshot: Awaited<ReturnType<FileTaskSpaceOwner['readSnapshot']>> & {},
  artifact: TaskArtifactRef,
): TaskSpaceCommit {
  const command: PatchTaskSpaceCommand = {
    kind: 'task-space.patch', commandId: 'raw-file-artifact-conflict', taskSpaceId: snapshot.taskSpaceId,
    expectedRevision: snapshot.revision, patchedAt: at(1),
    patch: { kind: 'attach-task-input-artifact', taskId: 'a', artifact },
  };
  const commandDigest = canonicalOwnDataDigest(command);
  const nextDefinition = {
    ...snapshot.definition,
    tasks: snapshot.definition.tasks.map((task) => ({ ...task, inputArtifacts: [artifact] })),
  };
  const event: TaskHistoryEvent = {
    kind: 'task-space.patched', eventId: 'event:raw-file-artifact-conflict:0', commandId: command.commandId,
    taskSpaceId: command.taskSpaceId, sequence: snapshot.historyEventIds.length,
    fromRevision: snapshot.revision, toRevision: snapshot.revision + 1, occurredAt: at(1), taskId: 'a',
  };
  const receipt: TaskTransitionReceipt = {
    kind: 'task-transition-receipt', receiptId: 'receipt:raw-file-artifact-conflict', commandId: command.commandId,
    commandDigest, taskSpaceId: command.taskSpaceId, fromRevision: snapshot.revision,
    toRevision: snapshot.revision + 1, eventIds: [event.eventId], committedAt: at(1), taskId: 'a',
  };
  return {
    kind: 'task-space-commit', taskSpaceId: command.taskSpaceId, expectedRevision: snapshot.revision,
    commandId: command.commandId, commandDigest, command,
    snapshot: {
      ...snapshot, revision: snapshot.revision + 1, definition: nextDefinition,
      tasks: snapshot.tasks.map((task) => ({ ...task, definition: nextDefinition.tasks[0]! })),
      historyEventIds: [...snapshot.historyEventIds, event.eventId],
      issuedReceiptIds: [...snapshot.issuedReceiptIds, receipt.receiptId], updatedAt: at(1),
    },
    events: [event], receipts: [receipt], artifacts: [],
  };
}

describe('gap round 2 file-owner authority', () => {
  test('restart replay recomputes the submitted canonical command before trusting an old digest/index', async () => {
    const ownerRoot = root();
    const first = new FileTaskSpaceOwner({ root: ownerRoot });
    const created = await createTaskSpace({ owner: first }, createCommand(), {});
    const forged = createCommand('FORGED DIFFERENT BODY');
    const restarted = new FileTaskSpaceOwner({ root: ownerRoot });

    await expect(restarted.compareAndSwap({
      kind: 'task-space-commit', taskSpaceId: forged.taskSpaceId, expectedRevision: null,
      commandId: forged.commandId, commandDigest: created.receipt.commandDigest, command: forged,
      snapshot: created.snapshot, events: [], receipts: [], artifacts: [],
    })).rejects.toMatchObject({ code: 'command-receipt-mismatch' });
  });

  test('restart raw CAS rejects same-digest reference metadata that conflicts with immutable artifact authority', async () => {
    const ownerRoot = root();
    const body = taskArtifactBodyFromBytes(new TextEncoder().encode('hello'), 'text/plain');
    const ref: TaskArtifactRef = {
      kind: 'task-artifact-ref', digest: body.digest, mediaType: body.mediaType, sizeBytes: body.sizeBytes,
      name: 'hello.txt',
    };
    const command = { ...createCommand('Artifact authority', ref), artifactBodies: [body] };
    await createTaskSpace({ owner: new FileTaskSpaceOwner({ root: ownerRoot }) }, command, {});
    const restarted = new FileTaskSpaceOwner({ root: ownerRoot });
    const snapshot = await restarted.readSnapshot(command.taskSpaceId);

    await expect(restarted.compareAndSwap(rawArtifactPatchCommit(snapshot!, {
      ...ref,
      mediaType: 'application/json',
    }))).rejects.toMatchObject({ code: 'artifact-conflict' });
  });

  for (const faultPoint of [
    'after-immutable-temp-create',
    'after-immutable-temp-write',
    'after-immutable-temp-fsync',
    'after-immutable-publish',
  ] as const) {
    test(`rolls forward after an immutable ${faultPoint} interruption`, async () => {
      const ownerRoot = root();
      let injected = false;
      const crashing = new FileTaskSpaceOwner({
        root: ownerRoot,
        faultInjector(point: string) {
          if (!injected && point === faultPoint) {
            injected = true;
            throw new Error(`simulated ${faultPoint} crash`);
          }
        },
      });
      await expect(createTaskSpace({ owner: crashing }, createCommand(), {}))
        .rejects.toThrow(`simulated ${faultPoint} crash`);
      const paths = crashing.diagnosticPaths('space-gap-2-file');
      expect(fs.existsSync(paths.journalFile)).toBe(true);
      expect(fs.existsSync(paths.headFile)).toBe(false);

      const recovered = new FileTaskSpaceOwner({ root: ownerRoot });
      expect((await recovered.readSnapshot('space-gap-2-file'))?.revision).toBe(0);
      expect(fs.existsSync(paths.journalFile)).toBe(false);
      expect(fs.existsSync(paths.headFile)).toBe(true);
      expect(await recovered.readReceiptByCommand('space-gap-2-file', 'create-gap-2-file')).toBeDefined();
      expect(await recovered.readHistory('space-gap-2-file')).toHaveLength(1);
      expect([
        ...fs.readdirSync(paths.treesDir),
        ...fs.readdirSync(paths.recordsDir),
        ...fs.readdirSync(paths.receiptsDir),
        ...fs.readdirSync(paths.commandsDir),
        ...fs.readdirSync(paths.historyDir),
      ].some((name) => name.includes('.txn-'))).toBe(false);
    });
  }

  test('accepts an exact already-published immutable target, finishes missing siblings, and rejects conflicts', async () => {
    const exactRoot = root();
    const crashing = new FileTaskSpaceOwner({
      root: exactRoot,
      faultInjector(point) {
        if (point === 'after-journal') throw new Error('retain exact journal');
      },
    });
    await expect(createTaskSpace({ owner: crashing }, createCommand(), {})).rejects.toThrow('retain exact journal');
    const exactPaths = crashing.diagnosticPaths('space-gap-2-file');
    const journal = JSON.parse(fs.readFileSync(exactPaths.journalFile, 'utf8')) as {
      entries: { relativePath: string; dataBase64: string }[];
    };
    const first = journal.entries[0]!;
    const firstTarget = path.resolve(exactPaths.spaceDir, ...first.relativePath.split('/'));
    fs.writeFileSync(firstTarget, Buffer.from(first.dataBase64, 'base64'));
    expect((await new FileTaskSpaceOwner({ root: exactRoot }).readSnapshot('space-gap-2-file'))?.revision).toBe(0);
    expect(fs.existsSync(exactPaths.headFile)).toBe(true);
    expect(fs.existsSync(exactPaths.journalFile)).toBe(false);

    const conflictRoot = root();
    const conflicting = new FileTaskSpaceOwner({
      root: conflictRoot,
      faultInjector(point) {
        if (point === 'after-journal') throw new Error('retain conflicting journal');
      },
    });
    await expect(createTaskSpace({ owner: conflicting }, createCommand(), {}))
      .rejects.toThrow('retain conflicting journal');
    const conflictPaths = conflicting.diagnosticPaths('space-gap-2-file');
    const conflictJournal = JSON.parse(fs.readFileSync(conflictPaths.journalFile, 'utf8')) as {
      entries: { relativePath: string }[];
    };
    const conflictTarget = path.resolve(conflictPaths.spaceDir, ...conflictJournal.entries[0]!.relativePath.split('/'));
    fs.writeFileSync(conflictTarget, 'partial-or-conflicting');
    await expect(new FileTaskSpaceOwner({ root: conflictRoot }).readSnapshot('space-gap-2-file'))
      .rejects.toMatchObject({ code: 'immutable-conflict' });
    expect(fs.existsSync(conflictPaths.headFile)).toBe(false);
    expect(fs.existsSync(conflictPaths.journalFile)).toBe(true);
  });
});
