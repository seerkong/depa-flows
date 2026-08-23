import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assembleDefinitionStepForest,
  createFilesystemDefinitionStepRuntime,
} from '../src/index.js';

describe('filesystem DefinitionStepForest runtime', () => {
  test('reads explicit regular files and rejects a referenced symbolic link', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'depa-step-space-'));
    try {
      fs.mkdirSync(path.join(root, 'steps'), { recursive: true });
      fs.writeFileSync(path.join(root, 'step-space.xnl'), '<StepSpace #s [ <StepRef #one { src = "steps/one.xnl" }> ]>');
      fs.writeFileSync(path.join(root, 'steps', 'one.xnl'), '<Step #one ( <Core [ <Return #one> ]> )>');
      const runtime = createFilesystemDefinitionStepRuntime({ rootDir: root });
      expect(assembleDefinitionStepForest(runtime, { stepSpaceRef: 'step-space.xnl' }, {}).stepOrder)
        .toEqual(['one']);

      fs.renameSync(path.join(root, 'steps', 'one.xnl'), path.join(root, 'steps', 'target.xnl'));
      fs.symlinkSync('target.xnl', path.join(root, 'steps', 'one.xnl'));
      expect(() => assembleDefinitionStepForest(runtime, { stepSpaceRef: 'step-space.xnl' }, {}))
        .toThrow('step-source-link-unsupported');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
