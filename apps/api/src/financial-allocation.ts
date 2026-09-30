import { fromScaled, toScaled } from '@eliza/contracts';

export type ExpenseAllocation = {
  amount: string;
  date: string;
  allocationMethod: 'ONE_TIME' | 'EVEN_OVER_PERIOD';
  periodStart: string | null;
  periodEnd: string | null;
};

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86400000;

/** Inclusive local calendar dates. Remainder cents go to the earliest days. */
export function allocatedExpenseCents(
  expense: ExpenseAllocation,
  from: string,
  to: string,
): bigint {
  const amount = toScaled(expense.amount, 2);
  if (expense.allocationMethod === 'ONE_TIME')
    return expense.date >= from && expense.date <= to ? amount : 0n;
  if (!expense.periodStart || !expense.periodEnd)
    throw new Error('Period expense is missing its economic dates');
  const first = dayNumber(expense.periodStart);
  const last = dayNumber(expense.periodEnd);
  const start = Math.max(first, dayNumber(from));
  const end = Math.min(last, dayNumber(to));
  if (start > end) return 0n;
  const days = BigInt(last - first + 1);
  const ordinary = amount / days;
  const remainder = Number(amount % days);
  const firstOffset = start - first;
  const lastOffset = end - first;
  const bonus = Math.max(0, Math.min(remainder, lastOffset + 1) - Math.min(remainder, firstOffset));
  return ordinary * BigInt(end - start + 1) + BigInt(bonus);
}

export function allocatedExpenseAmount(expense: ExpenseAllocation, from: string, to: string) {
  return fromScaled(allocatedExpenseCents(expense, from, to), 2);
}
