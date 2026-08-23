import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

type PackageManifest = {
  version: string;
  dependencies?: Record<string, string>;
  exports?: Record<string, string>;
  publishConfig?: Record<string, string>;
};

async function readManifest(path: string): Promise<PackageManifest> {
  return Bun.file(path).json() as Promise<PackageManifest>;
}

describe('AI workflow public package metadata', () => {
  test('uses exact registry-installable dependencies for the contract 0.1.7 and logic 0.1.8 patches', async () => {
    const contract = await readManifest(join(import.meta.dir, '../../ai-workflow-contract/package.json'));
    const logic = await readManifest(join(import.meta.dir, '../package.json'));

    expect(contract.version).toBe('0.1.7');
    expect(contract.dependencies).toEqual({
      'eager-data-flow-contract': '0.1.3',
      'halfcode-compiler.xnl': '0.2.2',
      'work-ctrl-flow-contract': '0.1.3',
    });
    expect(logic.version).toBe('0.1.8');
    expect(logic.dependencies).toEqual({
      'ai-workflow-contract': '0.1.7',
      'flow-step-space-contract': '0.1.1',
      'flow-step-space-logic': '0.1.1',
      'halfcode-compiler.xnl': '0.2.2',
      'work-ctrl-flow-contract': '0.1.3',
      'work-ctrl-flow-logic': '0.1.4',
    });

    for (const dependency of [
      ...Object.values(contract.dependencies ?? {}),
      ...Object.values(logic.dependencies ?? {}),
    ]) {
      expect(dependency.startsWith('workspace:')).toBe(false);
      expect(dependency.startsWith('file:')).toBe(false);
    }
  });

  test('keeps Ctrl and Data logic on the unified runtime patch closure', async () => {
    const ctrl = await readManifest(join(import.meta.dir, '../../ai-ctrl-workflow-logic/package.json'));
    const data = await readManifest(join(import.meta.dir, '../../ai-data-workflow-logic/package.json'));

    expect(ctrl.version).toBe('0.1.7');
    expect(ctrl.dependencies).toEqual({
      'ai-ctrl-workflow-contract': '0.1.4',
      'ai-workflow-contract': '0.1.7',
      'ai-workflow-logic': '0.1.8',
      'flow-step-space-logic': '0.1.1',
      'instant-ctrl-flow-contract': '0.1.2',
      'instant-ctrl-flow-logic': '0.1.5',
      'work-ctrl-flow-contract': '0.1.3',
      'work-ctrl-flow-logic': '0.1.4',
    });
    expect(data.version).toBe('0.1.9');
    expect(data.dependencies).toEqual({
      'ai-data-workflow-contract': '0.1.4',
      'ai-workflow-contract': '0.1.7',
      'ai-workflow-logic': '0.1.8',
      'eager-data-flow-contract': '0.1.3',
      'eager-data-flow-logic': '0.1.4',
      'flow-step-space-logic': '0.1.1',
      'work-ctrl-flow-logic': '0.1.4',
    });
  });

  test('keeps the release closure exact and free of registry selection', async () => {
    const names = [
      'flow-step-space-contract', 'flow-step-space-logic',
      'work-ctrl-flow-contract', 'instant-ctrl-flow-contract', 'instant-ctrl-flow-logic', 'work-ctrl-flow-logic',
      'eager-data-flow-contract', 'eager-data-flow-logic', 'ai-workflow-contract',
      'ai-workflow-logic', 'ai-ctrl-workflow-contract', 'ai-data-workflow-contract',
      'ai-ctrl-workflow-logic', 'ai-data-workflow-logic', 'ai-workflow-flow-dsl-reference',
    ];
    for (const name of names) {
      const manifest = await readManifest(join(import.meta.dir, `../../${name}/package.json`));
      expect(manifest.publishConfig).toEqual({ access: 'public' });
      for (const dependency of Object.values(manifest.dependencies ?? {})) {
        expect(dependency.startsWith('workspace:')).toBe(false);
        expect(dependency.startsWith('file:')).toBe(false);
      }
    }
  });

  test('prepares the BP and task runtime patch release without registry selection', async () => {
    const expected = {
      'task-manager-contract': { version: '0.1.1', dependencies: undefined },
      'task-manager-logic': {
        version: '0.1.1',
        dependencies: { 'task-manager-contract': '0.1.1' },
      },
      'depa-behavior-tree': {
        version: '0.1.1',
        dependencies: { 'depa-processor': '0.1.1' },
      },
      'bp-ctrl-flow-contract': {
        version: '0.1.1',
        dependencies: {
          'task-manager-contract': '0.1.1',
          'work-ctrl-flow-contract': '0.1.3',
        },
      },
      'bp-ctrl-flow-logic': {
        version: '0.1.2',
        dependencies: {
          'bp-ctrl-flow-contract': '0.1.1',
          'depa-behavior-tree': '0.1.1',
          'instant-ctrl-flow-contract': '0.1.2',
          'instant-ctrl-flow-logic': '0.1.5',
          'task-manager-contract': '0.1.1',
          'task-manager-logic': '0.1.1',
          'work-ctrl-flow-contract': '0.1.3',
          'work-ctrl-flow-logic': '0.1.4',
        },
      },
      'instant-ctrl-flow-logic': {
        version: '0.1.5',
        dependencies: {
          'depa-behavior-tree': '0.1.1',
          'flow-step-space-contract': '0.1.1',
          'flow-step-space-logic': '0.1.1',
          'instant-ctrl-flow-contract': '0.1.2',
          'xnl-core': '^0.1.8',
        },
      },
      'work-ctrl-flow-logic': {
        version: '0.1.4',
        dependencies: {
          'depa-behavior-tree': '0.1.1',
          'flow-step-space-logic': '0.1.1',
          'instant-ctrl-flow-contract': '0.1.2',
          'instant-ctrl-flow-logic': '0.1.5',
          'work-ctrl-flow-contract': '0.1.3',
        },
      },
    } as const;

    for (const [name, release] of Object.entries(expected)) {
      const manifest = await readManifest(join(import.meta.dir, `../../${name}/package.json`));
      expect(manifest.version).toBe(release.version);
      expect(manifest.dependencies).toEqual(release.dependencies);
      expect(manifest.publishConfig).toEqual({ access: 'public' });
      for (const dependency of Object.values(manifest.dependencies ?? {})) {
        expect(dependency.startsWith('workspace:')).toBe(false);
        expect(dependency.startsWith('file:')).toBe(false);
      }
    }
  });

  test('keeps browser-safe and Node-only entries explicit', async () => {
    const logic = await readManifest(join(import.meta.dir, '../package.json'));
    expect(logic.exports).toEqual({
      '.': './src/index.ts',
      './browser': './src/browser.ts',
      './checkpoint-filesystem': './src/checkpoint-filesystem.ts',
      './filesystem': './src/filesystem.ts',
      './run-freeze': './src/run-freeze.ts',
    });
  });
});
