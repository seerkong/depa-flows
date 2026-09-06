import type { AIDataWorkflowRuntime, AIAgentEffectConfig, AIAgentInstanceReference, AIWorkflowAuthoredEffects, FlowClosedValue } from 'ai-workflow-contract';

export interface SupportTicket {
  ticketId: string;
  message: string;
}

export interface EvidenceRecord {
  ticketId: string;
  facts: string[];
}

type Runtime = AIDataWorkflowRuntime<AIWorkflowAuthoredEffects>;
type AgentConfig = { agent: AIAgentEffectConfig };

export async function retrieveEvidence(runtime: Runtime, input: { ticket: SupportTicket }, config: AgentConfig) {
  const result = await runtime.ai.effects.runAgent({
    ticketId: input.ticket.ticketId,
    message: input.ticket.message,
  }, config.agent);
  return {
    evidence: result.output as unknown as EvidenceRecord,
    instance: result.instance,
  };
}

export async function summarizeEvidence(runtime: Runtime, input: { evidence: EvidenceRecord; prior: AIAgentInstanceReference }, config: AgentConfig) {
  const result = await runtime.ai.effects.runTargetedAgent(
    { byId: input.prior.instanceId },
    { kind: 'ai.agent', payload: { evidence: input.evidence as unknown as FlowClosedValue } },
    config.agent,
  );
  return {
    summary: String((result.output as { summary?: string }).summary ?? ''),
  };
}
