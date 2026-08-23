import { describe, expect, test } from 'bun:test';
import type {
  AIWorkflowEffectProvider,
  AIWorkflowEffectRequest,
  AIWorkflowRunEvent,
  AIWorkflowRunRef,
  AIWorkflowRunState,
  AIWorkflowStateStore,
  FlowRunCheckpointRuntime,
} from 'ai-workflow-contract';
import {
  createAICtrlWorkflowCheckpointStore,
  createAICtrlWorkflowController,
  loadAICtrlWorkflowCheckpoint,
  loadAICtrlWorkflowSources,
} from 'ai-ctrl-workflow-logic';
import { InMemoryFlowRunCheckpointStore } from 'ai-workflow-logic';

const definition = {
  revision: 'workflow-r1',
  digest: `sha256:${'b'.repeat(64)}` as const,
  provenance: {
    authority: 'resource-package',
    artifactRef: 'resource://depa.flows.test.CheckpointCtrl',
  },
};

const stateStore: AIWorkflowStateStore = {
  async loadRunState(): Promise<AIWorkflowRunState | undefined> { return undefined; },
  async saveRunState(): Promise<void> {},
  async appendRunEvent(_ref: AIWorkflowRunRef, _event: AIWorkflowRunEvent): Promise<void> {},
};

const effects: AIWorkflowEffectProvider = {
  async invoke<Input, Output>(_request: AIWorkflowEffectRequest<Input>): Promise<Output> {
    return undefined as Output;
  },
};

describe('AI Ctrl canonical checkpoint adapter', () => {
  test('restores a selected branch and wait from one checkpoint in a fresh controller', async () => {
    const loaded = loadAICtrlWorkflowSources({
      'manifest.xnl': `<AICtrlWorkflow #depa.flows.test.CheckpointCtrl apiVersion="depa.flows/v1" version="1" (
        <FlowContract #depa.flows.test.CheckpointCtrl>
      ) [
        <If #route (
          <Branches [
            <Branch #selected { when = "vfs://./flow-code.ts#select" } [
              <ExternalJob #hold { signalKind = "agent.completed" signalKey = "review" }>
            ]>
            <Otherwise #fallback []>
          ]>
        )>
        <Return #done>
      ]>`,
    }, { baseUri: 'app://flows/checkpoint-ctrl' });
    expect(loaded.diagnostics).toEqual([]);
    const runtime: FlowRunCheckpointRuntime = {
      checkpointStore: new InMemoryFlowRunCheckpointStore(),
    };
    const options = {
      instanceId: 'instance-ctrl-1',
      definition,
      config: { policy: 'standard' },
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
      projectOutput: (snapshot: { status: string }) => snapshot.status === 'Completed'
        ? { status: snapshot.status }
        : null,
    } as const;
    const store = createAICtrlWorkflowCheckpointStore(runtime, options);
    let predicateCalls = 0;
    const createController = () => createAICtrlWorkflowController({
      binding: loaded.binding!,
      store,
      resolveCode: async () => () => {
        predicateCalls += 1;
        return true;
      },
      ai: {
        roots: { globalRoot: 'vfs://global', workspaceRoot: 'vfs://workspace' },
        effects,
        stateStore,
      },
    });

    const originalStore = store;
    let observedPreNode = false;
    const guardedStore = {
      ...originalStore,
      async save(snapshot: Parameters<typeof originalStore.save>[0]) {
        await originalStore.save(snapshot);
      },
    };
    const createGuardedController = () => createAICtrlWorkflowController({
      binding: loaded.binding!,
      store: guardedStore,
      resolveCode: async () => async () => {
        const initial = await loadAICtrlWorkflowCheckpoint(runtime, {
          instanceId: 'instance-ctrl-1',
          runId: 'run-ctrl-1',
        });
        expect(initial?.version).toBe(0);
        expect(initial?.profile.snapshot.lastTickNo).toBe(0);
        observedPreNode = true;
        predicateCalls += 1;
        return true;
      },
      ai: {
        roots: { globalRoot: 'vfs://global', workspaceRoot: 'vfs://workspace' },
        effects,
        stateStore,
      },
    });

    const waiting = await createGuardedController().start('run-ctrl-1', { input: { request: 'review' } });
    expect(waiting.status).toBe('Waiting');
    expect(observedPreNode).toBe(true);
    expect(predicateCalls).toBe(1);
    const atWait = await loadAICtrlWorkflowCheckpoint(runtime, {
      instanceId: 'instance-ctrl-1',
      runId: 'run-ctrl-1',
    });
    expect(atWait?.profile.snapshot.branchDecisions['route#0']).toMatchObject({
      kind: 'Branch',
      branchKey: 'selected',
    });
    expect(atWait).toMatchObject({
      input: { request: 'review' },
      config: { policy: 'standard' },
      output: null,
      controllerSidecars: { status: 'Waiting' },
      nodeSidecars: { waitResults: {} },
    });
    expect(atWait?.profile.ai.instancesById['agent-instance-1'].sessionId).toBe('session-1');

    const handle = waiting.openWaitHandles[0];
    const completed = await createController().resume('run-ctrl-1', {
      signalKind: handle.signalKind,
      signalKey: handle.signalKey,
      resumeToken: handle.resumeToken,
      payload: { reviewed: true },
    });
    expect(completed.status).toBe('Completed');
    expect(predicateCalls).toBe(1);
    const restored = await loadAICtrlWorkflowCheckpoint(runtime, {
      instanceId: 'instance-ctrl-1',
      runId: 'run-ctrl-1',
    });
    expect(restored?.state).toMatchObject({});
    expect(restored?.profile.snapshot.status).toBe('Completed');
    expect(restored?.profile.snapshot.waitResults).not.toEqual({});
    expect(restored?.output).toEqual({ status: 'Completed' });
    expect(restored?.controllerSidecars).toMatchObject({ status: 'Completed' });
    expect(restored?.nodeSidecars).toMatchObject({
      waitResults: { 'hold#0': { result: 'Success', payload: { reviewed: true } } },
    });
    expect(restored?.version).toBeGreaterThan(atWait!.version);
  });
});
