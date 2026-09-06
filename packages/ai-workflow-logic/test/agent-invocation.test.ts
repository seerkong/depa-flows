import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  AIAgentHostEffectPort,
  AIAgentProcessorRuntime,
  AIWorkflowFlowRunCheckpoint,
  FlowRunCheckpointStore,
} from 'ai-workflow-contract';
import {
  AIAgentInvocationError,
  InMemoryFlowRunCheckpointStore,
  bindAIAgentProcessors,
  assertAIAgentNodeTaskBinding,
  commitFlowRunCheckpoint,
  normalizeAIAgentSelector,
  normalizeAIWorkflowProfileDurableState,
  runAgent,
  runTargetedAgent,
  upgradeLegacyAIWorkflowProfileDurableState,
} from 'ai-workflow-logic';
import { FilesystemFlowRunCheckpointStore } from 'ai-workflow-logic/checkpoint-filesystem';
import { materializeFlowInstance } from 'work-ctrl-flow-logic';

const definition = {
  revision: 'r1',
  digest: `sha256:${'a'.repeat(64)}` as const,
  provenance: { authority: 'resource-package', artifactRef: 'resource://demo.Flow' },
};

function checkpoint(ai: AIWorkflowFlowRunCheckpoint['profile'] extends infer _P ? any : never): AIWorkflowFlowRunCheckpoint {
  const snapshot = {
    schemaVersion: 'depa.flows.workflow/v4', treeId: 'flow-run', fqn: 'demo.Flow', status: 'Waiting',
    vars: {}, input: {}, branchDecisions: {}, nodeResults: {}, waitResults: {}, openWaitHandles: [],
    closedWaitHandles: [], appliedResumeSignals: [],
    orchestration: { attempts: {}, deadlines: {}, lanes: {}, winners: {}, cancellations: {}, composites: {} },
    lastTickNo: 0, updatedAtMs: 0,
  };
  return {
    schemaVersion: 'depa.flow-run-checkpoint/v1',
    instanceId: 'flow-instance',
    runId: 'flow-run',
    definition,
    version: 0,
    input: {},
    config: {},
    state: {},
    output: null,
    controllerSidecars: { status: 'Waiting', lastTickNo: 0, branchDecisions: {}, orchestration: snapshot.orchestration, openWaitHandles: [], closedWaitHandles: [], appliedResumeSignals: [] },
    nodeSidecars: { nodeResults: {}, waitResults: {} },
    profile: { kind: 'AICtrlWorkflow', snapshot, ai },
  };
}

function harness(initialAI = {
  schemaVersion: 'depa.ai-agent-state/v1',
  instancesById: {},
  instanceIdByName: {},
  invocationsByKey: {},
}) {
  let current = checkpoint(initialAI);
  const store: FlowRunCheckpointStore<any> = {
    async load() { return current; },
    async commit(input) {
      if (input.expectedVersion !== current.version) throw new Error('version conflict');
      current = structuredClone(input.checkpoint) as AIWorkflowFlowRunCheckpoint;
      return current;
    },
  };
  const calls: Array<{ kind: string; invocationKey: string; instanceId?: string }> = [];
  const effects: AIAgentHostEffectPort = {
    async runAgent(request) {
      calls.push({ kind: 'new', invocationKey: request.invocationKey });
      return {
        output: { text: 'draft' },
        instance: {
          authority: 'eidolon',
          instanceId: 'agent-1',
          instanceName: request.instanceName,
          sessionId: 'session-1',
        },
      };
    },
    async runTargetedAgent(request) {
      calls.push({ kind: 'targeted', invocationKey: request.invocationKey, instanceId: request.instance.instanceId });
      return { output: { text: 'refined' }, instance: request.instance };
    },
  };
  const runtime: AIAgentProcessorRuntime = {
    checkpointRuntime: { checkpointStore: store },
    checkpointKey: { instanceId: 'flow-instance', runId: 'flow-run' },
    nodeId: 'draft',
    invocationKey: 'draft#1',
    workflowKind: 'AICtrlWorkflow',
    workflowRef: 'resource://demo.Flow',
    taskBinding: {
      workflowKind: 'AICtrlWorkflow', workflowRef: 'resource://demo.Flow', nodeId: 'draft',
      agentDefinitionRef: 'resource://demo.Agent',
    },
    effects,
  };
  return { runtime, calls, read: () => current };
}

describe('typed Agent invocation processors', () => {
  test('normalizes the closed selector union before resolving state', () => {
    expect(normalizeAIAgentSelector({ byId: 'agent-1' })).toEqual({ byId: 'agent-1' });
    expect(normalizeAIAgentSelector({ byName: 'reviewer' })).toEqual({ byName: 'reviewer' });
    for (const selector of [{}, { byId: 'a', byName: 'b' }, { byId: '' }, { byId: 'a', extra: true }, { byInstanceId: 'a' }, { byInstanceName: 'a' }]) {
      expect(() => normalizeAIAgentSelector(selector)).toThrow(AIAgentInvocationError);
    }
  });

  test('upgrades legacy references only through the explicit read adapter', () => {
    const upgraded = upgradeLegacyAIWorkflowProfileDurableState({
      externalRuntimeRefs: { reviewer: { authority: 'eidolon', instanceId: 'agent-1' } },
      receipts: [{ nodeId: 'draft', externalRuntimeRef: 'reviewer' }],
    }, { reviewer: 'resource://demo.Agent' });
    expect(upgraded.instanceIdByName).toEqual({ reviewer: 'agent-1' });
    expect(upgraded.invocationsByKey['draft#legacy-1']?.status).toBe('completed');
  });

  test('proves the exact frozen task and ordinary node binding', () => {
    const task = {
      workflowKind: 'AICtrlWorkflow', workflowRef: 'resource://demo.Flow', nodeId: 'draft',
      agentDefinitionRef: 'resource://demo.Agent',
    } as const;
    expect(assertAIAgentNodeTaskBinding(task, {
      workflowKind: 'AICtrlWorkflow', workflowRef: 'resource://demo.Flow', nodeId: 'draft',
    }, { agentDefinitionRef: 'resource://demo.Agent' })).toEqual({ agentDefinitionRef: 'resource://demo.Agent' });
    expect(() => assertAIAgentNodeTaskBinding(task, {
      workflowKind: 'AICtrlWorkflow', workflowRef: 'resource://demo.Flow', nodeId: 'other',
    }, { agentDefinitionRef: 'resource://demo.Agent' })).toThrow(AIAgentInvocationError);
  });

  test('reserves a name, dispatches once, and reconstructs a completed result', async () => {
    const h = harness();
    const config = { agentDefinitionRef: 'resource://demo.Agent', instanceName: 'reviewer' } as const;
    const first = await runAgent(h.runtime, { prompt: 'draft' }, config);
    const second = await runAgent(h.runtime, { prompt: 'draft' }, config);

    expect(first).toEqual(second);
    expect(first.instance.instanceId).toBe('agent-1');
    expect(first.receipt).toEqual({ invocationKey: 'draft#1', nodeId: 'draft', status: 'completed' });
    expect(h.calls).toHaveLength(1);
    expect((h.read().profile as any).ai.instanceIdByName).toEqual({ reviewer: 'agent-1' });
  });

  test('resumes a pending invocation with the same key', async () => {
    const pending = {
      schemaVersion: 'depa.ai-agent-state/v1',
      instancesById: {},
      instanceIdByName: {},
      invocationsByKey: {
        'draft#1': {
          invocationKey: 'draft#1', nodeId: 'draft', status: 'pending', mode: 'new',
          agentDefinitionRef: 'resource://demo.Agent', instanceName: 'reviewer', input: { prompt: 'draft' },
          semanticFacts: { materialRefs: [], effectPolicy: null, invocationMetadata: null },
        },
      },
    };
    const h = harness(pending);
    await runAgent(h.runtime, { prompt: 'draft' }, {
      agentDefinitionRef: 'resource://demo.Agent', instanceName: 'reviewer',
    });
    expect(h.calls).toEqual([{ kind: 'new', invocationKey: 'draft#1' }]);
  });

  test('resolves an existing instance by name or id without creating another instance', async () => {
    const state = {
      schemaVersion: 'depa.ai-agent-state/v1',
      instancesById: {
        'agent-1': {
          authority: 'eidolon', instanceId: 'agent-1', instanceName: 'reviewer',
          sessionId: 'session-1', agentDefinitionRef: 'resource://demo.Agent',
        },
      },
      instanceIdByName: { reviewer: 'agent-1' },
      invocationsByKey: {},
    };
    for (const selector of [{ byName: 'reviewer' }, { byId: 'agent-1' }] as const) {
      const h = harness(state);
      const runtime = { ...h.runtime, nodeId: 'refine', invocationKey: `refine#${'byName' in selector ? 1 : 2}`, taskBinding: { ...h.runtime.taskBinding, nodeId: 'refine' } };
      const result = await runTargetedAgent(runtime, selector, { kind: 'ai.agent', payload: { prompt: 'refine' } }, {
        agentDefinitionRef: 'resource://demo.Agent',
      });
      expect(result.instance.instanceId).toBe('agent-1');
      expect(h.calls[0]?.kind).toBe('targeted');
    }
  });

  test('rejects unresolved and conflicting selectors before host dispatch', async () => {
    const h = harness();
    await expect(runTargetedAgent(h.runtime, { byName: 'missing' }, {
      kind: 'ai.agent', payload: {},
    }, { agentDefinitionRef: 'resource://demo.Agent' })).rejects.toMatchObject({
      code: 'AI_AGENT_INSTANCE_NAME_NOT_FOUND',
    });
    expect(h.calls).toHaveLength(0);
  });

  test('rejects indexed definition mismatch and nested runtime-owned metadata', () => {
    const base = {
      schemaVersion: 'depa.ai-agent-state/v1',
      instancesById: {
        'agent-1': { authority: 'eidolon', instanceId: 'agent-1', agentDefinitionRef: 'resource://demo.Agent', metadata: { safe: { value: true } } },
      },
      instanceIdByName: {},
      invocationsByKey: {
        'draft#1': { invocationKey: 'draft#1', nodeId: 'draft', status: 'completed', mode: 'targeted', agentDefinitionRef: 'resource://demo.Other', instanceId: 'agent-1', input: {}, semanticFacts: {}, output: {} },
      },
    };
    expect(() => normalizeAIWorkflowProfileDurableState(base)).toThrow(AIAgentInvocationError);
    expect(() => normalizeAIWorkflowProfileDurableState({
      ...base,
      instancesById: { 'agent-1': { ...base.instancesById['agent-1'], metadata: { safe: { history: [] } } } },
      invocationsByKey: {},
    })).toThrow(AIAgentInvocationError);
  });

  test('binds material, policy and invocation metadata to one invocation key', async () => {
    const state = {
      schemaVersion: 'depa.ai-agent-state/v1',
      instancesById: { 'agent-1': { authority: 'eidolon', instanceId: 'agent-1', agentDefinitionRef: 'resource://demo.Agent' } },
      instanceIdByName: {}, invocationsByKey: {},
    };
    const h = harness(state);
    const runtime = { ...h.runtime, nodeId: 'refine', invocationKey: 'refine#1', taskBinding: { ...h.runtime.taskBinding, nodeId: 'refine' } };
    await runTargetedAgent(runtime, { byId: 'agent-1' }, { kind: 'ai.agent', payload: {}, metadata: { phase: 'one' } }, {
      agentDefinitionRef: 'resource://demo.Agent', materialRefs: ['resource://demo.Material'], effectPolicy: { mode: 'declared' },
    });
    await expect(runTargetedAgent(runtime, { byId: 'agent-1' }, { kind: 'ai.agent', payload: {}, metadata: { phase: 'two' } }, {
      agentDefinitionRef: 'resource://demo.Agent', materialRefs: ['resource://demo.Material'], effectPolicy: { mode: 'declared' },
    })).rejects.toMatchObject({ code: 'AI_AGENT_INVOCATION_KEY_CONFLICT' });
    expect(h.calls).toHaveLength(1);
  });

  test('recovers pending and completed semantic facts through a fresh filesystem store', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-semantic-facts-'));
    const definitionDir = path.join(root, 'source');
    fs.mkdirSync(definitionDir);
    fs.writeFileSync(path.join(definitionDir, 'manifest.xnl'), '<WorkCtrlFlow #demo.Flow apiVersion="depa.flows/v1" version="1" (<FlowContract #demo.Flow>) [<Return #done>]>');
    const instance = materializeFlowInstance({
      definitionDir,
      instancesDir: path.join(root, 'instances'),
      instanceId: 'flow-instance',
      source: { revision: 'r1', provenance: { authority: 'resource-package', artifactRef: 'resource://demo.Flow' } },
    });
    const semanticFacts = {
      materialRefs: ['resource://demo.Material'],
      effectPolicy: { mode: 'declared' },
      invocationMetadata: { phase: 'one' },
    };
    const ai = {
      schemaVersion: 'depa.ai-agent-state/v1',
      instancesById: { 'agent-1': { authority: 'eidolon', instanceId: 'agent-1', instanceName: 'reviewer', agentDefinitionRef: 'resource://demo.Agent' } },
      instanceIdByName: { reviewer: 'agent-1' },
      invocationsByKey: {
        'refine#1': { invocationKey: 'refine#1', nodeId: 'refine', status: 'pending', mode: 'targeted', agentDefinitionRef: 'resource://demo.Agent', instanceId: 'agent-1', instanceName: 'reviewer', input: {}, semanticFacts },
      },
    } as const;
    const store = new FilesystemFlowRunCheckpointStore({ storeRoot: root });
    await store.commit({ expectedVersion: null, checkpoint: { ...checkpoint(ai), definition: instance.descriptor.definition } });
    let dispatches = 0;
    const runtime = (): AIAgentProcessorRuntime => ({
      checkpointRuntime: { checkpointStore: new FilesystemFlowRunCheckpointStore({ storeRoot: root }) },
      checkpointKey: { instanceId: 'flow-instance', runId: 'flow-run' }, nodeId: 'refine', invocationKey: 'refine#1',
      workflowKind: 'AICtrlWorkflow', workflowRef: 'resource://demo.Flow',
      taskBinding: { workflowKind: 'AICtrlWorkflow', workflowRef: 'resource://demo.Flow', nodeId: 'refine', agentDefinitionRef: 'resource://demo.Agent' },
      effects: {
        async runAgent() { throw new Error('unexpected new Agent dispatch'); },
        async runTargetedAgent(request) { dispatches += 1; return { output: { text: 'done' }, instance: request.instance }; },
      },
    });
    const invocation = { kind: 'ai.agent', payload: {}, metadata: { phase: 'one' } } as const;
    const config = { agentDefinitionRef: 'resource://demo.Agent', materialRefs: ['resource://demo.Material'], effectPolicy: { mode: 'declared' } } as const;
    await runTargetedAgent(runtime(), { byName: 'reviewer' }, invocation, config);
    await runTargetedAgent(runtime(), { byName: 'reviewer' }, invocation, config);
    for (const [changedInvocation, changedConfig] of [
      [invocation, { ...config, materialRefs: ['resource://demo.Other'] }],
      [invocation, { ...config, effectPolicy: { mode: 'other' } }],
      [{ ...invocation, metadata: { phase: 'two' } }, config],
    ] as const) {
      await expect(runTargetedAgent(runtime(), { byName: 'reviewer' }, changedInvocation, changedConfig))
        .rejects.toMatchObject({ code: 'AI_AGENT_INVOCATION_KEY_CONFLICT' });
    }
    expect(dispatches).toBe(1);
  });

  test('requires exact frozen task authority before host dispatch', async () => {
    const h = harness();
    const runtime = { ...h.runtime, taskBinding: undefined } as unknown as AIAgentProcessorRuntime;
    await expect(runAgent(runtime, {}, { agentDefinitionRef: 'resource://demo.Agent' })).rejects.toMatchObject({
      code: 'AI_AGENT_TASK_BINDING_REQUIRED',
    });
    expect(h.calls).toHaveLength(0);
  });

  test('same-named bound methods delegate to runtime-first processors', async () => {
    const h = harness();
    const effects = bindAIAgentProcessors(h.runtime);
    expect('invoke' in effects).toBe(false);
    const result = await effects.runAgent({ prompt: 'draft' }, {
      agentDefinitionRef: 'resource://demo.Agent', instanceName: 'reviewer',
    });
    expect(result.instance.instanceId).toBe('agent-1');
  });

  test('persists pending and completed facts through the canonical checkpoint transition gate', async () => {
    const store = new InMemoryFlowRunCheckpointStore();
    await commitFlowRunCheckpoint({ checkpointStore: store }, { expectedVersion: null, checkpoint: checkpoint({
      schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {},
    }) });
    let dispatches = 0;
    const runtime: AIAgentProcessorRuntime = {
      checkpointRuntime: { checkpointStore: store }, checkpointKey: { instanceId: 'flow-instance', runId: 'flow-run' },
      nodeId: 'draft', invocationKey: 'draft#1',
      workflowKind: 'AICtrlWorkflow', workflowRef: 'resource://demo.Flow',
      taskBinding: { workflowKind: 'AICtrlWorkflow', workflowRef: 'resource://demo.Flow', nodeId: 'draft', agentDefinitionRef: 'resource://demo.Agent' },
      effects: {
        async runAgent() { dispatches += 1; return { output: { text: 'ready' }, instance: { authority: 'eidolon', instanceId: 'agent-1', instanceName: 'reviewer' } }; },
        async runTargetedAgent(request) { return { output: {}, instance: request.instance }; },
      },
    };
    await runAgent(runtime, {}, { agentDefinitionRef: 'resource://demo.Agent', instanceName: 'reviewer' });
    await runAgent(runtime, {}, { agentDefinitionRef: 'resource://demo.Agent', instanceName: 'reviewer' });
    expect(dispatches).toBe(1);
    expect((await store.load(runtime.checkpointKey))?.version).toBe(2);
  });
});
