import { describe, expect, it } from 'vitest';
import { stockQuantity, stockReasons } from '../apps/web/src/stock-adjustment';

describe('directed stock operations', () => {
  it('applies the operation sign to positive quantities, including comma decimals', () => {
    expect(stockQuantity('24', 'add')).toBe('24.000');
    expect(stockQuantity('2', 'remove')).toBe('-2.000');
    expect(stockQuantity(' 1,250 ', 'remove')).toBe('-1.250');
    expect(stockQuantity('-2', 'signed')).toBe('-2');
  });
  it('rejects zero, negative magnitudes and quantities that would lose precision', () => {
    for (const value of ['0', '0.000', '-1', '-0.5', '1.2345', '', 'NaN']) {
      expect(() => stockQuantity(value, 'add')).toThrow();
      expect(() => stockQuantity(value, 'remove')).toThrow();
    }
  });
  it('offers only reasons appropriate to the selected direction', () => {
    expect(stockReasons('add')).toEqual(['received', 'opening_balance', 'other']);
    expect(stockReasons('remove')).toEqual(['damaged', 'expired', 'lost', 'internal_use', 'other']);
    expect(stockReasons('signed')).toContain('count_correction');
  });
});
