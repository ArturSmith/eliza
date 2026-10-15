import { describe, it, expect } from 'vitest';
import {
  planReplenishment,
  type ReplenishmentInput,
} from '../packages/contracts/src/replenishment';
const input: ReplenishmentInput = {
  today: '2026-10-15',
  unit: 'piece',
  sold: '28.000',
  observedDays: 28,
  available: '3.000',
  incoming: [],
  uncertainIncoming: '0',
  leadDays: 3,
  packSize: '6',
  minimumOrder: '0',
  reviewDays: 7,
  safetyDays: 2,
  stockReconciled: true,
};
describe('sales-based replenishment planning', () => {
  it('rounds a sales-based deficit to packs and orders before lead time and safety stock run out', () => {
    expect(planReplenishment(input)).toMatchObject({
      dailySales: '1.000',
      quantity: '12.000',
      targetStock: '12.000',
      status: 'order_now',
      orderBy: '2026-10-15',
    });
  });
  it('uses minimum order and keeps kilogram pack quantities precise', () => {
    expect(planReplenishment({ ...input, minimumOrder: '20' }).quantity).toBe('24.000');
    expect(
      planReplenishment({
        ...input,
        unit: 'kilogram',
        sold: '2.800',
        available: '0.300',
        packSize: '0.250',
      }).quantity,
    ).toBe('1.000');
  });
  it('subtracts dated deliveries without hiding an earlier shortage', () => {
    expect(
      planReplenishment({ ...input, incoming: [{ quantity: '20', date: '2026-10-17' }] }).status,
    ).toBe('covered');
    expect(
      planReplenishment({ ...input, incoming: [{ quantity: '20', date: '2026-10-25' }] }),
    ).toMatchObject({ status: 'needs_review', quantity: null, warnings: ['arrival_gap'] });
    expect(
      planReplenishment({ ...input, incoming: [{ quantity: '20', date: '2026-12-01' }] }).quantity,
    ).toBe('12.000');
  });
  it('withholds guesses for insufficient history and missing or unreliable supply facts', () => {
    expect(planReplenishment({ ...input, observedDays: 3 }).quantity).toBeNull();
    expect(planReplenishment({ ...input, leadDays: null })).toMatchObject({
      status: 'needs_review',
      quantity: null,
      orderBy: null,
    });
    expect(planReplenishment({ ...input, uncertainIncoming: '10' }).quantity).toBeNull();
    expect(planReplenishment({ ...input, stockReconciled: false }).warnings).toContain(
      'stock_mismatch',
    );
    expect(planReplenishment({ ...input, packSize: '2.5' }).warnings).toContain(
      'invalid_pack_size',
    );
  });
  it('does not label a new product as slow and recommends no speculative reorder for zero sales', () => {
    expect(planReplenishment({ ...input, sold: '0', observedDays: 3 }).demandStatus).toBe(
      'insufficient_history',
    );
    expect(planReplenishment({ ...input, sold: '0', available: '0' })).toMatchObject({
      status: 'needs_review',
      quantity: null,
    });
    expect(planReplenishment({ ...input, sold: '0' })).toMatchObject({
      demandStatus: 'no_sales',
      quantity: '0.000',
      status: 'no_demand',
    });
    expect(planReplenishment({ ...input, available: '100' }).demandStatus).toBe('slow');
  });
  it('accounts for stock that expires before it can be sold', () => {
    expect(
      planReplenishment({
        ...input,
        available: '10',
        packSize: '1',
        stockLots: [{ quantity: '10', expiry: '2026-10-16' }],
      }),
    ).toMatchObject({ quantity: '11.000', status: 'order_now' });
  });
  it('supports same-day suppliers and a future order-by date', () => {
    expect(planReplenishment({ ...input, available: '0', leadDays: 0 })).toMatchObject({
      status: 'order_now',
      orderBy: '2026-10-15',
    });
    expect(planReplenishment({ ...input, available: '10', packSize: '1' })).toMatchObject({
      quantity: '2.000',
      status: 'order_later',
      orderBy: '2026-10-20',
    });
  });
  it('computes from the unrounded rate for very slow weighted sales', () => {
    expect(
      planReplenishment({
        ...input,
        unit: 'kilogram',
        sold: '0.014',
        observedDays: 14,
        available: '0',
        packSize: '0.001',
        leadDays: 0,
        reviewDays: 1,
        safetyDays: 0,
      }).quantity,
    ).toBe('0.001');
  });
});
