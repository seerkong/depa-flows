import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  canonicalOwnDataDigest,
  type PatchTaskSpaceCommand,
  type TaskArtifactRef,
  type TaskHistoryEvent,
  type TaskTransitionReceipt,
} from 'task-manager-contract';
import { createTaskSpace } from '../../task-manager-logic/src/index.js';
import { FileTaskSpaceOwner } from '../src/index.js';

const at = (second: number) => `2026-08-24T00:00:${String(second).padStart(2, '0')}.000Z`;

function root(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'task-space-gap-owner-'));
}

function createCommand() {
  return {
    kind: 'task-space.create' as const,
    commandId: 'create-gap-file',
    taskSpaceId: 'space-gap-file',
    createdAt: at(0),
    definition: {
      kind: 'task-space-definition' as const,
      taskSpaceId: 'space-gap-file',
      name: 'Gap file owner',
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
        inputArtifacts: [],
      }],
      relations: [{
        kind: 'parent-child' as const,
        relationId: 'root:a',
        parentTaskId: null,
        childTaskId: 'a',
        order: 0,
      }],
    },
  };
}

describe('gap round 1 file owner authority', () => {
  test('persists exact command identity across restart and returns deep-frozen authority values', async () => {
    const ownerRoot = root();
    const owner = new FileTaskSpaceOwner({ root: ownerRoot });
    const command = createCommand();
    const created = await createTaskSpace({ owner }, command, {});
    const restarted = new FileTaskSpaceOwner({ root: ownerRoot });
    const snapshot = await restarted.readSnapshot(command.taskSpaceId);

    expect(Object.isFrozen(created.snapshot.tasks)).toBe(true);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot!.definition.tasks)).toBe(true);
    expect(Object.isFrozen(snapshot!.tasks[0]!.profile.facts)).toBe(true);
    await expect(createTaskSpace({ owner: restarted }, {
      ...command,
      definition: { ...command.definition, name: 'Different body' },
    }, {})).rejects.toMatchObject({ code: 'command-receipt-mismatch' });
  });

  test('raw CAS rejects a dangling artifact ref even when processors are bypassed', async () => {
    const owner = new FileTaskSpaceOwner({ root: root() });
    const created = await createTaskSpace({ owner }, createCommand(), {});
    const artifact: TaskArtifactRef = {
      kind: 'task-artifact-ref',
      digest: 'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
      mediaType: 'text/plain',
      sizeBytes: 5,
    };
    const command: PatchTaskSpaceCommand = {
      kind: 'task-space.patch',
      commandId: 'raw-dangling',
      taskSpaceId: 'space-gap-file',
      expectedRevision: 0,
      patchedAt: at(1),
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
      kind: 'task-space.patched', eventId: 'event:raw-dangling:0', commandId: command.commandId,
      taskSpaceId: command.taskSpaceId, sequence: 1, fromRevision: 0, toRevision: 1,
      occurredAt: at(1), taskId: 'a',
    };
    const receipt: TaskTransitionReceipt = {
      kind: 'task-transition-receipt', receiptId: 'receipt:raw-dangling', commandId: command.commandId,
      commandDigest, taskSpaceId: command.taskSpaceId, fromRevision: 0, toRevision: 1,
      eventIds: [event.eventId], committedAt: at(1), taskId: 'a',
    };

    await expect(owner.compareAndSwap({
      kind: 'task-space-commit', taskSpaceId: command.taskSpaceId, expectedRevision: 0,
      commandId: command.commandId, commandDigest, command,
      snapshot: {
        ...created.snapshot,
        revision: 1,
        definition: nextDefinition,
        tasks: nextTasks,
        historyEventIds: [...created.snapshot.historyEventIds, event.eventId],
        issuedReceiptIds: [...created.snapshot.issuedReceiptIds, receipt.receiptId],
        updatedAt: at(1),
      },
      events: [event], receipts: [receipt], artifacts: [],
    })).rejects.toMatchObject({ code: 'artifact-not-found' });
  });
});
