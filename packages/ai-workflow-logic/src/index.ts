import {
  AI_CTRL_WORKFLOW_DESCRIPTOR,
  AI_DATA_WORKFLOW_DESCRIPTOR,
  AI_WORKFLOW_ALLOWED_RESOURCE_REF_SCHEMES,
  AI_WORKFLOW_MACHINE_NODE_DEFAULT_REUSE_POLICY,
  AI_WORKFLOW_MANUAL_NODE_DEFAULT_REUSE_POLICY,
  type AICtrlWorkflowDefinitionBinding,
  type AIDataWorkflowDefinitionBinding,
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
  type AIWorkflowResourceRef,
  type AIWorkflowResourceRefScheme,
  type AIWorkflowReusePolicy,
  type AIWorkflowRuntimeRoots,
  type AIWorkflowRuntimeContext,
  type AIWorkflowStateStore,
  type AIWorkflowSubstrate,
} from 'ai-workflow-contract';

export class AIWorkflowFoundationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AIWorkflowFoundationError';
  }
}

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
  Effects extends AIWorkflowEffectProvider,
  Store extends AIWorkflowStateStore,
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
      return [...handlers.keys()].sort();
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

export function isAIWorkflowResourceRef(value: string): value is AIWorkflowResourceRef {
  return parseAIWorkflowResourceRef(value) !== undefined;
}

export function assertAIWorkflowResourceRef(value: string): AIWorkflowResourceRef {
  const parsed = parseAIWorkflowResourceRef(value);
  if (!parsed) {
    throw new AIWorkflowFoundationError(`invalid AI workflow resource ref: ${value}`);
  }
  return parsed.ref;
}
