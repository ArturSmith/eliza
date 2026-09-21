import { describe, expect, it } from 'vitest';
import { documentPurchasePreview } from '../apps/web/src/document-purchase-preview';
import type { DocumentData } from '../packages/contracts/src/scanned-document';
const base: DocumentData = {
  documentType: 'Invoice', language: 'ru', title: 'Invoice', number: 'U2-12670',
  date: '8 сентября 2026 г.', currency: '₽', summary: '', pages: 1,
  parties: [{ role: 'Поставщик', name: 'ИП Магомадов Р.А.', details: '+7 969 722-22-22' }],
  fields: [], sections: [], tables: [], additionalText: [], annotations: [], printedTotal: '', extractionWarnings: [],
};
describe('purchase preview from reconstructed document', () => {
  it('keeps supplier, reference, date and line-level unit costs', () => {
    const preview = documentPurchasePreview({ ...base, tables: [{
      id: 'items', title: 'Товары', columns: [
        { key: 'sku', label: 'Артикул', kind: 'text' },
        { key: 'name', label: 'Товар', kind: 'text' },
        { key: 'qty', label: 'Количество', kind: 'quantity' },
        { key: 'price', label: 'Цена', kind: 'price' },
      ], rows: [{ rowNumber: '1', cells: ['MILK', 'Milk', '2 шт', '3,00'] }], footerRows: [],
    }] });
    expect(preview).toMatchObject({ supplierName: 'ИП Магомадов Р.А.', reference: 'U2-12670', date: '2026-09-08', tooManyRows: false });
    expect(preview.rows).toEqual([{ description: 'Milk', sku: 'MILK', barcode: '', quantity: '2', unitCost: '3.00', derivedCost: false }]);
  });
  it('marks costs derived from totals and gathers multiple product tables', () => {
    const table = { id: 'items', title: 'Goods', columns: [
      { key: 'name', label: 'Item', kind: 'text' as const },
      { key: 'qty', label: 'Qty', kind: 'quantity' as const },
      { key: 'amount', label: 'Amount', kind: 'amount' as const },
    ], rows: [{ rowNumber: '1', cells: ['Apples', '2', '10,00'] }], footerRows: [] };
    const preview = documentPurchasePreview({ ...base, tables: [table, { ...table, id: 'second', rows: [{ rowNumber: '2', cells: ['Bread', '1', '4,00'] }] }] });
    expect(preview.rows.map((row) => [row.description, row.unitCost, row.derivedCost])).toEqual([['Apples', '5.00', true], ['Bread', '4.00', true]]);
  });
  it('blocks handoff rather than silently dropping rows after the first hundred', () => {
    const preview = documentPurchasePreview({ ...base, tables: [{
      id: 'items', title: 'Goods', columns: [
        { key: 'name', label: 'Item', kind: 'text' },
        { key: 'qty', label: 'Qty', kind: 'quantity' },
      ], rows: Array.from({ length: 101 }, (_, index) => ({ rowNumber: String(index + 1), cells: [`Item ${index}`, '1'] })), footerRows: [],
    }] });
    expect(preview.tooManyRows).toBe(true);
    expect(preview.rows).toHaveLength(100);
  });
});
