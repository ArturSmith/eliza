import { describe, expect, it } from 'vitest';
import {
  calculateLine,
  calculatePurchaseLine,
  expenseSchema,
  money,
  toScaled,
  fromScaled,
} from '../packages/contracts/src/index';
describe('money boundaries and conservation', () => {
  it.each([
    ['0.01', '0.499', '0', '0', { gross: '0.00', discount: '0.00', total: '0.00', tax: '0.00' }],
    ['0.01', '0.500', '0', '0', { gross: '0.01', discount: '0.00', total: '0.01', tax: '0.00' }],
    ['0.01', '1', '0', '50', { gross: '0.01', discount: '0.01', total: '0.00', tax: '0.00' }],
    ['0.03', '1', '100', '0', { gross: '0.03', discount: '0.00', total: '0.03', tax: '0.02' }],
    [
      '0',
      '999999999.999',
      '100',
      '100',
      { gross: '0.00', discount: '0.00', total: '0.00', tax: '0.00' },
    ],
  ])('rounds sale boundaries for %s × %s', (price, qty, tax, discount, expected) => {
    expect(calculateLine(price, qty, tax, discount)).toEqual(expected);
  });
  it('conserves cents and never adds inclusive tax again across fractional sales and discounts', () => {
    for (const price of ['0', '0.01', '0.03', '19.99', '999999999.99'])
      for (const qty of ['0.001', '0.499', '0.5', '1', '1.999'])
        for (const tax of ['0', '5.5', '20', '100']) {
          let last: bigint | null = null;
          for (const discount of ['0', '0.01', '12.5', '50', '99.99', '100']) {
            const line = calculateLine(price, qty, tax, discount);
            const total = toScaled(line.total, 2);
            expect(total + toScaled(line.discount, 2)).toBe(toScaled(line.gross, 2));
            expect(toScaled(line.tax, 2)).toBeGreaterThanOrEqual(0n);
            expect(toScaled(line.tax, 2)).toBeLessThanOrEqual(total);
            if (last !== null) expect(total).toBeLessThanOrEqual(last);
            last = total;
          }
        }
  });
  it.each(['-0.01', 'NaN', 'Infinity', '1e2', '1,00', '1.001', '1000000000', '', ' 1'])(
    'rejects invalid API money %s',
    (value) => expect(money.safeParse(value).success).toBe(false),
  );
  it('accepts the maximum supported amount and round-trips it exactly', () => {
    expect(money.safeParse('999999999.99').success).toBe(true);
    expect(fromScaled(toScaled('999999999.99', 2), 2)).toBe('999999999.99');
  });
  it.each(['0', '-1', '1.001', 'NaN'])(
    'requires positive cent-precision expenses (%s)',
    (amount) => {
      expect(
        expenseSchema.safeParse({
          date: '2026-09-26',
          description: 'Cost',
          category: 'Other',
          amount,
          paymentMethod: 'cash',
        }).success,
      ).toBe(false);
    },
  );
  it.each([
    ['0.01', '0.499', '100', { subtotal: '0.00', tax: '0.00', total: '0.00' }],
    ['0.01', '0.5', '100', { subtotal: '0.01', tax: '0.01', total: '0.02' }],
    ['0.03', '1', '50', { subtotal: '0.03', tax: '0.02', total: '0.05' }],
  ])('rounds exclusive purchase tax at cent boundaries %s × %s', (cost, qty, tax, expected) =>
    expect(calculatePurchaseLine(cost, qty, tax)).toEqual(expected),
  );
});
