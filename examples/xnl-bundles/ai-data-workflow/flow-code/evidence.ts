export interface SupportTicket {
  ticketId: string;
  message: string;
}

export interface EvidenceRecord {
  ticketId: string;
  facts: string[];
}

export function retrieveEvidence(_runtime: unknown, input: { ticket: SupportTicket }) {
  return {
    evidence: {
      ticketId: input.ticket.ticketId,
      facts: [`message:${input.ticket.message}`],
    } satisfies EvidenceRecord,
  };
}

export function summarizeEvidence(_runtime: unknown, input: { evidence: EvidenceRecord }) {
  return {
    summary: `${input.evidence.ticketId}: ${input.evidence.facts.join('; ')}`,
  };
}
