import type { AIAgentCodeExecutionIdentity, AIAgentCodeResourceProjection, CompiledAIAgentCodeExecution } from 'ai-workflow-contract';

interface CodeExecutionAuthority {
  readonly projection: AIAgentCodeResourceProjection;
  readonly identity: AIAgentCodeExecutionIdentity;
}
const authorities = new WeakMap<object, CodeExecutionAuthority>();
export function markAIAgentCodeExecution(value: CompiledAIAgentCodeExecution, authority: CodeExecutionAuthority): CompiledAIAgentCodeExecution {
  authorities.set(value, Object.freeze(authority));
  return value;
}
export function authorityForAIAgentCodeExecution(value: CompiledAIAgentCodeExecution): CodeExecutionAuthority | undefined {
  return authorities.get(value);
}
