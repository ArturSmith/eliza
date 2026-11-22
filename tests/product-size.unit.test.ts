import { describe, it, expect } from 'vitest';
import { splitProductSize, joinProductSize } from '../apps/web/src/product-size';
import { uniqueProductTerms } from '../apps/web/src/product-options';
describe('product size entry', () => {
  it.each([
    ['500 ml', '500', 'ml'],
    ['0,75 л', '0,75', 'L'],
    ['200г', '200', 'g'],
    ['1 KG', '1', 'kg'],
    ['.5 L', '.5', 'L'],
  ])('reads existing size %s', (value, amount, unit) =>
    expect(splitProductSize(value)).toMatchObject({ amount, unit, legacy: '' }),
  );
  it('keeps unrecognised packaging and unknown units visible instead of guessing', () => {
    for (const value of ['24 x 330 ml', 'Family pack', '500 mL bottle', '0 ml'])
      expect(splitProductSize(value)).toEqual({ amount: '', unit: '', legacy: value });
    expect(splitProductSize('500')).toEqual({ amount: '500', unit: '', legacy: '500' });
  });
  it('combines the numeric entry and chosen unit without converting the inventory unit', () => {
    expect(joinProductSize('0,75', 'L')).toBe('0.75 L');
    expect(joinProductSize('.5', 'kg')).toBe('0.5 kg');
    expect(joinProductSize('500', 'ml')).toBe('500 ml');
    expect(joinProductSize('', 'ml')).toBe('');
  });
  it('deduplicates saved names without replacing the store spelling', () =>
    expect(uniqueProductTerms([' Cola ', 'cola', undefined, '', null, 'Tine'])).toEqual([
      'Cola',
      'Tine',
    ]));
});
