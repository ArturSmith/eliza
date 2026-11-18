import { describe, it, expect } from 'vitest';
import { applyLoyaltyDiscount, toScaled } from '../packages/contracts/src/index';
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
