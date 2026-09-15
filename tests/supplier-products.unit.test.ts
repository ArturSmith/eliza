import { describe, it, expect } from 'vitest';
import { unitCost, compareOffers, supplierProductSchema } from '../packages/contracts/src/index';

const offer = (packCost: string, packSize: string, active = true) => ({
  packCost,
  packSize,
  active,
});

describe('unitCost', () => {
  it('divides a pack price by the pack size', () => {
    expect(unitCost('250.00', '12')).toBe('20.8333');
  });
  it('leaves a single-unit price unchanged', () => {
    expect(unitCost('22.00', '1')).toBe('22.0000');
  });
  it('keeps precision for fractional units', () => {
    // A 1.5 kg bag at 45.00 is 30.00 per kilogram.
    expect(unitCost('45.00', '1.5')).toBe('30.0000');
  });
  it('does not collapse to zero for small per-unit costs', () => {
    // 2.50 for a 1000 g pack is 0.0025 per gram, which two decimals would lose.
    expect(unitCost('2.50', '1000')).toBe('0.0025');
  });
  it('rounds half up rather than truncating', () => {
    expect(unitCost('10.00', '3')).toBe('3.3333');
    expect(unitCost('20.00', '3')).toBe('6.6667');
  });
  it('handles a zero cost without dividing by zero', () => {
    expect(unitCost('0.00', '5')).toBe('0.0000');
  });
  it('refuses a zero pack size instead of returning Infinity', () => {
    expect(unitCost('10.00', '0')).toBeNull();
  });
});

describe('compareOffers', () => {
  it('ranks a large cheap pack above a small expensive unit', () => {
    // The whole point of the feature: 250 > 22, but per jar the case is cheaper.
    const result = compareOffers([offer('22.00', '1'), offer('250.00', '12')]);
    expect(result[0].packCost).toBe('250.00');
    expect(result[0].cheapest).toBe(true);
    expect(result[1].cheapest).toBe(false);
  });
  it('reports how much more the runner-up costs', () => {
    const result = compareOffers([offer('100.00', '1'), offer('110.00', '1')]);
    expect(result[0].premiumPercent).toBe(0);
    expect(result[1].premiumPercent).toBe(10);
  });
  it('never lets an unpriceable offer win', () => {
    const result = compareOffers([offer('5.00', '0'), offer('9.00', '1')]);
    expect(result[0].packCost).toBe('9.00');
    expect(result[0].cheapest).toBe(true);
    expect(result.find((o) => o.packSize === '0')!.unitCost).toBeNull();
    expect(result.find((o) => o.packSize === '0')!.cheapest).toBe(false);
  });
  it('excludes inactive offers from winning but still returns them', () => {
    const result = compareOffers([offer('1.00', '1', false), offer('9.00', '1')]);
    expect(result).toHaveLength(2);
    expect(result[0].packCost).toBe('9.00');
    expect(result[0].cheapest).toBe(true);
    expect(result.find((o) => !o.active)!.cheapest).toBe(false);
  });
  it('marks a genuine tie as cheapest on both rows', () => {
    const result = compareOffers([offer('10.00', '2'), offer('25.00', '5')]);
    expect(result.every((o) => o.cheapest)).toBe(true);
  });
  it('returns an empty list unchanged', () => {
    expect(compareOffers([])).toEqual([]);
  });
  it('handles every offer being unpriceable', () => {
    const result = compareOffers([offer('5.00', '0')]);
    expect(result[0].cheapest).toBe(false);
    expect(result[0].premiumPercent).toBeNull();
  });
  it('does not treat a free offer as a division error', () => {
    const result = compareOffers([offer('0.00', '1'), offer('5.00', '1')]);
    expect(result[0].cheapest).toBe(true);
    // A zero baseline makes "percent more expensive" meaningless, not zero.
    expect(result[1].premiumPercent).toBeNull();
  });
});

describe('supplierProductSchema', () => {
  const base = {
    supplierId: '11111111-1111-4111-8111-111111111111',
    productId: '22222222-2222-4222-8222-222222222222',
    packCost: '12.50',
  };
  it('defaults a missing pack size to one selling unit', () => {
    expect(supplierProductSchema.parse(base).packSize).toBe('1');
  });
  it('rejects a zero pack size', () => {
    expect(supplierProductSchema.safeParse({ ...base, packSize: '0' }).success).toBe(false);
  });
  it('rejects a negative pack cost', () => {
    expect(supplierProductSchema.safeParse({ ...base, packCost: '-1.00' }).success).toBe(false);
  });
  it('accepts a zero pack cost for promotional stock', () => {
    expect(supplierProductSchema.safeParse({ ...base, packCost: '0.00' }).success).toBe(true);
  });
  it('allows an unknown lead time', () => {
    expect(supplierProductSchema.parse(base).leadTimeDays).toBeNull();
  });
});
