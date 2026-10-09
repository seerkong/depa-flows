import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fsyncDirectory } from '../src/layout.js';

test('directory fsync does not fail when the platform cannot sync a directory', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'task-space-dir-fsync-'));
  try {
    expect(() => fsyncDirectory(directory)).not.toThrow();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
