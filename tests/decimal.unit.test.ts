import { describe, expect, it } from 'vitest';
import {
  toScaled,
  fromScaled,
  productSchema,
  adjustmentSchema,
} from '../packages/contracts/src/index';
describe('decimal boundaries', () => {
  it('keeps money exact', () =>
    expect(fromScaled(toScaled('0.10', 2) + toScaled('0.20', 2), 2)).toBe('0.30'));
  it('represents fractional and negative quantities', () =>
    expect(fromScaled(toScaled('1.350', 3) + toScaled('-0.125', 3), 3)).toBe('1.225'));
  it('rejects silent precision loss', () =>
    expect(() => toScaled('0.001', 2)).toThrow('Too many decimal places'));
  it.each(['NaN', 'Infinity', '1e3', '1,20', '0x10', '1.2.3'])('rejects invalid decimal %s', (v) =>
    expect(() => toScaled(v, 3)).toThrow(),
  );
  it('permits products without barcodes', () =>
    expect(
      productSchema.safeParse({
        name: 'Bread',
        sku: 'B-1',
        category: 'Bakery',
        unit: 'piece',
        price: '19.90',
        cost: '8.00',
        minStock: '5',
        barcodes: [],
      }).success,
    ).toBe(true));
  it('rejects a zero stock movement', () =>
    expect(
      adjustmentSchema.safeParse({
        productId: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        quantity: '0.000',
        reason: 'other',
      }).success,
    ).toBe(false));
});
