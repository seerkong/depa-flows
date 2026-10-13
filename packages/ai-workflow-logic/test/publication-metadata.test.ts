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
  test('uses exact approved prepublication dependencies for the Halfcode 0.3 contract and logic candidates', async () => {
    const contract = await readManifest(join(import.meta.dir, '../../ai-workflow-contract/package.json'));
    const logic = await readManifest(join(import.meta.dir, '../package.json'));

    expect(contract.version).toBe('0.3.0-simplification.0');
    expect(contract.dependencies).toEqual({
      'eager-data-flow-contract': '0.1.4',
      'halfcode-compiler.xnl': '0.3.2',
      'task-manager-contract': '0.1.4',
      'work-ctrl-flow-contract': '0.1.4',
    });
    expect(logic.version).toBe('0.3.0-simplification.0');
    expect(logic.exports?.['./agent-code-execution']).toBe('./src/agent-code-execution.ts');
    expect(logic.dependencies).toEqual({
      'ai-workflow-contract': '0.3.0-simplification.0',
      ajv: '8.20.0',
      'flow-step-space-contract': '0.1.1',
      'flow-step-space-logic': '0.1.2',
      'halfcode-compiler.xnl': '0.3.2',
      'task-manager-contract': '0.1.4',
      'task-manager-logic': '0.1.7',
      'work-ctrl-flow-contract': '0.1.4',
      'work-ctrl-flow-logic': '0.1.6',
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
    const ctrlContract = await readManifest(join(import.meta.dir, '../../ai-ctrl-workflow-contract/package.json'));
    const dataContract = await readManifest(join(import.meta.dir, '../../ai-data-workflow-contract/package.json'));
    const ctrl = await readManifest(join(import.meta.dir, '../../ai-ctrl-workflow-logic/package.json'));
    const data = await readManifest(join(import.meta.dir, '../../ai-data-workflow-logic/package.json'));

    expect(ctrlContract.version).toBe('0.3.0-simplification.0');
    expect(ctrlContract.dependencies).toEqual({
      'ai-workflow-contract': '0.3.0-simplification.0',
      'work-ctrl-flow-contract': '0.1.4',
    });
    expect(dataContract.version).toBe('0.3.0-simplification.0');
    expect(dataContract.dependencies).toEqual({
      'ai-workflow-contract': '0.3.0-simplification.0',
      'eager-data-flow-contract': '0.1.4',
    });
    expect(ctrl.version).toBe('0.3.0-simplification.0');
    expect(ctrl.dependencies).toEqual({
      'depa-behavior-tree': '0.1.2',
      'ai-ctrl-workflow-contract': '0.3.0-simplification.0',
      'ai-workflow-contract': '0.3.0-simplification.0',
      'ai-workflow-logic': '0.3.0-simplification.0',
      'flow-step-space-logic': '0.1.2',
      'instant-ctrl-flow-contract': '0.1.3',
      'instant-ctrl-flow-logic': '0.1.7',
      'task-manager-contract': '0.1.4',
      'task-manager-logic': '0.1.7',
      'work-ctrl-flow-contract': '0.1.4',
      'work-ctrl-flow-logic': '0.1.6',
    });
    expect(data.version).toBe('0.3.0-simplification.0');
    expect(data.dependencies).toEqual({
      'ai-data-workflow-contract': '0.3.0-simplification.0',
      'ai-workflow-contract': '0.3.0-simplification.0',
      'ai-workflow-logic': '0.3.0-simplification.0',
      'eager-data-flow-contract': '0.1.4',
      'eager-data-flow-logic': '0.1.8',
      'flow-step-space-logic': '0.1.2',
      'task-manager-contract': '0.1.4',
      'task-manager-logic': '0.1.7',
      'work-ctrl-flow-logic': '0.1.6',
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

    const flowDslReference = await readManifest(join(
      import.meta.dir,
      '../../ai-workflow-flow-dsl-reference/package.json',
    ));
    expect(flowDslReference.version).toBe('0.2.1');
    expect(flowDslReference.dependencies).toEqual({
      'halfcode-compiler.xnl': '0.3.2',
    });
  });

  test('prepares the BP and task runtime patch release without registry selection', async () => {
    const expected = {
      "task-manager-contract": {
        "version": "0.1.4",
        "dependencies": undefined
      },
      "task-manager-logic": {
        "version": "0.1.7",
        "dependencies": {
          "task-manager-contract": "0.1.4"
        }
      },
      "task-manager-file-support": {
        "version": "0.1.7",
        "dependencies": {
          "task-manager-contract": "0.1.4",
          "task-manager-logic": "0.1.7"
        }
      },
      "ai-workflow-contract": {
        "version": "0.3.0-simplification.0",
        "dependencies": {
          "eager-data-flow-contract": "0.1.4",
          "halfcode-compiler.xnl": "0.3.2",
          "task-manager-contract": "0.1.4",
          "work-ctrl-flow-contract": "0.1.4"
        }
      },
      "ai-workflow-logic": {
        "version": "0.3.0-simplification.0",
        "dependencies": {
          "ai-workflow-contract": "0.3.0-simplification.0",
          "ajv": "8.20.0",
          "flow-step-space-contract": "0.1.1",
          "flow-step-space-logic": "0.1.2",
          "halfcode-compiler.xnl": "0.3.2",
          "task-manager-contract": "0.1.4",
          "task-manager-logic": "0.1.7",
          "work-ctrl-flow-contract": "0.1.4",
          "work-ctrl-flow-logic": "0.1.6"
        }
      },
      "ai-ctrl-workflow-contract": {
        "version": "0.3.0-simplification.0",
        "dependencies": {
          "ai-workflow-contract": "0.3.0-simplification.0",
          "work-ctrl-flow-contract": "0.1.4"
        }
      },
      "ai-ctrl-workflow-logic": {
        "version": "0.3.0-simplification.0",
        "dependencies": {
          "depa-behavior-tree": "0.1.2",
          "ai-ctrl-workflow-contract": "0.3.0-simplification.0",
          "ai-workflow-contract": "0.3.0-simplification.0",
          "ai-workflow-logic": "0.3.0-simplification.0",
          "flow-step-space-logic": "0.1.2",
          "instant-ctrl-flow-contract": "0.1.3",
          "instant-ctrl-flow-logic": "0.1.7",
          "task-manager-contract": "0.1.4",
          "task-manager-logic": "0.1.7",
          "work-ctrl-flow-contract": "0.1.4",
          "work-ctrl-flow-logic": "0.1.6"
        }
      },
      "ai-data-workflow-contract": {
        "version": "0.3.0-simplification.0",
        "dependencies": {
          "ai-workflow-contract": "0.3.0-simplification.0",
          "eager-data-flow-contract": "0.1.4"
        }
      },
      "ai-data-workflow-logic": {
        "version": "0.3.0-simplification.0",
        "dependencies": {
          "ai-data-workflow-contract": "0.3.0-simplification.0",
          "ai-workflow-contract": "0.3.0-simplification.0",
          "ai-workflow-logic": "0.3.0-simplification.0",
          "eager-data-flow-contract": "0.1.4",
          "eager-data-flow-logic": "0.1.8",
          "flow-step-space-logic": "0.1.2",
          "task-manager-contract": "0.1.4",
          "task-manager-logic": "0.1.7",
          "work-ctrl-flow-logic": "0.1.6"
        }
      },
      "instant-ctrl-flow-contract": {
        "version": "0.1.3",
        "dependencies": {
          "flow-step-space-contract": "0.1.1"
        }
      },
      "instant-ctrl-flow-logic": {
        "version": "0.1.7",
        "dependencies": {
          "depa-behavior-tree": "0.1.2",
          "flow-step-space-contract": "0.1.1",
          "flow-step-space-logic": "0.1.2",
          "instant-ctrl-flow-contract": "0.1.3",
          "xnl-core": "0.1.13",
          "port-control-graph-logic": "0.1.0"
        }
      },
      "work-ctrl-flow-contract": {
        "version": "0.1.4",
        "dependencies": {
          "instant-ctrl-flow-contract": "0.1.3"
        }
      },
      "work-ctrl-flow-logic": {
        "version": "0.1.6",
        "dependencies": {
          "depa-behavior-tree": "0.1.2",
          "flow-step-space-logic": "0.1.2",
          "instant-ctrl-flow-contract": "0.1.3",
          "instant-ctrl-flow-logic": "0.1.7",
          "work-ctrl-flow-contract": "0.1.4"
        }
      },
      "flow-step-space-logic": {
        "version": "0.1.2",
        "dependencies": {
          "flow-step-space-contract": "0.1.1",
          "xnl-core": "0.1.13"
        }
      },
      "eager-data-flow-logic": {
        "version": "0.1.8",
        "dependencies": {
          "eager-data-flow-contract": "0.1.4",
          "flow-step-space-logic": "0.1.2",
          "xnl-core": "0.1.13"
        }
      },
      "depa-behavior-tree": {
        "version": "0.1.2",
        "dependencies": {
          "depa-processor": "0.1.1"
        }
      },
      "port-control-graph-contract": {
        "version": "0.1.0",
        "dependencies": undefined
      },
      "port-control-graph-logic": {
        "version": "0.1.0",
        "dependencies": {
          "port-control-graph-contract": "0.1.0"
        }
      },
      "ai-workflow-flow-dsl-reference": {
        "version": "0.2.1",
        "dependencies": {
          "halfcode-compiler.xnl": "0.3.2"
        }
      },
      "bp-ctrl-flow-contract": {
        "version": "0.1.3",
        "dependencies": {
          "task-manager-contract": "0.1.3",
          "work-ctrl-flow-contract": "0.1.3"
        }
      },
      "bp-ctrl-flow-logic": {
        "version": "0.1.7",
        "dependencies": {
          "bp-ctrl-flow-contract": "0.1.3",
          "depa-behavior-tree": "0.1.1",
          "instant-ctrl-flow-contract": "0.1.2",
          "instant-ctrl-flow-logic": "0.1.5",
          "task-manager-contract": "0.1.3",
          "task-manager-logic": "0.1.6",
          "work-ctrl-flow-contract": "0.1.3",
          "work-ctrl-flow-logic": "0.1.4"
        }
      }
    } as const;

    for (const [name, release] of Object.entries(expected)) {
      const manifest = await readManifest(join(import.meta.dir, `../../${name}/package.json`));
      expect(manifest.version).toBe(release.version);
      expect(manifest.dependencies).toEqual(release.dependencies);
      // 首次graph候选沿用无publishConfig的npm默认；既有公开包仍要求显式public。
      expect(manifest.publishConfig).toEqual(
        name.startsWith('port-control-graph-') ? undefined : { access: 'public' },
      );
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
      './agent-code-execution': './src/agent-code-execution.ts',
      './definitions': './src/definitions.ts',
    });
  });
});
