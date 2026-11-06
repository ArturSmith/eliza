import { describe, expect, it } from 'vitest';
import { productDraft, productDraftInput, productDraftKey } from '../apps/web/src/product-draft';
import { productSchema, type Product } from '../packages/contracts/src/index';
const product = {
  id: 'product',
  name: 'Yogurt',
  description: '',
  category: 'Dairy',
  unit: 'piece',
  sku: 'YOG',
  plu: '1',
  barcodes: ['0400000000015'],
  cost: '59.00',
  price: '70.00',
  taxRate: '0.00',
  minStock: '2.000',
  image: 'cover',
  stock: '7.000',
} as Product;
describe('inline product draft', () => {
  it('starts creation with empty catalog fields and does not invent prices', () => {
    const draft = productDraft();
    for (const field of [
      'name',
      'description',
      'category',
      'unit',
      'sku',
      'plu',
      'barcodes',
      'price',
      'taxRate',
      'minStock',
    ] as const)
      expect(draft[field]).toBe('');
    expect(draft.images).toEqual([]);
    const parsed = productSchema.parse(
      productDraftInput(
        { ...draft, name: 'New yogurt', category: 'Dairy', unit: 'piece' },
        '15.00',
      ),
    );
    expect(parsed).toMatchObject({
      cost: null,
      price: null,
      taxRate: '15.00',
      minStock: '0',
      barcodes: [],
      images: [],
    });
  });
  it('recognizes reverted edits and equivalent decimal representations', () => {
    const draft = productDraft(product);
    const key = productDraftKey(draft);
    expect(
      productDraftKey({
        ...draft,
        name: ' Yogurt ',
        price: '70',
        barcodes: ' 0400000000015 ',
      }),
    ).toBe(key);
    expect(productDraftKey({ ...draft, name: 'New yogurt' })).not.toBe(key);
    expect(productDraftKey({ ...draft, price: '' })).not.toBe(key);
    expect(productDraftKey({ ...draft, images: [] })).not.toBe(key);
  });
  it('retains the gallery, original pricing basis and inventory-independent payload', () => {
    const draft = productDraft({ ...product, regularPrice: '80.00', images: ['front', 'back'] });
    expect(draft.price).toBe('80.00');
    expect(draft.images).toEqual(['front', 'back']);
    const payload = productDraftInput(draft, '0');
    expect(payload.image).toBe('front');
    expect(payload).not.toHaveProperty('cost');
    expect(payload).not.toHaveProperty('stock');
    expect(payload).not.toHaveProperty('margin');
    expect(payload).not.toHaveProperty('active');
  });
});
