import { describe, it, expect } from 'vitest';
import {
  defaultLabelLayout,
  fitLayoutElement,
  labelLayoutSchema,
  labelLayoutStorageKey,
  layoutElements,
  layoutSize,
  rotateLayout,
} from '../apps/web/src/printing/tag-layout';
describe('device label layouts', () => {
  it('validates defaults and rotated layouts without changing physical paper dimensions', () => {
    for (const orientation of ['portrait', 'landscape'] as const) {
      const layout = defaultLabelLayout(orientation);
      expect(labelLayoutSchema.safeParse(layout).success).toBe(true);
      expect(
        labelLayoutSchema.safeParse(
          rotateLayout(layout, orientation === 'portrait' ? 'landscape' : 'portrait'),
        ).success,
      ).toBe(true);
    }
  });
  it('keeps dragging and resizing inside paper edges', () => {
    for (const orientation of ['portrait', 'landscape'] as const)
      for (const id of layoutElements) {
        const original = defaultLabelLayout(orientation).elements[id],
          size = layoutSize(orientation);
        const moved = fitLayoutElement(
          { ...original, x: 999, y: -100, width: 900, height: 800 },
          orientation,
        );
        expect(moved.x).toBe(0);
        expect(moved.y).toBe(0);
        expect(moved.width).toBe(size.width);
        expect(moved.height).toBe(size.height);
      }
  });
  it('rejects malformed saved layouts, invisible barcodes and out-of-bounds elements', () => {
    const layout = defaultLabelLayout();
    expect(labelLayoutSchema.safeParse({ ...layout, version: 9 }).success).toBe(false);
    expect(
      labelLayoutSchema.safeParse({
        ...layout,
        elements: { ...layout.elements, barcode: { ...layout.elements.barcode, visible: false } },
      }).success,
    ).toBe(false);
    expect(
      labelLayoutSchema.safeParse({
        ...layout,
        elements: { ...layout.elements, price: { ...layout.elements.price, x: 400 } },
      }).success,
    ).toBe(false);
    expect(labelLayoutStorageKey('store1', 'device1')).not.toBe(
      labelLayoutStorageKey('store1', 'device2'),
    );
    expect(labelLayoutStorageKey('store1', 'device1')).not.toBe(
      labelLayoutStorageKey('store2', 'device1'),
    );
  });
});
