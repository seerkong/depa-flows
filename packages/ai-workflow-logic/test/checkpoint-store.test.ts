import { describe, expect, test } from 'bun:test';
import type {
  AIWorkflowFlowRunCheckpoint,
  FlowRunCheckpointRuntime,
} from 'ai-workflow-contract';
import {
  createInitialRunStepExtensions,
  FlowRunCheckpointVersionConflictError,
  FlowRunCheckpointTransitionError,
  InMemoryFlowRunCheckpointStore,
  commitFlowRunCheckpoint,
  loadFlowRunCheckpoint,
  projectFlowRunCheckpoint,
} from 'ai-workflow-logic';

const definition = {
  revision: 'workflow-r1',
  digest: `sha256:${'a'.repeat(64)}` as const,
  provenance: {
    authority: 'resource-package',
    artifactRef: 'resource://depa.flows.test.Checkpoint',
  },
};

function checkpoint(version: number, state: string): AIWorkflowFlowRunCheckpoint {
  return {
    schemaVersion: 'depa.flow-run-checkpoint/v1',
    instanceId: 'instance-1',
    runId: 'run-1',
    definition,
    version,
    input: { request: 'prepare' },
    config: { mode: 'review' },
    state: { phase: state },
    output: state === 'Completed' ? { result: 'ready' } : null,
    controllerSidecars: {
      status: state,
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
        treeId: 'run-1',
        fqn: 'depa.flows.test.Checkpoint',
        status: state,
        vars: { phase: state },
        input: { request: 'prepare' },
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
      ai: {
        schemaVersion: 'depa.ai-agent-state/v1',
        instancesById: {
          'agent-instance-1': {
            authority: 'eidolon',
            instanceId: 'agent-instance-1',
            instanceName: 'reviewer',
            sessionId: 'session-1',
            agentDefinitionRef: 'resource://demo.Agent',
          },
        },
        instanceIdByName: { reviewer: 'agent-instance-1' },
        invocationsByKey: {},
      },
    },
  };
}

describe('canonical FlowRunCheckpoint store', () => {
  test('freezes ForEach budget and item provenance in the canonical owner and rejects corrupt expansion', async () => {
    function expanded(version: number, budget = 2, item = 'first', started = true): AIWorkflowFlowRunCheckpoint {
      const value = checkpoint(version, 'Waiting');
      if (value.profile.kind !== 'AICtrlWorkflow') throw Error('test requires Ctrl profile');
      const orchestration = {
        attempts: {}, deadlines: {}, winners: {}, cancellations: {},
        lanes: { 'map#0/0': { invocationKey: 'map#0', laneId: '0', bodyId: 'item:0', status: 'Open', item, started } },
        composites: { 'map#0': { invocationKey: 'map#0', primitive: 'ForEach', bodyId: 'body', status: 'Waiting', updatedAtMs: version, expansion: { itemCount: 1, maxItems: budget, concurrency: 1 } } },
      };
      return { ...value, controllerSidecars: { ...value.controllerSidecars, orchestration }, profile: { ...value.profile, snapshot: { ...value.profile.snapshot, orchestration } } };
    }
    const store = new InMemoryFlowRunCheckpointStore();
    await store.commit({ expectedVersion: null, checkpoint: expanded(0) });
    for (const candidate of [expanded(1, 3), expanded(1, 2, 'changed'), expanded(1, 2, 'first', false)]) {
      await expect(store.commit({ expectedVersion: 0, checkpoint: candidate })).rejects.toBeInstanceOf(FlowRunCheckpointTransitionError);
    }
    await expect(store.commit({ expectedVersion: 0, checkpoint: expanded(1) })).resolves.toMatchObject({ version: 1 });
  });
  test('compares Unicode extension membership by explicit code-unit order', async () => {
    const extensionCodecs = {
      resolve: (kind: string) => kind === 'example.note' ? {
        codec: { normalize: (value: any) => value },
      } : undefined,
    };
    const authority = {
      profileKind: 'AICtrlWorkflow' as const,
      definitionStepIds: ['中-step', 'z-step', 'ä-step'],
      extensionsByStepId: Object.fromEntries(['中-step', 'z-step', 'ä-step'].map((stepId) => [stepId, {
        'example.note': { initialValue: { note: stepId } },
      }])),
    };
    const store = new InMemoryFlowRunCheckpointStore({
      extensionCodecs,
      profileAuthority: { load: () => authority },
    });
    const initial = {
      ...checkpoint(0, 'Waiting'),
      stepExtensions: createInitialRunStepExtensions(authority),
    };
    await store.commit({ expectedVersion: null, checkpoint: initial });
    const reversed = Object.fromEntries(Object.entries(initial.stepExtensions!.byStepId).reverse());
    const accepted = await store.commit({
      expectedVersion: 0,
      checkpoint: {
        ...checkpoint(1, 'Waiting'),
        stepExtensions: { ...initial.stepExtensions!, byStepId: reversed },
      },
    });
    expect(Object.keys(accepted.stepExtensions!.byStepId)).toEqual(['z-step', 'ä-step', '中-step']);
  });

  test('commits the complete checkpoint with one compare-and-swap version', async () => {
    const runtime: FlowRunCheckpointRuntime = {
      checkpointStore: new InMemoryFlowRunCheckpointStore(),
    };

    await commitFlowRunCheckpoint(runtime, {
      expectedVersion: null,
      checkpoint: checkpoint(0, 'Waiting'),
    });
    const committed = await commitFlowRunCheckpoint(runtime, {
      expectedVersion: 0,
      checkpoint: checkpoint(1, 'Completed'),
    });

    expect(committed.version).toBe(1);
    expect(committed).toMatchObject({
      input: { request: 'prepare' },
      config: { mode: 'review' },
      state: { phase: 'Completed' },
      output: { result: 'ready' },
      controllerSidecars: { status: 'Completed', lastTickNo: 1 },
      nodeSidecars: { nodeResults: {}, waitResults: {} },
      profile: { kind: 'AICtrlWorkflow' },
    });
    await expect(commitFlowRunCheckpoint(runtime, {
      expectedVersion: 0,
      checkpoint: checkpoint(1, 'Waiting'),
    })).rejects.toBeInstanceOf(FlowRunCheckpointVersionConflictError);
  });

  test('returns immutable read projections that cannot backwrite canonical state', async () => {
    const runtime: FlowRunCheckpointRuntime = {
      checkpointStore: new InMemoryFlowRunCheckpointStore(),
    };
    await commitFlowRunCheckpoint(runtime, {
      expectedVersion: null,
      checkpoint: checkpoint(0, 'Waiting'),
    });

    const view = await projectFlowRunCheckpoint(runtime, {
      instanceId: 'instance-1',
      runId: 'run-1',
    });
    expect(Object.isFrozen(view)).toBe(true);
    expect(() => {
      (view!.state as { phase: string }).phase = 'Changed';
    }).toThrow();
    expect((await loadFlowRunCheckpoint(runtime, {
      instanceId: 'instance-1',
      runId: 'run-1',
    }))?.state).toEqual({ phase: 'Waiting' });
  });

  test('keeps external runtime state as opaque references and rejects copied history', async () => {
    const runtime: FlowRunCheckpointRuntime = {
      checkpointStore: new InMemoryFlowRunCheckpointStore(),
    };
    const malformed = checkpoint(0, 'Waiting') as unknown as Record<string, any>;
    malformed.profile.ai.instancesById['agent-instance-1'].history = [
      { role: 'user', content: 'not canonical workflow state' },
    ];

    await expect(commitFlowRunCheckpoint(runtime, {
      expectedVersion: null,
      checkpoint: malformed as AIWorkflowFlowRunCheckpoint,
    })).rejects.toMatchObject({
      code: 'AI_AGENT_FIELD_UNSUPPORTED',
      location: 'checkpoint.profile.ai.instancesById.agent-instance-1.history',
    });
  });

  test.each([
    ['definition', (next: AIWorkflowFlowRunCheckpoint) => ({ ...next, definition: { ...next.definition, revision: 'workflow-r2' } })],
    ['input', (next: AIWorkflowFlowRunCheckpoint) => ({
      ...next,
      input: { request: 'changed' },
      profile: {
        ...next.profile,
        snapshot: { ...(next.profile as any).snapshot, input: { request: 'changed' } },
      },
    })],
    ['config', (next: AIWorkflowFlowRunCheckpoint) => ({ ...next, config: { mode: 'changed' } })],
    ['profile kind', (next: AIWorkflowFlowRunCheckpoint) => ({ ...next, profile: { kind: 'WorkCtrlFlow', snapshot: (next.profile as any).snapshot } })],
  ])('rejects a transition that rewrites immutable %s authority', async (_name, change) => {
    const store = new InMemoryFlowRunCheckpointStore();
    await store.commit({ expectedVersion: null, checkpoint: checkpoint(0, 'Waiting') });
    const next = change(checkpoint(1, 'Waiting')) as AIWorkflowFlowRunCheckpoint;
    await expect(store.commit({ expectedVersion: 0, checkpoint: next }))
      .rejects.toBeInstanceOf(FlowRunCheckpointTransitionError);
  });

  test.each([
    ['schema', (next: AIWorkflowFlowRunCheckpoint) => ({ ...next, schemaVersion: 'depa.flow-run-checkpoint/v2' })],
    ['instance', (next: AIWorkflowFlowRunCheckpoint) => ({ ...next, instanceId: 'instance-2' })],
    ['run', (next: AIWorkflowFlowRunCheckpoint) => ({ ...next, runId: 'run-2', profile: { ...next.profile, snapshot: { ...(next.profile as any).snapshot, treeId: 'run-2' } } })],
  ])('fails closed when %s key authority is changed', async (_name, change) => {
    const store = new InMemoryFlowRunCheckpointStore();
    await store.commit({ expectedVersion: null, checkpoint: checkpoint(0, 'Waiting') });
    await expect(store.commit({
      expectedVersion: 0,
      checkpoint: change(checkpoint(1, 'Waiting')) as AIWorkflowFlowRunCheckpoint,
    })).rejects.toThrow();
  });

  test('rejects reopening or rewriting a terminal checkpoint', async () => {
    const store = new InMemoryFlowRunCheckpointStore();
    await store.commit({ expectedVersion: null, checkpoint: checkpoint(0, 'Completed') });
    await expect(store.commit({ expectedVersion: 0, checkpoint: checkpoint(1, 'Waiting') }))
      .rejects.toBeInstanceOf(FlowRunCheckpointTransitionError);
    await expect(store.commit({ expectedVersion: 0, checkpoint: checkpoint(1, 'Failed') }))
      .rejects.toBeInstanceOf(FlowRunCheckpointTransitionError);
    await expect(store.commit({ expectedVersion: 0, checkpoint: checkpoint(1, 'Completed') }))
      .rejects.toBeInstanceOf(FlowRunCheckpointTransitionError);
  });
});
