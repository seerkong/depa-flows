import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  PatchTaskSpaceCommand,
  TaskArtifactBody,
  TaskArtifactRef,
  TaskHistoryEvent,
  TaskSpaceCommit,
  TaskSpaceOwnerPort,
  TaskSpaceSnapshot,
  TaskTransitionReceipt,
} from 'task-manager-contract';
import { canonicalOwnDataDigest } from 'task-manager-contract';
import {
  InMemoryTaskSpaceOwner,
  createTaskSpace,
  patchTaskSpace,
} from '../../task-manager-logic/src/index.js';
import { FileTaskSpaceOwner } from '../src/index.js';

const at = (second: number) => `2026-08-24T00:00:${String(second).padStart(2, '0')}.000Z`;
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
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const ownerRoot of temporaryRoots.splice(0)) fs.rmSync(ownerRoot, { recursive: true, force: true });
});

function ownerRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-space-gap-3-owner-'));
  temporaryRoots.push(root);
  return root;
}

function createCommand(taskSpaceId: string, withArtifact = false) {
  return {
    kind: 'task-space.create' as const,
    commandId: `create:${taskSpaceId}`,
    taskSpaceId,
    createdAt: at(0),
    definition: {
      kind: 'task-space-definition' as const,
      taskSpaceId,
      name: 'Gap round 3 owner parity',
      schemaVersion: 1,
      tasks: [{
        kind: 'task' as const,
        taskId: 'a',
        name: 'A',
        order: 0,
        profile: {
          kind: 'task-profile' as const,
          profileKind: 'test.task' as const,
          schemaVersion: 1,
          facts: { queue: 'default' as const },
        },
        inputArtifacts: withArtifact ? [artifactRef] : [],
      }],
      relations: [{
        kind: 'parent-child' as const,
        relationId: 'root:a',
        parentTaskId: null,
        childTaskId: 'a',
        order: 0,
      }],
    },
    ...(withArtifact ? { artifactBodies: [artifactBody] } : {}),
  };
}

function rawPatchCommit(
  snapshot: TaskSpaceSnapshot,
  input: {
    readonly commandId: string;
    readonly artifact?: TaskArtifactRef;
    readonly receiptEventIds?: readonly string[];
    readonly receiptCommandDigest?: `sha256:${string}`;
    readonly eventSequence?: number;
  },
): TaskSpaceCommit {
  const command: PatchTaskSpaceCommand = input.artifact
    ? {
      kind: 'task-space.patch',
      commandId: input.commandId,
      taskSpaceId: snapshot.taskSpaceId,
      expectedRevision: snapshot.revision,
      patchedAt: at(1),
      patch: { kind: 'attach-task-input-artifact', taskId: 'a', artifact: input.artifact },
    }
    : {
      kind: 'task-space.patch',
      commandId: input.commandId,
      taskSpaceId: snapshot.taskSpaceId,
      expectedRevision: snapshot.revision,
      patchedAt: at(1),
      patch: { kind: 'rename-task', taskId: 'a', name: 'Renamed' },
    };
  const commandDigest = canonicalOwnDataDigest(command);
  const nextTaskDefinition = {
    ...snapshot.definition.tasks[0]!,
    ...(input.artifact ? { inputArtifacts: [input.artifact] } : { name: 'Renamed' }),
  };
  const nextDefinition = { ...snapshot.definition, tasks: [nextTaskDefinition] };
  const event: TaskHistoryEvent = {
    kind: 'task-space.patched',
    eventId: `event:${input.commandId}:0`,
    commandId: command.commandId,
    taskSpaceId: command.taskSpaceId,
    sequence: input.eventSequence ?? snapshot.historyEventIds.length,
    fromRevision: snapshot.revision,
    toRevision: snapshot.revision + 1,
    occurredAt: at(1),
    taskId: 'a',
  };
  const receipt: TaskTransitionReceipt = {
    kind: 'task-transition-receipt',
    receiptId: `receipt:${input.commandId}`,
    commandId: command.commandId,
    commandDigest: input.receiptCommandDigest ?? commandDigest,
    taskSpaceId: command.taskSpaceId,
    fromRevision: snapshot.revision,
    toRevision: snapshot.revision + 1,
    eventIds: input.receiptEventIds ?? [event.eventId],
    committedAt: at(1),
    taskId: 'a',
  };
  return {
    kind: 'task-space-commit',
    taskSpaceId: command.taskSpaceId,
    expectedRevision: snapshot.revision,
    commandId: command.commandId,
    commandDigest,
    command,
    snapshot: {
      ...snapshot,
      revision: snapshot.revision + 1,
      definition: nextDefinition,
      tasks: snapshot.tasks.map((task) => ({
        ...task,
        definition: nextTaskDefinition,
        ...(input.artifact ? {} : { updatedAt: at(1) }),
      })),
      historyEventIds: [...snapshot.historyEventIds, event.eventId],
      issuedReceiptIds: [...snapshot.issuedReceiptIds, receipt.receiptId],
      updatedAt: at(1),
    },
    events: [event],
    receipts: [receipt],
    artifacts: [],
  };
}

async function admissionOutcome(owner: TaskSpaceOwnerPort, commit: TaskSpaceCommit): Promise<string> {
  try {
    return (await owner.compareAndSwap(commit)).kind;
  } catch (error) {
    return String((error as { readonly code?: unknown }).code);
  }
}

describe('gap round 3 shared owner authority', () => {
  test('memory and file owners return the same code for receipt, digest and append-only identity violations', async () => {
    const memory = new InMemoryTaskSpaceOwner();
    const file = new FileTaskSpaceOwner({ root: ownerRoot() });
    const createdMemory = await createTaskSpace({ owner: memory }, createCommand('space-gap-3-parity'), {});
    await createTaskSpace({ owner: file }, createCommand('space-gap-3-parity'), {});

    const malformed = [
      rawPatchCommit(createdMemory.snapshot, {
        commandId: 'receipt-events-mismatch',
        receiptEventIds: ['event:forged-not-admitted'],
      }),
      rawPatchCommit(createdMemory.snapshot, {
        commandId: 'receipt-digest-mismatch',
        receiptCommandDigest: `sha256:${'0'.repeat(64)}`,
      }),
      rawPatchCommit(createdMemory.snapshot, {
        commandId: 'event-sequence-mismatch',
        eventSequence: 99,
      }),
    ];

    for (const commit of malformed) {
      expect(await admissionOutcome(memory, commit)).toBe('invalid-commit');
      expect(await admissionOutcome(file, commit)).toBe('invalid-commit');
    }
    const valid = rawPatchCommit(createdMemory.snapshot, { commandId: 'valid-owner-parity' });
    const [memoryResult, fileResult] = await Promise.all([
      memory.compareAndSwap(valid),
      file.compareAndSwap(valid),
    ]);
    expect(memoryResult.kind).toBe('commit-accepted');
    expect(fileResult.kind).toBe(memoryResult.kind);
    expect(fileResult).toEqual(memoryResult);
    expect(await memory.readSnapshot('space-gap-3-parity')).toEqual(await file.readSnapshot('space-gap-3-parity'));
  });

  test('complete ArtifactRef identity fails closed in Processor, raw memory, raw file and restart paths', async () => {
    const conflicts = [
      { ...artifactRef, name: 'other.txt' },
      { ...artifactRef, mediaType: 'application/json' },
      { ...artifactRef, sizeBytes: 6 },
    ] as const;

    const processorOwner = new InMemoryTaskSpaceOwner();
    const processorCreated = await createTaskSpace(
      { owner: processorOwner },
      createCommand('space-gap-3-processor', true),
      {},
    );
    for (const [index, artifact] of conflicts.entries()) {
      await expect(patchTaskSpace({ owner: processorOwner }, {
        kind: 'task-space.patch',
        commandId: `processor-conflict:${index}`,
        taskSpaceId: 'space-gap-3-processor',
        expectedRevision: processorCreated.snapshot.revision,
        patchedAt: at(1),
        patch: { kind: 'attach-task-input-artifact', taskId: 'a', artifact },
      }, {})).rejects.toMatchObject({ code: 'artifact-conflict' });
    }

    const memory = new InMemoryTaskSpaceOwner();
    const memoryCreated = await createTaskSpace({ owner: memory }, createCommand('space-gap-3-memory', true), {});
    for (const [index, artifact] of conflicts.entries()) {
      expect(await admissionOutcome(memory, rawPatchCommit(memoryCreated.snapshot, {
        commandId: `memory-conflict:${index}`,
        artifact,
      }))).toBe('artifact-conflict');
    }

    for (const restart of [false, true]) {
      const root = ownerRoot();
      const first = new FileTaskSpaceOwner({ root });
      const taskSpaceId = `space-gap-3-file-${String(restart)}`;
      const created = await createTaskSpace({ owner: first }, createCommand(taskSpaceId, true), {});
      const file = restart ? new FileTaskSpaceOwner({ root }) : first;
      for (const [index, artifact] of conflicts.entries()) {
        expect(await admissionOutcome(file, rawPatchCommit(created.snapshot, {
          commandId: `file-${String(restart)}-conflict:${index}`,
          artifact,
        }))).toBe('artifact-conflict');
      }
    }
  });
});
