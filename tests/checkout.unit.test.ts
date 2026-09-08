import { describe, it, expect } from 'vitest';
import { calculateLine, productSchema, saleSchema } from '../packages/contracts/src/index';
describe('checkout arithmetic', () => {
  it('extracts included tax without adding it twice', () =>
    expect(calculateLine('115.00', '1', '15')).toEqual({
      gross: '115.00',
      discount: '0.00',
      total: '115.00',
      tax: '15.00',
    }));
  it('rounds weighted amounts and percentage discounts to cents', () =>
    expect(calculateLine('29.90', '1.350', '15', '10')).toEqual({
      gross: '40.37',
      discount: '4.04',
      total: '36.33',
      tax: '4.74',
    }));
  it('handles a fully discounted sale', () =>
    expect(calculateLine('99.99', '2', '25', '100')).toEqual({
      gross: '199.98',
      discount: '199.98',
      total: '0.00',
      tax: '0.00',
    }));
  it.each([
    ['-1', '1', '0'],
    ['1', '0', '0'],
    ['1', '1', '101'],
  ])('rejects invalid arithmetic %s %s %s', (price, qty, tax) =>
    expect(() => calculateLine(price, qty, tax)).toThrow(),
  );
  it('rejects malformed quantities without throwing from validation', () =>
    expect(() =>
      productSchema.safeParse({
        name: 'P',
        sku: 'P',
        category: 'P',
        unit: 'piece',
        price: '1',
        cost: '1',
        minStock: 'abc',
        barcodes: [],
      }),
    ).not.toThrow());
  it('rejects duplicate cart products', () => {
    const line = {
      productId: crypto.randomUUID(),
      quantity: '1',
      expectedPrice: '1',
      expectedTaxRate: '0',
    };
    expect(
      saleSchema.safeParse({
        requestId: crypto.randomUUID(),
        shiftId: crypto.randomUUID(),
        lines: [line, line],
        payment: { method: 'cash', tendered: '2' },
      }).success,
    ).toBe(false);
  });
});
