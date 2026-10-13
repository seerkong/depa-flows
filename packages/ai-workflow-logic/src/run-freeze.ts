import type {
  AIAgentDefinitionProjection,
  FrozenAIAgentTaskBinding,
  AIWorkflowAgentResourceProjection,
  AIWorkflowAgentTaskRef,
  AIWorkflowResourceProjectionDiagnostic,
  AIWorkflowRunResourceFreezeReceipt,
  MaterialBindingProjection,
  MaterialPortProjection,
  CompiledAIAgentCodeExecution,
  AIAgentCodeExecutionIdentity,
} from 'ai-workflow-contract';
import {
  buildResourceDependencySnapshot,
  composeLayeredResourceRegistry,
  loadResourceTree,
  sha256Digest,
  digestCanonical,
  type EffectiveResourceRegistry,
  type ResourceContentIdentity,
  type ResourceDependencyEdge,
  type Sha256Digest,
} from 'halfcode-compiler.xnl/resource-core';
import { projectAIWorkflowAgentResources } from './agent-resources.js';
import { sourceRegistryForAIWorkflowAgentResourceProjection } from './agent-resource-brand.js';
import { authorityForAIAgentCodeExecution } from './agent-code-brand.js';
import { assertAIAgentExecutionResources, assertAIAgentFreezeRegistry, type AIAgentExecutionResourceObservation } from './agent-execution-resources.js';
import {
  createResolvedAIWorkflowContentIdentityIndex,
  resolveAIWorkflowResourceTree,
} from './resource-resolution.js';

export interface FreezeAIWorkflowRunResourcesInput {
  readonly executionResources?: AIAgentExecutionResourceObservation;
  readonly codeExecutions?: readonly CompiledAIAgentCodeExecution[];
  readonly registry: EffectiveResourceRegistry;
  readonly projection: AIWorkflowAgentResourceProjection;
  readonly task: AIWorkflowAgentTaskRef;
  readonly contentIdentities: ReadonlyMap<string, ResourceContentIdentity>;
}

/** Filesystem adapter that builds an authentic receipt from one complete resource package. */
export async function freezeAIWorkflowRunResourcesFromDirectory(
  rootDir: string,
  task: AIWorkflowAgentTaskRef,
): Promise<AIWorkflowRunResourceFreezeReceipt> {
  const authoredTree = await loadResourceTree({ rootDir });
  const tree = resolveAIWorkflowResourceTree(authoredTree);
  const layers = [{ id: 'workspace', tree }] as const;
  const registry = composeLayeredResourceRegistry({ layers });
  return freezeAIWorkflowRunResources({
    registry,
    projection: projectAIWorkflowAgentResources(registry),
    task,
    contentIdentities: createResolvedAIWorkflowContentIdentityIndex(tree),
  });
}

export class AIWorkflowRunResourceFreezeError extends Error {
  constructor(public readonly diagnostics: readonly AIWorkflowResourceProjectionDiagnostic[]) {
    super(`AI workflow run resource freeze failed with ${diagnostics.length} diagnostic(s)`);
    this.name = 'AIWorkflowRunResourceFreezeError';
  }
}

const authenticFreezeReceipts = new WeakSet<object>();
const authenticTaskBindings = new WeakSet<object>();
const receiptByTaskBinding = new WeakMap<object, AIWorkflowRunResourceFreezeReceipt>();
export function freezeAIWorkflowRunResources(
  input: FreezeAIWorkflowRunResourcesInput,
): AIWorkflowRunResourceFreezeReceipt {
  assertAIAgentFreezeRegistry(input.registry);
  const diagnostics: AIWorkflowResourceProjectionDiagnostic[] = [];
  if (sourceRegistryForAIWorkflowAgentResourceProjection(input.projection) !== input.registry) {
    diagnostics.push(diagnostic(
      'AI_RUN_RESOURCE_PROJECTION_UNTRUSTED',
      'run-freeze:projection',
      'Run freeze requires the exact immutable Agent resource projection produced for this registry.',
    ));
    throwFreezeError(diagnostics);
  }
  const executionResources = input.executionResources === undefined ? undefined
    : assertAIAgentExecutionResources(input.executionResources, input.registry);
  if (executionResources) {
    if (input.contentIdentities.size !== executionResources.contentIdentities.size
      || [...executionResources.contentIdentities].some(([id, identity]) =>
        digestCanonical(input.contentIdentities.get(id) ?? null) !== digestCanonical(identity))) {
      throw new AIWorkflowRunResourceFreezeError(Object.freeze([
        diagnostic('AI_RUN_EXECUTION_CONTENT_IDENTITY_MISMATCH', 'run-freeze:identities', 'Execution observation requires its exact authored content identity facts.'),
      ]));
    }
    input = { ...input, registry: executionResources.registry, projection: executionResources.projection,
      contentIdentities: executionResources.contentIdentities };
  }
  const task = normalizeTask(input.task, diagnostics);
  if (!task) throwFreezeError(diagnostics);
  const workflowId = resourceIdFromRef(task.workflowRef)!;
  const agentId = resourceIdFromRef(task.agentDefinitionRef)!;
  const workflow = input.registry.byId.get(workflowId)?.resource;
  if (!workflow || workflow.kind !== task.workflowKind) diagnostics.push(diagnostic('AI_RUN_WORKFLOW_MISSING', `resource://${workflowId}`, `Workflow '${workflowId}' is absent or has another kind.`));
  const agent = input.projection.agentDefinitions.find((value) => value.resource.resourceId === agentId);
  if (!agent) diagnostics.push(diagnostic('AI_RUN_AGENT_DEFINITION_MISSING', `resource://${agentId}`, `Agent definition '${agentId}' is absent from the domain projection.`));
  if (diagnostics.length > 0 || !workflow || !agent) throwFreezeError(diagnostics);

  const selectedBindings = input.projection.materialBindings.filter((binding) => sameTask(binding.task, task));
  const orderedBindings = validateAndOrderBindings(
    agent,
    input.projection.materialPorts,
    selectedBindings,
    diagnostics,
  );
  if (diagnostics.length > 0) throwFreezeError(diagnostics);

  const workflowEdges: ResourceDependencyEdge[] = [
    edge(workflowId, agentId, 'workflow-agent-task'),
    ...orderedBindings.map((binding) => edge(workflowId, binding.resource.resourceId, 'workflow-material-binding')),
  ];
  const dependencySnapshot = buildResourceDependencySnapshot({
    registry: input.registry,
    roots: [workflowId, agentId, ...orderedBindings.map((binding) => binding.resource.resourceId)],
    edges: [...input.projection.dependencyEdges, ...workflowEdges],
    contentIdentities: input.contentIdentities,
  });
  const frozenTask = Object.freeze({
    workflowKind: task.workflowKind,
    workflowRef: task.workflowRef,
    nodeId: task.nodeId,
    agentDefinitionRef: task.agentDefinitionRef,
  });
  const bindingResourceIds = Object.freeze(orderedBindings.map((binding) => binding.resource.resourceId));
  const resourceFingerprint = semanticResourceFingerprint(
    frozenTask,
    agent,
    orderedBindings,
    dependencySnapshot.closure,
    dependencySnapshot.edges,
  );
  const codeExecutions = selectedCodeExecutions(input, dependencySnapshot.closure.map(item => item.resourceId));
  const resourceResolutions = executionResources && Object.freeze(dependencySnapshot.closure
    .map(item => {
      const resolution = executionResources.resolutionIdentities.get(item.resourceId);
      if (!resolution) throw new Error(`AI_RUN_RESOURCE_RESOLUTION_MISSING: ${item.resourceId}`);
      return resolution;
    }).sort((a, b) => a.resourceId < b.resourceId ? -1 : a.resourceId > b.resourceId ? 1 : 0));
  const codeFingerprint = codeExecutions.length
    ? sha256Digest(JSON.stringify({ schemaVersion: 'ai-workflow.code-bound-semantic/v1', resourceFingerprint, codeExecutions }))
    : resourceFingerprint;
  const semanticFingerprint = resourceResolutions
    ? sha256Digest(JSON.stringify({ schemaVersion: 'ai-workflow.reader-bound-semantic/v1', resourceFingerprint: codeFingerprint, resourceResolutions }))
    : codeFingerprint;
  const receipt = Object.freeze({
    schemaVersion: 'ai-workflow.run-resource-freeze/v1',
    task: frozenTask,
    bindingResourceIds,
    dependencySnapshot,
    semanticFingerprint,
    ...(codeExecutions.length ? { codeExecutions } : {}),
    ...(resourceResolutions ? { resourceResolutions } : {}),
  });
  authenticFreezeReceipts.add(receipt);
  return receipt;
}

/** Projects a dispatch proof only from the exact receipt produced by this run-freeze boundary. */
export function projectFrozenAIAgentTaskBinding(
  receipt: AIWorkflowRunResourceFreezeReceipt,
): FrozenAIAgentTaskBinding {
  if (!authenticFreezeReceipts.has(receipt as object)) {
    throw new AIWorkflowRunResourceFreezeError(Object.freeze([
      diagnostic('AI_RUN_RESOURCE_FREEZE_RECEIPT_UNTRUSTED', 'run-freeze:receipt', 'Task proof requires the authentic receipt produced by run freeze.'),
    ]));
  }
  const binding = Object.freeze({
    schemaVersion: 'ai-workflow.frozen-agent-task-binding/v1' as const,
    task: receipt.task,
    semanticFingerprint: receipt.semanticFingerprint,
    snapshotRevision: receipt.dependencySnapshot.snapshotRevision,
    closureResourceIds: Object.freeze(receipt.dependencySnapshot.closure.map((item) => item.resourceId)),
    ...(receipt.codeExecutions ? { codeExecutions: receipt.codeExecutions } : {}),
    ...(receipt.resourceResolutions ? { resourceResolutions: receipt.resourceResolutions } : {}),
  });
  authenticTaskBindings.add(binding);
  receiptByTaskBinding.set(binding, receipt);
  return binding;
}

/** Retrieves the old Agent identity from the authentic freeze, not caller feedback. */
export function frozenAIAgentTaskAgentContentDigest(binding: FrozenAIAgentTaskBinding): Sha256Digest {
  assertFrozenAIAgentTaskBinding(binding);
  const receipt = receiptByTaskBinding.get(binding)!;
  const agentId = resourceIdFromRef(receipt.task.agentDefinitionRef)!;
  const identity = receipt.dependencySnapshot.closure.find(({ resourceId }) => resourceId === agentId);
  if (!identity) throw new AIWorkflowRunResourceFreezeError(Object.freeze([
    diagnostic('AI_RUN_AGENT_IDENTITY_MISSING', binding.task.agentDefinitionRef, 'Frozen Agent identity is absent.'),
  ]));
  if (!/^sha256:[a-f0-9]{64}$/.test(identity.contentDigest)) throw new Error('Invalid frozen Agent content digest');
  return identity.contentDigest as Sha256Digest;
}

function selectedCodeExecutions(input: FreezeAIWorkflowRunResourcesInput, closureIds: readonly string[]): readonly AIAgentCodeExecutionIdentity[] {
  const selected = new Set(closureIds);
  const identities = new Map<string, AIAgentCodeExecutionIdentity>();
  for (const execution of input.codeExecutions ?? []) {
    const authority = authorityForAIAgentCodeExecution(execution);
    if (!authority || !selected.has(authority.identity.resourceId)
      || input.registry.byId.get(authority.identity.resourceId)?.resource !== authority.projection.resource
      || !(input.projection.codeResources ?? []).includes(authority.projection)
      || identities.has(authority.identity.resourceId)) {
      throw new AIWorkflowRunResourceFreezeError(Object.freeze([
        diagnostic('AI_RUN_CODE_EXECUTION_UNTRUSTED', 'run-freeze:code', 'Code execution must be authentic, selected and belong to the exact registry projection.'),
      ]));
    }
    identities.set(authority.identity.resourceId, authority.identity);
  }
  for (const code of input.projection.codeResources ?? []) {
    if (code.mode === 'native' && selected.has(code.resource.resourceId) && !identities.has(code.resource.resourceId)) {
      throw new AIWorkflowRunResourceFreezeError(Object.freeze([
        diagnostic('AI_RUN_CODE_EXECUTION_MISSING', `resource://${code.resource.resourceId}`, 'Native code must be compiled or restored before task freeze.'),
      ]));
    }
  }
  return Object.freeze([...identities.values()].sort((a, b) => a.resourceId < b.resourceId ? -1 : a.resourceId > b.resourceId ? 1 : 0));
}

/** Runtime assertion; a structurally similar literal is not an admitted authority. */
export function assertFrozenAIAgentTaskBinding(value: FrozenAIAgentTaskBinding): FrozenAIAgentTaskBinding {
  if (!authenticTaskBindings.has(value as object)) {
    throw new AIWorkflowRunResourceFreezeError(Object.freeze([
      diagnostic('AI_RUN_AGENT_TASK_PROOF_UNTRUSTED', 'run-freeze:task-proof', 'Agent task binding was not projected from an authentic run-freeze receipt.'),
    ]));
  }
  return value;
}

function validateAndOrderBindings(
  agent: AIAgentDefinitionProjection,
  materialPorts: readonly MaterialPortProjection[],
  selected: readonly MaterialBindingProjection[],
  diagnostics: AIWorkflowResourceProjectionDiagnostic[],
): MaterialBindingProjection[] {
  const agentPortOrder = new Map(agent.materialPorts.map((ref, index) => [ref.resource.resourceId, index]));
  const bindingsByPort = new Map<string, MaterialBindingProjection[]>();
  for (const binding of selected) {
    const portId = binding.port.resource.resourceId;
    if (!agentPortOrder.has(portId)) {
      diagnostics.push(diagnostic('AI_RUN_MATERIAL_PORT_FOREIGN', binding.resource.documentUri, `Port '${portId}' is not declared by Agent '${agent.resource.resourceId}'.`));
      continue;
    }
    if (binding.material.resource.kind !== binding.port.materialKind) {
      diagnostics.push(diagnostic('AI_RUN_MATERIAL_KIND_MISMATCH', binding.resource.documentUri, `Material '${binding.material.resource.resourceId}' has kind '${binding.material.resource.kind}', expected '${binding.port.materialKind}'.`));
      continue;
    }
    const values = bindingsByPort.get(portId) ?? [];
    values.push(binding);
    bindingsByPort.set(portId, values);
  }

  const ordered: MaterialBindingProjection[] = [];
  for (const portRef of agent.materialPorts) {
    const port = materialPorts.find((value) => value.resource.resourceId === portRef.resource.resourceId);
    if (!port) {
      diagnostics.push(diagnostic('AI_RUN_MATERIAL_PORT_PROJECTION_MISSING', agent.resource.documentUri, `Agent port '${portRef.resource.resourceId}' has no projected MaterialPort.`));
      continue;
    }
    const values = [...(bindingsByPort.get(port.resource.resourceId) ?? [])]
      .sort((left, right) => compareCodeUnits(left.resource.resourceId, right.resource.resourceId));
    if (port.required && values.length === 0) diagnostics.push(diagnostic('AI_RUN_REQUIRED_MATERIAL_MISSING', port.resource.documentUri, `Required MaterialPort '${port.resource.resourceId}' has no binding for this task.`));
    if (port.cardinality === 'one' && values.length > 1) diagnostics.push(diagnostic('AI_RUN_MATERIAL_CARDINALITY_EXCEEDED', port.resource.documentUri, `MaterialPort '${port.resource.resourceId}' accepts at most one binding.`));
    ordered.push(...values);
  }
  return ordered;
}

function semanticResourceFingerprint(
  task: AIWorkflowAgentTaskRef,
  agent: AIAgentDefinitionProjection,
  bindings: readonly MaterialBindingProjection[],
  closure: readonly { resourceId: string; kind: string; contentDigest: string }[],
  edges: readonly ResourceDependencyEdge[],
): `sha256:${string}` {
  const fact = {
    schemaVersion: 'ai-workflow-resource-semantic-hash/v1',
    task: {
      workflowKind: task.workflowKind,
      workflowRef: task.workflowRef,
      nodeId: task.nodeId,
      agentDefinitionRef: task.agentDefinitionRef,
    },
    agent: {
      resourceId: agent.resource.resourceId,
      messagePrefix: agent.messagePrefix.map((item) => item.type === 'message'
        ? {
            type: item.type,
            id: item.id,
            role: item.role,
            prompt: [item.prompt.kind, item.prompt.resource.resourceId],
            schema: item.schema ? {
              kind: item.schema.kind,
              resourceId: item.schema.resource.resourceId,
              value: item.schema.schema,
            } : null,
          }
        : {
            type: item.type,
            id: item.id,
            source: [item.source.kind, item.source.resource.resourceId],
          }),
      contextPipeline: agent.contextPipeline
        ? [agent.contextPipeline.kind, agent.contextPipeline.resource.resourceId]
        : null,
      inputSchema: agent.inputSchema ? {
        kind: agent.inputSchema.kind,
        resourceId: agent.inputSchema.resource.resourceId,
        value: agent.inputSchema.schema,
      } : null,
      outputSchema: agent.outputSchema ? {
        kind: agent.outputSchema.kind,
        resourceId: agent.outputSchema.resource.resourceId,
        value: agent.outputSchema.schema,
      } : null,
      tools: agent.tools.map((ref) => [ref.kind, ref.resource.resourceId]),
      effectPolicy: agent.effectPolicy ? {
        kind: agent.effectPolicy.kind,
        resourceId: agent.effectPolicy.resource.resourceId,
        toolMode: agent.effectPolicy.toolMode,
      } : null,
      materialPorts: agent.materialPorts.map((ref) => [ref.kind, ref.resource.resourceId]),
    },
    bindings: bindings.map((binding) => ({
      resourceId: binding.resource.resourceId,
      port: [binding.port.resource.resourceId, binding.port.materialKind, binding.port.required, binding.port.cardinality],
      material: {
        kind: binding.material.kind,
        resourceId: binding.material.resource.resourceId,
        value: binding.material.value,
      },
    })),
    closure: closure.map((resource) => ({
      resourceId: resource.resourceId,
      kind: resource.kind,
      contentDigest: resource.contentDigest,
    })),
    edges: edges.map((value) => ({
      fromResourceId: value.fromResourceId,
      toResourceId: value.toResourceId,
      relation: value.relation,
      declaredBy: value.declaredBy,
    })),
  };
  return sha256Digest(JSON.stringify(fact));
}

function normalizeTask(
  value: unknown,
  diagnostics: AIWorkflowResourceProjectionDiagnostic[],
): AIWorkflowAgentTaskRef | undefined {
  const initialDiagnosticCount = diagnostics.length;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    diagnostics.push(diagnostic('AI_RUN_AGENT_TASK_INVALID', 'run-freeze:task', 'Run freeze task must be a fixed four-field object.'));
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const allowedFields = new Set([
    'workflowKind',
    'workflowRef',
    'nodeId',
    'agentDefinitionRef',
  ]);
  const unsupportedFields = Reflect.ownKeys(record)
    .filter((key) => typeof key !== 'string' || !allowedFields.has(key))
    .map((key) => typeof key === 'string' ? key : key.toString())
    .sort(compareCodeUnits);
  for (const field of unsupportedFields) {
    diagnostics.push(diagnostic('AI_RUN_AGENT_TASK_FIELD_UNSUPPORTED', `run-freeze:task:${field}`, `Run freeze task field '${field}' is not part of the fixed Agent task tuple.`));
  }

  const workflowKind = ownDataValue(record, 'workflowKind');
  const workflowRef = ownDataValue(record, 'workflowRef');
  const nodeId = ownDataValue(record, 'nodeId');
  const agentDefinitionRef = ownDataValue(record, 'agentDefinitionRef');
  if (workflowKind !== 'AICtrlWorkflow' && workflowKind !== 'AIDataWorkflow') {
    diagnostics.push(diagnostic('AI_RUN_AGENT_TASK_INVALID', 'run-freeze:task:workflowKind', 'Run freeze task workflowKind must be AICtrlWorkflow or AIDataWorkflow.'));
  }
  if (typeof workflowRef !== 'string' || resourceIdFromRef(workflowRef) === undefined) {
    diagnostics.push(diagnostic('AI_RUN_AGENT_TASK_INVALID', 'run-freeze:task:workflowRef', 'Run freeze task workflowRef must be one exact resource:// identity.'));
  }
  if (typeof nodeId !== 'string' || nodeId.length === 0 || nodeId !== nodeId.trim()) {
    diagnostics.push(diagnostic('AI_RUN_AGENT_TASK_INVALID', 'run-freeze:task:nodeId', 'Run freeze task nodeId must be an explicit canonical string.'));
  }
  if (typeof agentDefinitionRef !== 'string' || resourceIdFromRef(agentDefinitionRef) === undefined) {
    diagnostics.push(diagnostic('AI_RUN_AGENT_TASK_INVALID', 'run-freeze:task:agentDefinitionRef', 'Run freeze task agentDefinitionRef must be one exact resource:// identity.'));
  }
  if (diagnostics.length !== initialDiagnosticCount
    || workflowKind !== 'AICtrlWorkflow' && workflowKind !== 'AIDataWorkflow'
    || typeof workflowRef !== 'string'
    || typeof nodeId !== 'string'
    || typeof agentDefinitionRef !== 'string') return undefined;
  return Object.freeze({ workflowKind, workflowRef: workflowRef as `resource://${string}`, nodeId, agentDefinitionRef: agentDefinitionRef as `resource://${string}` });
}

function ownDataValue(record: Record<string, unknown>, field: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, field);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function sameTask(left: AIWorkflowAgentTaskRef, right: AIWorkflowAgentTaskRef): boolean {
  return left.workflowKind === right.workflowKind
    && left.workflowRef === right.workflowRef
    && left.nodeId === right.nodeId
    && left.agentDefinitionRef === right.agentDefinitionRef;
}

function resourceIdFromRef(value: unknown): string | undefined {
  const prefix = 'resource://';
  if (typeof value !== 'string' || value !== value.trim() || !value.startsWith(prefix)) return undefined;
  const resourceId = value.slice(prefix.length);
  return resourceId.length > 0 && resourceId === resourceId.trim() && !resourceId.includes('://')
    ? resourceId
    : undefined;
}

function edge(fromResourceId: string, toResourceId: string, relation: string): ResourceDependencyEdge {
  return Object.freeze({ fromResourceId, toResourceId, relation, declaredBy: fromResourceId });
}

function throwFreezeError(diagnostics: AIWorkflowResourceProjectionDiagnostic[]): never {
  throw new AIWorkflowRunResourceFreezeError(Object.freeze([...diagnostics].sort((left, right) =>
    compareCodeUnits(left.location, right.location) || compareCodeUnits(left.code, right.code),
  )));
}

function diagnostic(code: string, location: string, message: string): AIWorkflowResourceProjectionDiagnostic {
  return Object.freeze({ code, location, message });
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
