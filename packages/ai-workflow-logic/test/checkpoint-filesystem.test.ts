import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  AIWorkflowFlowRunCheckpoint,
  FlowClosedObject,
  FlowDefinitionArtifactIdentity,
  FlowRunCheckpointRuntime,
} from 'ai-workflow-contract';
import type { WorkCtrlFlowSnapshot } from '../../work-ctrl-flow-contract/src/index.js';
import {
  createCanonicalMaterializedWorkCtrlFlowEngine,
  FlowRunFilesystemStoreError,
  FilesystemFlowRunCheckpointStore,
} from 'ai-workflow-logic/checkpoint-filesystem';
import type { CheckpointDurabilityEvent } from '../src/checkpoint-sidecar.js';
import {
  createInitialRunStepExtensions,
  FlowRunContractValidationError,
  FlowRunCheckpointTransitionError,
  FlowRunCheckpointVersionConflictError,
  commitFlowRunCheckpoint,
  loadFlowRunCheckpoint,
  mutateRunStepExtension,
} from 'ai-workflow-logic';
import { createAICtrlWorkflowCheckpointStore } from '../../ai-ctrl-workflow-logic/src/index.js';
import {
  createAIDataWorkflowRunGraph,
  loadAIDataWorkflowSources,
  recordAIDataWorkflowNodeResult,
} from '../../ai-data-workflow-logic/src/index.js';
import { createMaterializedAIDataWorkflowProfileAuthority } from '../../ai-data-workflow-logic/src/filesystem.js';
import {
  createMaterializedWorkCtrlFlowEngineFromDirectory,
  materializeFlowInstance,
} from 'work-ctrl-flow-logic';

function definitionBundle(root: string): string {
  const definitionDir = path.join(root, 'definition-source');
  fs.mkdirSync(definitionDir, { recursive: true });
  fs.writeFileSync(path.join(definitionDir, 'manifest.xnl'), `<WorkCtrlFlow #depa.flows.test.FilesystemCheckpoint apiVersion="depa.flows/v1" version="1" (
    <FlowContract #depa.flows.test.FilesystemCheckpoint>
  ) [<Return #done>]>
`);
  fs.writeFileSync(path.join(definitionDir, 'flow-code.ts'), 'export function ready(runtime, input) { return input; }\n');
  return definitionDir;
}

function fixture() {
  const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-checkpoint-store-'));
  const instance = materializeFlowInstance({
    definitionDir: definitionBundle(storeRoot),
    instancesDir: path.join(storeRoot, 'instances'),
    instanceId: 'instance-1',
    source: {
      revision: 'workflow-r1',
      provenance: {
        authority: 'resource-package',
        artifactRef: 'resource://depa.flows.test.FilesystemCheckpoint',
      },
    },
    materializedAtMs: 42,
  });
  return { storeRoot, definition: instance.descriptor.definition };
}

function checkpoint(
  definition: FlowDefinitionArtifactIdentity,
  runId: string,
  version: number,
  phase: string,
): AIWorkflowFlowRunCheckpoint {
  return {
    schemaVersion: 'depa.flow-run-checkpoint/v1',
    instanceId: 'instance-1',
    runId,
    definition,
    version,
    input: { a_key: 1, z_key: 2, ä_key: 3, 中_key: 4 },
    config: { mode: 'standard' },
    state: { phase },
    output: phase === 'Completed' ? { result: 'ready' } : null,
    controllerSidecars: {
      status: phase,
      lastTickNo: version,
      branchDecisions: {},
      orchestration: { attempts: {}, deadlines: {}, lanes: {}, winners: {}, cancellations: {}, composites: {} },
      openWaitHandles: [],
      closedWaitHandles: [],
      appliedResumeSignals: [],
    },
    nodeSidecars: { nodeResults: {}, waitResults: {} },
    profile: {
      kind: 'AICtrlWorkflow',
      snapshot: {
        schemaVersion: 'depa.flows.workflow/v4',
        treeId: runId,
        fqn: 'depa.flows.test.FilesystemCheckpoint',
        status: phase,
        vars: { phase },
        input: { a_key: 1, z_key: 2, ä_key: 3, 中_key: 4 },
        branchDecisions: {},
        nodeResults: {},
        waitResults: {},
        openWaitHandles: [],
        closedWaitHandles: [],
        appliedResumeSignals: [],
        orchestration: {
          attempts: {}, deadlines: {}, lanes: {}, winners: {}, cancellations: {}, composites: {},
        },
        lastTickNo: version,
        updatedAtMs: version,
      },
      ai: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
    },
  };
}

function createBoundedAIDataDefinition(root: string, count: number) {
  const definitionDir = path.join(root, 'bounded-data-source');
  const id = (index: number) => `node-${String(index).padStart(3, '0')}`;
  fs.mkdirSync(definitionDir, { recursive: true });
  fs.writeFileSync(path.join(definitionDir, 'manifest.xnl'), `<AIDataWorkflow #depa.flows.test.BoundedCheckpointData apiVersion="depa.flows/v1" version="1" (
    <FlowContract #depa.flows.test.BoundedCheckpointData { inputPorts = ["value"] outputPorts = ["result"] }>
    <StepSpaceRef { src = "step-space.xnl" }>
  )>`);
  const refs: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const nodeId = id(index);
    const stepDir = path.join(definitionDir, 'steps', nodeId);
    fs.mkdirSync(stepDir, { recursive: true });
    refs.push(`<StepRef #${nodeId} { src = "steps/${nodeId}/step.xnl" }>`);
    if (index === 0) {
      fs.writeFileSync(path.join(stepDir, 'step.xnl'), `<Step #${nodeId} ( <Core [ <EntryNode #${nodeId}> ]> )>`);
      continue;
    }
    if (index === count - 1) {
      fs.writeFileSync(path.join(stepDir, 'step.xnl'), `<Step #${nodeId} ( <Core [
        <ReturnNode #${nodeId} { inputs = { result = "flow-port://#${id(index - 1)}/result" } }>
      ]> )>`);
      continue;
    }
    fs.writeFileSync(path.join(stepDir, 'step.xnl'), `<Step #${nodeId} ( <Core [
      <TransformNode #${nodeId} {
        inputs = { value = "flow-port://#${id(0)}/value" }
        outputs = ["result"]
        src = "vfs://./flow-code.ts#node${index}"
        config = { payload = "immutable-binding-payload-${index}-${'x'.repeat(128)}" }
      }>
    ]> )>`);
  }
  fs.writeFileSync(path.join(definitionDir, 'step-space.xnl'), `<StepSpace #depa.flows.test.BoundedCheckpointDataSteps apiVersion="depa.flows/v1" version="1" [${refs.join('\n')}]>`);
  fs.writeFileSync(path.join(definitionDir, 'flow-code.ts'), 'export const unused = true;\n');
  const sources: Record<string, string> = {};
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.name.endsWith('.xnl')) sources[path.relative(definitionDir, file).split(path.sep).join('/')] = fs.readFileSync(file, 'utf8');
    }
  };
  visit(definitionDir);
  const loaded = loadAIDataWorkflowSources(sources);
  if (!loaded.binding) throw new Error(`bounded AI Data fixture is invalid: ${loaded.diagnostics.map(({ code }) => code).join(',')}`);
  const instance = materializeFlowInstance({
    definitionDir,
    instancesDir: path.join(root, 'instances'),
    instanceId: 'bounded-data-instance',
    source: {
      revision: 'bounded-data-r1',
      provenance: { authority: 'resource-package', artifactRef: 'resource://depa.flows.test.BoundedCheckpointData' },
    },
    validateDefinition: () => undefined,
  });
  return { definitionDir, binding: loaded.binding, definition: instance.descriptor.definition };
}

function dataCheckpoint(
  definition: FlowDefinitionArtifactIdentity,
  graph: ReturnType<typeof createAIDataWorkflowRunGraph>,
  version: number,
): AIWorkflowFlowRunCheckpoint {
  const { baseUri: _baseUri, definitionStepForest: _forest, ...durableDefinition } = graph.binding.definition;
  const durableGraph = {
    ...graph,
    binding: { ...graph.binding, definition: durableDefinition },
  };
  return {
    schemaVersion: 'depa.flow-run-checkpoint/v1',
    instanceId: 'bounded-data-instance',
    runId: graph.runId,
    definition,
    version,
    input: { value: 'subject' },
    config: { policy: 'standard' },
    state: { status: 'Pending', generation: graph.currentGeneration },
    output: null,
    controllerSidecars: { status: 'Pending' },
    nodeSidecars: Object.fromEntries(graph.declarationOrder.map((nodeId) => [nodeId, {
      status: graph.nodes[nodeId].status,
      generation: graph.nodes[nodeId].generation,
    }])),
    profile: {
      kind: 'AIDataWorkflow',
      runGraph: durableGraph as unknown as FlowClosedObject,
      ai: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
    },
  };
}

describe('filesystem FlowRunCheckpoint store', () => {
  test('reconstructs a Ctrl extension fact through the same leaf authority', async () => {
    const { storeRoot, definition } = fixture();
    const extensionCodecs = {
      resolve(kind: string) {
        return kind === 'example.ctrl-note' ? {
          schemaRef: 'schema://example.ctrl-note/v1',
          codec: {
            normalize(value: any) {
              if (!value || typeof value !== 'object' || typeof value.note !== 'string' || !value.note.trim()) {
                throw new Error('ctrl note is invalid');
              }
              return { note: value.note.trim() };
            },
          },
        } : undefined;
      },
    };
    const authority = {
      load() {
        return {
          profileKind: 'AICtrlWorkflow' as const,
          definitionStepIds: ['done'],
          extensionsByStepId: {
            done: {
              'example.ctrl-note': {
                schemaRef: 'schema://example.ctrl-note/v1',
                initialValue: { note: 'initial' },
              },
            },
          },
        };
      },
    };
    const checkpointStore = new FilesystemFlowRunCheckpointStore({
      storeRoot,
      profileAuthority: authority,
      extensionCodecs,
    });
    const v0 = {
      ...checkpoint(definition, 'ctrl-extension-run', 0, 'Waiting'),
      stepExtensions: createInitialRunStepExtensions(authority.load()),
    };
    await checkpointStore.commit({ expectedVersion: null, checkpoint: v0 });
    const revised = await mutateRunStepExtension({ checkpointStore, profileAuthority: authority, extensionCodecs }, {
      instanceId: 'instance-1', runId: 'ctrl-extension-run', stepId: 'done', kind: 'example.ctrl-note',
    }, { expectedRevision: 0, value: { note: ' revised ' } }, {});
    expect(revised.stepExtensions?.byStepId.done['example.ctrl-note']).toMatchObject({
      revision: 1,
      value: { note: 'revised' },
    });
    const fresh = new FilesystemFlowRunCheckpointStore({ storeRoot, profileAuthority: authority, extensionCodecs });
    expect(await fresh.load({ instanceId: 'instance-1', runId: 'ctrl-extension-run' })).toEqual(revised);
  });

  test('admits one local change through bounded immutable records and a root-last head', async () => {
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-checkpoint-data-store-'));
    const { definitionDir, binding, definition } = createBoundedAIDataDefinition(storeRoot, 256);
    const store = new FilesystemFlowRunCheckpointStore({
      storeRoot,
      profileAuthority: createMaterializedAIDataWorkflowProfileAuthority({ supportRoot: storeRoot }),
    });
    const initialGraph = createAIDataWorkflowRunGraph({
      binding,
      runId: 'bounded-run',
    });
    const initialValue = dataCheckpoint(definition, initialGraph, 0);
    const runDir = path.join(storeRoot, 'instances', 'bounded-data-instance', 'runs', 'bounded-run');
    await expect(new FilesystemFlowRunCheckpointStore({ storeRoot }).commit({
      expectedVersion: null,
      checkpoint: initialValue,
    })).rejects.toThrow('frozen profile authority');
    expect(fs.existsSync(runDir)).toBe(false);
    const authority = createMaterializedAIDataWorkflowProfileAuthority({ supportRoot: storeRoot });
    const wrongProfileStore = new FilesystemFlowRunCheckpointStore({
      storeRoot,
      profileAuthority: {
        load(request) { return { ...authority.load(request), profileKind: 'WorkCtrlFlow' }; },
      },
    });
    await expect(wrongProfileStore.commit({ expectedVersion: null, checkpoint: initialValue }))
      .rejects.toThrow('profile kind differs');
    expect(fs.existsSync(runDir)).toBe(false);
    const forged = {
      ...initialValue,
      profile: {
        ...initialValue.profile,
        runGraph: {
          ...(initialValue.profile as any).runGraph,
          binding: {
            ...(initialValue.profile as any).runGraph.binding,
            definition: {
              ...(initialValue.profile as any).runGraph.binding.definition,
              version: 'forged-live-version',
            },
          },
        },
      },
    } as AIWorkflowFlowRunCheckpoint;
    await expect(store.commit({ expectedVersion: null, checkpoint: forged }))
      .rejects.toThrow('binding differs');
    expect(fs.existsSync(runDir)).toBe(false);
    await store.commit({ expectedVersion: null, checkpoint: initialValue });

    fs.rmSync(definitionDir, { recursive: true });
    const recordsDir = path.join(runDir, 'step-space', 'records');
    const treesDir = path.join(runDir, 'step-space', 'trees');
    const controlsDir = path.join(runDir, 'step-space', 'controls');
    const beforeRecords = new Map(fs.readdirSync(recordsDir).map((name) => [name, fs.readFileSync(path.join(recordsDir, name))]));
    const beforeTreeNames = new Set(fs.readdirSync(treesDir));
    const beforeControls = new Map(fs.readdirSync(controlsDir).map((name) => [name, fs.readFileSync(path.join(controlsDir, name))]));
    const changedMarker = `changed-${'y'.repeat(128)}`;
    const nextGraph = recordAIDataWorkflowNodeResult(initialGraph, 'node-000', {
      nodeId: 'node-000', generation: 0, status: 'Succeeded', output: { value: changedMarker },
    });
    await store.commit({
      expectedVersion: 0,
      checkpoint: dataCheckpoint(definition, nextGraph, 1),
    });

    for (const [name, bytes] of beforeRecords) {
      expect(fs.readFileSync(path.join(recordsDir, name))).toEqual(bytes);
    }
    for (const [name, bytes] of beforeControls) {
      expect(fs.readFileSync(path.join(controlsDir, name))).toEqual(bytes);
    }
    const addedRecords = fs.readdirSync(recordsDir).filter((name) => !beforeRecords.has(name));
    const addedTrees = fs.readdirSync(treesDir).filter((name) => !beforeTreeNames.has(name));
    expect(addedRecords).toHaveLength(2);
    expect(addedTrees.length).toBeLessThan(20);
    const headBytes = fs.readFileSync(path.join(runDir, 'checkpoint.json'), 'utf8');
    expect(headBytes).not.toContain(changedMarker);
    expect(headBytes).not.toContain('immutable-binding-payload-128');
    const receipt = JSON.parse(fs.readFileSync(path.join(runDir, 'step-space', 'receipts', '1.json'), 'utf8')) as {
      addedMaterialRecordDigests: string[];
      addedRecordDigests: string[];
    };
    expect(receipt.addedMaterialRecordDigests).toHaveLength(1);
    expect(receipt.addedRecordDigests).toHaveLength(1);
    const restored = await store.load({ instanceId: 'bounded-data-instance', runId: 'bounded-run' });
    expect(restored).toEqual(dataCheckpoint(definition, nextGraph, 1));
  }, 30_000);

  test('imports a direct logical checkpoint once and keeps unreachable material outside current authority', async () => {
    const { storeRoot, definition } = fixture();
    const runDir = path.join(storeRoot, 'instances', 'instance-1', 'runs', 'legacy-direct');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'checkpoint.json'), JSON.stringify(checkpoint(definition, 'legacy-direct', 0, 'Waiting')));
    const store = new FilesystemFlowRunCheckpointStore({ storeRoot });
    expect((await store.load({ instanceId: 'instance-1', runId: 'legacy-direct' }))?.version).toBe(0);
    await store.commit({
      expectedVersion: 0,
      checkpoint: checkpoint(definition, 'legacy-direct', 1, 'Completed'),
    });
    const head = JSON.parse(fs.readFileSync(path.join(runDir, 'checkpoint.json'), 'utf8')) as { schemaVersion: string };
    expect(head.schemaVersion).toBe('depa.flow-run-checkpoint-head/v1');
    const marker = path.join(runDir, 'step-space', 'records', `${'f'.repeat(64)}.json`);
    fs.writeFileSync(marker, '{"unreachable":true}');
    expect((await new FilesystemFlowRunCheckpointStore({ storeRoot }).load({
      instanceId: 'instance-1', runId: 'legacy-direct',
    }))?.version).toBe(1);
    expect(fs.existsSync(marker)).toBe(true);
  });

  test('keeps the old head current when final admission is interrupted and permits a fresh candidate', async () => {
    const { storeRoot, definition } = fixture();
    const store = new FilesystemFlowRunCheckpointStore({ storeRoot });
    await store.commit({
      expectedVersion: null,
      checkpoint: checkpoint(definition, 'root-last-run', 0, 'Waiting'),
    });
    const runDir = path.join(storeRoot, 'instances', 'instance-1', 'runs', 'root-last-run');
    const interrupted = new FilesystemFlowRunCheckpointStore({
      storeRoot,
      durability: {
        beforeEvent(event) {
          if (event.operation === 'rename' && event.role === 'head'
            && event.path === path.join(runDir, 'checkpoint.staging.json')
            && event.targetPath === path.join(runDir, 'checkpoint.json')) {
            throw new Error('controlled final-admission interruption');
          }
        },
      },
    });
    await expect(interrupted.commit({
      expectedVersion: 0,
      checkpoint: checkpoint(definition, 'root-last-run', 1, 'Waiting'),
    })).rejects.toThrow('controlled final-admission interruption');
    expect((await new FilesystemFlowRunCheckpointStore({ storeRoot }).load({
      instanceId: 'instance-1', runId: 'root-last-run',
    }))?.version).toBe(0);
    await new FilesystemFlowRunCheckpointStore({ storeRoot }).commit({
      expectedVersion: 0,
      checkpoint: checkpoint(definition, 'root-last-run', 1, 'Completed'),
    });
    expect((await store.load({ instanceId: 'instance-1', runId: 'root-last-run' }))?.version).toBe(1);
  });

  test('rejects a linked sidecar root before changing an external directory', async () => {
    const { storeRoot, definition } = fixture();
    const runDir = path.join(storeRoot, 'instances', 'instance-1', 'runs', 'linked-sidecar');
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-sidecar-external-'));
    const marker = path.join(external, 'marker.txt');
    fs.writeFileSync(marker, 'unchanged');
    fs.mkdirSync(runDir, { recursive: true });
    fs.symlinkSync(external, path.join(runDir, 'step-space'));
    await expect(new FilesystemFlowRunCheckpointStore({ storeRoot }).commit({
      expectedVersion: null,
      checkpoint: checkpoint(definition, 'linked-sidecar', 0, 'Waiting'),
    })).rejects.toBeInstanceOf(FlowRunFilesystemStoreError);
    expect(fs.readFileSync(marker, 'utf8')).toBe('unchanged');
    expect(fs.readdirSync(external)).toEqual(['marker.txt']);
  });

  test('rejects a linked controls directory without changing its external target', async () => {
    const { storeRoot, definition } = fixture();
    const runDir = path.join(storeRoot, 'instances', 'instance-1', 'runs', 'linked-controls');
    const stepSpaceDir = path.join(runDir, 'step-space');
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-controls-external-'));
    const marker = path.join(external, 'marker.txt');
    fs.writeFileSync(marker, 'unchanged');
    fs.mkdirSync(stepSpaceDir, { recursive: true });
    fs.symlinkSync(external, path.join(stepSpaceDir, 'controls'));

    await expect(new FilesystemFlowRunCheckpointStore({ storeRoot }).commit({
      expectedVersion: null,
      checkpoint: checkpoint(definition, 'linked-controls', 0, 'Waiting'),
    })).rejects.toMatchObject({ code: 'flow-run-symlink-boundary' });
    expect(fs.readFileSync(marker, 'utf8')).toBe('unchanged');
    expect(fs.readdirSync(external)).toEqual(['marker.txt']);
  });

  test('observes the owner durability protocol with final head admission last', async () => {
    const { storeRoot, definition } = fixture();
    const events: CheckpointDurabilityEvent[] = [];
    const store = new FilesystemFlowRunCheckpointStore({
      storeRoot,
      durability: { onEvent(event) { events.push(event); } },
    });
    await store.commit({
      expectedVersion: null,
      checkpoint: checkpoint(definition, 'durability-order', 0, 'Waiting'),
    });

    for (const [index, event] of events.entries()) {
      if (event.operation === 'directory-create') {
        expect(events[index + 1]).toMatchObject({
          operation: 'directory-fsync',
          role: event.role,
          path: path.dirname(event.path),
        });
      }
      if (event.operation === 'rename') {
        expect(events[index - 1]).toMatchObject({
          operation: 'file-fsync', role: event.role, path: event.path,
        });
        expect(events[index + 1]).toMatchObject({
          operation: 'directory-fsync', role: event.role, path: path.dirname(event.targetPath!),
        });
      }
    }
    const finalHeadRename = events.map((event) => event.operation === 'rename' && event.role === 'head').lastIndexOf(true);
    expect(finalHeadRename).toBeGreaterThan(0);
    expect(events.slice(finalHeadRename).map(({ operation, role }) => ({ operation, role }))).toEqual([
      { operation: 'rename', role: 'head' },
      { operation: 'directory-fsync', role: 'head' },
    ]);
    expect(events[finalHeadRename].targetPath?.endsWith('/checkpoint.json')).toBe(true);
    expect(events[finalHeadRename + 1].path.endsWith('/durability-order')).toBe(true);
    expect(events.slice(0, finalHeadRename).filter((event) => event.operation === 'rename').every((event) => event.role !== 'head')).toBe(true);
  });

  test('keeps a linked WorkCtrl instances boundary outside the support root unchanged', () => {
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-checkpoint-work-boundary-'));
    const definitionDir = definitionBundle(storeRoot);
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-checkpoint-work-external-'));
    const marker = path.join(external, 'marker.txt');
    fs.writeFileSync(marker, 'unchanged');
    fs.symlinkSync(external, path.join(storeRoot, 'instances'));

    expect(() => createCanonicalMaterializedWorkCtrlFlowEngine({
      storeRoot,
      bundleDir: definitionDir,
      instanceId: 'linked-work-instance',
      source: {
        revision: 'work-r1',
        provenance: { authority: 'resource-package', artifactRef: 'resource://flow/linked-work' },
      },
      checkpointConfig: { mode: 'standard' },
    })).toThrow();
    expect(fs.readFileSync(marker, 'utf8')).toBe('unchanged');
    expect(fs.readdirSync(external)).toEqual(['marker.txt']);
  });

  test('runs canonical materialized WorkCtrl with checkpoint version zero before user code', async () => {
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-checkpoint-workctrl-'));
    const definitionDir = path.join(storeRoot, 'source');
    fs.mkdirSync(definitionDir);
    fs.writeFileSync(path.join(definitionDir, 'manifest.xnl'), `<WorkCtrlFlow #depa.flows.test.CanonicalWork apiVersion="depa.flows/v1" version="1" (
      <FlowContract #depa.flows.test.CanonicalWork>
    ) [
      <Run #observe { src = "vfs://./flow-code.ts#observe" }>
      <Return #done>
    ]>`);
    fs.writeFileSync(path.join(definitionDir, 'flow-code.ts'), `
      export function observe(runtime, input) {
        runtime.observe();
        return input;
      }
    `);
    let observedInitial = false;
    const engine = createCanonicalMaterializedWorkCtrlFlowEngine({
      storeRoot,
      bundleDir: definitionDir,
      instanceId: 'work-instance',
      source: {
        revision: 'work-r1',
        provenance: { authority: 'resource-package', artifactRef: 'resource://flow/canonical-work' },
      },
      checkpointConfig: { mode: 'standard' },
      runtime: {
        observe: () => {
          const initial = JSON.parse(fs.readFileSync(path.join(
            storeRoot, 'instances', 'work-instance', 'runs', 'work-run', 'checkpoint.json',
          ), 'utf8')) as { schemaVersion: string; version: number; runStepStateRootDigest: string };
          expect(initial.version).toBe(0);
          expect(initial.schemaVersion).toBe('depa.flow-run-checkpoint-head/v1');
          expect(initial.runStepStateRootDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
          observedInitial = true;
        },
      },
    });

    expect((await engine.start('work-run', { input: { request: 'prepare' } })).status).toBe('Completed');
    expect(observedInitial).toBe(true);
    const stored = await new FilesystemFlowRunCheckpointStore({ storeRoot }).load({
      instanceId: 'work-instance', runId: 'work-run',
    });
    expect(stored?.profile.kind).toBe('WorkCtrlFlow');
    expect(stored?.input).toEqual({ request: 'prepare' });

    fs.writeFileSync(path.join(definitionDir, 'manifest.xnl'), '<WorkCtrlFlow');
    const frozenWithAdmissionInput = createCanonicalMaterializedWorkCtrlFlowEngine({
      storeRoot,
      bundleDir: definitionDir,
      instanceId: 'work-instance',
      source: {
        revision: 'work-r2',
        provenance: { authority: 'resource-package', artifactRef: 'resource://flow/changed-live-work' },
      },
      checkpointConfig: { mode: 'standard' },
      runtime: { observe: () => undefined },
    });
    expect((await frozenWithAdmissionInput.start('work-run', { input: { request: 'prepare' } })).status).toBe('Completed');
    expect((await frozenWithAdmissionInput.start('work-run-2', { input: { request: 'second' } })).status).toBe('Completed');

    const fresh = createCanonicalMaterializedWorkCtrlFlowEngine({
      storeRoot,
      instanceId: 'work-instance',
      checkpointConfig: { mode: 'ignored-on-recovery' },
      runtime: { observe: () => undefined },
    });
    expect((await fresh.getOutcome('work-run'))?.status).toBe('Completed');
  });

  test('uses canonical instance/run paths and enforces CAS across independent stores', async () => {
    const { storeRoot, definition } = fixture();
    const first = new FilesystemFlowRunCheckpointStore({ storeRoot });
    const second = new FilesystemFlowRunCheckpointStore({ storeRoot });
    const runtimeA: FlowRunCheckpointRuntime = { checkpointStore: first };
    const runtimeB: FlowRunCheckpointRuntime = { checkpointStore: second };

    await commitFlowRunCheckpoint(runtimeA, {
      expectedVersion: null,
      checkpoint: checkpoint(definition, 'run-1', 0, 'Waiting'),
    });
    const stale = await loadFlowRunCheckpoint(runtimeB, { instanceId: 'instance-1', runId: 'run-1' });
    expect(stale?.version).toBe(0);
    const [left, right] = await Promise.allSettled([
      commitFlowRunCheckpoint(runtimeA, {
        expectedVersion: 0,
        checkpoint: checkpoint(definition, 'run-1', 1, 'Completed'),
      }),
      commitFlowRunCheckpoint(runtimeB, {
        expectedVersion: 0,
        checkpoint: checkpoint(definition, 'run-1', 1, 'Waiting'),
      }),
    ]);

    expect([left.status, right.status].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)).toEqual(['fulfilled', 'rejected']);
    const rejected = left.status === 'rejected' ? left.reason : right.status === 'rejected' ? right.reason : undefined;
    expect(rejected).toBeInstanceOf(FlowRunCheckpointVersionConflictError);
    const file = path.join(storeRoot, 'instances', 'instance-1', 'runs', 'run-1', 'checkpoint.json');
    expect(fs.existsSync(file)).toBe(true);
    expect((await new FilesystemFlowRunCheckpointStore({ storeRoot }).load({
      instanceId: 'instance-1', runId: 'run-1',
    }))?.version).toBe(1);
  });

  test('applies the same immutable and terminal transition rules in the filesystem owner', async () => {
    const { storeRoot, definition } = fixture();
    const store = new FilesystemFlowRunCheckpointStore({ storeRoot });
    await store.commit({
      expectedVersion: null,
      checkpoint: checkpoint(definition, 'transition-run', 0, 'Waiting'),
    });
    await expect(store.commit({
      expectedVersion: 0,
      checkpoint: {
        ...checkpoint(definition, 'transition-run', 1, 'Waiting'),
        config: { mode: 'rewritten' },
      },
    })).rejects.toBeInstanceOf(FlowRunCheckpointTransitionError);

    await store.commit({
      expectedVersion: 0,
      checkpoint: checkpoint(definition, 'transition-run', 1, 'Completed'),
    });
    await expect(store.commit({
      expectedVersion: 1,
      checkpoint: checkpoint(definition, 'transition-run', 2, 'Waiting'),
    })).rejects.toBeInstanceOf(FlowRunCheckpointTransitionError);
    expect((await store.load({ instanceId: 'instance-1', runId: 'transition-run' }))?.version).toBe(1);
  });

  test('rejects incomplete profile facts before commit and after filesystem decode', async () => {
    const { storeRoot, definition } = fixture();
    const store = new FilesystemFlowRunCheckpointStore({ storeRoot });
    const incomplete = {
      ...checkpoint(definition, 'incomplete-run', 0, 'Waiting'),
      profile: {
        kind: 'AICtrlWorkflow',
        snapshot: {},
        ai: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
      },
    } as unknown as AIWorkflowFlowRunCheckpoint;

    await expect(store.commit({ expectedVersion: null, checkpoint: incomplete }))
      .rejects.toBeInstanceOf(FlowRunContractValidationError);
    expect(fs.existsSync(path.join(storeRoot, 'instances', 'instance-1', 'runs', 'incomplete-run'))).toBe(false);

    const nested = checkpoint(definition, 'nested-run', 0, 'Waiting') as unknown as Record<string, any>;
    nested.profile.snapshot.branchDecisions = {
      'if#0': { ifPath: 'if', invocationKey: 'if#0', kind: 'NoMatch', parallelAuthority: true },
    };
    await expect(store.commit({
      expectedVersion: null,
      checkpoint: nested as AIWorkflowFlowRunCheckpoint,
    })).rejects.toBeInstanceOf(FlowRunContractValidationError);
    expect(fs.existsSync(path.join(storeRoot, 'instances', 'instance-1', 'runs', 'nested-run'))).toBe(false);

    await store.commit({
      expectedVersion: null,
      checkpoint: checkpoint(definition, 'decode-run', 0, 'Waiting'),
    });
    const file = path.join(storeRoot, 'instances', 'instance-1', 'runs', 'decode-run', 'checkpoint.json');
    const recordsDir = path.join(path.dirname(file), 'step-space', 'records');
    const recordFile = path.join(recordsDir, fs.readdirSync(recordsDir).sort((left, right) => left < right ? -1 : left > right ? 1 : 0)[0]);
    const encodedRecord = JSON.parse(fs.readFileSync(recordFile, 'utf8')) as Record<string, unknown>;
    fs.writeFileSync(recordFile, JSON.stringify({ ...encodedRecord, key: '["changed"]' }));
    await expect(new FilesystemFlowRunCheckpointStore({ storeRoot }).load({
      instanceId: 'instance-1', runId: 'decode-run',
    })).rejects.toMatchObject({ code: 'flow-run-checkpoint-invalid' });
  });

  test('connects the materialized engine and AI Ctrl adapter to the canonical filesystem owner', async () => {
    const { storeRoot, definition } = fixture();
    const checkpointStore = new FilesystemFlowRunCheckpointStore({ storeRoot });
    const runtime: FlowRunCheckpointRuntime = { checkpointStore };
    const ctrlStore = createAICtrlWorkflowCheckpointStore(runtime, {
      instanceId: 'instance-1',
      definition,
      config: { mode: 'standard' },
      ai: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
      projectOutput: (snapshot: WorkCtrlFlowSnapshot) => ({ status: snapshot.status }),
    });
    const engine = createMaterializedWorkCtrlFlowEngineFromDirectory({
      instancesDir: path.join(storeRoot, 'instances'),
      instanceId: 'instance-1',
      store: ctrlStore,
    });

    expect((await engine.start('integrated-run', { input: { request: 'prepare' } })).status).toBe('Completed');
    const restored = await checkpointStore.load({ instanceId: 'instance-1', runId: 'integrated-run' });
    expect(restored).toMatchObject({
      input: { request: 'prepare' },
      output: { status: 'Completed' },
      profile: { kind: 'AICtrlWorkflow', snapshot: { status: 'Completed' } },
    });
  });

  test('serializes CAS transitions from separate operating-system processes', async () => {
    const { storeRoot, definition } = fixture();
    const store = new FilesystemFlowRunCheckpointStore({ storeRoot });
    await store.commit({
      expectedVersion: null,
      checkpoint: checkpoint(definition, 'process-run', 0, 'Waiting'),
    });
    const firstInput = path.join(storeRoot, 'process-first.json');
    const secondInput = path.join(storeRoot, 'process-second.json');
    fs.writeFileSync(firstInput, JSON.stringify(checkpoint(definition, 'process-run', 1, 'Completed')));
    fs.writeFileSync(secondInput, JSON.stringify(checkpoint(definition, 'process-run', 1, 'Waiting')));
    const moduleUrl = pathToFileURL(path.resolve(import.meta.dir, '../src/checkpoint-filesystem.ts')).href;
    const script = path.join(storeRoot, 'process-commit.ts');
    fs.writeFileSync(script, `
      import fs from 'node:fs';
      import { FilesystemFlowRunCheckpointStore } from ${JSON.stringify(moduleUrl)};
      const store = new FilesystemFlowRunCheckpointStore({ storeRoot: process.argv[2] });
      const checkpoint = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
      try {
        await store.commit({ expectedVersion: 0, checkpoint });
        process.exit(0);
      } catch (error) {
        if (error?.name === 'FlowRunCheckpointVersionConflictError') process.exit(17);
        console.error(error);
        process.exit(1);
      }
    `);
    const runProcess = (inputFile: string) => Bun.spawn([
      process.execPath,
      script,
      storeRoot,
      inputFile,
    ], { stdout: 'pipe', stderr: 'pipe' });
    const first = runProcess(firstInput);
    const second = runProcess(secondInput);
    const exitCodes = await Promise.all([first.exited, second.exited]);
    const errors = await Promise.all([
      new Response(first.stderr).text(),
      new Response(second.stderr).text(),
    ]);

    expect({ exitCodes: exitCodes.sort((left, right) => left - right), errors }).toEqual({
      exitCodes: [0, 17],
      errors: ['', ''],
    });
    expect((await new FilesystemFlowRunCheckpointStore({ storeRoot }).load({
      instanceId: 'instance-1', runId: 'process-run',
    }))?.version).toBe(1);
  });

  test('releases only the lock identity acquired by the current owner', async () => {
    const { storeRoot, definition } = fixture();
    const store = new FilesystemFlowRunCheckpointStore({ storeRoot });
    const runDir = path.join(storeRoot, 'instances', 'instance-1', 'runs', 'owner-boundary-run');
    const lockFile = path.join(runDir, 'checkpoint.lock');
    const displacedLock = path.join(runDir, 'checkpoint.lock.displaced');
    const originalRename = fs.renameSync;
    let replacementInstalled = false;
    fs.renameSync = ((oldPath, newPath) => {
      originalRename(oldPath, newPath);
      if (!replacementInstalled && newPath === path.join(runDir, 'checkpoint.json')) {
        originalRename(lockFile, displacedLock);
        fs.writeFileSync(lockFile, `${JSON.stringify({ pid: process.pid, token: 'replacement-owner' })}\n`);
        replacementInstalled = true;
      }
    }) as typeof fs.renameSync;
    try {
      await store.commit({
        expectedVersion: null,
        checkpoint: checkpoint(definition, 'owner-boundary-run', 0, 'Waiting'),
      });
    } finally {
      fs.renameSync = originalRename;
    }

    expect(replacementInstalled).toBe(true);
    expect(JSON.parse(fs.readFileSync(lockFile, 'utf8'))).toEqual({
      pid: process.pid,
      token: 'replacement-owner',
    });
    fs.unlinkSync(lockFile);
    fs.unlinkSync(displacedLock);
  });

  test('atomically claims an abandoned lock and leaves no recovery artifacts', async () => {
    const { storeRoot, definition } = fixture();
    const runDir = path.join(storeRoot, 'instances', 'instance-1', 'runs', 'abandoned-lock-run');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'checkpoint.lock'), `${JSON.stringify({
      pid: 2_147_483_647,
      token: 'abandoned-owner',
    })}\n`);

    await new FilesystemFlowRunCheckpointStore({ storeRoot }).commit({
      expectedVersion: null,
      checkpoint: checkpoint(definition, 'abandoned-lock-run', 0, 'Waiting'),
    });

    expect(fs.existsSync(path.join(runDir, 'checkpoint.json'))).toBe(true);
    expect(fs.readdirSync(runDir).filter((entry) => entry.startsWith('checkpoint.lock'))).toEqual([]);
  });

  test('recovers an abandoned recovery barrier in a fresh store', async () => {
    const { storeRoot, definition } = fixture();
    const runDir = path.join(storeRoot, 'instances', 'instance-1', 'runs', 'recovery-barrier-run');
    fs.mkdirSync(runDir, { recursive: true });
    const abandonedOwner = {
      pid: 2_147_483_647,
      token: 'abandoned-owner',
      createdAtMs: 1,
    };
    fs.writeFileSync(path.join(runDir, 'checkpoint.lock'), `${JSON.stringify(abandonedOwner)}\n`);
    fs.writeFileSync(path.join(runDir, 'checkpoint.lock.recovery'), `${JSON.stringify({
      ...abandonedOwner,
      token: 'abandoned-recovery',
    })}\n`);

    await new FilesystemFlowRunCheckpointStore({ storeRoot }).commit({
      expectedVersion: null,
      checkpoint: checkpoint(definition, 'recovery-barrier-run', 0, 'Waiting'),
    });

    expect(fs.existsSync(path.join(runDir, 'checkpoint.json'))).toBe(true);
    expect(fs.readdirSync(runDir).filter((entry) => entry.startsWith('checkpoint.lock'))).toEqual([]);
  });

  test('rejects unsafe ids and malformed program data before creating a run directory', async () => {
    const { storeRoot, definition } = fixture();
    const store = new FilesystemFlowRunCheckpointStore({ storeRoot });
    await expect(store.load({ instanceId: '../instance-1', runId: 'run' })).rejects.toMatchObject({
      code: 'flow-run-id-invalid',
    });
    await expect(store.commit({
      expectedVersion: null,
      checkpoint: checkpoint(definition, '../run', 0, 'Waiting'),
    })).rejects.toMatchObject({ code: 'flow-run-id-invalid' });

    const malformed = checkpoint(definition, 'accessor-run', 0, 'Waiting') as unknown as Record<string, unknown>;
    Object.defineProperty(malformed.input as object, 'derived', {
      enumerable: true,
      get: () => 'value',
    });
    await expect(store.commit({
      expectedVersion: null,
      checkpoint: malformed as unknown as AIWorkflowFlowRunCheckpoint,
    })).rejects.toMatchObject({ code: 'FLOW_CONTRACT_DATA_FIELD_REQUIRED' });
    expect(fs.existsSync(path.join(storeRoot, 'instances', 'instance-1', 'runs', 'accessor-run'))).toBe(false);
  });

  test('refuses symlink boundaries and definition identity mismatches without changing external files', async () => {
    const { storeRoot, definition } = fixture();
    const runsDir = path.join(storeRoot, 'instances', 'instance-1', 'runs');
    fs.mkdirSync(runsDir, { recursive: true });
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-checkpoint-external-'));
    const marker = path.join(external, 'marker.txt');
    fs.writeFileSync(marker, 'unchanged');
    fs.symlinkSync(external, path.join(runsDir, 'linked-run'));
    const store = new FilesystemFlowRunCheckpointStore({ storeRoot });

    await expect(store.commit({
      expectedVersion: null,
      checkpoint: checkpoint(definition, 'linked-run', 0, 'Waiting'),
    })).rejects.toMatchObject({ code: 'flow-run-symlink-boundary' });
    expect(fs.readFileSync(marker, 'utf8')).toBe('unchanged');

    const mismatched = checkpoint({ ...definition, revision: 'workflow-r2' }, 'identity-run', 0, 'Waiting');
    await expect(store.commit({ expectedVersion: null, checkpoint: mismatched })).rejects.toMatchObject({
      code: 'flow-run-definition-mismatch',
    });
    expect(fs.existsSync(path.join(runsDir, 'identity-run'))).toBe(false);
  });

  test('recovers partial staging, rejects fatal canonical decode and preserves stable JSON ordering', async () => {
    const { storeRoot, definition } = fixture();
    const runDir = path.join(storeRoot, 'instances', 'instance-1', 'runs', 'partial-run');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'checkpoint.staging.json'), '{partial');
    const store = new FilesystemFlowRunCheckpointStore({ storeRoot });
    await store.commit({
      expectedVersion: null,
      checkpoint: checkpoint(definition, 'partial-run', 0, 'Waiting'),
    });
    expect(fs.existsSync(path.join(runDir, 'checkpoint.staging.json'))).toBe(false);
    const bytes = fs.readFileSync(path.join(runDir, 'checkpoint.json'), 'utf8');
    expect(bytes.indexOf('"definition"')).toBeLessThan(bytes.indexOf('"instanceId"'));
    expect(bytes.indexOf('"logicalDigest"')).toBeLessThan(bytes.indexOf('"runId"'));
    const recordFiles = fs.readdirSync(path.join(runDir, 'step-space', 'records'));
    expect(recordFiles).toHaveLength(2);
    const headIdentity = JSON.parse(bytes) as { runStepStateRootDigest: string };
    const tree = JSON.parse(fs.readFileSync(path.join(
      runDir,
      'step-space',
      'trees',
      `${headIdentity.runStepStateRootDigest.slice(7)}.json`,
    ), 'utf8')) as { recordDigest: string };
    const leaf = JSON.parse(fs.readFileSync(path.join(
      runDir,
      'step-space',
      'records',
      `${tree.recordDigest.slice(7)}.json`,
    ), 'utf8')) as {
      value: { coreRecordDigest: string };
    };
    const record = JSON.parse(fs.readFileSync(path.join(runDir, 'step-space', 'records', `${leaf.value.coreRecordDigest.slice(7)}.json`), 'utf8')) as { value: { memberId: string } };
    expect(record.value.memberId).toBe('definition:done');
    const head = JSON.parse(bytes) as { control: { checkpoint: Record<string, unknown> } };
    expect(head.control.checkpoint.controllerSidecars).toBeUndefined();
    expect(head.control.checkpoint.nodeSidecars).toBeUndefined();

    fs.writeFileSync(path.join(runDir, 'checkpoint.json'), '{malformed');
    await expect(new FilesystemFlowRunCheckpointStore({ storeRoot }).load({
      instanceId: 'instance-1', runId: 'partial-run',
    })).rejects.toMatchObject({ code: 'flow-run-checkpoint-invalid' });
  });

  test('rejects a frozen definition whose bytes no longer match its admitted identity', async () => {
    const { storeRoot, definition } = fixture();
    fs.writeFileSync(
      path.join(storeRoot, 'instances', 'instance-1', 'definition', 'flow-code.ts'),
      'export function ready(runtime, input) { return { changed: input }; }\n',
    );
    const store = new FilesystemFlowRunCheckpointStore({ storeRoot });
    await expect(store.commit({
      expectedVersion: null,
      checkpoint: checkpoint(definition, 'digest-run', 0, 'Waiting'),
    })).rejects.toMatchObject({ code: 'flow-run-instance-invalid' });
    expect(fs.existsSync(path.join(
      storeRoot, 'instances', 'instance-1', 'runs', 'digest-run',
    ))).toBe(false);
  });

  test('rebuilds a readonly Unicode-stable derived index without changing checkpoints', async () => {
    const { storeRoot, definition } = fixture();
    const store = new FilesystemFlowRunCheckpointStore({ storeRoot });
    for (const runId of ['run-中', 'run-z', 'run-ä']) {
      await store.commit({
        expectedVersion: null,
        checkpoint: checkpoint(definition, runId, 0, 'Waiting'),
      });
    }
    const checkpointFile = path.join(storeRoot, 'instances', 'instance-1', 'runs', 'run-z', 'checkpoint.json');
    const before = fs.readFileSync(checkpointFile);
    const first = await store.rebuildRunIndex();
    expect(first.entries.map((entry) => entry.runId)).toEqual(['run-z', 'run-ä', 'run-中']);
    expect(Object.isFrozen(first)).toBe(true);
    expect(() => {
      (first.entries[0] as { runId: string }).runId = 'changed';
    }).toThrow();

    const indexFile = path.join(storeRoot, 'run-index.json');
    const firstBytes = fs.readFileSync(indexFile);
    fs.rmSync(indexFile);
    const rebuilt = await new FilesystemFlowRunCheckpointStore({ storeRoot }).rebuildRunIndex();
    expect(fs.readFileSync(indexFile)).toEqual(firstBytes);
    expect(rebuilt).toEqual(first);
    expect(fs.readFileSync(checkpointFile)).toEqual(before);
  });
});
