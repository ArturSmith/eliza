import { productSku, type Product } from '@eliza/contracts';
import { quantityInputValue } from './quantity-format';

export type ProductDraft = {
  name: string;
  description: string;
  category: string;
  unit: string;
  sku: string;
  plu: string;
  barcodes: string;
  cost: string;
  price: string;
  taxRate: string;
  minStock: string;
  images: string[];
  source: Product['source'];
};
export function productDraft(product?: Product): ProductDraft {
  return {
    name: product?.name ?? '',
    description: product?.description ?? '',
    category: product?.category ?? '',
    unit: product?.unit ?? '',
    sku: product?.sku ?? '',
    plu: product?.plu ?? '',
    barcodes: product?.barcodes.join('\n') ?? '',
    cost: product?.cost ?? '',
    price: product?.regularPrice ?? product?.price ?? '',
    taxRate: product ? quantityInputValue(product.taxRate) : '',
    minStock: product ? quantityInputValue(product.minStock) : '',
    images: product?.images?.length ? [...product.images] : product?.image ? [product.image] : [],
    source: product?.source,
  };
}
export function productCodes(value: string) {
  return value
    .split(/[\n,]/)
    .map((code) => code.trim())
    .filter(Boolean);
}
/** Equivalent decimal formatting and harmless surrounding whitespace are not changes. */
export function productDraftKey(draft: ProductDraft) {
  return JSON.stringify({
    ...draft,
    name: draft.name.trim(),
    description: draft.description.trim(),
    category: draft.category.trim(),
    sku: draft.sku.trim(),
    plu: draft.plu.trim(),
    barcodes: productCodes(draft.barcodes),
    cost: quantityInputValue(draft.cost.trim()),
    price: quantityInputValue(draft.price.trim()),
    taxRate: quantityInputValue(draft.taxRate.trim()),
    minStock: quantityInputValue(draft.minStock.trim()),
  });
}
export function productDraftInput(draft: ProductDraft, defaultTaxRate: string) {
  return {
    ...draft,
    sku: draft.sku.trim() || productSku(draft.name, draft.plu || 'new'),
    barcodes: productCodes(draft.barcodes),
    image: draft.images[0] ?? '',
    taxRate: draft.taxRate.trim() || defaultTaxRate,
    minStock: draft.minStock.trim() || '0',
    cost: draft.cost.trim(),
    price: draft.price.trim(),
  };
}
