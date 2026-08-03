import { describe, expect, test } from 'bun:test';
import type { FlowBundleSpec, FlowCodeResolver, FlowNodeSpec } from 'instant-ctrl-flow-contract';
import type {
  AIWorkflowEffectProvider,
  AIWorkflowEffectRequest,
  AIWorkflowRunEvent,
  AIWorkflowRunRef,
  AIWorkflowRunState,
  AIWorkflowStateStore,
} from 'ai-workflow-contract';
import {
  createAICtrlWorkflowController,
  defineWorkCtrlFlowBackedAICtrlWorkflow,
  resumeAICtrlWorkflowRun,
  startAICtrlWorkflowRun,
} from 'ai-ctrl-workflow-logic';
import { InMemoryWorkCtrlFlowStore } from 'work-ctrl-flow-logic';

const flowNode = (
  tag: string,
  id: string,
  attrs: Record<string, unknown> = {},
): FlowNodeSpec => ({
  tag,
  id,
  metadata: {},
  attrs,
  children: [],
  sections: {},
});

const workCtrlFlowSpec = (statements: FlowNodeSpec[]): FlowBundleSpec => ({
  form: 'WorkCtrlFlow',
  fqn: 'depa.flows.test.AgentWorkflow',
  apiVersion: 'depa.flows/v1',
  version: '1',
  sourceNames: ['manifest.xnl'],
  dir: '',
  statements,
  flowContract: { id: 'depa.flows.test.AgentWorkflow' },
  config: {},
  configDef: {},
  diagnostics: [],
});

const runRef: AIWorkflowRunRef = {
  workflow: { ref: 'resource://depa.flows.test.AgentWorkflow', scheme: 'resource' },
  runId: 'run-1',
  generation: 0,
};

const stateStore: AIWorkflowStateStore = {
  async loadRunState(): Promise<AIWorkflowRunState | undefined> {
    return undefined;
  },
  async saveRunState(): Promise<void> {},
  async appendRunEvent(_ref: AIWorkflowRunRef, _event: AIWorkflowRunEvent): Promise<void> {},
};

const effects: AIWorkflowEffectProvider = {
  async invoke<Input, Output>(_request: AIWorkflowEffectRequest<Input>): Promise<Output> {
    return undefined as Output;
  },
};

function aiContext() {
  return {
    roots: {
      globalRoot: 'vfs://global/.eidolon',
      workspaceRoot: 'vfs://workspace/.eidolon',
    },
    effects,
    stateStore,
  };
}

describe('AI Ctrl Workflow runtime adapter', () => {
  test('starts a WorkCtrlFlow-backed AI agent run and projects node records', async () => {
    const binding = defineWorkCtrlFlowBackedAICtrlWorkflow(workCtrlFlowSpec([
      flowNode('Run', 'review', { src: 'vfs://./agent.ts#review' }),
      flowNode('Return', 'done', { src: 'vfs://./agent.ts#done' }),
    ]));
    const resolveCode: FlowCodeResolver = async ({ reference }) => {
      const name = reference.slice(reference.lastIndexOf('#') + 1);
      if (name === 'review') return (_runtime, input) => ({ reviewed: input });
      if (name === 'done') return (_runtime, input) => ({ result: input });
      throw new Error(`missing export ${name}`);
    };
    const store = new InMemoryWorkCtrlFlowStore();
    const controller = createAICtrlWorkflowController({
      binding,
      store,
      ai: aiContext(),
      resolveCode,
    });

    const record = await startAICtrlWorkflowRun(controller, 'tree-1', { input: { prompt: 'hello' } });

    expect(record.status).toBe('Completed');
    expect(record.openWaitHandles).toEqual([]);
    expect(record.nodes.map((node) => node.nodeId)).toEqual(['review', 'done']);
    expect(record.nodes.every((node) => node.status === 'Succeeded')).toBe(true);
  });

  test('resumes waiting AI agent run through WorkCtrlFlow ResumeSignal', async () => {
    const binding = defineWorkCtrlFlowBackedAICtrlWorkflow(workCtrlFlowSpec([
      flowNode('ExternalJob', 'agent-review', {
        signalKind: 'agent.done',
        signalKey: 'review',
      }),
      flowNode('Return', 'done'),
    ]));
    const store = new InMemoryWorkCtrlFlowStore();
    const controller = createAICtrlWorkflowController({
      binding,
      store,
      ai: aiContext(),
      resolveCode: async () => () => undefined,
    });

    const waiting = await startAICtrlWorkflowRun(controller, 'tree-2', { input: { prompt: 'hello' } });

    expect(waiting.status).toBe('Waiting');
    expect(waiting.openWaitHandles).toHaveLength(1);
    expect(waiting.nodes).toMatchObject([
      { nodeId: 'agent-review', status: 'Waiting' },
    ]);

    const [handle] = waiting.openWaitHandles;
    const completed = await resumeAICtrlWorkflowRun(controller, 'tree-2', {
      signalKind: handle.signalKind,
      signalKey: handle.signalKey,
      resumeToken: handle.resumeToken,
      payload: { approved: true },
    });

    expect(completed.status).toBe('Completed');
    expect(completed.openWaitHandles).toEqual([]);
    expect(completed.nodes.find((node) => node.nodeId === 'agent-review')?.status).toBe('Succeeded');
  });
});
