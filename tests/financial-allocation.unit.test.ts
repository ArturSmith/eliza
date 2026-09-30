import { describe, expect, it } from 'vitest';
import { allocatedExpenseAmount } from '../apps/api/src/financial-allocation';

describe('management expense allocation', () => {
  it('attributes one-time costs to the economic date, not a payment date', () => {
    const expense = {
      amount: '3000.00',
      date: '2026-09-12',
      allocationMethod: 'ONE_TIME' as const,
      periodStart: null,
      periodEnd: null,
    };
    expect(allocatedExpenseAmount(expense, '2026-09-12', '2026-09-12')).toBe('3000.00');
    expect(allocatedExpenseAmount(expense, '2026-09-13', '2026-09-30')).toBe('0.00');
  });

  it('allocates every cent exactly once over an inclusive period', () => {
    const expense = {
      amount: '100.01',
      date: '2026-09-01',
      allocationMethod: 'EVEN_OVER_PERIOD' as const,
      periodStart: '2026-09-01',
      periodEnd: '2026-09-03',
    };
    expect(allocatedExpenseAmount(expense, '2026-09-01', '2026-09-01')).toBe('33.34');
    expect(allocatedExpenseAmount(expense, '2026-09-02', '2026-09-02')).toBe('33.34');
    expect(allocatedExpenseAmount(expense, '2026-09-03', '2026-09-03')).toBe('33.33');
    expect(allocatedExpenseAmount(expense, '2026-09-01', '2026-09-03')).toBe('100.01');
  });
});
