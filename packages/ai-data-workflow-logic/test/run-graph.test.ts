import { describe, expect, test } from 'bun:test';
import type {
  AIWorkflowEffectProvider,
  AIWorkflowEffectRequest,
  AIWorkflowRunEvent,
  AIWorkflowRunRef,
  AIWorkflowRunState,
  AIWorkflowStateStore,
} from 'ai-workflow-contract';
import type {
  EagerDataEdge,
  EagerDataFlowAuthoringPlan,
  EagerDataFlowNodePlan,
} from 'eager-data-flow-contract';
import {
  applyAIDataWorkflowGraphPatch,
  createAIDataWorkflowRunGraph,
  createAIDataWorkflowRuntime,
  createAIDataWorkflowSemanticFingerprint,
  defineEagerBackedAIDataWorkflow,
  findReusableAIDataWorkflowNodeResult,
  listReadyAIDataWorkflowNodes,
  projectAIDataWorkflowRunState,
  recordAIDataWorkflowNodeResult,
} from 'ai-data-workflow-logic';

const ref = (nodeId: string, port: string) => ({
  ref: `flow-port://#${nodeId}/${port}`,
  nodeId,
  port,
});

const nodes: EagerDataFlowNodePlan[] = [
  {
    tag: 'EntryNode',
    id: 'entry',
    declarationIndex: 0,
    waitFor: [],
    outputs: ['value'],
  },
  {
    tag: 'TransformNode',
    id: 'draft',
    declarationIndex: 1,
    waitFor: [],
    inputs: { value: ref('entry', 'value') },
    outputs: ['draft'],
    src: 'vfs://./actions.ts#draft',
    config: { model: 'fast' },
  },
  {
    tag: 'TransformNode',
    id: 'human-review',
    declarationIndex: 2,
    waitFor: [],
    inputs: { draft: ref('draft', 'draft') },
    outputs: ['reviewed'],
    src: 'vfs://./actions.ts#review',
    type: 'manual',
    config: {},
  },
  {
    tag: 'ReturnNode',
    id: 'return',
    declarationIndex: 3,
    waitFor: [],
    inputs: { output: ref('human-review', 'reviewed') },
  },
];

const dataEdges: EagerDataEdge[] = [
  {
    kind: 'data',
    fromNodeId: 'entry',
    fromPort: 'value',
    toNodeId: 'draft',
    toInput: 'value',
    ref: 'flow-port://#entry/value',
  },
  {
    kind: 'data',
    fromNodeId: 'draft',
    fromPort: 'draft',
    toNodeId: 'human-review',
    toInput: 'draft',
    ref: 'flow-port://#draft/draft',
  },
  {
    kind: 'data',
    fromNodeId: 'human-review',
    fromPort: 'reviewed',
    toNodeId: 'return',
    toInput: 'output',
    ref: 'flow-port://#human-review/reviewed',
  },
];

const plan: EagerDataFlowAuthoringPlan = {
  form: 'EagerDataFlow',
  fqn: 'depa.flows.test.AIDataWorkflow',
  apiVersion: 'depa.flows/v1',
  version: '1',
  sourceNames: ['workflow.xnl'],
  contract: {
    id: 'depa.flows.test.AIDataWorkflow',
    inputPorts: ['value'],
    outputPorts: ['output'],
  },
  nodes,
  nodeById: Object.fromEntries(nodes.map((node) => [node.id, node])),
  declarationOrder: nodes.map((node) => node.id),
  dataEdges,
  waitForEdges: [],
  subflowEdges: [],
  diagnostics: [],
};

const binding = defineEagerBackedAIDataWorkflow(plan);

const runRef: AIWorkflowRunRef = {
  workflow: { ref: 'resource://depa.flows.test.AIDataWorkflow', scheme: 'resource' },
  runId: 'run-1',
  generation: 0,
};

const stateStore: AIWorkflowStateStore = {
  async loadRunState(): Promise<AIWorkflowRunState | undefined> {
    return undefined;
  },
  async saveRunState(_state: AIWorkflowRunState): Promise<void> {},
  async appendRunEvent(_ref: AIWorkflowRunRef, _event: AIWorkflowRunEvent): Promise<void> {},
};

const effects: AIWorkflowEffectProvider = {
  async invoke<Input, Output>(_request: AIWorkflowEffectRequest<Input>): Promise<Output> {
    return undefined as Output;
  },
};

describe('AI Data Workflow RunGraph', () => {
  test('derives run graph nodes, ports, config and dependencies from EagerDataFlow', () => {
    const graph = createAIDataWorkflowRunGraph({ binding, runId: 'run-1' });

    expect(graph.binding.substrate).toBe('EagerDataFlow');
    expect(graph.declarationOrder).toEqual(['entry', 'draft', 'human-review', 'return']);
    expect(graph.nodes.draft.inputs).toEqual({ value: ref('entry', 'value') });
    expect(graph.nodes.draft.outputs).toEqual(['draft']);
    expect(graph.nodes.draft.config).toEqual({ model: 'fast' });
    expect(graph.nodes.draft.dependsOn).toEqual(['entry']);
    expect(graph.nodes.draft.dependents).toEqual(['human-review']);
    expect(graph.nodes['human-review'].reusePolicy).toMatchObject({
      policy: 'never',
      source: 'node-type-default',
      nodeType: 'manual',
    });
    expect(listReadyAIDataWorkflowNodes(graph).map((node) => node.id)).toEqual(['entry']);
  });

  test('applies graph patches as new generations and invalidates downstream nodes', () => {
    let graph = createAIDataWorkflowRunGraph({ binding, runId: 'run-1' });
    graph = recordAIDataWorkflowNodeResult(graph, 'entry', {
      nodeId: 'entry',
      generation: 0,
      status: 'Succeeded',
      output: { value: 'topic' },
    });
    graph = recordAIDataWorkflowNodeResult(graph, 'draft', {
      nodeId: 'draft',
      generation: 0,
      status: 'Succeeded',
      output: { draft: 'old' },
    });
    graph = recordAIDataWorkflowNodeResult(graph, 'human-review', {
      nodeId: 'human-review',
      generation: 0,
      status: 'Succeeded',
      output: { reviewed: 'old' },
    });
    graph = recordAIDataWorkflowNodeResult(graph, 'return', {
      nodeId: 'return',
      generation: 0,
      status: 'Succeeded',
      output: { output: 'old' },
    });

    const patched = applyAIDataWorkflowGraphPatch(graph, {
      patchId: 'patch-change-draft-config',
      reason: 'correct draft prompt',
      atMs: 42,
      operations: [
        {
          op: 'update-node',
          nodeId: 'draft',
          changes: { config: { model: 'fast', prompt: 'v2' } },
        },
      ],
    });

    expect(patched.currentGeneration).toBe(1);
    expect(patched.patchHistory).toMatchObject([
      { patchId: 'patch-change-draft-config', generation: 1, reason: 'correct draft prompt' },
    ]);
    expect(patched.nodes.entry.status).toBe('Succeeded');
    expect(patched.nodes.draft.status).toBe('Invalidated');
    expect(patched.nodes['human-review'].status).toBe('Invalidated');
    expect(patched.nodes.return.status).toBe('Invalidated');
    expect(patched.nodes.draft.generation).toBe(1);
    expect(patched.invalidations.map((item) => item.nodeId)).toEqual([
      'draft',
      'human-review',
      'return',
    ]);
  });

  test('keeps generation out of semantic fingerprints and supports run-local reuse', () => {
    const graph = createAIDataWorkflowRunGraph({ binding, runId: 'run-1' });
    const fingerprint0 = createAIDataWorkflowSemanticFingerprint({
      nodeId: 'draft',
      nodeTag: graph.nodes.draft.tag,
      effectiveInput: { value: 'same' },
      config: graph.nodes.draft.config,
      materialRevisions: { prompt: 'rev-1' },
      effectPolicy: { provider: 'embedded-ai' },
    });
    const patched = applyAIDataWorkflowGraphPatch(graph, {
      patchId: 'add-side-note',
      operations: [
        {
          op: 'add-node',
          node: {
            id: 'side-note',
            dependsOn: ['draft'],
            inputs: { draft: ref('draft', 'draft') },
            outputs: ['note'],
            config: {},
          },
        },
      ],
    });
    const fingerprint1 = createAIDataWorkflowSemanticFingerprint({
      nodeId: 'draft',
      nodeTag: patched.nodes.draft.tag,
      effectiveInput: { value: 'same' },
      config: patched.nodes.draft.config,
      materialRevisions: { prompt: 'rev-1' },
      effectPolicy: { provider: 'embedded-ai' },
    });

    expect(patched.currentGeneration).toBe(1);
    expect(fingerprint1.value).toBe(fingerprint0.value);

    const result = {
      nodeId: 'draft',
      generation: 0,
      status: 'Succeeded' as const,
      output: { draft: 'reusable' },
      semanticFingerprint: fingerprint0,
    };
    expect(findReusableAIDataWorkflowNodeResult({
      runId: 'run-1',
      nodeId: 'draft',
      fingerprint: fingerprint1,
      policy: patched.nodes.draft.reusePolicy,
      candidates: [
        {
          runId: 'run-1',
          nodeId: 'draft',
          generation: 0,
          result,
          semanticFingerprint: fingerprint0,
        },
      ],
    })).toEqual(result);
    expect(findReusableAIDataWorkflowNodeResult({
      runId: 'other-run',
      nodeId: 'draft',
      fingerprint: fingerprint1,
      policy: patched.nodes.draft.reusePolicy,
      candidates: [
        {
          runId: 'run-1',
          nodeId: 'draft',
          generation: 0,
          result,
          semanticFingerprint: fingerprint0,
        },
      ],
    })).toBeUndefined();
  });

  test('honors never reuse policy and projects serializable run state', () => {
    const graph = createAIDataWorkflowRunGraph({ binding, runId: 'run-1' });
    const fingerprint = createAIDataWorkflowSemanticFingerprint({
      nodeId: 'human-review',
      nodeTag: graph.nodes['human-review'].tag,
      effectiveInput: { draft: 'same' },
      config: graph.nodes['human-review'].config,
    });
    expect(findReusableAIDataWorkflowNodeResult({
      runId: 'run-1',
      nodeId: 'human-review',
      fingerprint,
      policy: graph.nodes['human-review'].reusePolicy,
      candidates: [
        {
          runId: 'run-1',
          nodeId: 'human-review',
          generation: 0,
          result: {
            nodeId: 'human-review',
            generation: 0,
            status: 'Succeeded',
            semanticFingerprint: fingerprint,
          },
          semanticFingerprint: fingerprint,
        },
      ],
    })).toBeUndefined();

    const runtime = createAIDataWorkflowRuntime({
      ai: {
        roots: {
          globalRoot: 'vfs://global/.eidolon',
          workspaceRoot: 'vfs://workspace/.eidolon',
        },
        effects,
        stateStore,
      },
    });
    expect(runtime.ai.roots.workspaceRoot).toBe('vfs://workspace/.eidolon');

    const state = projectAIDataWorkflowRunState(graph, runRef.workflow);
    expect(state.ref).toEqual(runRef);
    expect(state.status).toBe('Pending');
    expect(Object.keys(state.nodes)).toEqual(['entry', 'draft', 'human-review', 'return']);
  });
});
