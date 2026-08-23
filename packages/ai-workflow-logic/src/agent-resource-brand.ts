import type {
  AIWorkflowAgentResourceProjection,
  AIWorkflowResourceRegistryView,
} from 'ai-workflow-contract';

const sourceRegistryByProjection = new WeakMap<object, AIWorkflowResourceRegistryView>();

export function markAIWorkflowAgentResourceProjection(
  projection: AIWorkflowAgentResourceProjection,
  registry: AIWorkflowResourceRegistryView,
): AIWorkflowAgentResourceProjection {
  sourceRegistryByProjection.set(projection, registry);
  return projection;
}

export function sourceRegistryForAIWorkflowAgentResourceProjection(
  projection: AIWorkflowAgentResourceProjection,
): AIWorkflowResourceRegistryView | undefined {
  return sourceRegistryByProjection.get(projection);
}
