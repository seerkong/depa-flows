interface Customer {
  name: string;
}

interface ExampleRuntime {
  audits: string[];
}

export function auditSegment(
  runtime: ExampleRuntime,
  input: Readonly<{ segment: string }>,
): void {
  runtime.audits.push(input.segment);
}

export function formatSummary(
  _runtime: ExampleRuntime,
  input: Readonly<{ customer: Customer; segment: string }>,
): { summary: string } {
  return { summary: `${input.customer.name}: ${input.segment}` };
}
