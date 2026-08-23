import type { AICtrlWorkflowRuntime, AIAgentEffectConfig, AIAgentSelector, AIWorkflowAuthoredEffects, FlowClosedValue } from 'ai-workflow-contract';

export interface SupportReviewInput {
  ticketId: string;
  message: string;
}

export interface SupportReviewResult {
  ticketId: string;
  approved: boolean;
  summary: string;
}

type Runtime = AICtrlWorkflowRuntime<AIWorkflowAuthoredEffects>;
type AgentConfig = { agent: AIAgentEffectConfig & { selector?: AIAgentSelector } };

export function draftContext(runtime: Runtime, input: SupportReviewInput, config: AgentConfig) {
  return runtime.ai.effects.runAgent({
    ticketId: input.ticketId,
    prompt: `Review support ticket: ${input.message}`,
  }, config.agent);
}

export function refineContext(runtime: Runtime, input: { output: FlowClosedValue }, config: AgentConfig) {
  const { selector, ...agentConfig } = config.agent;
  return runtime.ai.effects.runTargetedAgent(
    selector!,
    { kind: 'ai.agent', payload: { prior: input.output } },
    agentConfig,
  );
}

export function toResult(
  _runtime: unknown,
  input: { ticketId?: string; approved?: boolean; summary?: string },
  _config: unknown,
) {
  return {
    ticketId: input.ticketId ?? 'unknown-ticket',
    approved: input.approved ?? false,
    summary: input.summary ?? 'pending review',
  } satisfies SupportReviewResult;
}
