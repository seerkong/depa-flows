import { describe, expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fsyncDirectory } from '../../task-manager-file-support/src/layout.js';
import { createDirectoryDurably, writeDurableCandidate, type CheckpointDurabilityEvent } from '../src/checkpoint-sidecar.js';

const adapters = [
  { name: 'TaskSpace', sync: (root: string) => fsyncDirectory(root) },
  { name: 'workflow checkpoint', sync: (root: string) => createDirectoryDurably(path.join(root, 'child'), 'record') },
];

function withFilesystemError(platform: string, operation: 'openSync' | 'fsyncSync', code: string, check: (root: string, error: Error) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-windows-fsync-'));
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  const error = Object.assign(new Error(code), { code });
  const fault = spyOn(fs, operation).mockImplementation(() => { throw error; });
  try {
    Object.defineProperty(process, 'platform', { ...originalPlatform, value: platform });
    check(root, error);
    expect(fault).toHaveBeenCalled();
  } finally {
    Object.defineProperty(process, 'platform', originalPlatform);
    fault.mockRestore();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

for (const adapter of adapters) {
  describe(`${adapter.name} directory fsync compatibility`, () => {
    for (const operation of ['openSync', 'fsyncSync'] as const) {
      for (const code of ['EPERM', 'EINVAL', 'ENOTSUP', 'EISDIR']) {
        test(`tolerates Windows ${operation} ${code}`, () => {
          withFilesystemError('win32', operation, code, root => expect(() => adapter.sync(root)).not.toThrow());
        });
      }
      for (const [platform, code] of [['linux', 'EPERM'], ['win32', 'EIO'], ['win32', 'EACCES']]) {
        test(`propagates ${platform} ${operation} ${code}`, () => {
          withFilesystemError(platform!, operation, code!, (root, error) => expect(() => adapter.sync(root)).toThrow(error));
        });
      }
    }
  });
}

test('Windows file-data fsync errors are never treated as unsupported directory sync', () => {
  withFilesystemError('win32', 'fsyncSync', 'EPERM', (root, error) => {
    expect(() => writeDurableCandidate(path.join(root, 'candidate.json'), '{}', 'head')).toThrow(error);
  });
});

for (const hook of ['beforeEvent', 'onEvent'] as const) {
  test(`Windows directory ${hook} faults remain fatal`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-durability-hook-'));
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    const error = Object.assign(new Error('observer failure'), { code: 'EPERM' });
    const fault = spyOn(fs, 'fsyncSync').mockImplementation(() => undefined);
    try {
      Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'win32' });
      expect(() => createDirectoryDurably(path.join(root, 'child'), 'record', {
        [hook]: (event: CheckpointDurabilityEvent) => { if (event.operation === 'directory-fsync') throw error; },
      })).toThrow(error);
    } finally {
      Object.defineProperty(process, 'platform', originalPlatform);
      fault.mockRestore();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}
