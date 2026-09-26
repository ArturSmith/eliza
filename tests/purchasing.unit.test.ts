import { describe, it, expect } from 'vitest';
import {
  calculatePurchaseLine,
  purchaseDraftSchema,
  receiptInputSchema,
} from '../packages/contracts/src/index';
describe('purchase arithmetic and validation', () => {
  it('rounds extended cost then exclusive tax using exact decimals', () => {
    expect(calculatePurchaseLine('0.01', '0.5', '100')).toEqual({
      subtotal: '0.01',
      tax: '0.01',
      total: '0.02',
    });
    expect(calculatePurchaseLine('18.50', '24', '15')).toEqual({
      subtotal: '444.00',
      tax: '66.60',
      total: '510.60',
    });
  });
  it('rejects impossible calendar dates and duplicate lines', () => {
    const line = { productId: crypto.randomUUID(), quantity: '1', unitCost: '1', taxRate: '15' };
    expect(
      purchaseDraftSchema.safeParse({
        supplierId: crypto.randomUUID(),
        expectedDate: '2026-02-30',
        lines: [line],
      }).success,
    ).toBe(false);
    expect(
      purchaseDraftSchema.safeParse({ supplierId: crypto.randomUUID(), lines: [line, line] })
        .success,
    ).toBe(false);
  });
  it('requires positive delivery quantities', () => {
    for (const quantity of ['0', '-1', 'NaN', '1.0001'])
      expect(
        receiptInputSchema.safeParse({
          requestId: crypto.randomUUID(),
          version: 1,
          lines: [{ purchaseLineId: crypto.randomUUID(), quantity }],
        }).success,
      ).toBe(false);
  });
  it('validates expiry splits with exact quantities and keeps single-date payloads compatible', () => {
    const line = { purchaseLineId: crypto.randomUUID(), quantity: '1' };
    const request = (data: unknown) =>
      receiptInputSchema.safeParse({ requestId: crypto.randomUUID(), version: 1, lines: [data] });
    expect(request({ ...line, expiryDate: '2035-01-01' }).success).toBe(true);
    expect(
      request({
        ...line,
        expiryBatches: [
          { quantity: '0.333', expiryDate: '2035-01-01' },
          { quantity: '0.667', expiryDate: null },
        ],
      }).success,
    ).toBe(true);
    for (const expiryBatches of [
      [],
      [{ quantity: '1.001' }],
      [{ quantity: '0.999' }],
      [{ quantity: '0' }, { quantity: '1' }],
      [{ quantity: '-1' }],
      [{ quantity: 'NaN' }],
      [{ quantity: '1.0001' }],
      [{ quantity: '1', expiryDate: '2035-02-30' }],
      Array.from({ length: 51 }, () => ({ quantity: '1' })),
    ])
      expect(request({ ...line, expiryBatches }).success).toBe(false);
    expect(
      request({
        ...line,
        expiryDate: '2035-01-01',
        expiryBatches: [{ quantity: '1', expiryDate: '2036-01-01' }],
      }).success,
    ).toBe(false);
  });
});
