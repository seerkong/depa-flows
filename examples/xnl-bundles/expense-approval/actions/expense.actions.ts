import type { TaskStepResult } from 'bp-ctrl-flow-contract';

interface ExpenseRuntime {
  payout(expense: Expense): Promise<{ payoutId: string }>;
}

export interface ExpenseApprovalInput {
  expenseId?: string;
  amount?: number;
  currency?: string;
}

export interface Expense {
  expenseId: string;
  amount: number;
  currency: string;
}

export type ExpenseApprovalOutput =
  | TaskStepResult<Expense>
  | {
      outcome: 'paid';
      expense: Expense;
      payoutId: string;
    };

export function validateExpense(
  _runtime: ExpenseRuntime,
  input: ExpenseApprovalInput,
  _config: Readonly<Record<string, never>>,
): Expense {
  return {
    expenseId: input.expenseId ?? 'exp-demo-001',
    amount: input.amount ?? 8800,
    currency: input.currency ?? 'CNY',
  };
}

export function isApproved(
  _runtime: ExpenseRuntime,
  input: TaskStepResult<Expense>,
  _config: Readonly<Record<string, never>>,
): boolean {
  return input.outcome === 'approved';
}

export function needsFinanceApproval(
  _runtime: ExpenseRuntime,
  input: TaskStepResult<Expense>,
  config: Readonly<{ threshold: number }>,
): boolean {
  return (input.payload?.amount ?? 0) > config.threshold;
}

export function isForwarded(
  _runtime: ExpenseRuntime,
  input: TaskStepResult,
  _config: Readonly<Record<string, never>>,
): boolean {
  return input.outcome === 'forwarded';
}

export function taskPayload(
  _runtime: ExpenseRuntime,
  input: TaskStepResult<Expense>,
  _config: Readonly<Record<string, never>>,
): Expense {
  if (!input.payload) throw new Error('task result is missing expense payload');
  return input.payload;
}

export async function payoutExpense(
  runtime: ExpenseRuntime,
  input: Expense,
  _config: Readonly<Record<string, never>>,
) {
  const payout = await runtime.payout(input);
  return { outcome: 'paid', expense: input, ...payout };
}
