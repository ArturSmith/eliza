import { describe, expect, it } from 'vitest';
import { suggestSellingPrice, defaultMarkupSchema } from '../packages/contracts/src/index';

describe('VAT-inclusive selling-price suggestions', () => {
  it.each([
    ['100', '15', '115.00'],
    ['200', '15', '230.00'],
    ['80', '12.50', '90.00'],
    ['0.10', '15', '0.12'],
    ['0.03', '15', '0.03'],
    ['12.34', '0', '12.34'],
    ['0', '15', '0.00'],
    ['1', '1000', '11.00'],
  ])('%s plus %s percent gives %s with cent rounding', (cost, markup, expected) => {
    expect(suggestSellingPrice(cost, markup)).toBe(expected);
  });
  it.each(['', '-1', '1000.01', '1.234', 'NaN'])('rejects invalid markup %s', (markup) => {
    expect(defaultMarkupSchema.safeParse(markup).success).toBe(false);
    expect(suggestSellingPrice('100', markup)).toBe('');
  });
  it.each(['', 'abc', '-1', '1.234', '999999999.99'])(
    'does not suggest invalid or overflowing prices for %s',
    (cost) => {
      expect(suggestSellingPrice(cost, '15')).toBe('');
    },
  );
});
