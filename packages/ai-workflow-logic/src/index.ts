import {
  AI_CTRL_WORKFLOW_DESCRIPTOR,
  AI_DATA_WORKFLOW_DESCRIPTOR,
  AI_WORKFLOW_ALLOWED_RESOURCE_REF_SCHEMES,
  AI_WORKFLOW_MACHINE_NODE_DEFAULT_REUSE_POLICY,
  AI_WORKFLOW_MANUAL_NODE_DEFAULT_REUSE_POLICY,
  type AICtrlWorkflowDefinitionBinding,
  type AIDataWorkflowDefinitionBinding,
  type AIWorkflowAppBundleProjection,
  type AIWorkflowBindingProjection,
  type AIWorkflowDefinitionResourceKind,
  type AIWorkflowEffectiveReusePolicy,
  type AIWorkflowEmbeddedEffectProvider,
  type AIWorkflowEffectProvider,
  type AIWorkflowEffectHandler,
  type AIWorkflowEffectHandlerMap,
  type AIWorkflowEffectHandlerRegistry,
  type AIWorkflowEffectRequest,
  type AIWorkflowMutableEffectHandlerRegistry,
  type AIWorkflowKind,
  type AIWorkflowNodeType,
  type AIWorkflowProfileDescriptor,
  type AIWorkflowResourceProjectionDiagnostic,
  type AIWorkflowResourceRegistryView,
  type AIWorkflowResourceRef,
  type AIWorkflowResourceRefScheme,
  type AIWorkflowReusePolicy,
  type AIWorkflowRuntimeRoots,
  type AIWorkflowRuntimeContext,
  type AIWorkflowStateProjection,
  type AIWorkflowSubstrate,
  type ProjectAIWorkflowAppBundlesOptions,
} from 'ai-workflow-contract';
import type { ResourceNode, ResourceRecord, ResourceValue } from 'halfcode-compiler.xnl/resource-core';
import { AIWorkflowFoundationError, AIWorkflowResourceProjectionError } from './errors.js';

export { AIWorkflowFoundationError, AIWorkflowResourceProjectionError } from './errors.js';
export { projectAIWorkflowAgentResources } from './agent-resources.js';
export {
  FlowRunContractValidationError,
  normalizeAIWorkflowProfileDurableState,
  normalizeFlowClosedObject,
  normalizeFlowClosedValue,
  normalizeFlowInstanceDescriptor,
  normalizeFlowRunCheckpoint,
} from './run-checkpoint.js';
export {
  AIAgentInvocationError,
  bindAIAgentProcessors,
  normalizeAIAgentEffectConfig,
  normalizeAIAgentInvocation,
  normalizeAIAgentSelector,
  runAgent,
  runTargetedAgent,
} from './agent-invocation.js';
export * from './holon-task.js';
export { assertAIAgentNodeTaskBinding, upgradeLegacyAIWorkflowProfileDurableState } from './agent-state.js';
export type { AIAgentNodeBindingIdentity } from './agent-state.js';
export {
  FlowRunCheckpointTransitionError,
  FlowRunCheckpointVersionConflictError,
  InMemoryFlowRunCheckpointStore,
  createWorkCtrlFlowCheckpointStore,
  projectWorkCtrlSnapshotToCheckpointData,
  commitFlowRunCheckpoint,
  loadFlowRunCheckpoint,
  projectFlowRunCheckpoint,
} from './checkpoint-store.js';
export type { WorkCtrlFlowCheckpointStoreOptions } from './checkpoint-store.js';
export {
  createInitialRunStepExtensions,
  validateCheckpointAgainstFrozenProfile,
} from './checkpoint-profile.js';
export type {
  FlowRunCheckpointAdmissionRuntime,
  FlowRunProfileAuthorityPort,
  FlowRunProfileAuthorityRequest,
  FrozenFlowRunProfileAuthority,
  FrozenRunStepExtensionDefinition,
} from './checkpoint-profile.js';
export { mutateRunStepExtension } from './step-extension.js';
export type {
  RunStepExtensionMutationConfig,
  RunStepExtensionMutationInvocation,
  RunStepExtensionSelector,
} from 'ai-workflow-contract';
export type { RunStepExtensionMutationRuntime } from './step-extension.js';

export class AIWorkflowEffectHandlerNotFoundError extends AIWorkflowFoundationError {
  constructor(
    public readonly operation: string,
    public readonly effectId: string,
  ) {
    super(`AI workflow effect handler not found for operation ${operation}`);
    this.name = 'AIWorkflowEffectHandlerNotFoundError';
  }
}

export function descriptorForAIWorkflowKind(
  kind: 'AICtrlWorkflow',
): AIWorkflowProfileDescriptor<'AICtrlWorkflow', 'WorkCtrlFlow'>;
export function descriptorForAIWorkflowKind(
  kind: 'AIDataWorkflow',
): AIWorkflowProfileDescriptor<'AIDataWorkflow', 'EagerDataFlow'>;
export function descriptorForAIWorkflowKind(kind: AIWorkflowKind): AIWorkflowProfileDescriptor {
  switch (kind) {
    case 'AICtrlWorkflow':
      return AI_CTRL_WORKFLOW_DESCRIPTOR;
    case 'AIDataWorkflow':
      return AI_DATA_WORKFLOW_DESCRIPTOR;
  }
}

export function assertAIWorkflowSubstrate(
  descriptor: AIWorkflowProfileDescriptor,
  expected: AIWorkflowSubstrate,
): void {
  if (descriptor.substrate !== expected) {
    throw new AIWorkflowFoundationError(
      `${descriptor.kind} must use ${expected}, got ${descriptor.substrate}`,
    );
  }
}

export function defineAICtrlWorkflow(
  definition: AICtrlWorkflowDefinitionBinding['definition'],
): AICtrlWorkflowDefinitionBinding {
  return Object.freeze({
    kind: 'AICtrlWorkflow',
    substrate: 'WorkCtrlFlow',
    descriptor: AI_CTRL_WORKFLOW_DESCRIPTOR,
    definition,
  });
}

export function defineAIDataWorkflow(
  definition: AIDataWorkflowDefinitionBinding['definition'],
): AIDataWorkflowDefinitionBinding {
  return Object.freeze({
    kind: 'AIDataWorkflow',
    substrate: 'EagerDataFlow',
    descriptor: AI_DATA_WORKFLOW_DESCRIPTOR,
    definition,
  });
}

export function projectAIWorkflowAppBundles(
  registry: AIWorkflowResourceRegistryView,
  options: ProjectAIWorkflowAppBundlesOptions = {},
): readonly AIWorkflowAppBundleProjection[] {
  const diagnostics: AIWorkflowResourceProjectionDiagnostic[] = [];
  const workflowRecords = new Map<string, ResourceRecord>();
  for (const kind of AI_WORKFLOW_DEFINITION_RESOURCE_KINDS) {
    for (const resource of registry.byKind.get(kind) ?? []) {
      workflowRecords.set(resource.resourceId, resource);
    }
  }

  const appBundles = [...(registry.byKind.get('AIWorkflowAppBundle') ?? [])]
    .sort((left, right) => compareCodeUnits(left.resourceId, right.resourceId))
    .map((resource) => projectAppBundle(resource, workflowRecords, options, diagnostics));

  if (diagnostics.length > 0) {
    throw new AIWorkflowResourceProjectionError(Object.freeze(
      diagnostics.sort((left, right) => compareCodeUnits(left.location, right.location)
        || compareCodeUnits(left.code, right.code)),
    ));
  }

  return Object.freeze(appBundles.filter((bundle): bundle is AIWorkflowAppBundleProjection => bundle !== undefined));
}

const AI_WORKFLOW_DEFINITION_RESOURCE_KINDS = Object.freeze([
  'AICtrlWorkflow',
  'AIDataWorkflow',
] as const satisfies readonly AIWorkflowDefinitionResourceKind[]);

function projectAppBundle(
  resource: ResourceRecord,
  workflowRecords: ReadonlyMap<string, ResourceRecord>,
  options: ProjectAIWorkflowAppBundlesOptions,
  diagnostics: AIWorkflowResourceProjectionDiagnostic[],
): AIWorkflowAppBundleProjection | undefined {
  const bindingsNode = resource.node.subdomains.WorkflowBindings;
  if (!bindingsNode) {
    diagnostics.push(projectionDiagnostic(
      'AI_WORKFLOW_BINDINGS_MISSING',
      resource.documentUri,
      `AIWorkflowAppBundle '${resource.resourceId}' must declare WorkflowBindings.`,
    ));
    return undefined;
  }

  const bindingIds = new Set<string>();
  const workflowBindings: AIWorkflowBindingProjection[] = [];
  for (const [index, value] of bindingsNode.body.entries()) {
    const location = `${resource.documentUri}#WorkflowBindings:${index}`;
    if (!isResourceNode(value) || value.tag !== 'WorkflowBinding') {
      diagnostics.push(projectionDiagnostic(
        'AI_WORKFLOW_BINDING_NODE_INVALID',
        location,
        'WorkflowBindings may contain only WorkflowBinding nodes.',
      ));
      continue;
    }
    const binding = projectWorkflowBinding(value, workflowRecords, location, diagnostics);
    if (!binding) continue;
    if (bindingIds.has(binding.id)) {
      diagnostics.push(projectionDiagnostic(
        'AI_WORKFLOW_BINDING_ID_DUPLICATE',
        location,
        `WorkflowBinding id '${binding.id}' is declared more than once.`,
      ));
      continue;
    }
    bindingIds.add(binding.id);
    workflowBindings.push(binding);
  }

  const entrypoints = workflowBindings.filter((binding) => binding.entrypoint);
  if (entrypoints.length === 0) {
    diagnostics.push(projectionDiagnostic(
      'AI_WORKFLOW_APP_ENTRYPOINT_MISSING',
      resource.documentUri,
      `AIWorkflowAppBundle '${resource.resourceId}' must declare at least one workflow entrypoint.`,
    ));
  }

  const frozenBindings = Object.freeze(workflowBindings);
  return Object.freeze({
    kind: 'AIWorkflowAppBundle',
    fqn: resource.fqn ?? resource.resourceId,
    ...(options.packageResourceId === undefined ? {} : { packageResourceId: options.packageResourceId }),
    resource,
    workflowBindings: frozenBindings,
    entrypoints: Object.freeze(entrypoints),
  });
}

function projectWorkflowBinding(
  node: ResourceNode,
  workflowRecords: ReadonlyMap<string, ResourceRecord>,
  location: string,
  diagnostics: AIWorkflowResourceProjectionDiagnostic[],
): AIWorkflowBindingProjection | undefined {
  const id = node.resourceId;
  const kind = asString(node.properties.kind);
  const ref = asString(node.properties.ref);
  const entrypoint = node.properties.entrypoint;
  let valid = true;

  if (!id) {
    diagnostics.push(projectionDiagnostic(
      'AI_WORKFLOW_BINDING_ID_MISSING',
      location,
      'WorkflowBinding must declare an explicit #id.',
    ));
    valid = false;
  }
  if (!isWorkflowDefinitionResourceKind(kind)) {
    diagnostics.push(projectionDiagnostic(
      'AI_WORKFLOW_BINDING_KIND_INVALID',
      location,
      'WorkflowBinding kind must be AICtrlWorkflow or AIDataWorkflow.',
    ));
    valid = false;
  }
  const resourceId = resourceIdFromRef(ref);
  if (!resourceId) {
    diagnostics.push(projectionDiagnostic(
      'AI_WORKFLOW_BINDING_REF_INVALID',
      location,
      'WorkflowBinding ref must be a non-empty resource:// identity.',
    ));
    valid = false;
  }
  if (typeof entrypoint !== 'boolean') {
    diagnostics.push(projectionDiagnostic(
      'AI_WORKFLOW_BINDING_ENTRYPOINT_INVALID',
      location,
      'WorkflowBinding entrypoint must be an explicit boolean.',
    ));
    valid = false;
  }
  if (
    !valid
    || !id
    || !isWorkflowDefinitionResourceKind(kind)
    || !resourceId
    || typeof entrypoint !== 'boolean'
  ) return undefined;

  const target = workflowRecords.get(resourceId);
  if (!target) {
    diagnostics.push(projectionDiagnostic(
      'AI_WORKFLOW_BINDING_TARGET_MISSING',
      location,
      `WorkflowBinding target '${resourceId}' does not exist in the effective resource registry.`,
    ));
    return undefined;
  }
  if (target.kind !== kind) {
    diagnostics.push(projectionDiagnostic(
      'AI_WORKFLOW_BINDING_TARGET_KIND_MISMATCH',
      location,
      `WorkflowBinding declares kind '${kind}', but target '${resourceId}' has kind '${target.kind}'.`,
    ));
    return undefined;
  }

  return Object.freeze({
    id,
    kind,
    ref: ref as `resource://${string}`,
    entrypoint,
    resource: target,
  });
}

function isWorkflowDefinitionResourceKind(value: string | undefined): value is AIWorkflowDefinitionResourceKind {
  return value === 'AICtrlWorkflow' || value === 'AIDataWorkflow';
}

function resourceIdFromRef(value: string | undefined): string | undefined {
  const prefix = 'resource://';
  if (!value?.startsWith(prefix)) return undefined;
  const resourceId = value.slice(prefix.length);
  return resourceId.length > 0 && !resourceId.includes('://') ? resourceId : undefined;
}

function asString(value: ResourceValue | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isResourceNode(value: ResourceValue): value is ResourceNode {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && typeof (value as ResourceNode).tag === 'string'
    && Array.isArray((value as ResourceNode).body);
}

function projectionDiagnostic(
  code: string,
  location: string,
  message: string,
): AIWorkflowResourceProjectionDiagnostic {
  return Object.freeze({ code, location, message });
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export interface ResolveAIWorkflowReusePolicyInput {
  readonly nodeType: AIWorkflowNodeType;
  readonly explicitPolicy?: AIWorkflowReusePolicy;
  readonly nodeTypeDefaultPolicy?: AIWorkflowReusePolicy;
  readonly platformDefaultPolicy?: AIWorkflowReusePolicy;
}

export function resolveAIWorkflowReusePolicy(
  input: ResolveAIWorkflowReusePolicyInput,
): AIWorkflowEffectiveReusePolicy {
  if (input.explicitPolicy) {
    return {
      policy: input.explicitPolicy,
      source: 'node',
      nodeType: input.nodeType,
    };
  }

  if (input.nodeTypeDefaultPolicy) {
    return {
      policy: input.nodeTypeDefaultPolicy,
      source: 'node-type-default',
      nodeType: input.nodeType,
    };
  }

  if (input.nodeType === 'manual') {
    return {
      policy: AI_WORKFLOW_MANUAL_NODE_DEFAULT_REUSE_POLICY,
      source: 'node-type-default',
      nodeType: input.nodeType,
    };
  }

  if (input.platformDefaultPolicy) {
    return {
      policy: input.platformDefaultPolicy,
      source: 'platform-default',
      nodeType: input.nodeType,
    };
  }

  return {
    policy: AI_WORKFLOW_MACHINE_NODE_DEFAULT_REUSE_POLICY,
    source: 'node-type-default',
    nodeType: input.nodeType,
  };
}

export function createAIWorkflowRuntimeContext<
  Effects extends AIWorkflowEffectProvider | import('ai-workflow-contract').AIWorkflowAuthoredEffects,
  Store extends AIWorkflowStateProjection,
>(
  context: AIWorkflowRuntimeContext<Effects, Store>,
): AIWorkflowRuntimeContext<Effects, Store> {
  if (!context.roots.globalRoot) {
    throw new AIWorkflowFoundationError('AI workflow globalRoot is required');
  }
  if (!context.roots.workspaceRoot) {
    throw new AIWorkflowFoundationError('AI workflow workspaceRoot is required');
  }
  if (!context.effects) {
    throw new AIWorkflowFoundationError('AI workflow effects provider is required');
  }
  if (!context.stateStore) {
    throw new AIWorkflowFoundationError('AI workflow state store is required');
  }
  return Object.freeze({
    ...context,
    roots: Object.freeze({ ...context.roots }),
  });
}

export async function invokeAIWorkflowEffect<Input = unknown, Output = unknown>(
  context: AIWorkflowRuntimeContext,
  request: AIWorkflowEffectRequest<Input>,
): Promise<Output> {
  return context.effects.invoke<Input, Output>(request);
}

export interface CreateAIWorkflowEffectHandlerRegistryOptions {
  readonly handlers?: AIWorkflowEffectHandlerMap;
}

export function createAIWorkflowEffectHandlerRegistry(
  options: CreateAIWorkflowEffectHandlerRegistryOptions = {},
): AIWorkflowMutableEffectHandlerRegistry {
  const handlers = new Map<string, AIWorkflowEffectHandler>(
    Object.entries(options.handlers ?? {}),
  );
  return {
    hasHandler(operation) {
      return handlers.has(operation);
    },
    resolveHandler(operation) {
      return {
        operation,
        ...(handlers.has(operation) ? { handler: handlers.get(operation)! } : {}),
      };
    },
    listOperations() {
      return [...handlers.keys()].sort(compareCodeUnits);
    },
    registerHandler(operation, handler) {
      if (!operation) {
        throw new AIWorkflowFoundationError('AI workflow effect operation is required');
      }
      handlers.set(operation, handler);
    },
    unregisterHandler(operation) {
      return handlers.delete(operation);
    },
  };
}

export interface CreateEmbeddedAIWorkflowEffectProviderOptions {
  readonly roots: AIWorkflowRuntimeRoots;
  readonly registry?: AIWorkflowEffectHandlerRegistry;
  readonly handlers?: AIWorkflowEffectHandlerMap;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly onDispatch?: (request: AIWorkflowEffectRequest) => void;
  readonly onResult?: (request: AIWorkflowEffectRequest, result: unknown) => void;
}

export function createEmbeddedAIWorkflowEffectProvider(
  options: CreateEmbeddedAIWorkflowEffectProviderOptions,
): AIWorkflowEmbeddedEffectProvider {
  if (!options.roots.globalRoot) {
    throw new AIWorkflowFoundationError('AI workflow embedded effect provider globalRoot is required');
  }
  if (!options.roots.workspaceRoot) {
    throw new AIWorkflowFoundationError('AI workflow embedded effect provider workspaceRoot is required');
  }
  const registry = options.registry ?? createAIWorkflowEffectHandlerRegistry({
    handlers: options.handlers,
  });
  const roots = Object.freeze({ ...options.roots });
  return Object.freeze({
    roots,
    registry,
    async invoke<Input = unknown, Output = unknown>(
      request: AIWorkflowEffectRequest<Input>,
    ): Promise<Output> {
      const resolution = registry.resolveHandler(request.operation);
      if (!resolution.handler) {
        throw new AIWorkflowEffectHandlerNotFoundError(request.operation, request.effectId);
      }
      options.onDispatch?.(request);
      const result = await resolution.handler(request, {
        roots,
        ...(options.metadata ? { metadata: options.metadata } : {}),
      });
      options.onResult?.(request, result);
      return result as Output;
    },
  });
}

export interface ParsedAIWorkflowResourceRef {
  readonly ref: AIWorkflowResourceRef;
  readonly scheme: AIWorkflowResourceRefScheme;
  readonly target: string;
}

const RESOURCE_REF_PATTERN = /^([a-z][a-z0-9+.-]*):\/\/(.+)$/i;

const allowedResourceRefSchemes = new Set<string>(AI_WORKFLOW_ALLOWED_RESOURCE_REF_SCHEMES);

function hasContainmentEscape(target: string): boolean {
  if (target.toLowerCase().includes('%2e')) return true;
  let decoded: string;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    return true;
  }
  if (decoded.includes('\\')) return true;
  if (decoded.startsWith('/')) return true;
  if (/^[A-Za-z]:/.test(decoded)) return true;
  return decoded.split(/[/?#]+/).some((segment) => segment === '..');
}

/** @deprecated Compatibility helper; Halfcode owns canonical resource-reference validation. */
export function parseAIWorkflowResourceRef(value: string): ParsedAIWorkflowResourceRef | undefined {
  const match = RESOURCE_REF_PATTERN.exec(value);
  if (!match) return undefined;
  const [, scheme, target] = match;
  if (!allowedResourceRefSchemes.has(scheme)) return undefined;
  if (!target || hasContainmentEscape(target)) return undefined;
  return {
    ref: value as AIWorkflowResourceRef,
    scheme: scheme as AIWorkflowResourceRefScheme,
    target,
  };
}

/** @deprecated Compatibility helper; use typed refs projected from Halfcode ResourceRecord facts. */
export function isAIWorkflowResourceRef(value: string): value is AIWorkflowResourceRef {
  return parseAIWorkflowResourceRef(value) !== undefined;
}

/** @deprecated Compatibility helper; use typed refs projected from Halfcode ResourceRecord facts. */
export function assertAIWorkflowResourceRef(value: string): AIWorkflowResourceRef {
  const parsed = parseAIWorkflowResourceRef(value);
  if (!parsed) {
    throw new AIWorkflowFoundationError(`invalid AI workflow resource ref: ${value}`);
  }
  return parsed.ref;
}
