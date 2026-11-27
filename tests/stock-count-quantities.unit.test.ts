import { describe, expect, it } from 'vitest';
import { normalizeCountQuantity } from '../apps/web/src/stock-count-quantities';

describe('physical count quantities', () => {
  it.each([
    ['0', 'piece', '0.000'],
    [' 2,5 ', 'kilogram', '2.500'],
    ['0.001', 'liter', '0.001'],
    ['2,000', 'pack', '2.000'],
    ['999999999', 'box', '999999999.000'],
  ])('normalizes %s for %s without losing precision', (value, unit, expected) => {
    expect(normalizeCountQuantity(value, unit)).toBe(expected);
  });
  it.each(['', ' ', '-1', '1e3', '1.2345', '1,2,3', '1000000000', 'NaN'])(
    'rejects invalid or missing counts instead of treating %s as zero',
    (value) => {
      expect(() => normalizeCountQuantity(value, 'kilogram')).toThrow();
    },
  );
  it.each(['piece', 'pack', 'box'])('requires a whole count for %s', (unit) => {
    expect(() => normalizeCountQuantity('1,5', unit)).toThrow('whole-number');
  });
});
