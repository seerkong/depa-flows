import { describe, expect, test } from 'bun:test';
import type { FlowRunCheckpointRuntime } from 'ai-workflow-contract';
import type { EagerDataFlowAuthoringPlan, EagerDataFlowNodePlan } from 'eager-data-flow-contract';
import {
  applyAIDataWorkflowGraphPatch,
  commitAIDataWorkflowCheckpoint,
  createAIDataWorkflowCheckpoint,
  createAIDataWorkflowRunGraph,
  defineEagerBackedAIDataWorkflow,
  invalidateAIDataWorkflowNode,
  loadAIDataWorkflowCheckpoint,
  recordAIDataWorkflowNodeResult,
} from 'ai-data-workflow-logic';
import { FlowRunCheckpointTransitionError, InMemoryFlowRunCheckpointStore } from 'ai-workflow-logic';

const nodes: EagerDataFlowNodePlan[] = [
  { tag: 'EntryNode', id: 'entry', declarationIndex: 0, waitFor: [], outputs: ['value'] },
  {
    tag: 'TransformNode', id: 'prepare', declarationIndex: 1, waitFor: [],
    inputs: { value: { ref: 'flow-port://#entry/value', nodeId: 'entry', port: 'value' } },
    outputs: ['result'], src: 'vfs://./flow-code.ts#prepare', config: {},
  },
  {
    tag: 'ReturnNode', id: 'return', declarationIndex: 2, waitFor: [],
    inputs: { result: { ref: 'flow-port://#prepare/result', nodeId: 'prepare', port: 'result' } },
  },
];
const plan: EagerDataFlowAuthoringPlan = {
  form: 'EagerDataFlow',
  fqn: 'depa.flows.test.CheckpointData',
  apiVersion: 'depa.flows/v1',
  version: '1',
  sourceNames: ['manifest.xnl'],
  contract: { id: 'depa.flows.test.CheckpointData', inputPorts: ['value'], outputPorts: ['result'] },
  nodes,
  nodeById: Object.fromEntries(nodes.map((node) => [node.id, node])),
  declarationOrder: nodes.map((node) => node.id),
  dataEdges: [{
    kind: 'data', fromNodeId: 'entry', fromPort: 'value', toNodeId: 'prepare',
    toInput: 'value', ref: 'flow-port://#entry/value',
  }, {
    kind: 'data', fromNodeId: 'prepare', fromPort: 'result', toNodeId: 'return',
    toInput: 'result', ref: 'flow-port://#prepare/result',
  }],
  waitForEdges: [],
  subflowEdges: [],
  diagnostics: [],
};
const definition = {
  revision: 'workflow-r1',
  digest: `sha256:${'c'.repeat(64)}` as const,
  provenance: {
    authority: 'resource-package',
    artifactRef: 'resource://depa.flows.test.CheckpointData',
  },
};

describe('AI Data canonical checkpoint adapter', () => {
  test('accepts and preserves a declared platform reuse policy at version zero', async () => {
    const runtime: FlowRunCheckpointRuntime = { checkpointStore: new InMemoryFlowRunCheckpointStore() };
    const binding = defineEagerBackedAIDataWorkflow(plan);
    const graph = createAIDataWorkflowRunGraph({
      binding, runId: 'platform-v0-run', platformDefaultPolicy: 'never',
    });
    const created = await createAIDataWorkflowCheckpoint(runtime, {
      instanceId: 'platform-v0-instance', definition, graph,
      input: { value: 'subject' }, config: {}, state: { status: 'Pending', generation: 0 }, output: null,
      controllerSidecars: { status: 'Pending' }, nodeSidecars: projectNodeSidecars(graph),
      ai: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
    });
    expect((created.profile.runGraph as typeof graph).platformDefaultPolicy).toBe('never');
    expect((created.profile.runGraph as typeof graph).nodes.prepare.reusePolicy.source).toBe('platform-default');

    const mismatched = {
      ...graph,
      nodes: {
        ...graph.nodes,
        prepare: {
          ...graph.nodes.prepare,
          reusePolicy: { policy: 'semantic-hash', source: 'node-type-default', nodeType: 'data' } as const,
        },
      },
    };
    await expect(createAIDataWorkflowCheckpoint(runtime, {
      instanceId: 'platform-v0-mismatch-instance', definition, graph: mismatched,
      input: { value: 'subject' }, config: {}, state: { status: 'Pending', generation: 0 }, output: null,
      controllerSidecars: { status: 'Pending' }, nodeSidecars: projectNodeSidecars(mismatched),
      ai: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
    })).rejects.toThrow();
  });
  test('rejects an advanced graph as checkpoint version zero', async () => {
    const runtime: FlowRunCheckpointRuntime = { checkpointStore: new InMemoryFlowRunCheckpointStore() };
    const binding = defineEagerBackedAIDataWorkflow(plan);
    const initial = createAIDataWorkflowRunGraph({ binding, runId: 'advanced-v0-run' });
    const advanced = applyAIDataWorkflowGraphPatch(initial, {
      patchId: 'advanced-before-admission',
      operations: [{ op: 'update-node', nodeId: 'prepare', changes: { config: { mode: 'advanced' } } }],
    });
    await expect(createAIDataWorkflowCheckpoint(runtime, {
      instanceId: 'advanced-v0-instance', definition, graph: advanced,
      input: { value: 'subject' }, config: {}, state: { status: 'Pending', generation: 1 }, output: null,
      controllerSidecars: { status: 'Pending' }, nodeSidecars: projectNodeSidecars(advanced),
      ai: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
    })).rejects.toThrow();
    expect(await loadAIDataWorkflowCheckpoint(runtime, {
      instanceId: 'advanced-v0-instance', runId: 'advanced-v0-run',
    })).toBeUndefined();
  });

  test('accepts exact additive update and retained removal projections', async () => {
    const runtime: FlowRunCheckpointRuntime = { checkpointStore: new InMemoryFlowRunCheckpointStore() };
    const binding = defineEagerBackedAIDataWorkflow(plan);
    const baseGraph = createAIDataWorkflowRunGraph({ binding, runId: 'exact-patch-run' });
    const created = await createAIDataWorkflowCheckpoint(runtime, {
      instanceId: 'exact-patch-instance', definition, graph: baseGraph,
      input: { value: 'subject' }, config: {}, state: { status: 'Pending', generation: 0 }, output: null,
      controllerSidecars: { status: 'Pending' }, nodeSidecars: projectNodeSidecars(baseGraph),
      ai: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
    });
    const added = applyAIDataWorkflowGraphPatch(baseGraph, {
      patchId: 'add-side-note',
      operations: [
        { op: 'update-node', nodeId: 'prepare', changes: { config: { mode: 'declared' } } },
        { op: 'add-node', node: { id: 'side-note', dependsOn: ['prepare'], outputs: ['note'] } },
      ],
    });
    const acceptedAdd = await commitAIDataWorkflowCheckpoint(runtime, {
      expectedVersion: created.version,
      checkpoint: {
        ...created, version: created.version + 1,
        state: { status: 'Pending', generation: added.currentGeneration },
        nodeSidecars: projectNodeSidecars(added),
        profile: { ...created.profile, runGraph: added },
      },
    });
    const removed = applyAIDataWorkflowGraphPatch(added, {
      patchId: 'remove-side-note',
      operations: [{ op: 'remove-node', nodeId: 'side-note' }],
    });
    const acceptedRemove = await commitAIDataWorkflowCheckpoint(runtime, {
      expectedVersion: acceptedAdd.version,
      checkpoint: {
        ...acceptedAdd, version: acceptedAdd.version + 1,
        state: { status: 'Pending', generation: removed.currentGeneration },
        nodeSidecars: projectNodeSidecars(removed),
        profile: { ...acceptedAdd.profile, runGraph: removed },
      },
    });
    expect(acceptedRemove.profile.runGraph.nodes['side-note'].status).toBe('Removed');
    expect(acceptedRemove.profile.runGraph.declarationOrder).toContain('side-note');
  });

  test('rejects unexplained structural projections and disappearing accepted nodes', async () => {
    const binding = defineEagerBackedAIDataWorkflow(plan);
    const baseGraph = createAIDataWorkflowRunGraph({ binding, runId: 'structural-run' });
    const cases = [
      {
        name: 'missing accepted node',
        graph: {
          ...baseGraph,
          nodes: Object.fromEntries(Object.entries(baseGraph.nodes).filter(([nodeId]) => nodeId !== 'return')),
          declarationOrder: baseGraph.declarationOrder.filter((nodeId) => nodeId !== 'return'),
        },
      },
      {
        name: 'unexplained config change',
        graph: (() => {
          const invalidated = invalidateAIDataWorkflowNode(baseGraph, 'prepare', 'refresh', { generation: 1 });
          return {
            ...invalidated,
            nodes: {
              ...invalidated.nodes,
              prepare: { ...invalidated.nodes.prepare, config: { mode: 'unexplained' } },
            },
          };
        })(),
      },
      {
        name: 'patch projection mismatch',
        graph: (() => {
          const patched = applyAIDataWorkflowGraphPatch(baseGraph, {
            patchId: 'prepare-mode',
            operations: [{ op: 'update-node', nodeId: 'prepare', changes: { config: { mode: 'declared' } } }],
          });
          return {
            ...patched,
            nodes: {
              ...patched.nodes,
              prepare: { ...patched.nodes.prepare, config: { mode: 'different' } },
            },
          };
        })(),
      },
    ];

    for (const boundary of cases) {
      const runtime: FlowRunCheckpointRuntime = { checkpointStore: new InMemoryFlowRunCheckpointStore() };
      const created = await createAIDataWorkflowCheckpoint(runtime, {
        instanceId: 'structural-instance',
        definition,
        graph: baseGraph,
        input: { value: 'subject' },
        config: {},
        state: { status: 'Pending', generation: 0 },
        output: null,
        controllerSidecars: { status: 'Pending' },
        nodeSidecars: projectNodeSidecars(baseGraph),
        ai: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
      });
      await expect(commitAIDataWorkflowCheckpoint(runtime, {
        expectedVersion: created.version,
        checkpoint: {
          ...created,
          version: created.version + 1,
          state: { status: 'Pending', generation: boundary.graph.currentGeneration },
          nodeSidecars: projectNodeSidecars(boundary.graph),
          profile: { ...created.profile, runGraph: boundary.graph },
        },
      }), boundary.name).rejects.toThrow();
    }
  });

  test('recovers graph generation and invalidation with the same AI profile state', async () => {
    const runtime: FlowRunCheckpointRuntime = {
      checkpointStore: new InMemoryFlowRunCheckpointStore(),
    };
    const binding = defineEagerBackedAIDataWorkflow(plan);
    let graph = createAIDataWorkflowRunGraph({ binding, runId: 'run-data-1' });
    const created = await createAIDataWorkflowCheckpoint(runtime, {
      instanceId: 'instance-data-1',
      definition,
      graph,
      input: { value: 'subject' },
      config: { policy: 'standard' },
      state: { status: 'Pending', generation: 0 },
      output: null,
      controllerSidecars: { status: 'Pending' },
      nodeSidecars: Object.fromEntries(graph.declarationOrder.map((nodeId) => [nodeId, {
        status: graph.nodes[nodeId].status,
        generation: graph.nodes[nodeId].generation,
      }])),
      ai: {
        schemaVersion: 'depa.ai-agent-state/v1',
        instancesById: {
          'agent-instance-2': {
            authority: 'eidolon',
            instanceId: 'agent-instance-2',
            instanceName: 'preparer',
            sessionId: 'session-2',
            agentDefinitionRef: 'resource://demo.Agent',
          },
        },
        instanceIdByName: { preparer: 'agent-instance-2' },
        invocationsByKey: {},
      },
    });
    expect(created.version).toBe(0);

    graph = recordAIDataWorkflowNodeResult(graph, 'entry', {
      nodeId: 'entry', generation: 0, status: 'Succeeded', output: { value: 'subject' },
    });
    graph = recordAIDataWorkflowNodeResult(graph, 'prepare', {
      nodeId: 'prepare', generation: 0, status: 'Succeeded', output: { result: 'v1' },
    });
    const withResults = await commitAIDataWorkflowCheckpoint(runtime, {
      expectedVersion: created.version,
      checkpoint: {
        ...created,
        version: created.version + 1,
        nodeSidecars: projectNodeSidecars(graph),
        profile: { ...created.profile, runGraph: graph },
      },
    });

    const rewrittenGraph = {
      ...withResults.profile.runGraph,
      nodes: {
        ...withResults.profile.runGraph.nodes,
        prepare: {
          ...withResults.profile.runGraph.nodes.prepare,
          result: {
            ...withResults.profile.runGraph.nodes.prepare.result!,
            output: { result: 'rewritten' },
          },
        },
      },
    };
    const rewrittenNodes = rewrittenGraph.nodes as Readonly<Record<string, { status: string; generation: number }>>;
    await expect(commitAIDataWorkflowCheckpoint(runtime, {
      expectedVersion: withResults.version,
      checkpoint: {
        ...withResults,
        version: withResults.version + 1,
        nodeSidecars: Object.fromEntries(rewrittenGraph.declarationOrder.map((nodeId) => [nodeId, {
          status: rewrittenNodes[nodeId].status,
          generation: rewrittenNodes[nodeId].generation,
        }])),
        profile: { ...withResults.profile, runGraph: rewrittenGraph },
      },
    })).rejects.toBeInstanceOf(FlowRunCheckpointTransitionError);

    graph = applyAIDataWorkflowGraphPatch(graph, {
      patchId: 'prepare-v2',
      operations: [
        { op: 'update-node', nodeId: 'prepare', changes: { config: { prompt: 'v2' } } },
        { op: 'add-node', node: { id: 'side-note', dependsOn: ['prepare'], outputs: ['note'] } },
      ],
    });
    const advanced = await commitAIDataWorkflowCheckpoint(runtime, {
      expectedVersion: withResults.version,
      checkpoint: {
        ...withResults,
        version: withResults.version + 1,
        state: { status: 'Pending', generation: 1 },
        output: null,
        controllerSidecars: { status: 'Pending' },
        nodeSidecars: Object.fromEntries(graph.declarationOrder.map((nodeId) => [nodeId, {
          status: graph.nodes[nodeId].status,
          generation: graph.nodes[nodeId].generation,
        }])),
        profile: { ...withResults.profile, runGraph: graph },
      },
    });

    const rolledBackNodeGraph = {
      ...advanced.profile.runGraph,
      nodes: {
        ...advanced.profile.runGraph.nodes,
        'side-note': { ...advanced.profile.runGraph.nodes['side-note'], generation: 0 },
      },
    };
    await expect(commitAIDataWorkflowCheckpoint(runtime, {
      expectedVersion: advanced.version,
      checkpoint: {
        ...advanced,
        version: advanced.version + 1,
        nodeSidecars: {
          ...advanced.nodeSidecars,
          'side-note': { status: rolledBackNodeGraph.nodes['side-note'].status, generation: 0 },
        },
        profile: { ...advanced.profile, runGraph: rolledBackNodeGraph },
      },
    })).rejects.toThrow();

    const earlierPatchGraph = {
      ...advanced.profile.runGraph,
      currentGeneration: 2,
      nodes: {
        ...advanced.profile.runGraph.nodes,
        prepare: {
          ...advanced.profile.runGraph.nodes.prepare,
          config: { prompt: 'earlier-generation' },
        },
      },
      patchHistory: [
        ...advanced.profile.runGraph.patchHistory,
        {
          patchId: 'earlier-history',
          generation: 1,
          operations: [{ op: 'update-node' as const, nodeId: 'prepare', changes: { config: { prompt: 'earlier-generation' } } }],
        },
      ],
    };
    await expect(commitAIDataWorkflowCheckpoint(runtime, {
      expectedVersion: advanced.version,
      checkpoint: {
        ...advanced,
        version: advanced.version + 1,
        state: { status: 'Pending', generation: 2 },
        profile: { ...advanced.profile, runGraph: earlierPatchGraph },
      },
    })).rejects.toThrow();

    const earlierInvalidation = {
      nodeId: 'return', generation: 1, reason: 'earlier-history', sourceNodeId: 'prepare',
    };
    const earlierInvalidationGraph = {
      ...advanced.profile.runGraph,
      currentGeneration: 2,
      nodes: {
        ...advanced.profile.runGraph.nodes,
        return: {
          ...advanced.profile.runGraph.nodes.return,
          invalidatedBy: [...(advanced.profile.runGraph.nodes.return.invalidatedBy ?? []), earlierInvalidation],
        },
      },
      invalidations: [...advanced.profile.runGraph.invalidations, earlierInvalidation],
    };
    await expect(commitAIDataWorkflowCheckpoint(runtime, {
      expectedVersion: advanced.version,
      checkpoint: {
        ...advanced,
        version: advanced.version + 1,
        state: { status: 'Pending', generation: 2 },
        profile: { ...advanced.profile, runGraph: earlierInvalidationGraph },
      },
    })).rejects.toThrow();

    await expect(commitAIDataWorkflowCheckpoint(runtime, {
      expectedVersion: advanced.version,
      checkpoint: {
        ...created,
        version: advanced.version + 1,
      },
    })).rejects.toBeInstanceOf(FlowRunCheckpointTransitionError);

    const generationTwo = applyAIDataWorkflowGraphPatch(graph, {
      patchId: 'prepare-v3',
      operations: [{ op: 'update-node', nodeId: 'prepare', changes: { config: { prompt: 'v3' } } }],
    });
    const replacedPrefix = {
      ...generationTwo,
      patchHistory: generationTwo.patchHistory.map((patch, index) => index === 0
        ? { ...patch, reason: 'rewritten-prefix' }
        : patch),
    };
    await expect(commitAIDataWorkflowCheckpoint(runtime, {
      expectedVersion: advanced.version,
      checkpoint: {
        ...advanced,
        version: advanced.version + 1,
        state: { status: 'Pending', generation: replacedPrefix.currentGeneration },
        controllerSidecars: { status: 'Pending' },
        nodeSidecars: Object.fromEntries(replacedPrefix.declarationOrder.map((nodeId) => [nodeId, {
          status: replacedPrefix.nodes[nodeId].status,
          generation: replacedPrefix.nodes[nodeId].generation,
        }])),
        profile: { ...advanced.profile, runGraph: replacedPrefix },
      },
    })).rejects.toBeInstanceOf(FlowRunCheckpointTransitionError);

    const freshRuntime: FlowRunCheckpointRuntime = { checkpointStore: runtime.checkpointStore };
    const restored = await loadAIDataWorkflowCheckpoint(freshRuntime, {
      instanceId: 'instance-data-1',
      runId: 'run-data-1',
    });
    expect(restored?.profile.runGraph.currentGeneration).toBe(1);
    expect(restored?.profile.runGraph.nodes.prepare.status).toBe('Invalidated');
    expect(restored?.profile.runGraph.invalidations.map((item) => item.nodeId)).toEqual(['prepare', 'return', 'side-note']);
    expect(restored?.state).toMatchObject({ status: 'Pending' });
    expect(restored?.output).toBeNull();
    expect(restored?.nodeSidecars.prepare).toEqual({ status: 'Invalidated', generation: 1 });
    expect(restored?.profile.ai.instancesById['agent-instance-2']).toEqual({
      authority: 'eidolon',
      instanceId: 'agent-instance-2',
      instanceName: 'preparer',
      sessionId: 'session-2',
      agentDefinitionRef: 'resource://demo.Agent',
    });
  });
});

function projectNodeSidecars(graph: ReturnType<typeof createAIDataWorkflowRunGraph>) {
  return Object.fromEntries(graph.declarationOrder.map((nodeId) => [nodeId, {
    status: graph.nodes[nodeId].status,
    generation: graph.nodes[nodeId].generation,
  }]));
}
