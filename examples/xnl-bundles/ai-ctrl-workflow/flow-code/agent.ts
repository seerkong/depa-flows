export interface SupportReviewInput {
  ticketId: string;
  message: string;
}

export interface SupportReviewResult {
  ticketId: string;
  approved: boolean;
  summary: string;
}

export function draftContext(_runtime: unknown, input: SupportReviewInput) {
  return {
    ticketId: input.ticketId,
    prompt: `Review support ticket: ${input.message}`,
  };
}

export function toResult(_runtime: unknown, input: { ticketId?: string; approved?: boolean; summary?: string }) {
  return {
    ticketId: input.ticketId ?? 'unknown-ticket',
    approved: input.approved ?? false,
    summary: input.summary ?? 'pending review',
  } satisfies SupportReviewResult;
}
