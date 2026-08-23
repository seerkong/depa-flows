import { describe, expect, test } from 'bun:test';
import type {
  AICtrlWorkflowRunProfileState,
  AIDataWorkflowRunProfileState,
  AIWorkflowFlowRunCheckpoint,
  FlowInstanceDescriptor,
  FlowRunCheckpoint,
} from 'ai-workflow-contract';
import {
  FlowRunContractValidationError,
  normalizeFlowInstanceDescriptor,
  normalizeFlowRunCheckpoint,
} from 'ai-workflow-logic';

const digest: `sha256:${string}` = `sha256:${'a'.repeat(64)}`;

function definitionIdentity() {
  return {
    revision: 'workflow-r1',
    digest,
    provenance: {
      authority: 'resource-package',
      artifactRef: 'resource://depa.flows.test.Workflow.Support',
      metadata: { registryRevision: 'registry-r3' },
    },
  };
}

function checkpoint(profile: unknown): Record<string, unknown> {
  const base = {
    schemaVersion: 'depa.flow-run-checkpoint/v1',
    runId: 'run-1',
    instanceId: 'instance-1',
    definition: definitionIdentity(),
    version: 3,
    input: { request: 'summarize' },
    config: { retries: 2 },
    state: { phase: 'Running' },
    output: null,
    controllerSidecars: { scheduler: { cursor: 1 } },
    nodeSidecars: { collect: { attempt: 2 } },
    profile,
  };
  if (profile && typeof profile === 'object' && 'snapshot' in profile) {
    const snapshot = (profile as { snapshot?: Record<string, unknown> }).snapshot;
    if (snapshot?.schemaVersion === 'depa.flows.workflow/v4') {
      return {
        ...base,
        input: snapshot.input,
        state: snapshot.vars,
        controllerSidecars: {
          status: snapshot.status,
          lastTickNo: snapshot.lastTickNo,
          branchDecisions: snapshot.branchDecisions,
          orchestration: snapshot.orchestration,
          openWaitHandles: snapshot.openWaitHandles,
          closedWaitHandles: snapshot.closedWaitHandles,
          appliedResumeSignals: snapshot.appliedResumeSignals,
        },
        nodeSidecars: { nodeResults: snapshot.nodeResults, waitResults: snapshot.waitResults },
      };
    }
  }
  if (profile && typeof profile === 'object' && 'runGraph' in profile) {
    const graph = (profile as { runGraph?: ReturnType<typeof dataGraph> }).runGraph;
    if (graph?.nodes && graph.declarationOrder) {
      const graphNodes = graph.nodes as Readonly<Record<string, { status: string; generation: number }>>;
      const statuses = graph.declarationOrder.map((nodeId) => graphNodes[nodeId]?.status).filter(Boolean);
      const status = statuses.some((item) => item === 'Failed')
        ? 'Failed'
        : statuses.some((item) => item === 'Running')
          ? 'Running'
          : statuses.length > 0 && statuses.every((item) => item === 'Succeeded' || item === 'Reused')
            ? 'Succeeded'
            : 'Pending';
      return {
        ...base,
        state: { status, generation: graph.currentGeneration },
        output: null,
        controllerSidecars: { status },
        nodeSidecars: Object.fromEntries(graph.declarationOrder.map((nodeId) => [
          nodeId, { status: graphNodes[nodeId].status, generation: graphNodes[nodeId].generation },
        ])),
      };
    }
  }
  return base;
}

function workSnapshot(treeId = 'run-1', status: 'Waiting' | 'Completed' | 'Failed' = 'Waiting') {
  return {
    schemaVersion: 'depa.flows.workflow/v4',
    treeId,
    fqn: 'depa.flows.test.Workflow.Support',
    status,
    vars: {},
    input: {},
    branchDecisions: {},
    nodeResults: {},
    waitResults: {},
    openWaitHandles: [],
    closedWaitHandles: [],
    appliedResumeSignals: [],
    orchestration: {
      attempts: {}, deadlines: {}, lanes: {}, winners: {}, cancellations: {}, composites: {},
    },
    lastTickNo: 0,
    updatedAtMs: 1,
  };
}

function waitHandle(treeId = 'run-1') {
  return {
    waitHandleId: `${treeId}:approval#0:job.completed:approval`,
    treeId,
    nodeKey: 'approval',
    invocationKey: 'approval#0',
    waitKind: 'external-job',
    status: 'Open',
    signalKind: 'job.completed',
    signalKey: 'approval',
    resumeToken: 'resume-approval',
    deadlineAtMs: 0,
    metadata: { source: 'fixture' },
  };
}

function dataGraph(runId = 'run-1') {
  const entryDefinition = {
    tag: 'EntryNode',
    id: 'entry',
    declarationIndex: 0,
    waitFor: [],
    outputs: ['value'],
  };
  const prepareDefinition = {
    tag: 'TransformNode',
    id: 'prepare',
    declarationIndex: 1,
    waitFor: [],
    inputs: { value: { ref: 'flow-port://#entry/value', nodeId: 'entry', port: 'value' } },
    outputs: ['result'],
    src: 'vfs://./flow-code.ts#prepare',
    config: {},
  };
  const entryRunNode = {
    id: 'entry',
    tag: 'EntryNode',
    nodeType: 'data',
    generation: 0,
    status: 'Pending',
    declarationIndex: 0,
    inputs: {},
    outputs: ['value'],
    config: {},
    dependsOn: [],
    dependents: ['prepare'],
    reusePolicy: { policy: 'semantic-hash', source: 'node-type-default', nodeType: 'data' },
  };
  const prepareRunNode = {
    id: 'prepare',
    tag: 'TransformNode',
    nodeType: 'data',
    generation: 0,
    status: 'Pending',
    declarationIndex: 1,
    inputs: { value: { ref: 'flow-port://#entry/value', nodeId: 'entry', port: 'value' } },
    outputs: ['result'],
    config: {},
    dependsOn: ['entry'],
    dependents: [],
    reusePolicy: { policy: 'semantic-hash', source: 'node-type-default', nodeType: 'data' },
  };
  return {
    runId,
    binding: {
      kind: 'AIDataWorkflow',
      substrate: 'EagerDataFlow',
      definition: {
        form: 'EagerDataFlow',
        fqn: 'depa.flows.test.Workflow.Data',
        apiVersion: 'depa.flows/v1',
        version: '1',
        sourceNames: ['manifest.xnl'],
        contract: { id: 'depa.flows.test.Workflow.Data', inputPorts: ['value'], outputPorts: ['value'] },
        nodes: [entryDefinition, prepareDefinition],
        nodeById: { entry: entryDefinition, prepare: prepareDefinition },
        declarationOrder: ['entry', 'prepare'],
        dataEdges: [{
          kind: 'data', fromNodeId: 'entry', fromPort: 'value', toNodeId: 'prepare',
          toInput: 'value', ref: 'flow-port://#entry/value',
        }],
        waitForEdges: [],
        subflowEdges: [],
        diagnostics: [],
      },
    },
    currentGeneration: 0,
    nodes: { entry: entryRunNode, prepare: prepareRunNode },
    declarationOrder: ['entry', 'prepare'],
    patchHistory: [],
    invalidations: [],
  };
}

function expectDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if (typeof value !== 'object' || value === null || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const nested of Object.values(value)) expectDeepFrozen(nested, seen);
}

describe('Flow instance and run checkpoint contracts', () => {
  test('normalizes path-independent definition provenance into an immutable instance descriptor', () => {
    const source = {
      schemaVersion: 'depa.flow-instance/v1',
      instanceId: 'instance-1',
      definition: definitionIdentity(),
      materializedAtMs: 1_800_000_000_000,
    };

    const normalized: FlowInstanceDescriptor = normalizeFlowInstanceDescriptor(source);

    expect(normalized.schemaVersion).toBe('depa.flow-instance/v1');
    expect(normalized.instanceId).toBe(source.instanceId);
    expect(normalized.definition).toEqual(source.definition);
    expect(normalized.materializedAtMs).toBe(source.materializedAtMs);
    expectDeepFrozen(normalized);
    source.definition.provenance.metadata.registryRevision = 'changed-after-normalization';
    expect(normalized.definition.provenance.metadata?.registryRevision).toBe('registry-r3');
  });

  test('normalizes closed WorkCtrl, AI Ctrl and AI Data profile payloads', () => {
    const workCtrl = normalizeFlowRunCheckpoint(checkpoint({
      kind: 'WorkCtrlFlow',
      snapshot: workSnapshot(),
    }));
    const aiCtrl = normalizeFlowRunCheckpoint(checkpoint({
      kind: 'AICtrlWorkflow',
      snapshot: workSnapshot(),
      ai: {
        schemaVersion: 'depa.ai-agent-state/v1',
        instancesById: {
          'agent-instance-1': { authority: 'eidolon', instanceId: 'agent-instance-1', instanceName: 'reviewer', agentDefinitionRef: 'resource://demo.Agent' },
        },
        instanceIdByName: { reviewer: 'agent-instance-1' },
        invocationsByKey: {},
      },
    })) as FlowRunCheckpoint<AICtrlWorkflowRunProfileState>;
    const aiData = normalizeFlowRunCheckpoint(checkpoint({
      kind: 'AIDataWorkflow',
      runGraph: dataGraph(),
      ai: {
        schemaVersion: 'depa.ai-agent-state/v1',
        instancesById: {
          'agent-instance-1': { authority: 'eidolon', instanceId: 'agent-instance-1', instanceName: 'summarizer', agentDefinitionRef: 'resource://demo.Agent' },
        },
        instanceIdByName: { summarizer: 'agent-instance-1' },
        invocationsByKey: {},
      },
    })) as FlowRunCheckpoint<AIDataWorkflowRunProfileState>;

    expect((workCtrl.profile as { kind: string }).kind).toBe('WorkCtrlFlow');
    expect(aiCtrl.profile.kind).toBe('AICtrlWorkflow');
    expect(aiData.profile.kind).toBe('AIDataWorkflow');
    expectDeepFrozen(workCtrl);
    expectDeepFrozen(aiCtrl);
    expectDeepFrozen(aiData);
  });

  test.each([
    ['empty WorkCtrl snapshot', { kind: 'WorkCtrlFlow', snapshot: {} }],
    ['empty AI Ctrl snapshot', {
      kind: 'AICtrlWorkflow', snapshot: {}, ai: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
    }],
    ['empty AI Data graph', {
      kind: 'AIDataWorkflow', runGraph: {}, ai: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
    }],
    ['WorkCtrl run identity mismatch', { kind: 'WorkCtrlFlow', snapshot: workSnapshot('other-run') }],
    ['AI Data run identity mismatch', {
      kind: 'AIDataWorkflow', runGraph: dataGraph('other-run'), ai: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
    }],
  ])('fails closed for %s', (_name, profile) => {
    expect(() => normalizeFlowRunCheckpoint(checkpoint(profile))).toThrow(FlowRunContractValidationError);
  });

  test('fails closed when a definition node identity is omitted from the durable RunGraph', () => {
    const graph = dataGraph();
    const withoutPrepare = {
      ...graph,
      nodes: { entry: { ...graph.nodes.entry, dependents: [] } },
      declarationOrder: ['entry'],
    };
    expect(() => normalizeFlowRunCheckpoint(checkpoint({
      kind: 'AIDataWorkflow',
      runGraph: withoutPrepare,
      ai: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
    }))).toThrow(FlowRunContractValidationError);
  });

  test('fails closed when an AI Data input ref does not project a declared source output and dependency', () => {
    const graph = dataGraph();
    const malformed = {
      ...graph,
      nodes: {
        ...graph.nodes,
        prepare: {
          ...graph.nodes.prepare,
          inputs: { value: { ref: 'flow-port://#entry/missing', nodeId: 'entry', port: 'missing' } },
        },
      },
    };
    expect(() => normalizeFlowRunCheckpoint(checkpoint({
      kind: 'AIDataWorkflow', runGraph: malformed, ai: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
    }))).toThrow(FlowRunContractValidationError);
  });

  test('fails closed for invalid platform policy authority and duplicate patch targets', () => {
    expect(() => normalizeFlowRunCheckpoint(checkpoint({
      kind: 'AIDataWorkflow',
      runGraph: { ...dataGraph(), platformDefaultPolicy: 'ambient' },
      ai: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
    }))).toThrow(FlowRunContractValidationError);

    const graph = dataGraph();
    expect(() => normalizeFlowRunCheckpoint(checkpoint({
      kind: 'AIDataWorkflow',
      runGraph: {
        ...graph,
        currentGeneration: 1,
        nodes: { ...graph.nodes, prepare: { ...graph.nodes.prepare, generation: 1 } },
        patchHistory: [{
          patchId: 'duplicate-target', generation: 1,
          operations: [
            { op: 'update-node', nodeId: 'prepare', changes: {} },
            { op: 'remove-node', nodeId: 'prepare' },
          ],
        }],
      },
      ai: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
    }))).toThrow(FlowRunContractValidationError);
  });

  test('fails closed when reuse policy source lacks its declared authority', () => {
    const graph = dataGraph();
    for (const runGraph of [
      {
        ...graph,
        nodes: {
          ...graph.nodes,
          prepare: {
            ...graph.nodes.prepare,
            reusePolicy: { policy: 'never', source: 'node', nodeType: 'data' },
          },
        },
      },
      {
        ...graph,
        nodes: {
          ...graph.nodes,
          prepare: {
            ...graph.nodes.prepare,
            reusePolicy: { policy: 'never', source: 'platform-default', nodeType: 'data' },
          },
        },
      },
      {
        ...graph,
        platformDefaultPolicy: 'never',
      },
    ]) {
      expect(() => normalizeFlowRunCheckpoint(checkpoint({
        kind: 'AIDataWorkflow', runGraph, ai: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
      }))).toThrow(FlowRunContractValidationError);
    }
  });

  test('fails closed when an invalidation fact targets a Pending projection', () => {
    const graph = dataGraph();
    const fact = { nodeId: 'prepare', generation: 1, reason: 'refresh', sourceNodeId: 'entry' };
    expect(() => normalizeFlowRunCheckpoint(checkpoint({
      kind: 'AIDataWorkflow',
      runGraph: {
        ...graph,
        currentGeneration: 1,
        nodes: {
          ...graph.nodes,
          prepare: { ...graph.nodes.prepare, generation: 1, invalidatedBy: [fact] },
        },
        invalidations: [fact],
      },
      ai: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
    }))).toThrow(FlowRunContractValidationError);
  });

  test('fails closed when a Removed node remains a dependency or input source', () => {
    const graph = dataGraph();
    expect(() => normalizeFlowRunCheckpoint(checkpoint({
      kind: 'AIDataWorkflow',
      runGraph: {
        ...graph,
        currentGeneration: 1,
        nodes: {
          ...graph.nodes,
          entry: { ...graph.nodes.entry, generation: 1, status: 'Removed' },
        },
        patchHistory: [{
          patchId: 'remove-entry', generation: 1,
          operations: [{ op: 'remove-node', nodeId: 'entry' }],
        }],
      },
      ai: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
    }))).toThrow(FlowRunContractValidationError);
  });

  test('fails closed for a generated node input ref outside the RunGraph port projection', () => {
    const graph = dataGraph();
    const generatedNode = {
      id: 'generated', tag: 'TransformNode', nodeType: 'data', generation: 1, status: 'Pending',
      declarationIndex: 2,
      inputs: { value: { ref: 'flow-port://#entry/missing', nodeId: 'entry', port: 'missing' } },
      outputs: ['result'], config: {}, dependsOn: ['entry'], dependents: [],
      reusePolicy: { policy: 'semantic-hash', source: 'node-type-default', nodeType: 'data' },
    };
    const malformed = {
      ...graph,
      currentGeneration: 1,
      nodes: {
        ...graph.nodes,
        entry: { ...graph.nodes.entry, dependents: ['prepare', 'generated'] },
        generated: generatedNode,
      },
      declarationOrder: ['entry', 'prepare', 'generated'],
      patchHistory: [{
        patchId: 'add-generated', generation: 1,
        operations: [{
          op: 'add-node',
          node: {
            id: 'generated', inputs: generatedNode.inputs, outputs: ['result'], dependsOn: ['entry'],
          },
        }],
      }],
    };
    expect(() => normalizeFlowRunCheckpoint(checkpoint({
      kind: 'AIDataWorkflow', runGraph: malformed, ai: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
    }))).toThrow(FlowRunContractValidationError);
  });

  test.each([
    ['empty open wait handle', { openWaitHandles: [{}] }],
    ['wait handle with another run identity', { openWaitHandles: [waitHandle('other-run')] }],
    ['wait handle with an extra field', { openWaitHandles: [{ ...waitHandle(), owner: 'parallel' }] }],
    ['open collection with a closed handle', {
      openWaitHandles: [{ ...waitHandle(), status: 'Consumed', closedAtMs: 2 }],
    }],
    ['closed collection with an open handle', { closedWaitHandles: [waitHandle()] }],
  ])('fails closed for %s', (_name, changes) => {
    expect(() => normalizeFlowRunCheckpoint(checkpoint({
      kind: 'WorkCtrlFlow', snapshot: { ...workSnapshot(), ...changes },
    }))).toThrow(FlowRunContractValidationError);
  });

  test('fails closed for accessor and sparse WaitHandle data', () => {
    const accessor = waitHandle() as Record<string, unknown>;
    Object.defineProperty(accessor, 'treeId', { enumerable: true, get: () => 'run-1' });
    expect(() => normalizeFlowRunCheckpoint(checkpoint({
      kind: 'WorkCtrlFlow', snapshot: { ...workSnapshot(), openWaitHandles: [accessor] },
    }))).toThrow(FlowRunContractValidationError);

    const sparse = new Array(1);
    expect(() => normalizeFlowRunCheckpoint(checkpoint({
      kind: 'WorkCtrlFlow', snapshot: { ...workSnapshot(), openWaitHandles: sparse },
    }))).toThrow(FlowRunContractValidationError);
  });

  test.each([
    ['completed snapshot with an open handle', {
      status: 'Completed', openWaitHandles: [waitHandle()],
    }],
    ['completed snapshot with an open composite', {
      status: 'Completed',
      orchestration: {
        ...workSnapshot().orchestration,
        composites: { 'parallel#0': { invocationKey: 'parallel#0', primitive: 'Parallel', bodyId: 'body', status: 'Waiting', updatedAtMs: 1 } },
      },
    }],
    ['open wait handle with a close time', {
      openWaitHandles: [{ ...waitHandle(), closedAtMs: 2 }],
    }],
    ['branch path projection mismatch', {
      branchDecisions: { 'review#0': { ifPath: 'other', invocationKey: 'review#0', kind: 'NoMatch' } },
    }],
    ['duplicate applied signal identity', (() => {
      const closed = { ...waitHandle(), status: 'Consumed', closedAtMs: 2 };
      const identity = `${closed.waitHandleId}:${closed.resumeToken}`;
      return { openWaitHandles: [], closedWaitHandles: [closed], appliedResumeSignals: [identity, identity] };
    })()],
    ['applied signal unrelated to a closed handle', {
      appliedResumeSignals: ['missing-handle:missing-token'],
    }],
  ])('fails closed for Ctrl cross invariant: %s', (_name, changes) => {
    expect(() => normalizeFlowRunCheckpoint(checkpoint({
      kind: 'AICtrlWorkflow',
      snapshot: { ...workSnapshot(), ...changes },
      ai: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
    }))).toThrow(FlowRunContractValidationError);
  });

  test('fails closed when a controller sidecar conflicts with its canonical Ctrl snapshot', () => {
    const value = checkpoint({
      kind: 'WorkCtrlFlow', snapshot: workSnapshot(),
    });
    value.controllerSidecars = { status: 'Completed' };
    expect(() => normalizeFlowRunCheckpoint(value)).toThrow(FlowRunContractValidationError);
  });

  test.each([
    ['input', { input: { request: 'other' } }],
    ['state', { state: { retained: 'other' } }],
    ['controller projection', { controllerSidecars: { status: 'Waiting' } }],
    ['node projection', { nodeSidecars: { nodeResults: {} } }],
  ])('fails closed when Ctrl envelope %s differs from the snapshot authority', (_name, changes) => {
    const snapshot = { ...workSnapshot(), input: { request: 'canonical' }, vars: { retained: 'canonical' } };
    const value = {
      ...checkpoint({ kind: 'WorkCtrlFlow', snapshot }),
      input: snapshot.input,
      state: snapshot.vars,
      controllerSidecars: {
        status: snapshot.status,
        lastTickNo: snapshot.lastTickNo,
        branchDecisions: snapshot.branchDecisions,
        orchestration: snapshot.orchestration,
        openWaitHandles: snapshot.openWaitHandles,
        closedWaitHandles: snapshot.closedWaitHandles,
        appliedResumeSignals: snapshot.appliedResumeSignals,
      },
      nodeSidecars: { nodeResults: snapshot.nodeResults, waitResults: snapshot.waitResults },
      ...changes,
    };
    expect(() => normalizeFlowRunCheckpoint(value)).toThrow(FlowRunContractValidationError);
  });

  test.each([
    ['branch decision extra field', {
      branchDecisions: { 'if#0': { ifPath: 'if', invocationKey: 'if#0', kind: 'NoMatch', other: true } },
    }],
    ['branch decision identity mismatch', {
      branchDecisions: { 'if#0': { ifPath: 'if', invocationKey: 'other#0', kind: 'NoMatch' } },
    }],
    ['node result enum', { nodeResults: { 'prepare#0': 'Unknown' } }],
    ['wait result extra field', { waitResults: { 'approval#0': { result: 'Success', other: true } } }],
    ['attempt fact extra field', {
      orchestration: {
        ...workSnapshot().orchestration,
        attempts: { 'retry#0': { invocationKey: 'retry#0', attempt: 1, maxAttempts: 2, status: 'Open', other: true } },
      },
    }],
    ['lane key projection', {
      orchestration: {
        ...workSnapshot().orchestration,
        lanes: { 'parallel#0/one': { invocationKey: 'parallel#0', laneId: 'two', bodyId: 'lane:two', status: 'Open' } },
      },
    }],
    ['composite primitive enum', {
      orchestration: {
        ...workSnapshot().orchestration,
        composites: { 'retry#0': { invocationKey: 'retry#0', primitive: 'Other', bodyId: 'body', status: 'Open', updatedAtMs: 1 } },
      },
    }],
  ])('fails closed for nested Ctrl %s', (_name, changes) => {
    expect(() => normalizeFlowRunCheckpoint(checkpoint({
      kind: 'AICtrlWorkflow',
      snapshot: { ...workSnapshot(), ...changes },
      ai: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
    }))).toThrow(FlowRunContractValidationError);
  });

  test('fails closed for accessor and sparse nested Ctrl facts', () => {
    const attempt = { invocationKey: 'retry#0', attempt: 1, maxAttempts: 2, status: 'Open' } as Record<string, unknown>;
    Object.defineProperty(attempt, 'status', { enumerable: true, get: () => 'Open' });
    expect(() => normalizeFlowRunCheckpoint(checkpoint({
      kind: 'WorkCtrlFlow',
      snapshot: {
        ...workSnapshot(),
        orchestration: { ...workSnapshot().orchestration, attempts: { 'retry#0': attempt } },
      },
    }))).toThrow(FlowRunContractValidationError);
    expect(() => normalizeFlowRunCheckpoint(checkpoint({
      kind: 'WorkCtrlFlow',
      snapshot: { ...workSnapshot(), waitResults: { 'wait#0': { result: 'Success', payload: new Array(1) } } },
    }))).toThrow(FlowRunContractValidationError);
  });

  test.each([
    ['incomplete run node', { nodes: { ...dataGraph().nodes, entry: { id: 'entry', generation: 0, status: 'Pending' } } }],
    ['run node extra authority', {
      nodes: { ...dataGraph().nodes, entry: { ...dataGraph().nodes.entry, parallelAuthority: 'other' } },
    }],
    ['malformed reuse policy', {
      nodes: { ...dataGraph().nodes, entry: { ...dataGraph().nodes.entry, reusePolicy: { policy: 'semantic-hash' } } },
    }],
    ['unknown dependency', {
      nodes: { ...dataGraph().nodes, entry: { ...dataGraph().nodes.entry, dependsOn: ['missing'] } },
    }],
    ['host-local binding base URI', {
      binding: {
        ...dataGraph().binding,
        definition: { ...dataGraph().binding.definition, baseUri: '/host/workspace/definition' },
      },
    }],
    ['definition node extra authority', {
      binding: {
        ...dataGraph().binding,
        definition: {
          ...dataGraph().binding.definition,
          nodes: [{ ...dataGraph().binding.definition.nodes[0], parallelAuthority: true }],
        },
      },
    }],
    ['node result generation mismatch', {
      nodes: {
        ...dataGraph().nodes,
        entry: {
          ...dataGraph().nodes.entry,
          status: 'Succeeded',
          result: { nodeId: 'entry', generation: 1, status: 'Succeeded', output: { value: 'ready' } },
        },
      },
    }],
    ['node result status mismatch', {
      nodes: {
        ...dataGraph().nodes,
        entry: {
          ...dataGraph().nodes.entry,
          status: 'Succeeded',
          result: { nodeId: 'entry', generation: 0, status: 'Failed' },
        },
      },
    }],
    ['node port projection mismatch', {
      nodes: {
        ...dataGraph().nodes,
        entry: { ...dataGraph().nodes.entry, outputs: ['other'] },
      },
    }],
    ['dependency projection mismatch', {
      nodes: {
        ...dataGraph().nodes,
        entry: { ...dataGraph().nodes.entry, dependents: [] },
      },
    }],
    ['terminal node without result', {
      nodes: {
        ...dataGraph().nodes,
        entry: { ...dataGraph().nodes.entry, status: 'Succeeded' },
      },
    }],
    ['succeeded node result with a mismatched port projection', {
      nodes: {
        ...dataGraph().nodes,
        entry: {
          ...dataGraph().nodes.entry,
          status: 'Succeeded',
          result: { nodeId: 'entry', generation: 0, status: 'Succeeded', output: { other: 'ready' } },
        },
      },
    }],
    ['definition edge with an undeclared source port', {
      binding: {
        ...dataGraph().binding,
        definition: {
          ...dataGraph().binding.definition,
          dataEdges: [{
            ...dataGraph().binding.definition.dataEdges[0], fromPort: 'missing',
          }],
        },
      },
    }],
    ['graph invalidation without its node projection', {
      invalidations: [{ nodeId: 'prepare', generation: 1, reason: 'refresh', sourceNodeId: 'entry' }],
    }],
    ['node invalidation without its graph projection', {
      nodes: {
        ...dataGraph().nodes,
        prepare: {
          ...dataGraph().nodes.prepare,
          generation: 1,
          status: 'Invalidated',
          invalidatedBy: [{ nodeId: 'prepare', generation: 1, reason: 'refresh', sourceNodeId: 'entry' }],
        },
      },
    }],
    ['reused result without matching fingerprints', {
      nodes: {
        ...dataGraph().nodes,
        entry: {
          ...dataGraph().nodes.entry,
          status: 'Reused',
          semanticFingerprint: { algorithm: 'semantic-hash/v1', value: 'current' },
          result: {
            nodeId: 'entry', generation: 0, status: 'Reused',
            semanticFingerprint: { algorithm: 'semantic-hash/v1', value: 'current' },
          },
        },
      },
    }],
  ])('fails closed for AI Data %s', (_name, changes) => {
    expect(() => normalizeFlowRunCheckpoint(checkpoint({
      kind: 'AIDataWorkflow',
      runGraph: { ...dataGraph(), ...changes },
      ai: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
    }))).toThrow(FlowRunContractValidationError);
  });

  test('fails closed for accessor and sparse AI Data node collections', () => {
    const accessor = { ...dataGraph().nodes.entry } as Record<string, unknown>;
    Object.defineProperty(accessor, 'dependsOn', { enumerable: true, get: () => [] });
    expect(() => normalizeFlowRunCheckpoint(checkpoint({
      kind: 'AIDataWorkflow',
      runGraph: { ...dataGraph(), nodes: { ...dataGraph().nodes, entry: accessor } },
      ai: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
    }))).toThrow(FlowRunContractValidationError);

    const sparse = new Array(1);
    expect(() => normalizeFlowRunCheckpoint(checkpoint({
      kind: 'AIDataWorkflow',
      runGraph: {
        ...dataGraph(),
        nodes: { ...dataGraph().nodes, entry: { ...dataGraph().nodes.entry, outputs: sparse } },
      },
      ai: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
    }))).toThrow(FlowRunContractValidationError);
  });

  test.each([
    ['state generation', { state: { status: 'Pending', generation: 1 } }],
    ['controller status', { controllerSidecars: { status: 'Running' } }],
    ['node sidecars', { nodeSidecars: { entry: { status: 'Pending', generation: 0 } } }],
    ['nonterminal output', { output: { value: 'unexpected' } }],
  ])('fails closed when AI Data %s differs from its RunGraph projection', (_name, changes) => {
    const graph = dataGraph();
    const graphNodes = graph.nodes as Readonly<Record<string, { status: string; generation: number }>>;
    const value = {
      ...checkpoint({ kind: 'AIDataWorkflow', runGraph: graph, ai: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} } }),
      state: { status: 'Pending', generation: graph.currentGeneration },
      controllerSidecars: { status: 'Pending' },
      nodeSidecars: Object.fromEntries(graph.declarationOrder.map((nodeId) => [
        nodeId, { status: graphNodes[nodeId].status, generation: graphNodes[nodeId].generation },
      ])),
      output: null,
      ...changes,
    };
    expect(() => normalizeFlowRunCheckpoint(value)).toThrow(FlowRunContractValidationError);
  });

  test.each([
    ['accessor', () => {
      const value = checkpoint({ kind: 'WorkCtrlFlow', snapshot: {} });
      Object.defineProperty(value.input as object, 'derived', { enumerable: true, get: () => 'value' });
      return value;
    }],
    ['symbol key', () => {
      const value = checkpoint({ kind: 'WorkCtrlFlow', snapshot: {} });
      Object.assign(value.state as object, { [Symbol('state')]: true });
      return value;
    }],
    ['sparse array', () => checkpoint({
      kind: 'AIDataWorkflow',
      runGraph: { nodes: new Array(2) },
      ai: {},
    })],
    ['non-finite number', () => {
      const value = checkpoint({ kind: 'WorkCtrlFlow', snapshot: {} });
      (value.config as Record<string, unknown>).limit = Number.POSITIVE_INFINITY;
      return value;
    }],
    ['non-plain value', () => {
      const value = checkpoint({ kind: 'WorkCtrlFlow', snapshot: {} });
      value.output = new Date(0);
      return value;
    }],
    ['malformed WorkCtrl snapshot', () => checkpoint({
      kind: 'WorkCtrlFlow',
      snapshot: null,
    })],
    ['missing checkpoint identity', () => {
      const value = checkpoint({ kind: 'WorkCtrlFlow', snapshot: {} });
      delete value.runId;
      return value;
    }],
    ['unsupported checkpoint field', () => ({
      ...checkpoint({ kind: 'WorkCtrlFlow', snapshot: {} }),
      parallelAuthority: {},
    })],
    ['malformed definition digest', () => ({
      ...checkpoint({ kind: 'WorkCtrlFlow', snapshot: {} }),
      definition: { ...definitionIdentity(), digest: 'not-a-sha256-digest' },
    })],
    ['unknown profile kind', () => checkpoint({ kind: 'CustomProfile', state: {} })],
    ['explicit undefined metadata', () => ({
      ...checkpoint({ kind: 'WorkCtrlFlow', snapshot: {} }),
      definition: {
        ...definitionIdentity(),
        provenance: { authority: 'resource-package', artifactRef: 'resource://workflow', metadata: undefined },
      },
    })],
  ])('fails closed for %s', (_name, makeValue) => {
    expect(() => normalizeFlowRunCheckpoint(makeValue())).toThrow(FlowRunContractValidationError);
  });

  test('does not return a partially normalized value when a later field is malformed', () => {
    const value = checkpoint({ kind: 'AICtrlWorkflow', snapshot: {}, ai: {} });
    const input = value.input as Record<string, unknown>;
    Object.defineProperty(value.profile as object, 'ai', {
      enumerable: true,
      get: () => ({ copied: true }),
    });

    expect(() => normalizeFlowRunCheckpoint(value)).toThrow(FlowRunContractValidationError);
    expect(Object.isFrozen(input)).toBe(false);
  });

  test('publishes readonly checkpoint fields for generic and specialized consumers', () => {
    const normalized: AIWorkflowFlowRunCheckpoint = normalizeFlowRunCheckpoint(checkpoint({
      kind: 'WorkCtrlFlow',
      snapshot: workSnapshot(),
    }));
    expect(normalized.definition.revision).toBe('workflow-r1');
    expect(normalized.definition.digest).toBe(digest);
    expect(normalized.controllerSidecars.status).toBe('Waiting');
    expect(normalized.nodeSidecars).toEqual({ nodeResults: {}, waitResults: {} });
  });
});
