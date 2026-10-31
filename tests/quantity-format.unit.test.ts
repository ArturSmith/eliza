import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../apps/web/src/i18n';
import { formatQuantity, quantityInputValue } from '../apps/web/src/quantity-format';

afterEach(() => setLanguage('en'));
describe('quantity display', () => {
  it('removes fixed-scale zeros and uses the selected locale', () => {
    setLanguage('ru');
    expect(formatQuantity('7.0000')).toBe('7');
    expect(formatQuantity('0.000')).toBe('0');
    expect(formatQuantity('1.250')).toBe('1,25');
    expect(formatQuantity('0.125')).toBe('0,125');
    expect(formatQuantity('-2.500')).toBe('-2,5');
    expect(formatQuantity('-0.250')).toBe('-0,25');
    expect(formatQuantity('-0.000')).toBe('0');
    expect(formatQuantity('7000.000')).toBe('7\u00a0000');
    setLanguage('en');
    expect(formatQuantity('7.000')).toBe('7');
    expect(formatQuantity('1.250')).toBe('1.25');
    expect(formatQuantity('7000.000')).toBe('7,000');
  });
  it('preserves decimal precision without converting database strings to floating point', () => {
    setLanguage('ru');
    expect(formatQuantity('999999999999.999')).toBe('999\u00a0999\u00a0999\u00a0999,999');
    expect(formatQuantity('9007199254740993.1250')).toBe(
      '9\u00a0007\u00a0199\u00a0254\u00a0740\u00a0993,125',
    );
    expect(formatQuantity('0.00001')).toBe('0,00001');
    expect(formatQuantity(1.25)).toBe('1,25');
  });
  it('handles missing and invalid values without displaying NaN or a fictitious zero', () => {
    for (const value of [null, undefined, '', ' ', 'invalid', Number.NaN, Infinity])
      expect(formatQuantity(value)).toBe('—');
  });
  it('cleans initial editable values without adding locale separators or grouping', () => {
    setLanguage('ru');
    expect(quantityInputValue('7.0000')).toBe('7');
    expect(quantityInputValue('7000.000')).toBe('7000');
    expect(quantityInputValue('1.250')).toBe('1.25');
    expect(quantityInputValue('0.0050')).toBe('0.005');
    expect(quantityInputValue('')).toBe('');
  });
});
