import type {
  AIAgentDefinitionProjection,
  AIAgentMessageProjection,
  AIAgentMessageRole,
  AIWorkflowEffectPolicyProjection,
  AIWorkflowAgentResourceProjection,
  AIWorkflowAgentResourceRelation,
  AIWorkflowAgentTaskRef,
  AIWorkflowDefinitionResourceKind,
  AIWorkflowMaterialValueProjection,
  AIWorkflowMessageSchemaProjection,
  AIWorkflowResourceProjectionDiagnostic,
  AIWorkflowResourceRegistryView,
  AIWorkflowTypedResourceRef,
  MaterialBindingProjection,
  MaterialCardinality,
  MaterialPortProjection,
} from 'ai-workflow-contract';
import type {
  ResourceDependencyEdge,
  ResourceNode,
  ResourceRecord,
  ResourceValue,
} from 'halfcode-compiler.xnl/resource-core';
import { markAIWorkflowAgentResourceProjection } from './agent-resource-brand.js';
import { AIWorkflowResourceProjectionError } from './errors.js';

const AGENT_SUBDOMAINS = Object.freeze([
  'Messages',
  'InputSchemaRef',
  'OutputSchemaRef',
  'ToolRefs',
  'EffectPolicyRef',
  'MaterialPortRefs',
]);

export function projectAIWorkflowAgentResources(
  registry: AIWorkflowResourceRegistryView,
): AIWorkflowAgentResourceProjection {
  const diagnostics: AIWorkflowResourceProjectionDiagnostic[] = [];
  const resources = buildResourceIndex(registry, diagnostics);
  const edges: ResourceDependencyEdge[] = [];

  const materialPorts = recordsForKind(registry, 'MaterialPort')
    .map((resource) => projectMaterialPort(resource, resources, edges, diagnostics))
    .filter((value): value is MaterialPortProjection => value !== undefined);
  const portsById = new Map(materialPorts.map((port) => [port.resource.resourceId, port]));

  const agentDefinitions = recordsForKind(registry, 'AIAgentDefinition')
    .map((resource) => projectAgentDefinition(resource, resources, edges, diagnostics))
    .filter((value): value is AIAgentDefinitionProjection => value !== undefined);

  const materialBindings = recordsForKind(registry, 'MaterialBinding')
    .map((resource) => projectMaterialBinding(resource, resources, portsById, edges, diagnostics))
    .filter((value): value is MaterialBindingProjection => value !== undefined);
  validateBindingIdentity(materialBindings, diagnostics);

  if (diagnostics.length > 0) throwProjectionError(diagnostics);
  return markAIWorkflowAgentResourceProjection(Object.freeze({
    agentDefinitions: Object.freeze(agentDefinitions),
    materialPorts: Object.freeze(materialPorts),
    materialBindings: Object.freeze(materialBindings),
    dependencyEdges: Object.freeze([...edges].sort(compareEdges)),
  }), registry);
}

function buildResourceIndex(
  registry: AIWorkflowResourceRegistryView,
  diagnostics: AIWorkflowResourceProjectionDiagnostic[],
): ReadonlyMap<string, ResourceRecord> {
  const resources = new Map<string, ResourceRecord>();
  const records = [...registry.byKind.entries()]
    .sort(([left], [right]) => compareCodeUnits(left, right))
    .flatMap(([, values]) => [...values])
    .sort(compareRecords);
  for (const resource of records) {
    if (resources.has(resource.resourceId)) {
      diagnostics.push(diagnostic(
        'AI_RESOURCE_ID_DUPLICATE',
        resource.documentUri,
        `Resource identity '${resource.resourceId}' occurs more than once in the registry view.`,
      ));
      continue;
    }
    resources.set(resource.resourceId, resource);
  }
  return resources;
}

function recordsForKind(
  registry: AIWorkflowResourceRegistryView,
  kind: string,
): readonly ResourceRecord[] {
  return [...(registry.byKind.get(kind) ?? [])].sort(compareRecords);
}

function projectMaterialPort(
  resource: ResourceRecord,
  resources: ReadonlyMap<string, ResourceRecord>,
  edges: ResourceDependencyEdge[],
  diagnostics: AIWorkflowResourceProjectionDiagnostic[],
): MaterialPortProjection | undefined {
  validateAllowedSubdomains(resource, ['SchemaRef'], diagnostics);
  const materialKind = canonicalString(resource.node.properties.materialKind);
  const required = resource.node.properties.required;
  const cardinality = resource.node.properties.cardinality;
  let valid = true;
  if (!materialKind) {
    diagnostics.push(diagnostic('AI_MATERIAL_PORT_KIND_INVALID', resource.documentUri, 'MaterialPort materialKind must be an explicit non-empty string.'));
    valid = false;
  }
  if (typeof required !== 'boolean') {
    diagnostics.push(diagnostic('AI_MATERIAL_PORT_REQUIRED_INVALID', resource.documentUri, 'MaterialPort required must be an explicit boolean.'));
    valid = false;
  }
  if (!isMaterialCardinality(cardinality)) {
    diagnostics.push(diagnostic('AI_MATERIAL_PORT_CARDINALITY_INVALID', resource.documentUri, 'MaterialPort cardinality must be one or many.'));
    valid = false;
  }
  const schema = projectOptionalSchemaSubdomain(
    resource,
    'SchemaRef',
    resources,
    'material-port-schema',
    edges,
    diagnostics,
  );
  if (!valid || !materialKind || typeof required !== 'boolean' || !isMaterialCardinality(cardinality)) return undefined;
  return Object.freeze({
    kind: 'MaterialPort',
    fqn: resource.fqn ?? resource.resourceId,
    resource,
    materialKind,
    required,
    cardinality,
    ...(schema === undefined ? {} : { schema }),
  });
}

function projectAgentDefinition(
  resource: ResourceRecord,
  resources: ReadonlyMap<string, ResourceRecord>,
  edges: ResourceDependencyEdge[],
  diagnostics: AIWorkflowResourceProjectionDiagnostic[],
): AIAgentDefinitionProjection | undefined {
  validateAllowedSubdomains(resource, AGENT_SUBDOMAINS, diagnostics);
  const messagesNode = requiredSubdomain(resource, 'Messages', diagnostics);
  const toolRefsNode = requiredSubdomain(resource, 'ToolRefs', diagnostics);
  const materialPortRefsNode = requiredSubdomain(resource, 'MaterialPortRefs', diagnostics);
  const messages = messagesNode
    ? projectMessages(resource, messagesNode, resources, edges, diagnostics)
    : [];
  const inputSchema = projectOptionalSchemaSubdomain(resource, 'InputSchemaRef', resources, 'agent-input-schema', edges, diagnostics);
  const outputSchema = projectOptionalSchemaSubdomain(resource, 'OutputSchemaRef', resources, 'agent-output-schema', edges, diagnostics);
  const tools = toolRefsNode
    ? projectTypedRefList(resource, toolRefsNode, 'ToolRef', resources, 'agent-tool', edges, diagnostics)
    : [];
  const effectPolicy = projectOptionalEffectPolicySubdomain(resource, 'EffectPolicyRef', resources, 'agent-effect-policy', edges, diagnostics);
  const materialPorts = materialPortRefsNode
    ? projectTypedRefList(resource, materialPortRefsNode, 'MaterialPortRef', resources, 'agent-material-port', edges, diagnostics, 'MaterialPort')
    : [];

  if (!messagesNode || !toolRefsNode || !materialPortRefsNode) return undefined;
  return Object.freeze({
    kind: 'AIAgentDefinition',
    fqn: resource.fqn ?? resource.resourceId,
    resource,
    messages: Object.freeze(messages),
    ...(inputSchema === undefined ? {} : { inputSchema }),
    ...(outputSchema === undefined ? {} : { outputSchema }),
    tools: Object.freeze(tools),
    ...(effectPolicy === undefined ? {} : { effectPolicy }),
    materialPorts: Object.freeze(materialPorts),
  });
}

function projectMessages(
  resource: ResourceRecord,
  messagesNode: ResourceNode,
  resources: ReadonlyMap<string, ResourceRecord>,
  edges: ResourceDependencyEdge[],
  diagnostics: AIWorkflowResourceProjectionDiagnostic[],
): AIAgentMessageProjection[] {
  const output: AIAgentMessageProjection[] = [];
  const ids = new Set<string>();
  messagesNode.body.forEach((value, index) => {
    const location = `${resource.documentUri}#Messages:${index}`;
    if (!isResourceNode(value) || value.tag !== 'Message') {
      diagnostics.push(diagnostic('AI_AGENT_MESSAGE_NODE_INVALID', location, 'Messages may contain only Message nodes.'));
      return;
    }
    validateAllowedNodeSubdomains(value, ['SchemaRef'], location, diagnostics);
    const id = canonicalString(value.resourceId);
    const role = value.properties.role;
    if (!id) {
      diagnostics.push(diagnostic('AI_AGENT_MESSAGE_ID_MISSING', location, 'Message must declare an explicit #id.'));
    } else if (ids.has(id)) {
      diagnostics.push(diagnostic('AI_AGENT_MESSAGE_ID_DUPLICATE', location, `Message id '${id}' is declared more than once.`));
    } else {
      ids.add(id);
    }
    if (!isMessageRole(role)) {
      diagnostics.push(diagnostic('AI_AGENT_MESSAGE_ROLE_INVALID', location, 'Message role must be system, developer, user, or assistant.'));
    }
    const prompt = projectTypedValues(
      value.properties.promptKind,
      value.properties.promptRef,
      resources,
      location,
      diagnostics,
    );
    if (prompt) edges.push(edge(resource.resourceId, prompt.resource.resourceId, 'agent-message-prompt'));
    const schemaNode = value.subdomains.SchemaRef;
    const schema = schemaNode?.tag === 'SchemaRef'
      ? projectMessageSchemaRefNode(schemaNode, resources, `${location}#SchemaRef`, diagnostics)
      : undefined;
    if (schemaNode && schemaNode.tag !== 'SchemaRef') diagnostics.push(diagnostic('AI_RESOURCE_SUBDOMAIN_TAG_MISMATCH', `${location}#SchemaRef`, `Subdomain SchemaRef must contain a SchemaRef node, got '${schemaNode.tag}'.`));
    if (schema) edges.push(edge(resource.resourceId, schema.resource.resourceId, 'agent-message-schema'));
    if (!id || !isMessageRole(role) || !prompt) return;
    output.push(Object.freeze({ id, role, prompt, ...(schema === undefined ? {} : { schema }) }));
  });
  return output;
}

function projectTypedRefList(
  owner: ResourceRecord,
  list: ResourceNode,
  childTag: string,
  resources: ReadonlyMap<string, ResourceRecord>,
  relation: AIWorkflowAgentResourceRelation,
  edges: ResourceDependencyEdge[],
  diagnostics: AIWorkflowResourceProjectionDiagnostic[],
  expectedKind?: string,
): AIWorkflowTypedResourceRef[] {
  const output: AIWorkflowTypedResourceRef[] = [];
  const ids = new Set<string>();
  const targetIds = new Set<string>();
  list.body.forEach((value, index) => {
    const location = `${owner.documentUri}#${list.tag}:${index}`;
    if (!isResourceNode(value) || value.tag !== childTag) {
      diagnostics.push(diagnostic('AI_RESOURCE_REF_NODE_INVALID', location, `${list.tag} may contain only ${childTag} nodes.`));
      return;
    }
    const id = canonicalString(value.resourceId);
    if (!id) diagnostics.push(diagnostic('AI_RESOURCE_REF_ID_MISSING', location, `${childTag} must declare an explicit #id.`));
    else if (ids.has(id)) diagnostics.push(diagnostic('AI_RESOURCE_REF_ID_DUPLICATE', location, `${childTag} id '${id}' is declared more than once.`));
    else ids.add(id);
    const typedRef = projectTypedRefNode(value, resources, location, diagnostics, expectedKind);
    if (typedRef && targetIds.has(typedRef.resource.resourceId)) {
      diagnostics.push(diagnostic('AI_RESOURCE_REF_TARGET_DUPLICATE', location, `${childTag} target '${typedRef.resource.resourceId}' is declared more than once.`));
      return;
    }
    if (!typedRef || !id) return;
    targetIds.add(typedRef.resource.resourceId);
    output.push(typedRef);
    edges.push(edge(owner.resourceId, typedRef.resource.resourceId, relation));
  });
  return output;
}

function projectOptionalTypedSubdomain(
  owner: ResourceRecord,
  name: string,
  resources: ReadonlyMap<string, ResourceRecord>,
  relation: AIWorkflowAgentResourceRelation,
  edges: ResourceDependencyEdge[],
  diagnostics: AIWorkflowResourceProjectionDiagnostic[],
): AIWorkflowTypedResourceRef | undefined {
  const node = owner.node.subdomains[name];
  if (!node) return undefined;
  if (node.tag !== name) {
    diagnostics.push(diagnostic('AI_RESOURCE_SUBDOMAIN_TAG_MISMATCH', `${owner.documentUri}#${name}`, `Subdomain ${name} must contain a ${name} node, got '${node.tag}'.`));
    return undefined;
  }
  const typedRef = projectTypedRefNode(node, resources, `${owner.documentUri}#${name}`, diagnostics);
  if (typedRef) edges.push(edge(owner.resourceId, typedRef.resource.resourceId, relation));
  return typedRef;
}

function projectOptionalSchemaSubdomain(
  owner: ResourceRecord,
  name: string,
  resources: ReadonlyMap<string, ResourceRecord>,
  relation: AIWorkflowAgentResourceRelation,
  edges: ResourceDependencyEdge[],
  diagnostics: AIWorkflowResourceProjectionDiagnostic[],
): AIWorkflowMessageSchemaProjection | undefined {
  const node = owner.node.subdomains[name];
  if (!node) return undefined;
  if (node.tag !== name) {
    diagnostics.push(diagnostic('AI_RESOURCE_SUBDOMAIN_TAG_MISMATCH', `${owner.documentUri}#${name}`, `Subdomain ${name} must contain a ${name} node, got '${node.tag}'.`));
    return undefined;
  }
  const schema = projectMessageSchemaRefNode(node, resources, `${owner.documentUri}#${name}`, diagnostics);
  if (schema) edges.push(edge(owner.resourceId, schema.resource.resourceId, relation));
  return schema;
}

function projectOptionalEffectPolicySubdomain(
  owner: ResourceRecord,
  name: string,
  resources: ReadonlyMap<string, ResourceRecord>,
  relation: AIWorkflowAgentResourceRelation,
  edges: ResourceDependencyEdge[],
  diagnostics: AIWorkflowResourceProjectionDiagnostic[],
): AIWorkflowEffectPolicyProjection | undefined {
  const node = owner.node.subdomains[name];
  if (!node) return undefined;
  if (node.tag !== name) {
    diagnostics.push(diagnostic('AI_RESOURCE_SUBDOMAIN_TAG_MISMATCH', `${owner.documentUri}#${name}`, `Subdomain ${name} must contain a ${name} node, got '${node.tag}'.`));
    return undefined;
  }
  const typedRef = projectTypedRefNode(node, resources, `${owner.documentUri}#${name}`, diagnostics, 'EffectPolicy');
  if (!typedRef) return undefined;
  const supportedProperties = new Set(['lifecycle', 'description', 'toolMode']);
  const unsupportedProperties = Reflect.ownKeys(typedRef.resource.node.properties)
    .filter((key) => typeof key !== 'string' || !supportedProperties.has(key))
    .map((key) => typeof key === 'string' ? key : key.toString())
    .sort(compareCodeUnits);
  if (unsupportedProperties.length > 0) {
    for (const property of unsupportedProperties) {
      diagnostics.push(diagnostic(
        'AI_EFFECT_POLICY_PROPERTY_UNSUPPORTED',
        `${typedRef.resource.documentUri}#${property}`,
        `EffectPolicy property '${property}' is not part of the closed executable policy contract.`,
      ));
    }
    return undefined;
  }
  const toolMode = ownResourceValue(typedRef.resource.node.properties, 'toolMode');
  if (toolMode !== 'declared-only' && toolMode !== 'none') {
    diagnostics.push(diagnostic(
      'AI_EFFECT_POLICY_TOOL_MODE_INVALID',
      typedRef.resource.documentUri,
      "EffectPolicy toolMode must be 'declared-only' or 'none'.",
    ));
    return undefined;
  }
  edges.push(edge(owner.resourceId, typedRef.resource.resourceId, relation));
  return Object.freeze({ ...typedRef, kind: 'EffectPolicy', toolMode });
}

function projectMaterialBinding(
  resource: ResourceRecord,
  resources: ReadonlyMap<string, ResourceRecord>,
  portsById: ReadonlyMap<string, MaterialPortProjection>,
  edges: ResourceDependencyEdge[],
  diagnostics: AIWorkflowResourceProjectionDiagnostic[],
): MaterialBindingProjection | undefined {
  validateAllowedSubdomains(resource, ['AgentTaskRef', 'PortRef', 'MaterialRef'], diagnostics);
  const taskNode = requiredSubdomain(resource, 'AgentTaskRef', diagnostics);
  const portNode = requiredSubdomain(resource, 'PortRef', diagnostics);
  const materialNode = requiredSubdomain(resource, 'MaterialRef', diagnostics);
  const task = taskNode ? projectTaskRef(taskNode, resources, `${resource.documentUri}#AgentTaskRef`, diagnostics) : undefined;
  const portRef = portNode ? projectTypedRefNode(portNode, resources, `${resource.documentUri}#PortRef`, diagnostics, 'MaterialPort') : undefined;
  const materialRef = materialNode ? projectTypedRefNode(materialNode, resources, `${resource.documentUri}#MaterialRef`, diagnostics) : undefined;
  const material = materialRef
    ? projectMaterialValue(materialRef, diagnostics)
    : undefined;
  if (portRef) edges.push(edge(resource.resourceId, portRef.resource.resourceId, 'material-binding-port'));
  if (material) edges.push(edge(resource.resourceId, material.resource.resourceId, 'material-binding-material'));
  const port = portRef ? portsById.get(portRef.resource.resourceId) : undefined;
  if (portRef && !port) diagnostics.push(diagnostic('AI_MATERIAL_BINDING_PORT_PROJECTION_MISSING', resource.documentUri, `MaterialBinding port '${portRef.resource.resourceId}' has no valid MaterialPort projection.`));
  if (!task || !port || !material) return undefined;
  return Object.freeze({
    kind: 'MaterialBinding',
    fqn: resource.fqn ?? resource.resourceId,
    resource,
    task,
    port,
    material,
  });
}

function projectMessageSchemaRefNode(
  node: ResourceNode,
  resources: ReadonlyMap<string, ResourceRecord>,
  location: string,
  diagnostics: AIWorkflowResourceProjectionDiagnostic[],
): AIWorkflowMessageSchemaProjection | undefined {
  const typedRef = projectTypedRefNode(node, resources, location, diagnostics, 'MessageSchema');
  if (!typedRef) return undefined;
  const schemaValue = ownResourceValue(typedRef.resource.node.properties, 'schema');
  if (!isResourceValueMap(schemaValue)) {
    diagnostics.push(diagnostic(
      'AI_MESSAGE_SCHEMA_VALUE_INVALID',
      typedRef.resource.documentUri,
      'MessageSchema must declare one explicit schema map.',
    ));
    return undefined;
  }
  const schema = cloneResourceValue(schemaValue, typedRef.resource.documentUri, diagnostics, 'AI_MESSAGE_SCHEMA_VALUE_INVALID');
  if (!isResourceValueMap(schema)) return undefined;
  return Object.freeze({ ...typedRef, kind: 'MessageSchema', schema });
}

function projectMaterialValue(
  typedRef: AIWorkflowTypedResourceRef,
  diagnostics: AIWorkflowResourceProjectionDiagnostic[],
): AIWorkflowMaterialValueProjection | undefined {
  const value = ownResourceValue(typedRef.resource.node.properties, 'value');
  if (value === undefined) {
    diagnostics.push(diagnostic(
      'AI_MATERIAL_VALUE_MISSING',
      typedRef.resource.documentUri,
      `Material '${typedRef.resource.resourceId}' must declare one explicit value.`,
    ));
    return undefined;
  }
  const cloned = cloneResourceValue(value, typedRef.resource.documentUri, diagnostics, 'AI_MATERIAL_VALUE_INVALID');
  return cloned === undefined ? undefined : Object.freeze({ ...typedRef, value: cloned });
}

function ownResourceValue(
  record: Readonly<Record<string, ResourceValue>>,
  field: string,
): ResourceValue | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(record, field);
  return descriptor && descriptor.enumerable && 'value' in descriptor
    ? descriptor.value
    : undefined;
}

function isResourceValueMap(value: ResourceValue | undefined): value is Readonly<Record<string, ResourceValue>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !isResourceNode(value);
}

function cloneResourceValue(
  value: ResourceValue,
  location: string,
  diagnostics: AIWorkflowResourceProjectionDiagnostic[],
  code: string,
  ancestors: WeakSet<object> = new WeakSet(),
): ResourceValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    diagnostics.push(diagnostic(code, location, 'Executable resource values may contain only finite numbers.'));
    return undefined;
  }
  if (ancestors.has(value)) {
    diagnostics.push(diagnostic(code, location, 'Executable resource values must not contain cycles.'));
    return undefined;
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    const keys = Reflect.ownKeys(value);
    const expected = new Set([...value.keys()].map(String).concat('length'));
    if (keys.some((key) => typeof key !== 'string' || !expected.has(key))) {
      diagnostics.push(diagnostic(code, location, 'Executable resource arrays must be dense plain-data arrays.'));
      ancestors.delete(value);
      return undefined;
    }
    const output: ResourceValue[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        diagnostics.push(diagnostic(code, location, 'Executable resource arrays must be dense plain-data arrays.'));
        ancestors.delete(value);
        return undefined;
      }
      const item = cloneResourceValue(descriptor.value as ResourceValue, location, diagnostics, code, ancestors);
      if (item === undefined) {
        ancestors.delete(value);
        return undefined;
      }
      output.push(item);
    }
    ancestors.delete(value);
    return Object.freeze(output);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    diagnostics.push(diagnostic(code, location, 'Executable resource maps must be plain-data objects.'));
    ancestors.delete(value);
    return undefined;
  }
  const output: Record<string, ResourceValue> = Object.create(null) as Record<string, ResourceValue>;
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')) {
    diagnostics.push(diagnostic(code, location, 'Executable resource maps may contain only string keys.'));
    ancestors.delete(value);
    return undefined;
  }
  for (const key of (keys as string[]).sort(compareCodeUnits)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      diagnostics.push(diagnostic(code, location, 'Executable resource maps must contain only enumerable data properties.'));
      ancestors.delete(value);
      return undefined;
    }
    const item = cloneResourceValue(descriptor.value as ResourceValue, location, diagnostics, code, ancestors);
    if (item === undefined) {
      ancestors.delete(value);
      return undefined;
    }
    output[key] = item;
  }
  ancestors.delete(value);
  return Object.freeze(output);
}

function projectTaskRef(
  node: ResourceNode,
  resources: ReadonlyMap<string, ResourceRecord>,
  location: string,
  diagnostics: AIWorkflowResourceProjectionDiagnostic[],
): AIWorkflowAgentTaskRef | undefined {
  const workflowKind = node.properties.workflowKind;
  const workflowRef = canonicalString(node.properties.workflowRef);
  const nodeId = canonicalString(node.properties.nodeId);
  const agentDefinitionRef = canonicalString(node.properties.agentDefinitionRef);
  let valid = true;
  if (!isWorkflowKind(workflowKind)) {
    diagnostics.push(diagnostic('AI_AGENT_TASK_WORKFLOW_KIND_INVALID', location, 'AgentTaskRef workflowKind must be AICtrlWorkflow or AIDataWorkflow.'));
    valid = false;
  }
  const workflow = resolveRef(workflowRef, resources, location, diagnostics);
  if (workflow && isWorkflowKind(workflowKind) && workflow.kind !== workflowKind) {
    diagnostics.push(diagnostic('AI_RESOURCE_REF_KIND_MISMATCH', location, `Resource '${workflow.resourceId}' has kind '${workflow.kind}', expected '${workflowKind}'.`));
    valid = false;
  }
  if (!nodeId) {
    diagnostics.push(diagnostic('AI_AGENT_TASK_NODE_ID_INVALID', location, 'AgentTaskRef nodeId must be an explicit canonical string.'));
    valid = false;
  }
  const agent = resolveRef(agentDefinitionRef, resources, location, diagnostics);
  if (agent && agent.kind !== 'AIAgentDefinition') {
    diagnostics.push(diagnostic('AI_RESOURCE_REF_KIND_MISMATCH', location, `Resource '${agent.resourceId}' has kind '${agent.kind}', expected 'AIAgentDefinition'.`));
    valid = false;
  }
  if (!valid || !isWorkflowKind(workflowKind) || !workflowRef || !resourceIdFromRef(workflowRef) || !nodeId || !agentDefinitionRef || !resourceIdFromRef(agentDefinitionRef) || !workflow || !agent) return undefined;
  return Object.freeze({
    workflowKind,
    workflowRef: workflowRef as `resource://${string}`,
    nodeId,
    agentDefinitionRef: agentDefinitionRef as `resource://${string}`,
  });
}

function projectTypedRefNode(
  node: ResourceNode,
  resources: ReadonlyMap<string, ResourceRecord>,
  location: string,
  diagnostics: AIWorkflowResourceProjectionDiagnostic[],
  expectedKind?: string,
): AIWorkflowTypedResourceRef | undefined {
  return projectTypedValues(node.properties.kind, node.properties.ref, resources, location, diagnostics, expectedKind);
}

function projectTypedValues(
  kindValue: ResourceValue | undefined,
  refValue: ResourceValue | undefined,
  resources: ReadonlyMap<string, ResourceRecord>,
  location: string,
  diagnostics: AIWorkflowResourceProjectionDiagnostic[],
  expectedKind?: string,
): AIWorkflowTypedResourceRef | undefined {
  const kind = canonicalString(kindValue);
  const ref = canonicalString(refValue);
  let valid = true;
  if (!kind || expectedKind && kind !== expectedKind) {
    diagnostics.push(diagnostic('AI_RESOURCE_REF_KIND_INVALID', location, expectedKind ? `Typed ref kind must be '${expectedKind}'.` : 'Typed ref kind must be an explicit canonical string.'));
    valid = false;
  }
  const target = resolveRef(ref, resources, location, diagnostics);
  if (target && kind && target.kind !== kind) {
    diagnostics.push(diagnostic('AI_RESOURCE_REF_KIND_MISMATCH', location, `Resource '${target.resourceId}' has kind '${target.kind}', expected '${kind}'.`));
    valid = false;
  }
  if (!valid || !kind || !ref || !resourceIdFromRef(ref) || !target) return undefined;
  return Object.freeze({ kind, ref: ref as `resource://${string}`, resource: target });
}

function resolveRef(
  ref: string | undefined,
  resources: ReadonlyMap<string, ResourceRecord>,
  location: string,
  diagnostics: AIWorkflowResourceProjectionDiagnostic[],
): ResourceRecord | undefined {
  const resourceId = resourceIdFromRef(ref);
  if (!resourceId) {
    diagnostics.push(diagnostic('AI_RESOURCE_REF_INVALID', location, 'Typed ref must use one exact non-empty resource:// identity.'));
    return undefined;
  }
  const target = resources.get(resourceId);
  if (!target) diagnostics.push(diagnostic('AI_RESOURCE_REF_TARGET_MISSING', location, `Resource '${resourceId}' does not exist in the registry view.`));
  return target;
}

function requiredSubdomain(
  resource: ResourceRecord,
  name: string,
  diagnostics: AIWorkflowResourceProjectionDiagnostic[],
): ResourceNode | undefined {
  const node = resource.node.subdomains[name];
  if (!node) diagnostics.push(diagnostic('AI_RESOURCE_SUBDOMAIN_MISSING', resource.documentUri, `${resource.kind} '${resource.resourceId}' must declare ${name}.`));
  else if (node.tag !== name) {
    diagnostics.push(diagnostic('AI_RESOURCE_SUBDOMAIN_TAG_MISMATCH', `${resource.documentUri}#${name}`, `Subdomain ${name} must contain a ${name} node, got '${node.tag}'.`));
    return undefined;
  }
  return node;
}

function validateAllowedSubdomains(
  resource: ResourceRecord,
  allowed: readonly string[],
  diagnostics: AIWorkflowResourceProjectionDiagnostic[],
): void {
  validateAllowedNodeSubdomains(resource.node, allowed, resource.documentUri, diagnostics);
}

function validateAllowedNodeSubdomains(
  node: ResourceNode,
  allowed: readonly string[],
  location: string,
  diagnostics: AIWorkflowResourceProjectionDiagnostic[],
): void {
  const allowedNames = new Set(allowed);
  for (const name of Object.keys(node.subdomains)) {
    if (!allowedNames.has(name)) diagnostics.push(diagnostic('AI_RESOURCE_SUBDOMAIN_UNSUPPORTED', `${location}#${name}`, `Subdomain '${name}' is not part of the fixed ${node.tag} contract.`));
  }
}

function validateBindingIdentity(
  bindings: readonly MaterialBindingProjection[],
  diagnostics: AIWorkflowResourceProjectionDiagnostic[],
): void {
  const keys = new Map<string, string>();
  for (const binding of bindings) {
    const key = `${taskKey(binding.task)}\u0000${binding.port.resource.resourceId}\u0000${binding.material.resource.resourceId}`;
    const previous = keys.get(key);
    if (previous) diagnostics.push(diagnostic('AI_MATERIAL_BINDING_DUPLICATE', binding.resource.documentUri, `MaterialBinding duplicates the relation declared by '${previous}'.`));
    else keys.set(key, binding.resource.resourceId);
  }
}

function throwProjectionError(diagnostics: AIWorkflowResourceProjectionDiagnostic[]): never {
  throw new AIWorkflowResourceProjectionError(Object.freeze([...diagnostics].sort((left, right) =>
    compareCodeUnits(left.location, right.location) || compareCodeUnits(left.code, right.code),
  )));
}

function edge(fromResourceId: string, toResourceId: string, relation: AIWorkflowAgentResourceRelation): ResourceDependencyEdge {
  return Object.freeze({ fromResourceId, toResourceId, relation, declaredBy: fromResourceId });
}

function compareEdges(left: ResourceDependencyEdge, right: ResourceDependencyEdge): number {
  return compareCodeUnits(left.fromResourceId, right.fromResourceId)
    || compareCodeUnits(left.toResourceId, right.toResourceId)
    || compareCodeUnits(left.relation, right.relation)
    || compareCodeUnits(left.declaredBy, right.declaredBy);
}

function compareRecords(left: ResourceRecord, right: ResourceRecord): number {
  return compareCodeUnits(left.resourceId, right.resourceId) || compareCodeUnits(left.kind, right.kind);
}

function taskKey(task: AIWorkflowAgentTaskRef): string {
  return `${task.workflowKind}\u0000${task.workflowRef}\u0000${task.nodeId}\u0000${task.agentDefinitionRef}`;
}

function resourceIdFromRef(value: string | undefined): string | undefined {
  const prefix = 'resource://';
  if (!value || value !== value.trim() || !value.startsWith(prefix)) return undefined;
  const resourceId = value.slice(prefix.length);
  return resourceId.length > 0 && !resourceId.includes('://') && resourceId === resourceId.trim()
    ? resourceId
    : undefined;
}

function canonicalString(value: ResourceValue | string | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 && value === value.trim() ? value : undefined;
}

function isMessageRole(value: ResourceValue | undefined): value is AIAgentMessageRole {
  return value === 'system' || value === 'developer' || value === 'user' || value === 'assistant';
}

function isMaterialCardinality(value: ResourceValue | undefined): value is MaterialCardinality {
  return value === 'one' || value === 'many';
}

function isWorkflowKind(value: ResourceValue | undefined): value is AIWorkflowDefinitionResourceKind {
  return value === 'AICtrlWorkflow' || value === 'AIDataWorkflow';
}

function isResourceNode(value: ResourceValue): value is ResourceNode {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && typeof (value as ResourceNode).tag === 'string'
    && Array.isArray((value as ResourceNode).body);
}

function diagnostic(code: string, location: string, message: string): AIWorkflowResourceProjectionDiagnostic {
  return Object.freeze({ code, location, message });
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
