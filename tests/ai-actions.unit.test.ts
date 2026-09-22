import { describe, expect, it } from 'vitest';
import { stageProposal } from '../apps/api/src/ai-actions';

const supplier = { code: 'SUP-1', name: 'ИП Магомадов Р.А.', phone: '+7 (969) 722-22-22', contactName: 'М-7 С. Мохамад', contactPhone: '89292088095' };
const write = ['suppliers.manage', 'catalog.write', 'purchases.write'] as const;
function propose(kind: 'supplier' | 'product' | 'purchase', data: unknown, permissions: readonly string[] = write) {
  return stageProposal({ kind, operation: 'create', summary: 'Create the reviewed record', data: JSON.stringify(data) }, permissions as any);
}
describe('AI write proposals', () => {
  it('stages supplier details without writing or merging business and representative phones', () => {
    const result = propose('supplier', supplier);
    expect(result).toMatchObject({ kind: 'supplier', operation: 'create', payload: supplier });
    expect(result).toHaveProperty('id');
  });
  it('rejects proposals without the relevant permission', () => {
    expect(propose('supplier', supplier, ['catalog.write'])).toEqual({ error: 'Permission denied for this change.' });
  });
  it('rejects purchase lines with missing real product IDs or costs', () => {
    const result = propose('purchase', { supplierId: crypto.randomUUID(), lines: [{ productId: '', quantity: '2', unitCost: '', taxRate: '0' }] });
    expect(result).toHaveProperty('error');
  });
  it('requires a full, validated product proposal and rejects hidden image data', () => {
    const product = { name: 'Milk', sku: 'MILK', category: 'Dairy', unit: 'piece', price: '12', cost: '8', minStock: '0', barcodes: [], plu: '' };
    expect(propose('product', product)).toMatchObject({ kind: 'product', payload: product });
    expect(propose('product', { ...product, image: 'data:image/jpeg;base64,/9j/' })).toHaveProperty('error');
  });
});
