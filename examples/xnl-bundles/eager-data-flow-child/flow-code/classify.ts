interface Customer {
  annualSpend: number;
}

export function classifyCustomer(
  _runtime: unknown,
  input: Readonly<{ customer: Customer }>,
): { segment: string } {
  return { segment: input.customer.annualSpend >= 10000 ? 'priority' : 'standard' };
}
