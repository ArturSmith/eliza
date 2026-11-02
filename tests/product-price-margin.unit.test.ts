import { describe, expect, it } from 'vitest';
import { productPriceMargin } from '../apps/web/src/product-price-margin';

describe('catalog price margin', () => {
  it('uses the checkout tax calculation before subtracting the product purchase cost', () => {
    expect(productPriceMargin({ price: '70.00', cost: '59.00', taxRate: '0' })).toEqual({
      percent: '15.71',
      profit: '11.00',
    });
    expect(productPriceMargin({ price: '125.00', cost: '70.00', taxRate: '25' })).toEqual({
      percent: '30.00',
      profit: '30.00',
    });
  });
  it('shows a loss and preserves zero cost as known', () => {
    expect(productPriceMargin({ price: '55.00', cost: '59.00', taxRate: '0' })).toEqual({
      percent: '-7.27',
      profit: '-4.00',
    });
    expect(productPriceMargin({ price: '100.00', cost: '0.00', taxRate: '0' })).toEqual({
      percent: '100.00',
      profit: '100.00',
    });
  });
  it('does not invent a percentage for missing prices or zero revenue', () => {
    expect(productPriceMargin({ price: null, cost: '59.00', taxRate: '0' })).toBeNull();
    expect(productPriceMargin({ price: '70.00', cost: null, taxRate: '0' })).toBeNull();
    expect(productPriceMargin({ price: '0.00', cost: '59.00', taxRate: '0' })).toBeNull();
  });
});
