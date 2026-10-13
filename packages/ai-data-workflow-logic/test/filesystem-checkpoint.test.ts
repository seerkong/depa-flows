import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  AIDataWorkflowAutonomousSubFlowBinding,
  AIDataWorkflowChildInvocationIdentity,
  AIDataWorkflowChildInvocationRuntimePort,
} from 'ai-data-workflow-contract';
import type { AIWorkflowStateProjection, FlowClosedObject } from 'ai-workflow-contract';
import type { EagerDataFlowExecutable } from 'eager-data-flow-contract';
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

  test('converges competing fresh resumes on one autonomous child and accepted effect', async () => {
    const supportRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-data-autonomous-child-'));
    const source = path.join(supportRoot, 'source');
    fs.mkdirSync(source);
    const manifest = `<AIDataWorkflow #depa.flows.test.AutonomousParent apiVersion="depa.flows/v1" version="1" (
      <FlowContract #depa.flows.test.AutonomousParent { inputPorts = ["value"] outputPorts = ["result"] }>
    ) [
      <EntryNode #entry>
      <TransformNode #prepare {
        inputs = { value = "flow-port://#entry/value" }
        outputs = ["result"]
        src = "vfs://./flow-code.ts#prepare"
      }>
      <ReturnNode #return { inputs = { result = "flow-port://#prepare/result" } }>
    ]>`;
    fs.writeFileSync(path.join(source, 'manifest.xnl'), manifest);
    fs.writeFileSync(path.join(source, 'flow-code.ts'), 'export function prepare(runtime, input) { return { result: input.value }; }\n');
    const instance = materializeFlowInstance({
      definitionDir: source,
      instancesDir: path.join(supportRoot, 'instances'),
      instanceId: 'autonomous-parent-instance',
      source: {
        revision: 'parent-r1',
        provenance: { authority: 'resource-package', artifactRef: 'resource://depa.flows.test.AutonomousParent' },
      },
      validateDefinition: () => undefined,
    });
    const loaded = loadAIDataWorkflowSources({ 'manifest.xnl': manifest });
    if (!loaded.binding) throw new Error('autonomous parent fixture did not load');
    const baseGraph = createAIDataWorkflowRunGraph({ binding: loaded.binding, runId: 'autonomous-parent-run' });
    const subflow = {
      kind: 'autonomous' as const,
      schemaVersion: 'depa.ai-data-subflow-binding/v1' as const,
      capabilityId: 'child-capability',
      catalogDigest: 'sha256:catalog',
      definitionRef: 'resource://depa.flows.test.Child' as const,
      flowRef: 'eager-data-flow://depa.flows.test.Child' as const,
      contractDigest: 'sha256:child-contract',
    };
    const revisedGraph = applyAIDataWorkflowGraphPatch(baseGraph, {
      patchId: 'add-autonomous-child',
      generation: 1,
      operations: [{
        op: 'add-node',
        node: {
          id: 'child', tag: 'SubFlowNode', nodeType: 'subflow', subflow,
          inputs: { value: { ref: 'flow-port://#entry/value', nodeId: 'entry', port: 'value' } },
          outputs: ['result'], dependsOn: ['entry'],
        },
      }, {
        op: 'update-node',
        nodeId: 'return',
        changes: {
          inputs: { result: { ref: 'flow-port://#child/result', nodeId: 'child', port: 'result' } },
          dependsOn: ['child'],
        },
      }],
    });
    const profileAuthority = createMaterializedAIDataWorkflowProfileAuthority({ supportRoot });
    const checkpointStore = new FilesystemFlowRunCheckpointStore({ storeRoot: supportRoot, profileAuthority });
    const { baseUri: _baseUri, definitionStepForest: _forest, ...definition } = baseGraph.binding.definition;
    const durableBase = { ...baseGraph, binding: { ...baseGraph.binding, definition } };
    const v0 = await createAIDataWorkflowCheckpoint({ checkpointStore }, {
      instanceId: 'autonomous-parent-instance',
      definition: instance.descriptor.definition,
      graph: durableBase,
      input: { value: 'subject' }, config: {}, state: { status: 'Pending', generation: 0 }, output: null,
      controllerSidecars: { status: 'Pending' },
      nodeSidecars: Object.fromEntries(baseGraph.declarationOrder.map((nodeId) => [nodeId, { status: 'Pending', generation: 0 }])),
      ai: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
    });
    const { baseUri: _revisedBaseUri, definitionStepForest: _revisedForest, ...revisedDefinition } = revisedGraph.binding.definition;
    const durableRevised = { ...revisedGraph, binding: { ...revisedGraph.binding, definition: revisedDefinition } };
    await commitAIDataWorkflowCheckpoint({ checkpointStore }, {
      expectedVersion: v0.version,
      checkpoint: {
        ...v0,
        version: 1,
        state: { status: 'Pending', generation: 1 },
        nodeSidecars: Object.fromEntries(revisedGraph.declarationOrder.map((nodeId) => [nodeId, {
          status: revisedGraph.nodes[nodeId].status,
          generation: revisedGraph.nodes[nodeId].generation,
        }])),
        profile: { ...v0.profile, runGraph: durableRevised },
      },
    });

    const childPlan = {
      form: 'EagerDataFlow' as const,
      fqn: 'depa.flows.test.Child', apiVersion: 'depa.flows/v1', version: '1', sourceNames: ['child.xnl'],
      contract: { id: 'depa.flows.test.Child', inputPorts: ['value'], outputPorts: ['result'] },
      nodes: [], nodeById: {}, declarationOrder: [], dataEdges: [], waitForEdges: [], subflowEdges: [], diagnostics: [],
    };
    const childExecutable: EagerDataFlowExecutable = {
      plan: childPlan,
      async invoke() { throw new Error('autonomous child must execute through its durable invocation port'); },
    };
    const childInput = new Map<string, string>();
    const childStatus = new Map<string, 'Running' | 'Succeeded'>();
    const calls = { freeze: 0, start: 0, load: 0, settle: 0 };
    let acceptedEffects = 0;
    let allowCompletion = false;
    const childInvocations: AIDataWorkflowChildInvocationRuntimePort = {
      async resolveAndFreeze({ identity }) {
        calls.freeze += 1;
        return {
          schemaVersion: 'depa.ai-data-child-invocation/v1', invocationKey: identity.invocationKey,
          childInstanceId: identity.childInstanceId, childRunId: identity.childRunId,
          definitionRef: identity.subflow.definitionRef, flowRef: identity.subflow.flowRef,
          contractDigest: identity.subflow.contractDigest,
          definitionRevision: 'child-r1', definitionDigest: 'sha256:child-definition',
        };
      },
      async startOrContinue({ identity, input }) {
        calls.start += 1;
        if (!childStatus.has(identity.invocationKey)) {
          childInput.set(identity.invocationKey, String(input.value));
          childStatus.set(identity.invocationKey, 'Running');
          acceptedEffects += 1;
        }
        if (allowCompletion) {
          childStatus.set(identity.invocationKey, 'Succeeded');
        }
        return {
          schemaVersion: 'depa.ai-data-child-invocation/v1', invocationKey: identity.invocationKey,
          childInstanceId: identity.childInstanceId, childRunId: identity.childRunId,
          status: childStatus.get(identity.invocationKey)!,
        };
      },
      async load({ identity }) {
        calls.load += 1;
        return {
          schemaVersion: 'depa.ai-data-child-invocation/v1', invocationKey: identity.invocationKey,
          childInstanceId: identity.childInstanceId, childRunId: identity.childRunId,
          status: childStatus.get(identity.invocationKey)!,
        };
      },
      async settle({ identity }) {
        calls.settle += 1;
        return {
          schemaVersion: 'depa.ai-data-child-invocation/v1', invocationKey: identity.invocationKey,
          childInstanceId: identity.childInstanceId, childRunId: identity.childRunId,
          definitionRef: identity.subflow.definitionRef, flowRef: identity.subflow.flowRef,
          contractDigest: identity.subflow.contractDigest, status: 'Succeeded',
          output: { result: `child:${childInput.get(identity.invocationKey)}` },
          receiptDigest: `sha256:receipt:${identity.invocationKey}`,
        };
      },
    };
    const stateProjection: AIWorkflowStateProjection = { async loadRunState() { return undefined; } };
    const runtime = {
      supportRoot,
      workflow: {
        ai: {
          roots: { globalRoot: 'vfs://global', workspaceRoot: 'vfs://workspace' },
          effects: { async invoke<Input, Output>(): Promise<Output> { return undefined as Output; } },
          stateStore: stateProjection,
        },
      },
      importModule: async () => ({ prepare: (_runtime: unknown, input: { value: string }) => ({ result: input.value }) }),
      childFlows: {
        'depa.flows.test.Child': {
          definitionRef: subflow.definitionRef,
          contractDigest: subflow.contractDigest,
          executable: childExecutable,
        },
      },
      childInvocations,
    } as const;
    const runKey = {
      instanceId: 'autonomous-parent-instance', runId: 'autonomous-parent-run',
    } as const;
    await expect(continueMaterializedAIDataWorkflow({
      ...runtime,
      checkpointObserver({ checkpoint, nodeId, phase }) {
        const child = checkpoint.profile.runGraph.nodes.child;
        if (nodeId === 'child' && phase === 'before' && child.childInvocation && !child.childFreezeReceipt) {
          throw new Error('crash-after-parent-reservation');
        }
      },
    }, runKey, {})).rejects.toThrow('crash-after-parent-reservation');
    const reservedOnly = await loadMaterializedAIDataWorkflowRun(runtime, runKey);
    expect(reservedOnly?.graph.nodes.child.childInvocation).toBeDefined();
    expect(reservedOnly?.graph.nodes.child.childFreezeReceipt).toBeUndefined();
    expect(calls.start).toBe(0);

    await expect(continueMaterializedAIDataWorkflow({
      ...runtime,
      checkpointObserver({ checkpoint, nodeId, phase }) {
        const child = checkpoint.profile.runGraph.nodes.child;
        if (nodeId === 'child' && phase === 'before' && child.childFreezeReceipt
          && !child.childTerminalReceipt) {
          throw new Error('crash-after-child-freeze');
        }
      },
    }, runKey, {})).rejects.toThrow('crash-after-child-freeze');
    const frozenOnly = await loadMaterializedAIDataWorkflowRun(runtime, runKey);
    expect(frozenOnly?.graph.nodes.child.childFreezeReceipt?.definitionRevision).toBe('child-r1');
    expect(calls.start).toBe(0);

    const competing = await Promise.allSettled([
      continueMaterializedAIDataWorkflow(runtime, runKey, {}),
      continueMaterializedAIDataWorkflow({ ...runtime }, runKey, {}),
    ]);
    expect(competing.every((attempt) => attempt.status === 'rejected')).toBe(true);
    expect(competing.some((attempt) => attempt.status === 'rejected'
      && String(attempt.reason).includes('version conflict'))).toBe(false);
    const suspended = await loadMaterializedAIDataWorkflowRun(runtime, runKey);
    const reservedChildRunId = suspended?.graph.nodes.child.childInvocation?.childRunId;
    expect(reservedChildRunId).toContain('--child-');
    expect(suspended?.graph.nodes.child.childFreezeReceipt?.definitionRevision).toBe('child-r1');
    expect(childStatus.size).toBe(1);
    expect(acceptedEffects).toBe(1);

    allowCompletion = true;
    await expect(continueMaterializedAIDataWorkflow({
      ...runtime,
      childInvocationObserver() {
        throw new Error('crash-after-child-terminal-before-parent-accept');
      },
    }, runKey, {})).rejects.toThrow('crash-after-child-terminal-before-parent-accept');
    const terminalBeforeParentAccept = await loadMaterializedAIDataWorkflowRun(runtime, runKey);
    expect(terminalBeforeParentAccept?.graph.nodes.child.status).toBe('Running');
    expect(terminalBeforeParentAccept?.graph.nodes.child.childTerminalReceipt).toBeUndefined();
    expect(childStatus.get(terminalBeforeParentAccept!.graph.nodes.child.childInvocation!.invocationKey)).toBe('Succeeded');

    await expect(continueMaterializedAIDataWorkflow({
      ...runtime,
      checkpointObserver({ checkpoint, nodeId, phase }) {
        if (nodeId === 'child' && phase === 'after'
          && checkpoint.profile.runGraph.nodes.child.childTerminalReceipt) {
          throw new Error('crash-after-parent-accept');
        }
      },
    }, runKey, {})).rejects.toThrow('crash-after-parent-accept');

    const reused = await continueMaterializedAIDataWorkflow({ ...runtime }, runKey, {});
    expect(reused.checkpoint.output).toEqual({ result: 'child:subject' });
    expect(reused.graph.nodes.child.childInvocation?.childRunId).toBe(reservedChildRunId);
    expect(reused.graph.nodes.child.childTerminalReceipt?.status).toBe('Succeeded');
    expect(calls.freeze).toBeGreaterThanOrEqual(1);
    expect(calls.start).toBeGreaterThanOrEqual(3);
    expect(calls.load).toBeGreaterThanOrEqual(1);
    expect(calls.settle).toBe(2);
    expect(acceptedEffects).toBe(1);
  });

  test('executes A to B to C through recursive materialized subflow checkpoints', async () => {
    const supportRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-data-recursive-subflow-'));
    const sourceFor = (name: 'A' | 'B' | 'C'): string => {
      const source = path.join(supportRoot, `source-${name.toLowerCase()}`);
      fs.mkdirSync(source);
      const fqn = `depa.flows.test.Recursive${name}`;
      fs.writeFileSync(path.join(source, 'manifest.xnl'), `<AIDataWorkflow #${fqn} apiVersion="depa.flows/v1" version="1" (
        <FlowContract #${fqn} { inputPorts = ["value"] outputPorts = ["result"] }>
      ) [
        <EntryNode #entry>
        <TransformNode #prepare {
          inputs = { value = "flow-port://#entry/value" }
          outputs = ["result"]
          src = "vfs://./flow-code.ts#prepare"
        }>
        <ReturnNode #return { inputs = { result = "flow-port://#prepare/result" } }>
      ]>`);
      fs.writeFileSync(path.join(source, 'flow-code.ts'), 'export function prepare(runtime, input) { return { result: input.value }; }\n');
      return source;
    };
    const sourceA = sourceFor('A');
    const sourceB = sourceFor('B');
    const sourceC = sourceFor('C');
    const bindingFor = (name: 'B' | 'C'): AIDataWorkflowAutonomousSubFlowBinding => ({
      kind: 'autonomous',
      schemaVersion: 'depa.ai-data-subflow-binding/v1',
      capabilityId: `recursive-${name.toLowerCase()}`,
      catalogDigest: 'sha256:recursive-catalog',
      definitionRef: `resource://depa.flows.test.Recursive${name}`,
      flowRef: `eager-data-flow://depa.flows.test.Recursive${name}`,
      contractDigest: `sha256:recursive-${name.toLowerCase()}-contract`,
    });
    const bindingB = bindingFor('B');
    const bindingC = bindingFor('C');
    const profileAuthority = createMaterializedAIDataWorkflowProfileAuthority({ supportRoot });
    const checkpointStore = new FilesystemFlowRunCheckpointStore({ storeRoot: supportRoot, profileAuthority });
    const admitAutonomousParent = async (input: {
      readonly source: string;
      readonly instanceId: string;
      readonly runId: string;
      readonly value: string;
      readonly child: AIDataWorkflowAutonomousSubFlowBinding;
    }): Promise<void> => {
      const manifest = fs.readFileSync(path.join(input.source, 'manifest.xnl'), 'utf8');
      const instance = materializeFlowInstance({
        definitionDir: input.source,
        instancesDir: path.join(supportRoot, 'instances'),
        instanceId: input.instanceId,
        source: {
          revision: `recursive-${input.instanceId}-r1`,
          provenance: { authority: 'resource-package', artifactRef: `resource://${input.instanceId}` },
        },
        validateDefinition: () => undefined,
      });
      const loaded = loadAIDataWorkflowSources({ 'manifest.xnl': manifest });
      if (!loaded.binding) throw new Error(`recursive fixture ${input.instanceId} did not load`);
      const baseGraph = createAIDataWorkflowRunGraph({ binding: loaded.binding, runId: input.runId });
      const revisedGraph = applyAIDataWorkflowGraphPatch(baseGraph, {
        patchId: `add-${input.child.capabilityId}`,
        generation: 1,
        operations: [{
          op: 'add-node',
          node: {
            id: 'child', tag: 'SubFlowNode', nodeType: 'subflow', subflow: input.child,
            inputs: { value: { ref: 'flow-port://#entry/value', nodeId: 'entry', port: 'value' } },
            outputs: ['result'], dependsOn: ['entry'],
          },
        }, {
          op: 'update-node',
          nodeId: 'return',
          changes: {
            inputs: { result: { ref: 'flow-port://#child/result', nodeId: 'child', port: 'result' } },
            dependsOn: ['child'],
          },
        }],
      });
      const { baseUri: _baseUri, definitionStepForest: _forest, ...definition } = baseGraph.binding.definition;
      const v0 = await createAIDataWorkflowCheckpoint({ checkpointStore }, {
        instanceId: input.instanceId,
        definition: instance.descriptor.definition,
        graph: { ...baseGraph, binding: { ...baseGraph.binding, definition } },
        input: { value: input.value }, config: {},
        state: { status: 'Pending', generation: 0 }, output: null,
        controllerSidecars: { status: 'Pending' },
        nodeSidecars: Object.fromEntries(baseGraph.declarationOrder.map((nodeId) => [nodeId, {
          status: 'Pending', generation: 0,
        }])),
        ai: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
      });
      const { baseUri: _revisedBaseUri, definitionStepForest: _revisedForest, ...revisedDefinition } = revisedGraph.binding.definition;
      await commitAIDataWorkflowCheckpoint({ checkpointStore }, {
        expectedVersion: v0.version,
        checkpoint: {
          ...v0,
          version: v0.version + 1,
          state: { status: 'Pending', generation: revisedGraph.currentGeneration },
          nodeSidecars: Object.fromEntries(revisedGraph.declarationOrder.map((nodeId) => [nodeId, {
            status: revisedGraph.nodes[nodeId].status,
            generation: revisedGraph.nodes[nodeId].generation,
          }])),
          profile: {
            ...v0.profile,
            runGraph: { ...revisedGraph, binding: { ...revisedGraph.binding, definition: revisedDefinition } },
          },
        },
      });
    };
    await admitAutonomousParent({
      source: sourceA,
      instanceId: 'recursive-a-instance',
      runId: 'recursive-a-run',
      value: 'subject',
      child: bindingB,
    });

    const planFor = (name: 'B' | 'C') => ({
      form: 'EagerDataFlow' as const,
      fqn: `depa.flows.test.Recursive${name}`,
      apiVersion: 'depa.flows/v1', version: '1', sourceNames: [`recursive-${name}.xnl`],
      contract: {
        id: `depa.flows.test.Recursive${name}`,
        inputPorts: ['value'], outputPorts: ['result'],
      },
      nodes: [], nodeById: {}, declarationOrder: [], dataEdges: [], waitForEdges: [], subflowEdges: [], diagnostics: [],
    });
    const executableFor = (name: 'B' | 'C'): EagerDataFlowExecutable => ({
      plan: planFor(name),
      async invoke() { throw new Error(`recursive ${name} must execute through its durable invocation port`); },
    });
    const terminalOutput = new Map<string, FlowClosedObject>();
    const identityByFlow = new Map<string, AIDataWorkflowChildInvocationIdentity>();
    const started = new Set<string>();
    const dispatchOrder: string[] = [];
    let recursiveRuntime!: Parameters<typeof continueMaterializedAIDataWorkflow>[0];
    const childInvocations: AIDataWorkflowChildInvocationRuntimePort = {
      async resolveAndFreeze({ identity }) {
        const flowId = identity.subflow.flowRef.slice('eager-data-flow://'.length);
        identityByFlow.set(flowId, identity);
        dispatchOrder.push(`freeze:${flowId}`);
        return {
          schemaVersion: 'depa.ai-data-child-invocation/v1',
          invocationKey: identity.invocationKey,
          childInstanceId: identity.childInstanceId,
          childRunId: identity.childRunId,
          definitionRef: identity.subflow.definitionRef,
          flowRef: identity.subflow.flowRef,
          contractDigest: identity.subflow.contractDigest,
          definitionRevision: `${flowId}-r1`,
          definitionDigest: `sha256:${flowId}-definition`,
        };
      },
      async startOrContinue({ identity, input }) {
        const flowId = identity.subflow.flowRef.slice('eager-data-flow://'.length);
        dispatchOrder.push(`start:${flowId}`);
        if (!terminalOutput.has(identity.invocationKey)) {
          let childResult;
          if (flowId === 'depa.flows.test.RecursiveB') {
            if (!started.has(identity.invocationKey)) {
              await admitAutonomousParent({
                source: sourceB,
                instanceId: identity.childInstanceId,
                runId: identity.childRunId,
                value: String(input.value),
                child: bindingC,
              });
              started.add(identity.invocationKey);
            }
            childResult = await continueMaterializedAIDataWorkflow(recursiveRuntime, {
              instanceId: identity.childInstanceId,
              runId: identity.childRunId,
            }, {});
          } else if (flowId === 'depa.flows.test.RecursiveC') {
            childResult = await startMaterializedAIDataWorkflow(recursiveRuntime, {
              instanceId: identity.childInstanceId,
              runId: identity.childRunId,
              bundleDir: sourceC,
              source: {
                revision: 'recursive-c-r1',
                provenance: { authority: 'resource-package', artifactRef: bindingC.definitionRef },
              },
              input,
            }, {
              checkpointConfig: {},
              platformDefaultPolicy: 'never',
              durableAI: {
                schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {},
              },
            });
          } else {
            throw new Error(`unexpected recursive child ${flowId}`);
          }
          terminalOutput.set(identity.invocationKey, childResult.checkpoint.output as FlowClosedObject);
        }
        return {
          schemaVersion: 'depa.ai-data-child-invocation/v1',
          invocationKey: identity.invocationKey,
          childInstanceId: identity.childInstanceId,
          childRunId: identity.childRunId,
          status: 'Succeeded',
        };
      },
      async load({ identity }) {
        return {
          schemaVersion: 'depa.ai-data-child-invocation/v1',
          invocationKey: identity.invocationKey,
          childInstanceId: identity.childInstanceId,
          childRunId: identity.childRunId,
          status: terminalOutput.has(identity.invocationKey) ? 'Succeeded' : 'Running',
        };
      },
      async settle({ identity }) {
        const output = terminalOutput.get(identity.invocationKey);
        if (!output) throw new Error(`recursive child ${identity.invocationKey} has no terminal output`);
        return {
          schemaVersion: 'depa.ai-data-child-invocation/v1',
          invocationKey: identity.invocationKey,
          childInstanceId: identity.childInstanceId,
          childRunId: identity.childRunId,
          definitionRef: identity.subflow.definitionRef,
          flowRef: identity.subflow.flowRef,
          contractDigest: identity.subflow.contractDigest,
          status: 'Succeeded',
          output,
          receiptDigest: `sha256:receipt:${identity.invocationKey}`,
        };
      },
    };
    const executedModules: string[] = [];
    recursiveRuntime = {
      supportRoot,
      workflow: {
        ai: {
          roots: { globalRoot: 'vfs://global', workspaceRoot: 'vfs://workspace' },
          effects: { async invoke<Input, Output>(): Promise<Output> { return undefined as Output; } },
          stateStore: { async loadRunState() { return undefined; } },
        },
      },
      importModule: async (specifier) => ({
        prepare: (_runtime: unknown, input: { value: string }) => {
          executedModules.push(specifier);
          return { result: input.value };
        },
      }),
      childFlows: {
        'depa.flows.test.RecursiveB': {
          definitionRef: bindingB.definitionRef,
          contractDigest: bindingB.contractDigest,
          executable: executableFor('B'),
        },
        'depa.flows.test.RecursiveC': {
          definitionRef: bindingC.definitionRef,
          contractDigest: bindingC.contractDigest,
          executable: executableFor('C'),
        },
      },
      childInvocations,
    };

    const completedA = await continueMaterializedAIDataWorkflow(recursiveRuntime, {
      instanceId: 'recursive-a-instance', runId: 'recursive-a-run',
    }, {});
    expect(completedA.checkpoint.output).toEqual({ result: 'subject' });
    expect(dispatchOrder).toEqual([
      'freeze:depa.flows.test.RecursiveB',
      'start:depa.flows.test.RecursiveB',
      'freeze:depa.flows.test.RecursiveC',
      'start:depa.flows.test.RecursiveC',
    ]);
    expect(executedModules).toHaveLength(3);
    const identityB = identityByFlow.get('depa.flows.test.RecursiveB')!;
    const identityC = identityByFlow.get('depa.flows.test.RecursiveC')!;
    const completedB = await loadMaterializedAIDataWorkflowRun(recursiveRuntime, {
      instanceId: identityB.childInstanceId, runId: identityB.childRunId,
    });
    const completedC = await loadMaterializedAIDataWorkflowRun(recursiveRuntime, {
      instanceId: identityC.childInstanceId, runId: identityC.childRunId,
    });
    expect(completedA.graph.nodes.child.childTerminalReceipt?.status).toBe('Succeeded');
    expect(completedB?.graph.nodes.child.childTerminalReceipt?.status).toBe('Succeeded');
    expect(completedB?.checkpoint.state).toMatchObject({ status: 'Succeeded' });
    expect(completedC?.checkpoint.state).toMatchObject({ status: 'Succeeded' });
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

  for(const entry of ['legacy','node-task'] as const)test(`uses the named Agent facade across ordinary nodes and fresh reconstruction (${entry})`, async () => {
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
          const output = entry==='node-task'?await nodeRuntime.ai.tasks.invoke(input,config):(await nodeRuntime.ai.effects.runAgent(input, config)).output;
          return { result: output.text };
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
