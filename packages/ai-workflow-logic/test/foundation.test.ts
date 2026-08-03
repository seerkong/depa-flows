import { describe, expect, test } from 'bun:test';
import {
  AI_CTRL_WORKFLOW_DESCRIPTOR,
  AI_DATA_WORKFLOW_DESCRIPTOR,
  type AICtrlWorkflowDefinitionBinding,
  type AIDataWorkflowDefinitionBinding,
  type AIWorkflowEffectProvider,
  type AIWorkflowEffectRequest,
  type AIWorkflowRunEvent,
  type AIWorkflowRunRef,
  type AIWorkflowRunState,
  type AIWorkflowStateStore,
} from 'ai-workflow-contract';
import {
  createAIWorkflowRuntimeContext,
  defineAICtrlWorkflow,
  defineAIDataWorkflow,
  descriptorForAIWorkflowKind,
  invokeAIWorkflowEffect,
  resolveAIWorkflowReusePolicy,
} from 'ai-workflow-logic';

const workCtrlFlowBundle = (form: 'WorkCtrlFlow'): AICtrlWorkflowDefinitionBinding['definition'] => ({
  form,
  fqn: 'depa.flows.test.Agent',
  apiVersion: 'depa.flows/v1',
  version: '1',
  sourceNames: ['manifest.xnl'],
  dir: '',
  statements: [],
  flowContract: { id: 'depa.flows.test.Agent' },
  config: {},
  configDef: {},
  diagnostics: [],
});

const eagerPlan = (): AIDataWorkflowDefinitionBinding['definition'] => ({
  form: 'EagerDataFlow',
  fqn: 'depa.flows.test.Data',
  apiVersion: 'depa.flows/v1',
  version: '1',
  sourceNames: ['manifest.xnl'],
  contract: {
    id: 'depa.flows.test.Data',
    inputPorts: ['input'],
    outputPorts: ['output'],
  },
  nodes: [],
  nodeById: {},
  declarationOrder: [],
  dataEdges: [],
  waitForEdges: [],
  subflowEdges: [],
  diagnostics: [],
});

const runRef: AIWorkflowRunRef = {
  workflow: { ref: 'resource://depa.flows.test.Agent', scheme: 'resource' },
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

describe('AI workflow foundation', () => {
  test('binds AI workflow descriptors to the intended substrates', () => {
    expect(AI_CTRL_WORKFLOW_DESCRIPTOR).toMatchObject({
      kind: 'AICtrlWorkflow',
      substrate: 'WorkCtrlFlow',
      defaultReusePolicy: 'semantic-hash',
      manualNodeDefaultReusePolicy: 'never',
    });
    expect(AI_DATA_WORKFLOW_DESCRIPTOR).toMatchObject({
      kind: 'AIDataWorkflow',
      substrate: 'EagerDataFlow',
      defaultReusePolicy: 'semantic-hash',
      manualNodeDefaultReusePolicy: 'never',
    });
    expect(descriptorForAIWorkflowKind('AICtrlWorkflow').substrate).toBe('WorkCtrlFlow');
    expect(descriptorForAIWorkflowKind('AIDataWorkflow').substrate).toBe('EagerDataFlow');
  });

  test('creates definition bindings without changing substrates', () => {
    expect(defineAICtrlWorkflow(workCtrlFlowBundle('WorkCtrlFlow'))).toMatchObject({
      kind: 'AICtrlWorkflow',
      substrate: 'WorkCtrlFlow',
    });
    expect(defineAIDataWorkflow(eagerPlan())).toMatchObject({
      kind: 'AIDataWorkflow',
      substrate: 'EagerDataFlow',
    });
  });

  test('resolves node-level reuse policy defaults and records the source', () => {
    expect(resolveAIWorkflowReusePolicy({ nodeType: 'agent' })).toEqual({
      policy: 'semantic-hash',
      source: 'node-type-default',
      nodeType: 'agent',
    });
    expect(resolveAIWorkflowReusePolicy({ nodeType: 'manual' })).toEqual({
      policy: 'never',
      source: 'node-type-default',
      nodeType: 'manual',
    });
    expect(resolveAIWorkflowReusePolicy({ nodeType: 'agent', explicitPolicy: 'never' })).toEqual({
      policy: 'never',
      source: 'node',
      nodeType: 'agent',
    });
    expect(resolveAIWorkflowReusePolicy({ nodeType: 'agent', platformDefaultPolicy: 'never' })).toEqual({
      policy: 'never',
      source: 'platform-default',
      nodeType: 'agent',
    });
  });

  test('uses injected runtime roots, state store, and embedded effect provider', async () => {
    const calls: unknown[] = [];
    const effects: AIWorkflowEffectProvider = {
      async invoke<Input, Output>(request: AIWorkflowEffectRequest<Input>): Promise<Output> {
        calls.push(request);
        return { ok: true, input: request.input } as Output;
      },
    };
    const context = createAIWorkflowRuntimeContext({
      roots: {
        globalRoot: 'vfs://global/.eidolon',
        workspaceRoot: 'vfs://workspace/.eidolon',
      },
      effects,
      stateStore,
    });

    expect(context.roots).toEqual({
      globalRoot: 'vfs://global/.eidolon',
      workspaceRoot: 'vfs://workspace/.eidolon',
    });
    await expect(invokeAIWorkflowEffect(context, {
      effectId: 'ai.test',
      operation: 'review',
      input: { prompt: 'hello' },
      run: runRef,
    })).resolves.toEqual({ ok: true, input: { prompt: 'hello' } });
    expect(calls).toHaveLength(1);
  });
});
