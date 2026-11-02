import { describe, expect, it } from 'vitest';
import { normalizeProductGallery } from '../apps/api/src/product-gallery';
import { productSchema } from '../packages/contracts/src/index';
const a = 'data:image/jpeg;base64,/9j/AA==';
const b = 'data:image/jpeg;base64,/9j/BB==';
const c = 'data:image/jpeg;base64,/9j/CC==';
describe('product gallery and legacy cover', () => {
  it('saves ordered photos and treats the first as the cover', () => {
    expect(normalizeProductGallery({ images: [b, a] })).toEqual({ image: b, images: [b, a] });
    expect(normalizeProductGallery({ image: a })).toEqual({ image: a, images: [a] });
    expect(normalizeProductGallery({ images: [a, a, b] })).toEqual({ image: a, images: [a, b] });
  });
  it('preserves gallery photos when an older client omits the gallery', () => {
    const old = { image: a, images: [a, b] };
    expect(normalizeProductGallery({}, old)).toEqual(old);
    expect(normalizeProductGallery({ image: a }, old)).toEqual(old);
    expect(normalizeProductGallery({ image: c }, old)).toEqual({ image: c, images: [c, b] });
    expect(normalizeProductGallery({ image: '' }, old)).toEqual({ image: b, images: [b] });
  });
  it('can remove all photos explicitly and accepts valid bounded JPEG arrays', () => {
    expect(normalizeProductGallery({ images: [] }, { image: a, images: [a, b] })).toEqual({
      image: '',
      images: [],
    });
    const product = {
      name: 'Yogurt',
      sku: 'YOG',
      category: 'Dairy',
      unit: 'piece',
      minStock: '0',
      barcodes: [],
    };
    expect(productSchema.safeParse({ ...product, images: [a, b] }).success).toBe(true);
    for (const images of [
      [...Array(7).fill(a)],
      ['https://example.com/photo.jpg'],
      [''],
      ['data:image/svg+xml;base64,AAAA'],
    ]) {
      expect(productSchema.safeParse({ ...product, images }).success).toBe(false);
    }
  });
});
