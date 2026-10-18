import { describe, it, expect } from 'vitest';
import { productSchema } from '../packages/contracts/src/index';
import { resolvePrice } from '../apps/api/src/pricing-engine';

describe('optional product prices', () => {
  const product = {
    name: 'Yogurt',
    sku: 'YOG',
    category: 'Dairy',
    unit: 'piece',
    minStock: '0',
    barcodes: [],
  };
  it.each([{}, { price: '', cost: '' }, { price: null, cost: null }])(
    'preserves missing prices as unknown: %j',
    (prices) => {
      expect(productSchema.parse({ ...product, ...prices })).toMatchObject({
        price: null,
        cost: null,
      });
    },
  );
  it('distinguishes an explicitly entered zero from an unknown price', () => {
    expect(productSchema.parse({ ...product, price: '0', cost: '0' })).toMatchObject({
      price: '0',
      cost: '0',
    });
  });
  it.each(['-1', 'abc', '1.234'])('rejects invalid prices %s', (price) => {
    expect(productSchema.safeParse({ ...product, price }).success).toBe(false);
  });
  it('rejects unpriced sales before calculating promotions', async () => {
    await expect(resolvePrice({} as any, 'store', { id: 'product', price: null })).rejects.toThrow(
      'Set a selling price',
    );
  });
});
