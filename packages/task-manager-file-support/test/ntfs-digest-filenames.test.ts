import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTaskSpace } from '../../task-manager-logic/src/index.js';
import { FileTaskSpaceOwner, taskArtifactBodyFromBytes } from '../src/index.js';

const at = (second: number) => `2026-08-24T00:00:${String(second).padStart(2, '0')}.000Z`;

function root(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'task-space-ntfs-'));
}

function createCommand(taskSpaceId = 'space-ntfs', commandId = 'create-ntfs') {
  return {
    kind: 'task-space.create' as const,
    commandId,
    taskSpaceId,
    createdAt: at(0),
    definition: {
      kind: 'task-space-definition' as const,
      taskSpaceId,
      name: 'NTFS digest filenames',
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
          facts: { mode: 'default' as const },
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

describe('NTFS-safe digest filenames', () => {
  test('writes hex-only CAS basenames without colon', async () => {
    const owner = new FileTaskSpaceOwner({ root: root() });
    const created = await createTaskSpace({ owner }, createCommand(), {});
    expect(created.snapshot.taskSpaceId).toBe('space-ntfs');
    expect(created.receipt.commandId).toBe('create-ntfs');
    const paths = owner.diagnosticPaths('space-ntfs');
    const names = [
      ...fs.readdirSync(paths.treesDir),
      ...fs.readdirSync(paths.recordsDir),
      ...fs.readdirSync(paths.receiptsDir),
      ...fs.readdirSync(paths.historyDir),
    ];
    for (const name of names) {
      expect(name.includes(':')).toBe(false);
    }
    expect(fs.readdirSync(paths.treesDir)[0]).toMatch(/^[a-f0-9]{64}\.json$/);
    expect(fs.readdirSync(paths.recordsDir)[0]).toMatch(/^[a-f0-9]{64}\.json$/);
    expect(fs.readdirSync(paths.historyDir)[0]).toMatch(/^\d{12}--[a-f0-9]{64}\.json$/);
    expect(fs.readdirSync(paths.receiptsDir)[0]).toMatch(/^receipt-.+--[a-f0-9]{64}\.json$/);

    const artifact = taskArtifactBodyFromBytes(new TextEncoder().encode('hello-ntfs'), 'text/plain');
    expect(artifact.digest.startsWith('sha256:')).toBe(true);
    expect(artifact.digest.slice('sha256:'.length)).toMatch(/^[a-f0-9]{64}$/);
  });
});
