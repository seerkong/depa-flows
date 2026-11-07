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
  test('keeps the published workflow and file storage release versions', async () => {
    const versions = {
      'ai-workflow-contract': '0.2.3',
      'ai-workflow-logic': '0.2.3',
      'ai-ctrl-workflow-contract': '0.2.2',
      'ai-ctrl-workflow-logic': '0.2.2',
      'ai-data-workflow-contract': '0.2.2',
      'ai-data-workflow-logic': '0.2.2',
      'task-manager-file-support': '0.1.8',
    };
    for (const [name, version] of Object.entries(versions)) {
      const manifest = await readManifest(join(import.meta.dir, `../../${name}/package.json`));
      expect(manifest.version).toBe(version);
    }
  });

  test('keeps the release closure exact and free of registry selection', async () => {
    const names = [
      'flow-step-space-contract', 'flow-step-space-logic',
      'work-ctrl-flow-contract', 'instant-ctrl-flow-contract', 'instant-ctrl-flow-logic', 'work-ctrl-flow-logic',
      'eager-data-flow-contract', 'eager-data-flow-logic', 'ai-workflow-contract',
      'ai-workflow-logic', 'ai-ctrl-workflow-contract', 'ai-data-workflow-contract',
      'ai-ctrl-workflow-logic', 'ai-data-workflow-logic', 'ai-workflow-flow-dsl-reference',
      'bp-ctrl-flow-contract', 'bp-ctrl-flow-logic',
      'task-manager-contract', 'task-manager-logic', 'task-manager-file-support',
      'depa-behavior-tree', 'port-control-graph-contract', 'port-control-graph-logic',
    ];
    const manifests = new Map(await Promise.all(names.map(async name => {
      const manifest = await readManifest(join(import.meta.dir, `../../${name}/package.json`));
      return [name, manifest] as const;
    })));
    const exactVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
    for (const [name, manifest] of manifests) {
      expect(manifest.version).toMatch(exactVersion);
      expect(manifest.publishConfig).toEqual(
        name.startsWith('port-control-graph-') ? undefined : { access: 'public' },
      );
      for (const [dependency, version] of Object.entries(manifest.dependencies ?? {})) {
        expect(version).toMatch(exactVersion);
        const internal = manifests.get(dependency);
        // BP remains on its independently published runtime dependency versions.
        if (internal && !name.startsWith('bp-ctrl-flow-')) {
          expect(version).toBe(internal.version);
        }
      }
    }

    const flowDslReference = await readManifest(join(
      import.meta.dir,
      '../../ai-workflow-flow-dsl-reference/package.json',
    ));
    expect(flowDslReference.version).toBe('0.2.1');
    expect(flowDslReference.dependencies).toEqual({
      'halfcode-compiler.xnl': '0.3.2',
    });
  });

  test('keeps browser-safe and Node-only entries explicit', async () => {
    const logic = await readManifest(join(import.meta.dir, '../package.json'));
    expect(logic.exports).toEqual({
      '.': './src/index.ts',
      './browser': './src/browser.ts',
      './checkpoint-filesystem': './src/checkpoint-filesystem.ts',
      './filesystem': './src/filesystem.ts',
      './run-freeze': './src/run-freeze.ts',
      './agent-code-execution': './src/agent-code-execution.ts',
      './definitions': './src/definitions.ts',
    });
  });
});
