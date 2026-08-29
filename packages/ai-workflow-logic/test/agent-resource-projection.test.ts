import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type {
  ResourceNode,
  ResourceRecord,
  ResourceRegistry,
  ResourceValue,
} from 'halfcode-compiler.xnl/resource-core';
import {
  AIWorkflowResourceProjectionError,
  projectAIWorkflowAgentResources,
} from 'ai-workflow-logic';
import { loadResourceTree } from 'halfcode-compiler.xnl/resource-core';

const fixtureRoot = join(import.meta.dir, 'fixtures/HalfcodeAIAgentResourcePackage');

describe('AI Agent and Material resource projection', () => {
  test('projects fixed typed relations from a real Halfcode ResourcePackage', async () => {
    const tree = await loadResourceTree({ rootDir: fixtureRoot });
    const projection = projectAIWorkflowAgentResources(tree.registry);

    expect(projection.agentDefinitions).toHaveLength(1);
    expect(projection.agentDefinitions[0]).toMatchObject({
      kind: 'AIAgentDefinition',
      fqn: 'depa.flows.test.Agent.Support',
    });
    expect(projection.agentDefinitions[0]?.messages.map((message) => [
      message.id,
      message.role,
      message.prompt.ref,
      message.schema?.ref,
    ])).toEqual([
      ['system', 'system', 'resource://depa.flows.test.Prompt.System', undefined],
      ['user', 'user', 'resource://depa.flows.test.Prompt.User', 'resource://depa.flows.test.Schema.Response'],
    ]);
    expect(projection.agentDefinitions[0]?.tools.map((ref) => ref.ref)).toEqual([
      'resource://depa.flows.test.Tool.Lookup',
    ]);
    expect(projection.agentDefinitions[0]?.inputSchema?.schema).toEqual({
      additionalProperties: false,
      properties: { request: { type: 'string' } },
      required: ['request'],
      type: 'object',
    });
    expect(projection.agentDefinitions[0]?.outputSchema?.schema).toEqual({ type: 'string' });
    expect(projection.agentDefinitions[0]?.messages[1]?.schema?.schema).toEqual({ type: 'string' });
    expect(projection.agentDefinitions[0]?.effectPolicy).toMatchObject({
      kind: 'EffectPolicy',
      toolMode: 'declared-only',
    });
    expect(projection.agentDefinitions[0]?.materialPorts.map((port) => port.ref)).toEqual([
      'resource://depa.flows.test.Port.Request',
      'resource://depa.flows.test.Port.Context',
    ]);
    expect(projection.materialPorts.map((port) => [
      port.fqn,
      port.materialKind,
      port.required,
      port.cardinality,
    ])).toEqual([
      ['depa.flows.test.Port.Context', 'ContextMaterial', false, 'many'],
      ['depa.flows.test.Port.Foreign', 'ContextMaterial', false, 'many'],
      ['depa.flows.test.Port.Request', 'RequestMaterial', true, 'one'],
    ]);
    expect(projection.materialBindings
      .filter((binding) => binding.task.nodeId === 'collect-request')
      .map((binding) => binding.fqn)).toEqual([
      'depa.flows.test.Binding.Context.A',
      'depa.flows.test.Binding.Context.B',
      'depa.flows.test.Binding.Request',
    ]);
    expect(projection.dependencyEdges.some((edge) =>
      edge.fromResourceId === 'depa.flows.test.Agent.Support'
      && edge.toResourceId === 'depa.flows.test.Tool.Lookup'
      && edge.relation === 'agent-tool')).toBe(true);
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.agentDefinitions)).toBe(true);
    expect(Object.isFrozen(projection.agentDefinitions[0]?.messages)).toBe(true);
    expect(Object.isFrozen(projection.materialBindings[0]?.task)).toBe(true);
    expect(projection.materialBindings.find((binding) => binding.fqn === 'depa.flows.test.Binding.Request')?.material.value).toEqual({
      request: 'request-001',
    });
    expect(Object.isFrozen(projection.agentDefinitions[0]?.inputSchema?.schema)).toBe(true);
    expect(Object.isFrozen(projection.agentDefinitions[0]?.inputSchema?.schema.properties)).toBe(true);
    expect(Object.isFrozen(projection.materialBindings.find((binding) => binding.fqn === 'depa.flows.test.Binding.Request')?.material.value)).toBe(true);
  });

  test('does not derive refs or policies from ordinary text', () => {
    const prompt = record('Prompt', 'depa.flows.test.Prompt.Plain', {}, {
      note: '负责人批准后可继续，resource://depa.flows.test.Tool.Hidden 只是普通文本',
    });
    const agent = record('AIAgentDefinition', 'depa.flows.test.Agent.Plain', {
      Messages: node('Messages', undefined, {}, [
        node('Message', 'system', {
          role: 'system',
          promptKind: 'Prompt',
          promptRef: 'resource://depa.flows.test.Prompt.Plain',
        }),
      ]),
      ToolRefs: node('ToolRefs'),
      MaterialPortRefs: node('MaterialPortRefs'),
    });
    const hidden = record('Tool', 'depa.flows.test.Tool.Hidden');

    const projection = projectAIWorkflowAgentResources(registry(agent, prompt, hidden));
    expect(projection.agentDefinitions[0]?.tools).toEqual([]);
    expect(projection.dependencyEdges.some((edge) => edge.toResourceId === hidden.resourceId)).toBe(false);
  });

  test('projects an ordered heterogeneous MessagePrefix and explicit ContextPipeline', () => {
    const prompt = record('Prompt', 'depa.flows.test.Prompt.System');
    const source = record('AgentMessageSource', 'depa.flows.test.MessageSource.Workspace');
    const pipeline = record('AgentContextPipeline', 'depa.flows.test.ContextPipeline.Standard');
    const agent = record('AIAgentDefinition', 'depa.flows.test.Agent.Composed', {
      MessagePrefix: node('MessagePrefix', undefined, {}, [
        message('system'),
        node('MessageSource', 'workspace', {
          kind: 'AgentMessageSource',
          ref: 'resource://depa.flows.test.MessageSource.Workspace',
        }),
      ]),
      ContextPipeline: node('ContextPipeline', undefined, {
        kind: 'AgentContextPipeline',
        ref: 'resource://depa.flows.test.ContextPipeline.Standard',
      }),
      ToolRefs: node('ToolRefs'),
      MaterialPortRefs: node('MaterialPortRefs'),
    });

    const projection = projectAIWorkflowAgentResources(registry(agent, prompt, source, pipeline));
    const composed = projection.agentDefinitions[0]!;
    expect(composed.messagePrefix.map((item) => item.type)).toEqual(['message', 'message-source']);
    expect(composed.messages.map((item) => item.id)).toEqual(['system']);
    expect(composed.messagePrefix[1]).toMatchObject({
      type: 'message-source',
      id: 'workspace',
      source: { kind: 'AgentMessageSource', ref: 'resource://depa.flows.test.MessageSource.Workspace' },
    });
    expect(composed.contextPipeline).toMatchObject({
      kind: 'AgentContextPipeline',
      ref: 'resource://depa.flows.test.ContextPipeline.Standard',
    });
    expect(projection.dependencyEdges.map((edge) => edge.relation)).toContain('agent-message-source');
    expect(projection.dependencyEdges.map((edge) => edge.relation)).toContain('agent-context-pipeline');
    expect(Object.isFrozen(composed.messagePrefix)).toBe(true);
  });

  test('fails closed on ambiguous prefix containers and unsupported prefix children', () => {
    const prompt = record('Prompt', 'depa.flows.test.Prompt.System');
    const conflict = replaceSubdomain(baseAgent(), 'MessagePrefix', node('MessagePrefix', undefined, {}, [message('system')]));
    expectProjectionError(registry(conflict, prompt), 'AI_AGENT_MESSAGE_PREFIX_CONFLICT');

    const unsupported = record('AIAgentDefinition', 'depa.flows.test.Agent.Unsupported', {
      MessagePrefix: node('MessagePrefix', undefined, {}, [node('ImplicitWorkspacePrompt', 'workspace')]),
      ToolRefs: node('ToolRefs'),
      MaterialPortRefs: node('MaterialPortRefs'),
    });
    expectProjectionError(registry(unsupported, prompt), 'AI_AGENT_MESSAGE_PREFIX_NODE_INVALID');
  });

  test.each([
    {
      name: 'unknown message role',
      mutate: (agent: ResourceRecord) => replaceSubdomain(agent, 'Messages', node('Messages', undefined, {}, [
        node('Message', 'system', {
          role: 'operator',
          promptKind: 'Prompt',
          promptRef: 'resource://depa.flows.test.Prompt.System',
        }),
      ])),
      code: 'AI_AGENT_MESSAGE_ROLE_INVALID',
    },
    {
      name: 'duplicate message id',
      mutate: (agent: ResourceRecord) => replaceSubdomain(agent, 'Messages', node('Messages', undefined, {}, [
        message('same'),
        message('same'),
      ])),
      code: 'AI_AGENT_MESSAGE_ID_DUPLICATE',
    },
    {
      name: 'wrong typed target kind',
      mutate: (agent: ResourceRecord) => replaceSubdomain(agent, 'Messages', node('Messages', undefined, {}, [
        node('Message', 'system', {
          role: 'system',
          promptKind: 'Tool',
          promptRef: 'resource://depa.flows.test.Prompt.System',
        }),
      ])),
      code: 'AI_RESOURCE_REF_KIND_MISMATCH',
    },
  ])('fails closed for $name', ({ mutate, code }) => {
    const prompt = record('Prompt', 'depa.flows.test.Prompt.System');
    const agent = mutate(baseAgent());
    expectProjectionError(registry(agent, prompt), code);
  });

  test('distinguishes similar ids by exact identity', () => {
    const prompt1 = record('Prompt', 'depa.flows.test.Prompt.node-1');
    const prompt10 = record('Prompt', 'depa.flows.test.Prompt.node-10');
    const agent = replaceSubdomain(baseAgent(), 'Messages', node('Messages', undefined, {}, [
      node('Message', 'node-1', {
        role: 'user',
        promptKind: 'Prompt',
        promptRef: 'resource://depa.flows.test.Prompt.node-1',
      }),
    ]));
    const projection = projectAIWorkflowAgentResources(registry(agent, prompt1, prompt10));
    expect(projection.agentDefinitions[0]?.messages[0]?.prompt.resource).toBe(prompt1);
  });

  test('requires exact fixed child tags and unique declared refs', () => {
    const prompt = record('Prompt', 'depa.flows.test.Prompt.System');
    const wrongMessages = replaceSubdomain(baseAgent(), 'Messages', node('NotMessages'));
    expectProjectionError(registry(wrongMessages, prompt), 'AI_RESOURCE_SUBDOMAIN_TAG_MISMATCH');

    const tool = record('Tool', 'depa.flows.test.Tool.Lookup');
    const duplicateTools = replaceSubdomain(baseAgent(), 'ToolRefs', node('ToolRefs', undefined, {}, [
      node('ToolRef', 'first', { kind: 'Tool', ref: 'resource://depa.flows.test.Tool.Lookup' }),
      node('ToolRef', 'second', { kind: 'Tool', ref: 'resource://depa.flows.test.Tool.Lookup' }),
    ]));
    expectProjectionError(registry(duplicateTools, prompt, tool), 'AI_RESOURCE_REF_TARGET_DUPLICATE');
  });

  test.each([
    {
      name: 'message schema without an explicit schema map',
      resource: record('MessageSchema', 'depa.flows.test.Schema.Invalid'),
      code: 'AI_MESSAGE_SCHEMA_VALUE_INVALID',
    },
    {
      name: 'effect policy with an unsupported tool mode',
      resource: record('EffectPolicy', 'depa.flows.test.Policy.Invalid', {}, { toolMode: 'implicit' }),
      code: 'AI_EFFECT_POLICY_TOOL_MODE_INVALID',
    },
    {
      name: 'effect policy with an undeclared behavior field',
      resource: record('EffectPolicy', 'depa.flows.test.Policy.Invalid', {}, {
        toolMode: 'declared-only',
        undeclaredToolBehavior: 'all',
      }),
      code: 'AI_EFFECT_POLICY_PROPERTY_UNSUPPORTED',
    },
    {
      name: 'material without an explicit value',
      resource: record('RequestMaterial', 'depa.flows.test.Material.Invalid'),
      code: 'AI_MATERIAL_VALUE_MISSING',
    },
  ])('fails closed for $name', ({ resource, code }) => {
    const prompt = record('Prompt', 'depa.flows.test.Prompt.System');
    const schemaRef = node('InputSchemaRef', undefined, {
      kind: 'MessageSchema',
      ref: `resource://${resource.resourceId}`,
    });
    const effectRef = node('EffectPolicyRef', undefined, {
      kind: 'EffectPolicy',
      ref: `resource://${resource.resourceId}`,
    });
    const agent = resource.kind === 'MessageSchema'
      ? replaceSubdomain(baseAgent(), 'InputSchemaRef', schemaRef)
      : resource.kind === 'EffectPolicy'
        ? replaceSubdomain(baseAgent(), 'EffectPolicyRef', effectRef)
        : baseAgent();
    if (resource.kind !== 'RequestMaterial') {
      expectProjectionError(registry(agent, prompt, resource), code);
      return;
    }
    const workflow = record('AICtrlWorkflow', 'depa.flows.test.Workflow');
    const port = record('MaterialPort', 'depa.flows.test.Port.Request', {}, {
      materialKind: 'RequestMaterial', required: true, cardinality: 'one',
    });
    const binding = record('MaterialBinding', 'depa.flows.test.Binding.Invalid', {
      AgentTaskRef: node('AgentTaskRef', undefined, {
        workflowKind: 'AICtrlWorkflow',
        workflowRef: 'resource://depa.flows.test.Workflow',
        nodeId: 'agent-node',
        agentDefinitionRef: 'resource://depa.flows.test.Agent.Support',
      }),
      PortRef: node('PortRef', undefined, { kind: 'MaterialPort', ref: 'resource://depa.flows.test.Port.Request' }),
      MaterialRef: node('MaterialRef', undefined, { kind: 'RequestMaterial', ref: 'resource://depa.flows.test.Material.Invalid' }),
    });
    expectProjectionError(registry(agent, prompt, workflow, port, binding, resource), code);
  });
});

function expectProjectionError(view: Pick<ResourceRegistry, 'byKind'>, code: string): void {
  try {
    projectAIWorkflowAgentResources(view);
    throw new Error('expected projection to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(AIWorkflowResourceProjectionError);
    expect((error as AIWorkflowResourceProjectionError).diagnostics.map((item) => item.code)).toContain(code);
  }
}

function baseAgent(): ResourceRecord {
  return record('AIAgentDefinition', 'depa.flows.test.Agent.Support', {
    Messages: node('Messages', undefined, {}, [message('system')]),
    ToolRefs: node('ToolRefs'),
    MaterialPortRefs: node('MaterialPortRefs'),
  });
}

function message(id: string): ResourceNode {
  return node('Message', id, {
    role: 'system',
    promptKind: 'Prompt',
    promptRef: 'resource://depa.flows.test.Prompt.System',
  });
}

function replaceSubdomain(resource: ResourceRecord, key: string, value: ResourceNode): ResourceRecord {
  return {
    ...resource,
    node: {
      ...resource.node,
      subdomains: { ...resource.node.subdomains, [key]: value },
    },
  };
}

function registry(...records: ResourceRecord[]): Pick<ResourceRegistry, 'byKind'> {
  const byKind = new Map<string, ResourceRecord[]>();
  for (const item of records) {
    const values = byKind.get(item.kind) ?? [];
    values.push(item);
    byKind.set(item.kind, values);
  }
  return { byKind };
}

function record(
  kind: string,
  resourceId: string,
  subdomains: Readonly<Record<string, ResourceNode>> = {},
  properties: Readonly<Record<string, ResourceValue>> = {},
): ResourceRecord {
  return {
    kind,
    fqn: resourceId,
    resourceId,
    metadata: { apiVersion: 'depa.flows/v1', version: '1.0.0' },
    sourceShape: 'single-file',
    logicalPath: `${kind}/${resourceId}.xnl`,
    documentUri: `vfs://@/${kind}/${resourceId}.xnl`,
    format: 'xnl',
    node: node(kind, resourceId, properties, [], subdomains),
  };
}

function node(
  tag: string,
  resourceId?: string,
  properties: Readonly<Record<string, ResourceValue>> = {},
  body: readonly ResourceValue[] = [],
  subdomains: Readonly<Record<string, ResourceNode>> = {},
): ResourceNode {
  return {
    tag,
    ...(resourceId === undefined ? {} : { resourceId }),
    metadata: {},
    properties,
    body,
    subdomains,
  };
}
