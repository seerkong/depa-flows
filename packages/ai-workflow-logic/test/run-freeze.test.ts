import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import {
  composeLayeredResourceRegistry,
  loadResourceTree,
  resolveEffectiveResourceContentIdentities,
} from 'halfcode-compiler.xnl/resource-core';
import { projectAIWorkflowAgentResources } from 'ai-workflow-logic';
import {
  AIWorkflowRunResourceFreezeError,
  freezeAIWorkflowRunResources,
  projectFrozenAIAgentTaskBinding,
} from 'ai-workflow-logic/run-freeze';

const fixtureRoot = join(import.meta.dir, 'fixtures/HalfcodeAIAgentResourcePackage');
const unrelatedOverlayRoot = join(import.meta.dir, 'fixtures/HalfcodeAIAgentUnrelatedOverlay');
const selectedOverlayRoot = join(import.meta.dir, 'fixtures/HalfcodeAIAgentSelectedOverlay');
const executableOverlayRoot = join(import.meta.dir, 'fixtures/HalfcodeAIAgentExecutableOverlay');
const dynamicOverlayRoot = join(import.meta.dir, 'fixtures/HalfcodeAIAgentDynamicOverlay');

describe('AI workflow run resource freeze', () => {
  test('delegates closure proof to Halfcode and returns an immutable ordered receipt', async () => {
    const tree = await loadResourceTree({ rootDir: fixtureRoot });
    const registry = composeLayeredResourceRegistry({ layers: [{ id: 'workspace', tree }] });
    const contentIdentities = resolveEffectiveResourceContentIdentities({
      registry,
      layers: [{ id: 'workspace', tree }],
    });
    const projection = projectAIWorkflowAgentResources(registry);
    const task = {
      workflowKind: 'AICtrlWorkflow' as const,
      workflowRef: 'resource://depa.flows.test.Workflow.Support' as const,
      nodeId: 'collect-request',
      agentDefinitionRef: 'resource://depa.flows.test.Agent.Support' as const,
    };

    const receipt = freezeAIWorkflowRunResources({ registry, projection, task, contentIdentities });
    const taskProof = projectFrozenAIAgentTaskBinding(receipt);

    expect(receipt.schemaVersion).toBe('ai-workflow.run-resource-freeze/v1');
    expect(Object.keys(receipt.task)).toEqual([
      'workflowKind',
      'workflowRef',
      'nodeId',
      'agentDefinitionRef',
    ]);
    expect(receipt.bindingResourceIds).toEqual([
      'depa.flows.test.Binding.Request',
      'depa.flows.test.Binding.Context.A',
      'depa.flows.test.Binding.Context.B',
    ]);
    expect(receipt.dependencySnapshot.roots).toEqual([
      'depa.flows.test.Workflow.Support',
      'depa.flows.test.Agent.Support',
      'depa.flows.test.Binding.Request',
      'depa.flows.test.Binding.Context.A',
      'depa.flows.test.Binding.Context.B',
    ]);
    expect(receipt.dependencySnapshot.closure.map((item) => item.resourceId)).toContain(
      'depa.flows.test.Prompt.System',
    );
    expect(receipt.dependencySnapshot.closure.map((item) => item.resourceId)).toContain(
      'depa.flows.test.MessageSource.Workspace',
    );
    expect(receipt.dependencySnapshot.closure.map((item) => item.resourceId)).toContain(
      'depa.flows.test.ContextPipeline.Standard',
    );
    expect(receipt.semanticFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.isFrozen(receipt.task)).toBe(true);
    expect(Object.isFrozen(receipt.bindingResourceIds)).toBe(true);
    expect(Object.isFrozen(receipt.dependencySnapshot)).toBe(true);
    expect(Object.isFrozen(receipt.dependencySnapshot.closure)).toBe(true);
    expect(taskProof.task).toBe(receipt.task);
    expect(taskProof.snapshotRevision).toBe(receipt.dependencySnapshot.snapshotRevision);
    expect(() => projectFrozenAIAgentTaskBinding({ ...receipt })).toThrow(AIWorkflowRunResourceFreezeError);
  });

  test('fails closed when one-valued required material is not bound', async () => {
    const tree = await loadResourceTree({ rootDir: fixtureRoot });
    const registry = composeLayeredResourceRegistry({ layers: [{ id: 'workspace', tree }] });
    const contentIdentities = resolveEffectiveResourceContentIdentities({
      registry,
      layers: [{ id: 'workspace', tree }],
    });
    const projection = projectAIWorkflowAgentResources(registry);

    expectFreezeError(() => freezeAIWorkflowRunResources({
      registry,
      projection,
      task: {
        workflowKind: 'AICtrlWorkflow',
        workflowRef: 'resource://depa.flows.test.Workflow.Support',
        nodeId: 'missing-case',
        agentDefinitionRef: 'resource://depa.flows.test.Agent.Support',
      },
      contentIdentities,
    }), 'AI_RUN_REQUIRED_MATERIAL_MISSING');
  });

  test('freezes the same Agent definition for an exact AIDataWorkflow task', async () => {
    const tree = await loadResourceTree({ rootDir: fixtureRoot });
    const registry = composeLayeredResourceRegistry({ layers: [{ id: 'workspace', tree }] });
    const contentIdentities = resolveEffectiveResourceContentIdentities({
      registry,
      layers: [{ id: 'workspace', tree }],
    });
    const projection = projectAIWorkflowAgentResources(registry);
    const receipt = freezeAIWorkflowRunResources({
      registry,
      projection,
      task: {
        workflowKind: 'AIDataWorkflow',
        workflowRef: 'resource://depa.flows.test.DataWorkflow.Support',
        nodeId: 'transform-request',
        agentDefinitionRef: 'resource://depa.flows.test.Agent.Support',
      },
      contentIdentities,
    });

    expect(receipt.task.workflowKind).toBe('AIDataWorkflow');
    expect(receipt.bindingResourceIds).toEqual(['depa.flows.test.Binding.Data.Request']);
    expect(receipt.dependencySnapshot.closure.map((item) => item.resourceId)).toContain(
      'depa.flows.test.DataWorkflow.Support',
    );
  });

  test('keeps the pure browser entry separate from run-freeze', async () => {
    const browser = await import('ai-workflow-logic/browser');
    expect(browser.projectAIWorkflowAgentResources).toBe(projectAIWorkflowAgentResources);
    expect('freezeAIWorkflowRunResources' in browser).toBe(false);
  });

  test('separates complete registry proof from selected resource semantics', async () => {
    const baseTree = await loadResourceTree({ rootDir: fixtureRoot });
    const unrelatedTree = await loadResourceTree({ rootDir: unrelatedOverlayRoot });
    const selectedTree = await loadResourceTree({ rootDir: selectedOverlayRoot });
    const base = freezeLayers([{ id: 'global', tree: baseTree }]);
    const unrelated = freezeLayers([
      { id: 'global', tree: baseTree },
      { id: 'workspace', tree: unrelatedTree },
    ]);
    const selected = freezeLayers([
      { id: 'global', tree: baseTree },
      { id: 'workspace', tree: selectedTree },
    ]);

    expect(unrelated.receipt.dependencySnapshot.registryRevision)
      .not.toBe(base.receipt.dependencySnapshot.registryRevision);
    expect(unrelated.receipt.dependencySnapshot.snapshotRevision)
      .not.toBe(base.receipt.dependencySnapshot.snapshotRevision);
    expect(unrelated.receipt.semanticFingerprint).toBe(base.receipt.semanticFingerprint);
    expect(selected.receipt.semanticFingerprint).not.toBe(base.receipt.semanticFingerprint);
  });

  test('binds projected schema, effect policy, and selected Material values to semantic identity', async () => {
    const baseTree = await loadResourceTree({ rootDir: fixtureRoot });
    const executableTree = await loadResourceTree({ rootDir: executableOverlayRoot });
    const base = freezeLayers([{ id: 'global', tree: baseTree }]);
    const changed = freezeLayers([
      { id: 'global', tree: baseTree },
      { id: 'workspace', tree: executableTree },
    ]);

    expect(changed.projection.agentDefinitions[0]?.inputSchema?.schema).toMatchObject({
      properties: { request: { minLength: 2 } },
    });
    expect(changed.projection.agentDefinitions[0]?.effectPolicy?.toolMode).toBe('none');
    expect(changed.projection.materialBindings.find((binding) =>
      binding.resource.resourceId === 'depa.flows.test.Binding.Request')?.material.value).toEqual({ request: 'request-002' });
    expect(changed.receipt.semanticFingerprint).not.toBe(base.receipt.semanticFingerprint);
  });

  test('binds MessageSource and ContextPipeline content identities to semantic identity', async () => {
    const baseTree = await loadResourceTree({ rootDir: fixtureRoot });
    const dynamicTree = await loadResourceTree({ rootDir: dynamicOverlayRoot });
    const base = freezeLayers([{ id: 'global', tree: baseTree }]);
    const changed = freezeLayers([
      { id: 'global', tree: baseTree },
      { id: 'workspace', tree: dynamicTree },
    ]);

    expect(changed.projection.agentDefinitions[0]?.messagePrefix[2]).toMatchObject({
      type: 'message-source',
      source: { ref: 'resource://depa.flows.test.MessageSource.Workspace' },
    });
    expect(changed.projection.agentDefinitions[0]?.contextPipeline?.ref)
      .toBe('resource://depa.flows.test.ContextPipeline.Standard');
    expect(changed.receipt.semanticFingerprint).not.toBe(base.receipt.semanticFingerprint);
  });

  test('rejects foreign ports, one-valued overflow, and material kind mismatch', async () => {
    const tree = await loadResourceTree({ rootDir: fixtureRoot });
    const frozen = freezeLayers([{ id: 'workspace', tree }]);
    const baseInput = {
      registry: frozen.registry,
      task: frozen.task,
      contentIdentities: frozen.contentIdentities,
    };
    expectFreezeError(() => freezeAIWorkflowRunResources({
      ...baseInput,
      projection: frozen.projection,
      task: Object.freeze({ ...frozen.task, nodeId: 'foreign-case' }),
    }), 'AI_RUN_MATERIAL_PORT_FOREIGN');

    expectFreezeError(() => freezeAIWorkflowRunResources({
      ...baseInput,
      projection: frozen.projection,
      task: Object.freeze({ ...frozen.task, nodeId: 'overflow-case' }),
    }), 'AI_RUN_MATERIAL_CARDINALITY_EXCEEDED');

    expectFreezeError(() => freezeAIWorkflowRunResources({
      ...baseInput,
      projection: frozen.projection,
      task: Object.freeze({ ...frozen.task, nodeId: 'kind-case' }),
    }), 'AI_RUN_MATERIAL_KIND_MISMATCH');
  });

  test('requires the exact projection produced for the effective registry', async () => {
    const tree = await loadResourceTree({ rootDir: fixtureRoot });
    const frozen = freezeLayers([{ id: 'workspace', tree }]);
    expectFreezeError(() => freezeAIWorkflowRunResources({
      registry: frozen.registry,
      projection: Object.freeze({ ...frozen.projection }),
      task: frozen.task,
      contentIdentities: frozen.contentIdentities,
    }), 'AI_RUN_RESOURCE_PROJECTION_UNTRUSTED');
  });

  test('rejects unsupported task fields and malformed runtime values with stable diagnostics', async () => {
    const tree = await loadResourceTree({ rootDir: fixtureRoot });
    const frozen = freezeLayers([{ id: 'workspace', tree }]);
    expectFreezeError(() => freezeAIWorkflowRunResources({
      registry: frozen.registry,
      projection: frozen.projection,
      task: {
        ...frozen.task,
        runId: 'run-1',
        sessionId: 'session-1',
        actor: 'actor-1',
        provider: 'provider-1',
        root: '/host/root',
      } as unknown as typeof frozen.task,
      contentIdentities: frozen.contentIdentities,
    }), 'AI_RUN_AGENT_TASK_FIELD_UNSUPPORTED');

    expectFreezeError(() => freezeAIWorkflowRunResources({
      registry: frozen.registry,
      projection: frozen.projection,
      task: {} as typeof frozen.task,
      contentIdentities: frozen.contentIdentities,
    }), 'AI_RUN_AGENT_TASK_INVALID');
  });
});

function freezeLayers(layers: readonly { id: string; tree: Awaited<ReturnType<typeof loadResourceTree>> }[]) {
  const registry = composeLayeredResourceRegistry({ layers });
  const contentIdentities = resolveEffectiveResourceContentIdentities({ registry, layers });
  const projection = projectAIWorkflowAgentResources(registry);
  const task = Object.freeze({
    workflowKind: 'AICtrlWorkflow' as const,
    workflowRef: 'resource://depa.flows.test.Workflow.Support' as const,
    nodeId: 'collect-request',
    agentDefinitionRef: 'resource://depa.flows.test.Agent.Support' as const,
  });
  const receipt = freezeAIWorkflowRunResources({ registry, projection, task, contentIdentities });
  return { registry, contentIdentities, projection, task, receipt };
}

function expectFreezeError(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error('expected freeze to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(AIWorkflowRunResourceFreezeError);
    expect((error as AIWorkflowRunResourceFreezeError).diagnostics.map((item) => item.code)).toContain(code);
  }
}
