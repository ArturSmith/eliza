import { it, expect } from 'vitest';
import {
  decodeScaleBarcode,
  encodeScaleBarcode,
  scalePriceQuantity,
  scaleBarcodeSchema,
} from '../packages/contracts/src/index';
const config = {
  enabled: true,
  prefix: '20',
  productDigits: 5,
  mode: 'weight' as const,
  decimals: 3,
};
const label = (body: string) =>
  body + ((10 - ([...body].reduce((sum, d, i) => sum + Number(d) * (i % 2 ? 3 : 1), 0) % 10)) % 10);
it('reads exact kilograms and leading-zero product codes', () => {
  expect(decodeScaleBarcode(label('200004201250'), config)).toEqual({
    productCode: '00042',
    quantity: '1.250',
  });
});
it('rejects corrupt and zero labels while ignoring unrelated barcodes', () => {
  expect(() => decodeScaleBarcode('2000042012509', config)).toThrow();
  expect(() => decodeScaleBarcode(label('200004200000'), config)).toThrow();
  expect(decodeScaleBarcode('5449000000996', config)).toBeNull();
  expect(decodeScaleBarcode(label('200004201250'), { ...config, enabled: false })).toBeNull();
});
it('supports price labels with integer arithmetic and rejects unrepresentable prices', () => {
  expect(
    decodeScaleBarcode(label('200004203750'), { ...config, mode: 'price', decimals: 2 }),
  ).toEqual({ productCode: '00042', price: '37.50' });
  expect(scalePriceQuantity('37.50', '30.00')).toBe('1.250');
  expect(() => scalePriceQuantity('0.01', '100.00')).toThrow();
  expect(scaleBarcodeSchema.safeParse({ ...config, mode: 'price' }).success).toBe(false);
});

it('generates labels that the checkout decoder reads at the exact packaged weight', () => {
  const barcode = encodeScaleBarcode('42', '0.532', config);
  expect(barcode).toMatch(/^20\d{11}$/);
  expect(decodeScaleBarcode(barcode, config)).toEqual({
    productCode: '00042',
    quantity: '0.532',
  });
  expect(() => encodeScaleBarcode('42', '0', config)).toThrow();
  expect(() => encodeScaleBarcode('123456', '0.532', config)).toThrow();
  expect(() => encodeScaleBarcode('42', '0.532', { ...config, decimals: 2 })).toThrow();
  expect(() => encodeScaleBarcode('42', '0.532', { ...config, enabled: false })).toThrow();
});
