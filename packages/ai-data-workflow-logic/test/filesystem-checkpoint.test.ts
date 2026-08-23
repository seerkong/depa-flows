import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AIWorkflowStateProjection } from 'ai-workflow-contract';
import { freezeAIWorkflowRunResourcesFromDirectory, projectFrozenAIAgentTaskBinding } from 'ai-workflow-logic/run-freeze';
import { FilesystemFlowRunCheckpointStore } from 'ai-workflow-logic/checkpoint-filesystem';
import { createInitialRunStepExtensions, mutateRunStepExtension } from 'ai-workflow-logic';
import {
  applyAIDataWorkflowGraphPatch,
  commitAIDataWorkflowCheckpoint,
  createAIDataWorkflowCheckpoint,
  createAIDataWorkflowRunGraph,
  invalidateAIDataWorkflowNode,
  loadAIDataWorkflowSources,
  loadAIDataWorkflow,
} from 'ai-data-workflow-logic';
import {
  continueMaterializedAIDataWorkflow,
  createMaterializedAIDataWorkflowProfileAuthority,
  loadMaterializedAIDataWorkflowRun,
  startMaterializedAIDataWorkflow,
} from 'ai-data-workflow-logic/filesystem';
import { materializeFlowInstance } from 'work-ctrl-flow-logic';

describe('materialized AI Data canonical execution', () => {
  test('freezes the example extension and mutates it through the canonical checkpoint owner', async () => {
    const supportRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-data-step-extension-'));
    const exampleRoot = path.resolve(import.meta.dir, '../../../examples/xnl-bundles/ai-data-workflow');
    const codec = {
      schemaRef: 'schema://depa.example.review-policy/v1',
      codec: {
        normalize(value: any) {
          if (!value || typeof value !== 'object' || !Number.isSafeInteger(value.reviewDepth)
            || value.reviewDepth < 1 || typeof value.audience !== 'string' || !value.audience.trim()) {
            throw new Error('review policy is invalid');
          }
          return { audience: value.audience.trim(), reviewDepth: value.reviewDepth };
        },
      },
    } as const;
    const extensionCodecs = { resolve: (kind: string) => kind === 'depa.example.review-policy' ? codec : undefined };
    const sources: Record<string, string> = {};
    const visit = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(file);
        else if (entry.name.endsWith('.xnl')) sources[path.relative(exampleRoot, file).split(path.sep).join('/')] = fs.readFileSync(file, 'utf8');
      }
    };
    visit(exampleRoot);
    const loaded = loadAIDataWorkflow({ extensionCodecs }, { sources }, { baseUri: exampleRoot });
    if (!loaded.binding) throw new Error(`example binding missing: ${loaded.diagnostics.map(({ code }) => code).join(',')}`);
    const instance = materializeFlowInstance({
      definitionDir: exampleRoot,
      instancesDir: path.join(supportRoot, 'instances'),
      instanceId: 'extension-instance',
      source: {
        revision: 'extension-r1',
        provenance: { authority: 'resource-package', artifactRef: 'resource://depa.examples.SupportEvidenceDag' },
      },
      validateDefinition: () => undefined,
    });
    const profileAuthority = createMaterializedAIDataWorkflowProfileAuthority({
      supportRoot,
      extensionCodecs,
    });
    const checkpointStore = new FilesystemFlowRunCheckpointStore({
      storeRoot: supportRoot,
      profileAuthority,
      extensionCodecs,
    });
    const graph = createAIDataWorkflowRunGraph({ binding: loaded.binding, runId: 'extension-run' });
    const { baseUri: _baseUri, definitionStepForest: _forest, ...definition } = graph.binding.definition;
    const durableGraph = { ...graph, binding: { ...graph.binding, definition } };
    const authority = profileAuthority.load({
      instanceId: 'extension-instance',
      definition: instance.descriptor.definition,
      profileKind: 'AIDataWorkflow',
    });
    const initial = await createAIDataWorkflowCheckpoint({ checkpointStore }, {
      instanceId: 'extension-instance',
      definition: instance.descriptor.definition,
      graph: durableGraph,
      input: { ticket: { ticketId: 'T-1', message: 'subject' } },
      config: {},
      state: { status: 'Pending', generation: 0 },
      output: null,
      controllerSidecars: { status: 'Pending' },
      nodeSidecars: Object.fromEntries(graph.declarationOrder.map((nodeId) => [nodeId, { status: 'Pending', generation: 0 }])),
      ai: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
      stepExtensions: createInitialRunStepExtensions(authority),
    });
    expect(initial.stepExtensions?.byStepId.summarize['depa.example.review-policy']).toEqual({
      schemaRef: 'schema://depa.example.review-policy/v1',
      revision: 0,
      value: { audience: 'support', reviewDepth: 2 },
    });
    const runDir = path.join(supportRoot, 'instances', 'extension-instance', 'runs', 'extension-run');
    const beforeRecords = new Set(fs.readdirSync(path.join(runDir, 'step-space', 'records')));
    const revised = await mutateRunStepExtension({ checkpointStore, profileAuthority, extensionCodecs }, {
      instanceId: 'extension-instance', runId: 'extension-run', stepId: 'summarize', kind: 'depa.example.review-policy',
    }, {
      expectedRevision: 0,
      value: { audience: ' escalation ', reviewDepth: 3 },
    }, {});
    expect(revised.stepExtensions?.byStepId.summarize['depa.example.review-policy']).toEqual({
      schemaRef: 'schema://depa.example.review-policy/v1',
      revision: 1,
      value: { audience: 'escalation', reviewDepth: 3 },
    });
    const addedRecords = fs.readdirSync(path.join(runDir, 'step-space', 'records')).filter((name) => !beforeRecords.has(name));
    expect(addedRecords).toHaveLength(2);
    const receipt = JSON.parse(fs.readFileSync(path.join(runDir, 'step-space', 'receipts', '1.json'), 'utf8')) as {
      addedMaterialRecordDigests: string[];
      addedRecordDigests: string[];
      addedTreeNodeDigests: string[];
    };
    expect(receipt.addedMaterialRecordDigests).toHaveLength(1);
    expect(receipt.addedRecordDigests).toHaveLength(1);
    expect(receipt.addedTreeNodeDigests.length).toBeLessThanOrEqual(3);
    const freshStore = new FilesystemFlowRunCheckpointStore({ storeRoot: supportRoot, profileAuthority, extensionCodecs });
    expect(await freshStore.load({ instanceId: 'extension-instance', runId: 'extension-run' })).toEqual(revised);
    await expect(mutateRunStepExtension({ checkpointStore: freshStore, profileAuthority, extensionCodecs }, {
      instanceId: 'extension-instance', runId: 'extension-run', stepId: 'summarize', kind: 'unknown.kind',
    }, { expectedRevision: 0, value: {} }, {})).rejects.toThrow('not admitted');
    await expect(mutateRunStepExtension({ checkpointStore: freshStore, profileAuthority, extensionCodecs }, {
      instanceId: 'extension-instance', runId: 'extension-run', stepId: 'summarize', kind: 'depa.example.review-policy',
    }, { expectedRevision: 1, value: { audience: '', reviewDepth: 0 } }, {})).rejects.toThrow('review policy is invalid');
    let accessorRead = false;
    const accessorSelector = {
      instanceId: 'extension-instance', runId: 'extension-run', kind: 'depa.example.review-policy',
    } as Record<string, unknown>;
    Object.defineProperty(accessorSelector, 'stepId', {
      enumerable: true,
      get() { accessorRead = true; return 'summarize'; },
    });
    await expect(mutateRunStepExtension(
      { checkpointStore: freshStore, profileAuthority, extensionCodecs },
      accessorSelector as never,
      { expectedRevision: 1, value: { audience: 'support', reviewDepth: 4 } },
      {},
    )).rejects.toThrow('own-data');
    expect(accessorRead).toBe(false);
    await expect(mutateRunStepExtension(
      { checkpointStore: freshStore, profileAuthority, extensionCodecs },
      { instanceId: 'extension-instance', runId: 'extension-run', stepId: 'summarize', kind: 'depa.example.review-policy' },
      { expectedRevision: 1, value: { audience: 'support', reviewDepth: 4 } },
      { physicalPath: '/tmp/not-domain-config' } as never,
    )).rejects.toThrow('config fields are invalid');
    await expect(freshStore.commit({
      expectedVersion: 1,
      checkpoint: {
        ...revised,
        version: 2,
        stepExtensions: {
          ...revised.stepExtensions!,
          byStepId: {
            ...revised.stepExtensions!.byStepId,
            summarize: {
              ...revised.stepExtensions!.byStepId.summarize,
              'depa.example.review-policy': {
                schemaRef: 'schema://depa.example.review-policy/v1',
                revision: 2,
                value: { audience: ' forged ', reviewDepth: 4 },
              },
            },
          },
        },
      },
    })).rejects.toThrow('not normalized');
    expect((await freshStore.load({ instanceId: 'extension-instance', runId: 'extension-run' }))?.version).toBe(1);
  });
  test('keeps a linked AI Data instances boundary outside the support root unchanged', async () => {
    const supportRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-data-boundary-'));
    const source = path.join(supportRoot, 'source');
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, 'manifest.xnl'), `<AIDataWorkflow #depa.flows.test.DataBoundary apiVersion="depa.flows/v1" version="1" (
      <FlowContract #depa.flows.test.DataBoundary { inputPorts = ["request"] outputPorts = ["request"] }>
    ) [
      <EntryNode #entry>
      <ReturnNode #return { inputs = { request = "flow-port://#entry/request" } }>
    ]>`);
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-data-external-'));
    const marker = path.join(external, 'marker.txt');
    fs.writeFileSync(marker, 'unchanged');
    fs.symlinkSync(external, path.join(supportRoot, 'instances'));
    const stateProjection: AIWorkflowStateProjection = {
      async loadRunState() { return undefined; },
    };

    await expect(startMaterializedAIDataWorkflow({
      supportRoot,
      workflow: {
        ai: {
          roots: { globalRoot: 'vfs://global', workspaceRoot: 'vfs://workspace' },
          effects: { async invoke<Input, Output>(): Promise<Output> { return undefined as Output; } },
          stateStore: stateProjection,
        },
      },
      importModule: async () => ({}),
    }, {
      instanceId: 'linked-data-instance',
      runId: 'linked-data-run',
      bundleDir: source,
      source: {
        revision: 'data-r1',
        provenance: { authority: 'resource-package', artifactRef: 'resource://flow/data-boundary' },
      },
      input: { request: 'subject' },
    }, {
      checkpointConfig: {},
      durableAI: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
    })).rejects.toThrow();
    expect(fs.readFileSync(marker, 'utf8')).toBe('unchanged');
    expect(fs.readdirSync(external)).toEqual(['marker.txt']);
  });

  test('executes into a filesystem checkpoint and reconstructs from the frozen instance', async () => {
    const supportRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-data-canonical-'));
    const source = path.join(supportRoot, 'source');
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, 'manifest.xnl'), `<AIDataWorkflow #depa.flows.test.MaterializedData apiVersion="depa.flows/v1" version="1" (
      <FlowContract #depa.flows.test.MaterializedData { inputPorts = ["request"] outputPorts = ["result"] }>
    ) [
      <EntryNode #entry>
      <TransformNode #prepare {
        inputs = { request = "flow-port://#entry/request" }
        outputs = ["result"]
        src = "vfs://./flow-code.ts#prepare"
      }>
      <ReturnNode #return { inputs = { result = "flow-port://#prepare/result" } }>
    ]>`);
    fs.writeFileSync(path.join(source, 'flow-code.ts'), 'export function prepare(runtime, input, config) { return { result: input.request }; }\n');
    const stateProjection: AIWorkflowStateProjection = {
      async loadRunState() { return undefined; },
    };
    let observedV0 = false;
    const runtime = {
      supportRoot,
      workflow: {
        ai: {
          roots: { globalRoot: 'vfs://global', workspaceRoot: 'vfs://workspace' },
          effects: { async invoke<Input, Output>(): Promise<Output> { return undefined as Output; } },
          stateStore: stateProjection,
        },
      },
      importModule: async () => ({
        prepare: (_runtime: unknown, input: { request: string }) => {
          if (observedV0) return { result: `prepared:${input.request}` };
          const initial = JSON.parse(fs.readFileSync(path.join(
            supportRoot, 'instances', 'data-instance', 'runs', 'data-run', 'checkpoint.json',
          ), 'utf8')) as { schemaVersion: string; version: number; runStepStateRootDigest: string };
          expect(initial.version).toBeGreaterThan(0);
          expect(initial.schemaVersion).toBe('depa.flow-run-checkpoint-head/v1');
          expect(initial.runStepStateRootDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
          observedV0 = true;
          return { result: `prepared:${input.request}` };
        },
      }),
    } as const;

    const completed = await startMaterializedAIDataWorkflow(runtime, {
      instanceId: 'data-instance',
      runId: 'data-run',
      bundleDir: source,
      source: {
        revision: 'data-r1',
        provenance: { authority: 'resource-package', artifactRef: 'resource://flow/materialized-data' },
      },
      input: { request: 'subject' },
    }, {
      checkpointConfig: { mode: 'standard' },
      platformDefaultPolicy: 'never',
      durableAI: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
    });
    expect(observedV0).toBe(true);
    expect(completed.checkpoint.version).toBeGreaterThan(1);
    expect(completed.checkpoint.output).toEqual({ result: 'prepared:subject' });
    expect(completed.checkpoint.profile.runGraph.platformDefaultPolicy).toBe('never');
    expect(completed.checkpoint.profile.runGraph.nodes.prepare.reusePolicy.source).toBe('platform-default');

    const frozenManifest = fs.readFileSync(path.join(
      supportRoot, 'instances', 'data-instance', 'definition', 'manifest.xnl',
    ));
    fs.writeFileSync(path.join(source, 'manifest.xnl'), '<AIDataWorkflow');
    const restored = await loadMaterializedAIDataWorkflowRun(runtime, {
      instanceId: 'data-instance', runId: 'data-run',
    });
    expect(restored?.checkpoint.output).toEqual({ result: 'prepared:subject' });
    expect(restored?.graph.nodes.prepare.status).toBe('Succeeded');
    expect(restored?.checkpoint.profile.runGraph.platformDefaultPolicy).toBe('never');
    expect(restored?.checkpoint.profile.runGraph.nodes.prepare.reusePolicy.source).toBe('platform-default');
    expect(restored?.graph.binding.definition.baseUri).toContain('/instances/data-instance/definition');
    expect(restored?.checkpoint.profile.runGraph.binding.definition.baseUri).toBeUndefined();
    expect(fs.readFileSync(path.join(
      supportRoot, 'instances', 'data-instance', 'definition', 'manifest.xnl',
    ))).toEqual(frozenManifest);

    const freshRuntime = { ...runtime };
    const admission = {
      bundleDir: source,
      source: {
        revision: 'data-r2',
        provenance: { authority: 'resource-package', artifactRef: 'resource://flow/changed-live-data' },
      },
    } as const;
    expect((await startMaterializedAIDataWorkflow(freshRuntime, {
      instanceId: 'data-instance', runId: 'data-run', input: { request: 'subject' }, ...admission,
    }, {
      checkpointConfig: { mode: 'standard' }, platformDefaultPolicy: 'never',
      durableAI: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
    })).checkpoint.output).toEqual({ result: 'prepared:subject' });
    expect((await startMaterializedAIDataWorkflow(freshRuntime, {
      instanceId: 'data-instance', runId: 'data-run-2', input: { request: 'second' }, ...admission,
    }, {
      checkpointConfig: { mode: 'standard' }, platformDefaultPolicy: 'never',
      durableAI: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
    })).checkpoint.output).toEqual({ result: 'prepared:second' });

    const checkpointFile = path.join(
      supportRoot, 'instances', 'data-instance', 'runs', 'data-run', 'checkpoint.json',
    );
    const head = JSON.parse(fs.readFileSync(checkpointFile, 'utf8')) as { runStepStateRootDigest: string };
    const treesDir = path.join(path.dirname(checkpointFile), 'step-space', 'trees');
    const recordsDir = path.join(path.dirname(checkpointFile), 'step-space', 'records');
    const currentRecordDigest = (treeDigest: string): string => {
      const node = JSON.parse(fs.readFileSync(path.join(treesDir, `${treeDigest.slice(7)}.json`), 'utf8')) as {
        kind: 'leaf' | 'branch';
        recordDigest?: string;
        leftDigest?: string;
      };
      if (node.kind === 'leaf') return node.recordDigest!;
      return currentRecordDigest(node.leftDigest!);
    };
    const recordFile = path.join(recordsDir, `${currentRecordDigest(head.runStepStateRootDigest).slice(7)}.json`);
    const encoded = JSON.parse(fs.readFileSync(recordFile, 'utf8')) as Record<string, unknown>;
    fs.writeFileSync(recordFile, JSON.stringify({ ...encoded, key: '["changed"]' }));
    await expect(loadMaterializedAIDataWorkflowRun(runtime, {
      instanceId: 'data-instance', runId: 'data-run',
    })).rejects.toMatchObject({ code: 'flow-run-checkpoint-invalid' });
  });

  test('continues a reconstructed version-zero run once and reuses its terminal checkpoint', async () => {
    const supportRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-data-continue-'));
    const source = path.join(supportRoot, 'source');
    fs.mkdirSync(source);
    const manifest = `<AIDataWorkflow #depa.flows.test.ContinueData apiVersion="depa.flows/v1" version="1" (
      <FlowContract #depa.flows.test.ContinueData { inputPorts = ["request"] outputPorts = ["result"] }>
    ) [
      <EntryNode #entry>
      <TransformNode #prepare {
        inputs = { request = "flow-port://#entry/request" }
        outputs = ["result"]
        src = "vfs://./flow-code.ts#prepare"
      }>
      <ReturnNode #return { inputs = { result = "flow-port://#prepare/result" } }>
    ]>`;
    fs.writeFileSync(path.join(source, 'manifest.xnl'), manifest);
    fs.writeFileSync(path.join(source, 'flow-code.ts'), 'export function prepare(runtime, input, config) { return { result: input.request }; }\n');
    const instance = materializeFlowInstance({
      definitionDir: source,
      instancesDir: path.join(supportRoot, 'instances'),
      instanceId: 'continue-instance',
      source: {
        revision: 'continue-r1',
        provenance: { authority: 'resource-package', artifactRef: 'resource://flow/continue-data' },
      },
      validateDefinition: () => undefined,
    });
    const loaded = loadAIDataWorkflowSources({ 'manifest.xnl': manifest });
    if (!loaded.binding) throw new Error('fixture binding missing');
    const graph = createAIDataWorkflowRunGraph({
      binding: loaded.binding,
      runId: 'continue-run',
      platformDefaultPolicy: 'never',
    });
    const profileAuthority = createMaterializedAIDataWorkflowProfileAuthority({ supportRoot });
    const checkpointStore = new FilesystemFlowRunCheckpointStore({ storeRoot: supportRoot, profileAuthority });
    const advancedV0Graph = applyAIDataWorkflowGraphPatch(
      createAIDataWorkflowRunGraph({ binding: loaded.binding, runId: 'advanced-v0-fs-run' }),
      {
        patchId: 'advanced-before-fs-admission',
        operations: [{ op: 'update-node', nodeId: 'prepare', changes: { config: { mode: 'advanced' } } }],
      },
    );
    await expect(createAIDataWorkflowCheckpoint({ checkpointStore }, {
      instanceId: 'continue-instance', definition: instance.descriptor.definition, graph: advancedV0Graph,
      input: { request: 'subject' }, config: {}, state: { status: 'Pending', generation: 1 }, output: null,
      controllerSidecars: { status: 'Pending' },
      nodeSidecars: Object.fromEntries(advancedV0Graph.declarationOrder.map((nodeId) => [nodeId, {
        status: advancedV0Graph.nodes[nodeId].status,
        generation: advancedV0Graph.nodes[nodeId].generation,
      }])),
      ai: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
    })).rejects.toThrow();
    expect(await checkpointStore.load({
      instanceId: 'continue-instance', runId: 'advanced-v0-fs-run',
    })).toBeUndefined();
    await createAIDataWorkflowCheckpoint({ checkpointStore }, {
      instanceId: 'continue-instance',
      definition: instance.descriptor.definition,
      graph,
      input: { request: 'subject' },
      config: { alpha: 1, zeta: 2 },
      state: { status: 'Pending', generation: 0 },
      output: null,
      controllerSidecars: { status: 'Pending' },
      nodeSidecars: Object.fromEntries(graph.declarationOrder.map((nodeId) => [nodeId, {
        status: graph.nodes[nodeId].status,
        generation: graph.nodes[nodeId].generation,
      }])),
      ai: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
    });

    let executions = 0;
    const stateProjection: AIWorkflowStateProjection = {
      async loadRunState() { return undefined; },
    };
    const freshRuntime = {
      supportRoot,
      workflow: {
        ai: {
          roots: { globalRoot: 'vfs://global', workspaceRoot: 'vfs://workspace' },
          effects: { async invoke<Input, Output>(): Promise<Output> { return undefined as Output; } },
          stateStore: stateProjection,
        },
      },
      importModule: async () => ({
        prepare: (_runtime: unknown, input: { request: string }) => {
          executions += 1;
          return { result: `continued:${input.request}` };
        },
      }),
    } as const;

    const completed = await continueMaterializedAIDataWorkflow(freshRuntime, {
      instanceId: 'continue-instance', runId: 'continue-run',
    }, {});
    expect(completed.checkpoint.version).toBeGreaterThan(1);
    expect(completed.checkpoint.output).toEqual({ result: 'continued:subject' });
    expect(executions).toBe(1);

    const repeated = await startMaterializedAIDataWorkflow(freshRuntime, {
      instanceId: 'continue-instance',
      runId: 'continue-run',
      input: { request: 'subject' },
    }, {
      checkpointConfig: { zeta: 2, alpha: 1 },
      platformDefaultPolicy: 'never',
      durableAI: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
    });
    expect((completed.checkpoint.profile.runGraph as typeof graph).platformDefaultPolicy).toBe('never');
    expect((completed.checkpoint.profile.runGraph as typeof graph).nodes.prepare.reusePolicy.source).toBe('platform-default');
    expect(repeated.checkpoint.version).toBe(completed.checkpoint.version);
    expect(executions).toBe(1);

    const startGraph = createAIDataWorkflowRunGraph({ binding: loaded.binding, runId: 'start-existing-run' });
    await createAIDataWorkflowCheckpoint({ checkpointStore }, {
      instanceId: 'continue-instance',
      definition: instance.descriptor.definition,
      graph: startGraph,
      input: { request: 'second' },
      config: { alpha: 1, zeta: 2 },
      state: { status: 'Pending', generation: 0 },
      output: null,
      controllerSidecars: { status: 'Pending' },
      nodeSidecars: Object.fromEntries(startGraph.declarationOrder.map((nodeId) => [nodeId, {
        status: startGraph.nodes[nodeId].status,
        generation: startGraph.nodes[nodeId].generation,
      }])),
      ai: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
    });
    await expect(startMaterializedAIDataWorkflow(freshRuntime, {
      instanceId: 'continue-instance',
      runId: 'start-existing-run',
      input: { request: 'second' },
    }, {
      checkpointConfig: { alpha: 2, zeta: 2 },
      durableAI: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
    })).rejects.toThrow('different start facts');
    expect(executions).toBe(1);

    const startedFromExisting = await startMaterializedAIDataWorkflow(freshRuntime, {
      instanceId: 'continue-instance',
      runId: 'start-existing-run',
      input: { request: 'second' },
    }, {
      checkpointConfig: { zeta: 2, alpha: 1 },
      durableAI: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
    });
    expect(startedFromExisting.checkpoint.version).toBeGreaterThan(1);
    expect(startedFromExisting.checkpoint.output).toEqual({ result: 'continued:second' });
    expect(executions).toBe(2);
  });

  test('checkpoints every node boundary and resumes without replaying a completed effectful node', async () => {
    const supportRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-data-step-resume-'));
    const source = path.join(supportRoot, 'source');
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, 'manifest.xnl'), `<AIDataWorkflow #depa.flows.test.StepResume apiVersion="depa.flows/v1" version="1" (
      <FlowContract #depa.flows.test.StepResume { inputPorts = ["request"] outputPorts = ["result"] }>
    ) [
      <EntryNode #entry>
      <TransformNode #prepare {
        inputs = { request = "flow-port://#entry/request" }
        outputs = ["prepared"]
        src = "vfs://./flow-code.ts#prepare"
      }>
      <TransformNode #finalize {
        inputs = { prepared = "flow-port://#prepare/prepared" }
        outputs = ["result"]
        src = "vfs://./flow-code.ts#finalize"
      }>
      <ReturnNode #return { inputs = { result = "flow-port://#finalize/result" } }>
    ]>`);
    fs.writeFileSync(path.join(source, 'flow-code.ts'), 'export function prepare() {}\nexport function finalize() {}\n');
    const executions = { prepare: 0, finalize: 0 };
    const observedVersions: number[] = [];
    const stateProjection: AIWorkflowStateProjection = {
      async loadRunState() { return undefined; },
    };
    const workflow = {
      ai: {
        roots: { globalRoot: 'vfs://global', workspaceRoot: 'vfs://workspace' },
        effects: { async invoke<Input, Output>(): Promise<Output> { return undefined as Output; } },
        stateStore: stateProjection,
      },
    };
    const importModule = async () => ({
      prepare: (_runtime: unknown, input: { request: string }) => {
        executions.prepare += 1;
        return { prepared: `prepared:${input.request}` };
      },
      finalize: (_runtime: unknown, input: { prepared: string }) => {
        executions.finalize += 1;
        return { result: `final:${input.prepared}` };
      },
    });
    let interrupted = false;
    await expect(startMaterializedAIDataWorkflow({
      supportRoot,
      workflow,
      importModule,
      checkpointObserver: ({ checkpoint, nodeId, phase }) => {
        observedVersions.push(checkpoint.version);
        if (!interrupted && nodeId === 'prepare' && phase === 'after') {
          interrupted = true;
          throw new Error('checkpoint observer stopped the current process');
        }
      },
    }, {
      instanceId: 'step-instance',
      runId: 'step-run',
      bundleDir: source,
      source: {
        revision: 'step-r1',
        provenance: { authority: 'resource-package', artifactRef: 'resource://flow/step-resume' },
      },
      input: { request: 'subject' },
    }, {
      checkpointConfig: {},
      durableAI: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
    })).rejects.toThrow('checkpoint observer stopped the current process');

    const paused = await loadMaterializedAIDataWorkflowRun({ supportRoot, workflow, importModule }, {
      instanceId: 'step-instance', runId: 'step-run',
    });
    expect(paused?.graph.nodes.prepare.status).toBe('Succeeded');
    expect(paused?.graph.nodes.finalize.status).toBe('Pending');
    expect(executions).toEqual({ prepare: 1, finalize: 0 });
    expect(observedVersions).toEqual([...observedVersions].sort((left, right) => left - right));
    const directCheckpointStore = new FilesystemFlowRunCheckpointStore({
      storeRoot: supportRoot,
      profileAuthority: createMaterializedAIDataWorkflowProfileAuthority({ supportRoot }),
    });

    const earlierHistoryGraph = {
      ...paused!.checkpoint.profile.runGraph,
      currentGeneration: 1,
      patchHistory: [{
        patchId: 'generation-one-with-earlier-target',
        generation: 1,
        operations: [{
          op: 'update-node' as const,
          nodeId: 'prepare',
          changes: { config: { mode: 'earlier-target-generation' } },
        }],
      }],
    };
    await expect(commitAIDataWorkflowCheckpoint({
      checkpointStore: directCheckpointStore,
    }, {
      expectedVersion: paused!.checkpoint.version,
      checkpoint: {
        ...paused!.checkpoint,
        version: paused!.checkpoint.version + 1,
        state: { status: 'Pending', generation: 1 },
        controllerSidecars: { status: 'Pending' },
        profile: { ...paused!.checkpoint.profile, runGraph: earlierHistoryGraph },
      },
    })).rejects.toThrow();
    const recoveredAfterRejectedHistory = await loadMaterializedAIDataWorkflowRun(
      { supportRoot, workflow, importModule },
      { instanceId: 'step-instance', runId: 'step-run' },
    );
    expect(recoveredAfterRejectedHistory?.checkpoint.version).toBe(paused!.checkpoint.version);
    expect(recoveredAfterRejectedHistory?.graph.nodes.prepare.generation).toBe(0);

    const invalidatedGraph = invalidateAIDataWorkflowNode(
      paused!.checkpoint.profile.runGraph,
      'prepare',
      'refresh',
      { generation: 1 },
    );
    const unexplainedStructuralGraph: typeof invalidatedGraph = {
      ...invalidatedGraph,
      nodes: {
        ...invalidatedGraph.nodes,
        prepare: { ...invalidatedGraph.nodes.prepare, config: { mode: 'unexplained' } },
      },
    };
    await expect(commitAIDataWorkflowCheckpoint({
      checkpointStore: directCheckpointStore,
    }, {
      expectedVersion: paused!.checkpoint.version,
      checkpoint: {
        ...paused!.checkpoint,
        version: paused!.checkpoint.version + 1,
        state: { status: 'Pending', generation: 1 },
        controllerSidecars: { status: 'Pending' },
        nodeSidecars: Object.fromEntries(unexplainedStructuralGraph.declarationOrder.map((nodeId) => [nodeId, {
          status: unexplainedStructuralGraph.nodes[nodeId].status,
          generation: unexplainedStructuralGraph.nodes[nodeId].generation,
        }])),
        profile: { ...paused!.checkpoint.profile, runGraph: unexplainedStructuralGraph },
      },
    })).rejects.toThrow();
    const recoveredAfterRejectedStructure = await loadMaterializedAIDataWorkflowRun(
      { supportRoot, workflow, importModule },
      { instanceId: 'step-instance', runId: 'step-run' },
    );
    expect(recoveredAfterRejectedStructure?.checkpoint.version).toBe(paused!.checkpoint.version);
    expect(recoveredAfterRejectedStructure?.graph.nodes.prepare.config).toEqual({});

    const completed = await continueMaterializedAIDataWorkflow({ supportRoot, workflow, importModule }, {
      instanceId: 'step-instance', runId: 'step-run',
    }, {});
    expect(completed.checkpoint.output).toEqual({ result: 'final:prepared:subject' });
    expect(executions).toEqual({ prepare: 1, finalize: 1 });
    expect(completed.checkpoint.version).toBeGreaterThan(paused!.checkpoint.version);
    const repeated = await continueMaterializedAIDataWorkflow({ supportRoot, workflow, importModule }, {
      instanceId: 'step-instance', runId: 'step-run',
    }, {});
    expect(repeated.checkpoint.version).toBe(completed.checkpoint.version);
    expect(executions).toEqual({ prepare: 1, finalize: 1 });
  });

  test('uses the named Agent facade across ordinary nodes and fresh reconstruction', async () => {
    const supportRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-data-agent-facade-'));
    const source = path.join(supportRoot, 'source');
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, 'manifest.xnl'), `<AIDataWorkflow #depa.flows.test.DataWorkflow.Support apiVersion="depa.flows/v1" version="1" (
      <FlowContract #depa.flows.test.DataWorkflow.Support { inputPorts = ["request"] outputPorts = ["result"] }>
    ) [
      <EntryNode #entry>
      <TransformNode #transform-request { inputs = { request = "flow-port://#entry/request" } outputs = ["result"] src = "vfs://./flow-code.ts#transformRequest" config = { agentDefinitionRef = "resource://depa.flows.test.Agent.Support" instanceName = "reviewer" } }>
      <ReturnNode #return { inputs = { result = "flow-port://#transform-request/result" } }>
    ]>`);
    fs.writeFileSync(path.join(source, 'flow-code.ts'), 'export const fixture = true;\n');
    const projection: AIWorkflowStateProjection = { async loadRunState() { return undefined; } };
    let newCalls = 0;
    const receipt = await freezeAIWorkflowRunResourcesFromDirectory(
      path.join(import.meta.dir, '../../ai-workflow-logic/test/fixtures/HalfcodeAIAgentResourcePackage'),
      { workflowKind: 'AIDataWorkflow', workflowRef: 'resource://depa.flows.test.DataWorkflow.Support', nodeId: 'transform-request', agentDefinitionRef: 'resource://depa.flows.test.Agent.Support' },
    );
    const runtime = {
      supportRoot,
      workflow: { ai: { roots: { globalRoot: 'vfs://global', workspaceRoot: 'vfs://workspace' }, effects: { async invoke<Input, Output>(): Promise<Output> { return undefined as Output; } }, stateStore: projection } },
      agentEffects: {
        async runAgent() { newCalls += 1; return { output: { text: 'draft' }, instance: { authority: 'eidolon', instanceId: 'agent-1', instanceName: 'reviewer' } }; },
        async runTargetedAgent(request: any) { return { output: { result: `${request.input.text}:refined` }, instance: request.instance }; },
      },
      agentTaskProofs: { 'transform-request': projectFrozenAIAgentTaskBinding(receipt) },
      importModule: async () => ({
        transformRequest: async (nodeRuntime: any, input: any, config: any) => {
          const result = await nodeRuntime.ai.effects.runAgent(input, config);
          return { result: result.output.text };
        },
      }),
    } as const;
    const request = { instanceId: 'agent-data-instance', runId: 'agent-data-run', bundleDir: source, source: { revision: 'r1', provenance: { authority: 'resource-package', artifactRef: 'resource://demo.Flow' } }, input: { request: 'subject' } } as const;
    const config = { checkpointConfig: {}, durableAI: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} } } as const;
    await expect(startMaterializedAIDataWorkflow({ ...runtime, agentTaskProofs: undefined }, request, config))
      .rejects.toThrow('AI_AGENT_TASK_PROOF_REQUIRED');
    expect(newCalls).toBe(0);
    await expect(startMaterializedAIDataWorkflow({
      ...runtime,
      agentTaskProofs: { 'transform-request': { ...runtime.agentTaskProofs['transform-request'] } },
    }, { ...request, runId: 'forged-proof-run' }, config)).rejects.toThrow();
    expect(newCalls).toBe(0);
    const completed = await startMaterializedAIDataWorkflow(runtime, request, config);
    expect(completed.checkpoint.output).toEqual({ result: 'draft' });
    expect(completed.checkpoint.profile.ai.instanceIdByName).toEqual({ reviewer: 'agent-1' });
    expect(newCalls).toBe(1);
    await startMaterializedAIDataWorkflow(runtime, request, config);
    expect(newCalls).toBe(1);
  });
});
