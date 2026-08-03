import { describe, expect, test } from 'bun:test';
import type {
  AIWorkflowEffectRequest,
  AIWorkflowRunEvent,
  AIWorkflowRunRef,
  AIWorkflowRunState,
  AIWorkflowStateStore,
} from 'ai-workflow-contract';
import {
  AIWorkflowEffectHandlerNotFoundError,
  createAIWorkflowEffectHandlerRegistry,
  createAIWorkflowRuntimeContext,
  createEmbeddedAIWorkflowEffectProvider,
  invokeAIWorkflowEffect,
} from 'ai-workflow-logic';

const runRef: AIWorkflowRunRef = {
  workflow: { ref: 'resource://depa.flows.test.Agent', scheme: 'resource' },
  runId: 'run-1',
  generation: 0,
};

const roots = {
  globalRoot: 'vfs://global/.eidolon',
  workspaceRoot: 'vfs://workspace/.eidolon',
};

const stateStore: AIWorkflowStateStore = {
  async loadRunState(): Promise<AIWorkflowRunState | undefined> {
    return undefined;
  },
  async saveRunState(_state: AIWorkflowRunState): Promise<void> {},
  async appendRunEvent(_ref: AIWorkflowRunRef, _event: AIWorkflowRunEvent): Promise<void> {},
};

describe('embedded AI workflow effect provider', () => {
  test('dispatches registered operation handlers with request and injected roots', async () => {
    const calls: unknown[] = [];
    const dispatches: AIWorkflowEffectRequest[] = [];
    const results: unknown[] = [];
    const controller = new AbortController();
    const provider = createEmbeddedAIWorkflowEffectProvider({
      roots,
      metadata: { runtime: 'test' },
      handlers: {
        'ai.review': (request, context) => {
          calls.push({ request, context });
          return {
            ok: true,
            input: request.input,
            nodeId: request.nodeId,
            materialRefs: request.materialRefs,
            config: request.config,
            aborted: request.signal?.aborted ?? false,
            workspaceRoot: context.roots.workspaceRoot,
            metadata: context.metadata,
          };
        },
      },
      onDispatch: (request) => dispatches.push(request),
      onResult: (_request, result) => results.push(result),
    });
    const context = createAIWorkflowRuntimeContext({
      roots,
      effects: provider,
      stateStore,
    });

    const output = await invokeAIWorkflowEffect(context, {
      effectId: 'effect-1',
      operation: 'ai.review',
      input: { prompt: 'hello' },
      config: { temperature: 0 },
      run: runRef,
      nodeId: 'review',
      materialRefs: ['resource://depa.flows.test.Material'],
      signal: controller.signal,
    });

    expect(output).toEqual({
      ok: true,
      input: { prompt: 'hello' },
      nodeId: 'review',
      materialRefs: ['resource://depa.flows.test.Material'],
      config: { temperature: 0 },
      aborted: false,
      workspaceRoot: 'vfs://workspace/.eidolon',
      metadata: { runtime: 'test' },
    });
    expect(calls).toHaveLength(1);
    expect(dispatches.map((request) => request.effectId)).toEqual(['effect-1']);
    expect(results).toHaveLength(1);
  });

  test('supports mutable handler registration and stable missing handler failures', async () => {
    const registry = createAIWorkflowEffectHandlerRegistry();
    expect(registry.hasHandler('ai.plan')).toBe(false);
    registry.registerHandler('ai.plan', (request) => ({ planned: request.input }));
    expect(registry.hasHandler('ai.plan')).toBe(true);
    expect(registry.listOperations()).toEqual(['ai.plan']);

    const provider = createEmbeddedAIWorkflowEffectProvider({ roots, registry });
    await expect(provider.invoke({
      effectId: 'effect-2',
      operation: 'ai.plan',
      input: { goal: 'ship' },
      run: runRef,
    })).resolves.toEqual({ planned: { goal: 'ship' } });

    registry.unregisterHandler('ai.plan');
    try {
      await provider.invoke({
        effectId: 'effect-3',
        operation: 'ai.plan',
        input: {},
        run: runRef,
      });
      throw new Error('expected missing handler');
    } catch (error) {
      expect(error).toBeInstanceOf(AIWorkflowEffectHandlerNotFoundError);
      expect((error as AIWorkflowEffectHandlerNotFoundError).operation).toBe('ai.plan');
      expect((error as AIWorkflowEffectHandlerNotFoundError).effectId).toBe('effect-3');
    }
  });
});
