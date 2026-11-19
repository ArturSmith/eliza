import { describe, it, expect } from 'vitest';
import {
  applyLoyaltyDiscount,
  toScaled,
  loyaltyProgramSchema,
} from '../packages/contracts/src/index';
const line = (total: string, taxRate = '0') => ({
  total,
  taxRate,
  discount: '0.00',
  tax: taxRate === '25' ? '20.00' : '0.00',
});
describe('cashier Collect or Spend bonus allocation', () => {
  it('spends 50 from a balance of 100 on a purchase of 50 without earning new points', () => {
    const r = applyLoyaltyDiscount([line('50', '25')], {
      balance: '100',
      mode: 'spend',
      earnPercent: '3',
    });
    expect(r.spent).toBe('50.00');
    expect(r.earned).toBe('0.00');
    expect(r.lines[0].total).toBe('0.00');
    expect(r.lines[0].tax).toBe('0.00');
  });
  it('collects instead of spending when Collect is selected, even with an existing balance', () => {
    const r = applyLoyaltyDiscount([line('50')], {
      balance: '100',
      mode: 'collect',
      earnPercent: '3',
    });
    expect(r.spent).toBe('0.00');
    expect(r.earned).toBe('1.50');
    expect(r.lines[0].total).toBe('50.00');
  });
  it('uses only the available balance and reconciles taxes and cash across mixed-rate lines', () => {
    const r = applyLoyaltyDiscount([line('100', '25'), line('60')], {
      balance: '80',
      mode: 'spend',
      earnPercent: '3',
    });
    expect(r.spent).toBe('80.00');
    expect(r.earned).toBe('0.00');
    expect(r.lines.map((l) => l.total)).toEqual(['50.00', '30.00']);
    expect(r.lines.map((l) => l.tax)).toEqual(['10.00', '0.00']);
  });
  it('allocates a single-cent redemption exactly and does not earn on the cash remainder', () => {
    const r = applyLoyaltyDiscount([line('0.01'), line('0.01'), line('0.01')], {
      balance: '0.01',
      mode: 'spend',
      earnPercent: '3',
    });
    expect(r.lines.reduce((s, l) => s + toScaled(l.total, 2), 0n)).toBe(2n);
    expect(r.lines.reduce((s, l) => s + toScaled(l.loyaltyDiscount, 2), 0n)).toBe(1n);
    expect(r.earned).toBe('0.00');
  });
  it('rounds earnings once for the basket, independently of how many lines it contains', () => {
    const split = applyLoyaltyDiscount([line('0.02'), line('0.02')], {
      balance: '0',
      mode: 'collect',
      earnPercent: '25',
    });
    const combined = applyLoyaltyDiscount([line('0.04')], {
      balance: '0',
      mode: 'collect',
      earnPercent: '25',
    });
    expect(split.earned).toBe('0.01');
    expect(split.earned).toBe(combined.earned);
    for (const price of ['0.01', '0.02', '0.03', '0.09', '0.25', '0.99']) {
      for (let count = 1; count <= 20; count++) {
        const result = applyLoyaltyDiscount(
          Array.from({ length: count }, () => line(price)),
          { balance: '0', mode: 'collect', earnPercent: '25' },
        );
        const expected = (toScaled(price, 2) * BigInt(count) * 2500n + 5000n) / 10000n;
        expect(toScaled(result.earned, 2)).toBe(expected);
        expect(result.lines.reduce((sum, l) => sum + toScaled(l.loyaltyEarned, 2), 0n)).toBe(
          expected,
        );
      }
    }
  });
  it('caps redemption at the configured share and floors fractional cents', () => {
    const member = {
      balance: '1500',
      mode: 'spend' as const,
      earnPercent: '3',
      redeemPercent: '20',
    };
    const capped = applyLoyaltyDiscount([line('1000', '25')], member);
    expect(capped.spent).toBe('200.00');
    expect(capped.lines[0].total).toBe('800.00');
    expect(capped.lines[0].tax).toBe('160.00');
    expect(capped.earned).toBe('0.00');
    expect(applyLoyaltyDiscount([line('1000')], { ...member, balance: '75' }).spent).toBe('75.00');
    expect(applyLoyaltyDiscount([line('1000')], { ...member, redeemPercent: '0' }).spent).toBe(
      '0.00',
    );
    expect(applyLoyaltyDiscount([line('0.03')], member).spent).toBe('0.00');
    expect(applyLoyaltyDiscount([line('0.10')], { ...member, redeemPercent: '12.34' }).spent).toBe(
      '0.01',
    );
    const collect = applyLoyaltyDiscount([line('1000')], { ...member, mode: 'collect' });
    expect(collect.earned).toBe('30.00');
    expect(collect.spent).toBe('0.00');
  });
  it('validates redemption percentages without silently resetting omitted values', () => {
    const program = {
      enabled: true,
      name: 'Rewards',
      description: '',
      earnPercent: '3',
      version: 1,
    };
    expect(loyaltyProgramSchema.parse({ ...program, redeemPercent: '20.25' }).redeemPercent).toBe(
      '20.25',
    );
    expect(loyaltyProgramSchema.parse(program).redeemPercent).toBeUndefined();
    for (const value of ['-1', '100.01', '101', '20.001', 'abc'])
      expect(loyaltyProgramSchema.safeParse({ ...program, redeemPercent: value }).success).toBe(
        false,
      );
  });
  it('never redeems a negative balance and keeps legacy capped codes bounded by their authorization', () => {
    const negative = applyLoyaltyDiscount([line('100')], {
      balance: '-3',
      mode: 'spend',
      earnPercent: '3',
    });
    expect(negative.spent).toBe('0.00');
    expect(negative.lines[0].total).toBe('100.00');
    const legacy = applyLoyaltyDiscount([line('100')], {
      balance: '100',
      maxPoints: '6',
      earnPercent: '3',
    });
    expect(legacy.spent).toBe('6.00');
    expect(legacy.lines[0].total).toBe('94.00');
    expect(legacy.earned).toBe('0.00');
  });
});
