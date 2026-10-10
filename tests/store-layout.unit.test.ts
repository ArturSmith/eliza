import { describe, expect, it } from 'vitest';
import {
  footprint,
  storeLayoutSchema,
  validPlacement,
  type LayoutObject,
} from '../packages/contracts/src/store-layout';
const object: LayoutObject = {
  id: '12345678-1234-4234-8234-123456789012',
  name: 'Shelf',
  kind: 'gondola',
  x: 0,
  y: 0,
  width: 3,
  depth: 1,
  height: 1.6,
  rotation: 0,
};
describe('store layout geometry and validation', () => {
  it('accounts for rotated footprints and allows touching edges', () => {
    const layout = { width: 4, length: 4, objects: [object] };
    const second = {
      ...object,
      id: '12345678-1234-4234-8234-123456789013',
      x: 3,
      rotation: 90 as const,
    };
    expect(footprint(second)).toEqual({ x: 3, y: 0, width: 1, depth: 3 });
    expect(validPlacement(layout, second)).toBe(true);
    expect(validPlacement(layout, { ...second, x: 2.75 })).toBe(false);
    expect(validPlacement(layout, { ...second, x: 3.25 })).toBe(false);
  });
  it('prevents invalid room shrinking, duplicate IDs, overlaps and unsupported rotations', () => {
    expect(storeLayoutSchema.safeParse({ width: 2, length: 4, objects: [object] }).success).toBe(
      false,
    );
    expect(
      storeLayoutSchema.safeParse({ width: 4, length: 4, objects: [object, { ...object, y: 2 }] })
        .success,
    ).toBe(false);
    expect(
      storeLayoutSchema.safeParse({ width: 4, length: 4, objects: [{ ...object, rotation: 45 }] })
        .success,
    ).toBe(false);
    expect(
      storeLayoutSchema.safeParse({
        width: 4,
        length: 4,
        objects: [{ ...object, height: Infinity }],
      }).success,
    ).toBe(false);
    expect(storeLayoutSchema.safeParse({ width: 4, length: 4, objects: [object] }).success).toBe(
      true,
    );
  });
});
