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
  AIDataWorkflowRunGraphError,
  applyAIDataWorkflowGraphPatch,
  createAIDataWorkflowRunGraph,
  createAIDataWorkflowRuntime,
  createAIDataWorkflowSemanticFingerprint,
  defineEagerBackedAIDataWorkflow,
  findReusableAIDataWorkflowNodeResult,
  invalidateAIDataWorkflowNode,
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

  test('persists the platform reuse policy authority in the generation-zero graph', () => {
    const graph = createAIDataWorkflowRunGraph({
      binding,
      runId: 'platform-policy-run',
      platformDefaultPolicy: 'never',
    });
    expect(graph.platformDefaultPolicy).toBe('never');
    expect(graph.nodes.draft.reusePolicy).toEqual({
      policy: 'never', source: 'platform-default', nodeType: 'data',
    });
    expect(graph.nodes['human-review'].reusePolicy).toEqual({
      policy: 'never', source: 'node-type-default', nodeType: 'manual',
    });
  });

  test('requires one patch operation per target and matching reuse policy identity', () => {
    const graph = createAIDataWorkflowRunGraph({ binding, runId: 'patch-identity-run' });
    expect(() => applyAIDataWorkflowGraphPatch(graph, {
      patchId: 'duplicate-target',
      operations: [
        { op: 'update-node', nodeId: 'draft', changes: { config: { model: 'first' } } },
        { op: 'remove-node', nodeId: 'draft' },
      ],
    })).toThrow('patch duplicate-target targets node draft more than once');
    expect(() => applyAIDataWorkflowGraphPatch(graph, {
      patchId: 'mismatched-policy',
      operations: [{
        op: 'update-node', nodeId: 'draft',
        changes: { reusePolicy: { policy: 'never', source: 'node', nodeType: 'manual' } },
      }],
    })).toThrow('reuse policy nodeType must equal data');
    expect(() => applyAIDataWorkflowGraphPatch(graph, {
      patchId: 'undeclared-node-policy',
      operations: [{
        op: 'update-node', nodeId: 'draft',
        changes: { reusePolicy: { policy: 'never', source: 'node', nodeType: 'data' } },
      }],
    })).toThrow('must match its declared config and platform authority');
    expect(() => applyAIDataWorkflowGraphPatch(graph, {
      patchId: 'undeclared-platform-policy',
      operations: [{
        op: 'update-node', nodeId: 'draft',
        changes: { reusePolicy: { policy: 'never', source: 'platform-default', nodeType: 'data' } },
      }],
    })).toThrow('must match its declared config and platform authority');
  });

  test('preserves autonomous SubFlow identity as a first-class RunGraph fact', () => {
    const graph = createAIDataWorkflowRunGraph({ binding, runId: 'subflow-binding-run' });
    const subflow = {
      kind: 'autonomous' as const,
      schemaVersion: 'depa.ai-data-subflow-binding/v1' as const,
      capabilityId: 'child-capability',
      catalogDigest: 'sha256:catalog',
      definitionRef: 'resource://depa.flows.test.Child' as const,
      flowRef: 'eager-data-flow://depa.flows.test.Child' as const,
      contractDigest: 'sha256:contract',
    };
    const patched = applyAIDataWorkflowGraphPatch(graph, {
      patchId: 'add-child',
      operations: [{
        op: 'add-node',
        node: {
          id: 'child',
          tag: 'SubFlowNode',
          nodeType: 'subflow',
          inputs: { value: ref('entry', 'value') },
          outputs: ['result'],
          dependsOn: ['entry'],
          subflow,
        },
      }],
    });
    expect(patched.nodes.child.subflow).toEqual(subflow);
    expect(patched.patchHistory[0]?.operations[0]).toMatchObject({
      op: 'add-node', node: { id: 'child', subflow },
    });
    expect(JSON.parse(JSON.stringify(patched)).nodes.child.subflow).toEqual(subflow);

    expect(() => applyAIDataWorkflowGraphPatch(graph, {
      patchId: 'missing-child-binding',
      operations: [{ op: 'add-node', node: { id: 'invalid-child', tag: 'SubFlowNode' } }],
    })).toThrow('requires an exact subflow binding');
    expect(() => applyAIDataWorkflowGraphPatch(graph, {
      patchId: 'binding-on-transform',
      operations: [{ op: 'add-node', node: { id: 'invalid-transform', tag: 'TransformNode', subflow } }],
    })).toThrow('cannot carry a subflow binding');
  });

  test('projects active invalidation facts exactly and clears stale execution facts', () => {
    let graph = createAIDataWorkflowRunGraph({ binding, runId: 'active-invalidation-run' });
    graph = recordAIDataWorkflowNodeResult(graph, 'entry', {
      nodeId: 'entry', generation: 0, status: 'Succeeded', output: { value: 'accepted' },
      semanticFingerprint: { algorithm: 'semantic-hash/v1', value: 'entry-v0' },
    });
    const invalidated = invalidateAIDataWorkflowNode(graph, 'entry', 'refresh', { generation: 1 });
    expect(invalidated.nodes.entry).toMatchObject({ status: 'Invalidated', generation: 1 });
    expect(invalidated.nodes.entry.result).toBeUndefined();
    expect(invalidated.nodes.entry.semanticFingerprint).toBeUndefined();
    expect(invalidated.nodes.entry.invalidatedBy).toEqual(invalidated.invalidations.filter((fact) => fact.nodeId === 'entry'));

    const running = recordAIDataWorkflowNodeResult(invalidated, 'entry', {
      nodeId: 'entry', generation: 1, status: 'Running',
    });
    expect(running.nodes.entry.invalidatedBy).toBeUndefined();
    expect(running.invalidations.some((fact) => fact.nodeId === 'entry')).toBe(false);
  });

  test('allows removal only after the same patch removes durable references', () => {
    const graph = createAIDataWorkflowRunGraph({ binding, runId: 'removed-reference-run' });
    expect(() => applyAIDataWorkflowGraphPatch(graph, {
      patchId: 'referenced-removal',
      operations: [{ op: 'remove-node', nodeId: 'draft' }],
    })).toThrow(AIDataWorkflowRunGraphError);

    const rewired = applyAIDataWorkflowGraphPatch(graph, {
      patchId: 'rewire-then-remove',
      operations: [
        {
          op: 'update-node', nodeId: 'human-review',
          changes: { inputs: { draft: ref('entry', 'value') }, dependsOn: ['entry'] },
        },
        { op: 'remove-node', nodeId: 'draft' },
      ],
    });
    expect(rewired.nodes.draft.status).toBe('Removed');
    expect(rewired.nodes['human-review'].dependsOn).toEqual(['entry']);
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

  test('rejects an explicit generation that precedes the graph or affected node', () => {
    const generationOne = applyAIDataWorkflowGraphPatch(
      createAIDataWorkflowRunGraph({ binding, runId: 'generation-boundary-run' }),
      {
        patchId: 'generation-one',
        operations: [{ op: 'update-node', nodeId: 'draft', changes: { config: { model: 'careful' } } }],
      },
    );

    expect(() => invalidateAIDataWorkflowNode(
      generationOne,
      'draft',
      'refresh',
      { generation: 0 },
    )).toThrow(AIDataWorkflowRunGraphError);
    expect(() => applyAIDataWorkflowGraphPatch(generationOne, {
      patchId: 'earlier-generation',
      generation: 0,
      operations: [{ op: 'update-node', nodeId: 'draft', changes: { config: { model: 'earlier' } } }],
    } as Parameters<typeof applyAIDataWorkflowGraphPatch>[1])).toThrow(AIDataWorkflowRunGraphError);
  });

  test('keeps an empty invalidation emission as a deterministic no-op', () => {
    const graph = createAIDataWorkflowRunGraph({ binding, runId: 'invalidation-no-op-run' });
    const leafNoOp = invalidateAIDataWorkflowNode(
      graph,
      'return',
      'no-dependent-target',
      { includeSource: false, generation: 4 },
    );
    expect(leafNoOp).toEqual(graph);
    expect(leafNoOp).not.toBe(graph);

    const removed = applyAIDataWorkflowGraphPatch(graph, {
      patchId: 'remove-return',
      operations: [{ op: 'remove-node', nodeId: 'return' }],
    });
    const removedNoOp = invalidateAIDataWorkflowNode(
      removed,
      'return',
      'removed-source',
      { generation: 5 },
    );
    expect(removedNoOp).toEqual(removed);
    expect(removedNoOp.currentGeneration).toBe(removed.currentGeneration);
  });

  test('rejects input references without a declared endpoint, source port or dependency projection', () => {
    const graph = createAIDataWorkflowRunGraph({ binding, runId: 'input-reference-run' });
    for (const node of [
      { id: 'missing-endpoint', inputs: { value: ref('missing', 'value') }, dependsOn: [] },
      { id: 'missing-port', inputs: { value: ref('draft', 'missing') }, dependsOn: ['draft'] },
      { id: 'missing-dependency', inputs: { value: ref('draft', 'draft') }, dependsOn: [] },
    ]) {
      expect(() => applyAIDataWorkflowGraphPatch(graph, {
        patchId: `add-${node.id}`,
        operations: [{ op: 'add-node', node: { ...node, outputs: ['result'] } }],
      })).toThrow(AIDataWorkflowRunGraphError);
    }
  });

  test('recomputes reuse policy for nodeType patches and rejects repeated removal', () => {
    const graph = createAIDataWorkflowRunGraph({ binding, runId: 'node-type-patch-run' });
    const manual = applyAIDataWorkflowGraphPatch(graph, {
      patchId: 'manual-draft',
      operations: [{ op: 'update-node', nodeId: 'draft', changes: { nodeType: 'manual' } }],
    });
    expect(manual.nodes.draft.reusePolicy).toEqual({
      policy: 'never', source: 'node-type-default', nodeType: 'manual',
    });

    const removed = applyAIDataWorkflowGraphPatch(graph, {
      patchId: 'remove-return-once',
      operations: [{ op: 'remove-node', nodeId: 'return' }],
    });
    expect(() => applyAIDataWorkflowGraphPatch(removed, {
      patchId: 'remove-return-again',
      operations: [{ op: 'remove-node', nodeId: 'return' }],
    })).toThrow(AIDataWorkflowRunGraphError);
    expect(removed.currentGeneration).toBe(1);
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

  test('uses UTF-16 code-unit ordering for Unicode semantic input keys', () => {
    const first = createAIDataWorkflowSemanticFingerprint({
      nodeId: 'unicode',
      nodeTag: 'TransformNode',
      effectiveInput: { 中: 4, ä: 3, a: 2, Z: 1 },
    });
    const second = createAIDataWorkflowSemanticFingerprint({
      nodeId: 'unicode',
      nodeTag: 'TransformNode',
      effectiveInput: { Z: 1, a: 2, ä: 3, 中: 4 },
    });

    expect(first.value).toBe(second.value);
    const canonical = first.parts?.find((part) => part.name === 'canonical')?.value ?? '';
    expect(canonical.indexOf('"Z"')).toBeLessThan(canonical.indexOf('"a"'));
    expect(canonical.indexOf('"a"')).toBeLessThan(canonical.indexOf('"ä"'));
    expect(canonical.indexOf('"ä"')).toBeLessThan(canonical.indexOf('"中"'));
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

  test('does not rewrite an accepted terminal result in the same node generation', () => {
    let graph = createAIDataWorkflowRunGraph({ binding, runId: 'immutable-result-run' });
    graph = recordAIDataWorkflowNodeResult(graph, 'entry', {
      nodeId: 'entry', generation: 0, status: 'Succeeded', output: { value: 'first' },
    });
    expect(() => recordAIDataWorkflowNodeResult(graph, 'entry', {
      nodeId: 'entry', generation: 0, status: 'Succeeded', output: { value: 'second' },
    })).toThrow(AIDataWorkflowRunGraphError);
  });
});
