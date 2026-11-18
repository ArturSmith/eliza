import { describe, it, expect } from 'vitest';
import { applyLoyaltyDiscount, toScaled } from '../packages/contracts/src/index';
const line = (total: string, taxRate = '0') => ({
  total,
  taxRate,
  discount: '0.00',
  tax: taxRate === '25' ? '20.00' : '0.00',
});
describe('loyalty discount and bonus allocation', () => {
  it('reconciles a capped redemption, included tax and earned points across mixed-rate lines', () => {
    const result = applyLoyaltyDiscount([line('100', '25'), line('60')], {
      balance: '80',
      maxPoints: '80',
      redeemPercent: '20',
      earnPercent: '3',
    });
    expect(result.spent).toBe('32.00');
    expect(result.earned).toBe('3.84');
    expect(result.lines.map((l) => l.total)).toEqual(['80.00', '48.00']);
    expect(result.lines.map((l) => l.tax)).toEqual(['16.00', '0.00']);
    expect(result.lines.map((l) => l.loyaltyDiscount)).toEqual(['20.00', '12.00']);
  });
  it('preserves the exact single-cent discount across tiny basket lines', () => {
    const result = applyLoyaltyDiscount([line('0.01'), line('0.01'), line('0.01')], {
      balance: '0.01',
      maxPoints: '0.01',
      redeemPercent: '100',
      earnPercent: '3',
    });
    expect(result.lines.reduce((sum, l) => sum + toScaled(l.total, 2), 0n)).toBe(2n);
    expect(result.lines.reduce((sum, l) => sum + toScaled(l.loyaltyDiscount, 2), 0n)).toBe(1n);
    expect(result.lines.every((l) => toScaled(l.total, 2) >= 0n)).toBe(true);
  });
  it('never spends from a membership identifier alone or from a negative balance', () => {
    for (const member of [
      { balance: '100', redeemPercent: '100', earnPercent: '3' },
      { balance: '-3', maxPoints: '20', redeemPercent: '100', earnPercent: '3' },
    ]) {
      const result = applyLoyaltyDiscount([line('100')], member);
      expect(result.spent).toBe('0.00');
      expect(result.earned).toBe('3.00');
      expect(result.lines[0].total).toBe('100.00');
    }
  });
  it('limits redemption to the purchase total and awards no points on the free portion', () => {
    const result = applyLoyaltyDiscount([line('100', '25')], {
      balance: '200',
      maxPoints: '200',
      redeemPercent: '100',
      earnPercent: '3',
    });
    expect(result.spent).toBe('100.00');
    expect(result.earned).toBe('0.00');
    expect(result.lines[0].total).toBe('0.00');
    expect(result.lines[0].tax).toBe('0.00');
  });
});
