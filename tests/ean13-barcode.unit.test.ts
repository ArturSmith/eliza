import { expect, it } from 'vitest';
import { ean13Modules } from '../apps/web/src/ean13-barcode';

it('renders EAN-13 guards and the specified A/B/C digit patterns', () => {
  const bits = ean13Modules('4006381333931');
  expect(bits).toHaveLength(95);
  expect(bits.slice(0, 3)).toBe('101');
  expect(bits.slice(45, 50)).toBe('01010');
  expect(bits.slice(92)).toBe('101');
  expect(bits.slice(3, 10)).toBe('0001101'); // First left digit 0 in set A.
  expect(bits.slice(10, 17)).toBe('0100111'); // Second left digit 0 in set B.
  expect(bits.slice(50, 57)).toBe('1000010'); // First right digit 3 in set C.
});
