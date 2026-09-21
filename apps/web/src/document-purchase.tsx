import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  confidentTextMatch,
  matchingTextScore,
  normalizeMatchText,
  type DocumentData,
  type Product,
  type Supplier,
} from '@eliza/contracts';
import { api, refresh } from './api';
import { t, useLanguage } from './i18n';
import { ErrorMessage } from './forms';
import { Button } from './components/ui/button';
import { Dialog } from './components/ui/dialog';
import { SupplierForm } from './purchasing';
import type { DocumentDraftLine } from './purchase-document';
import { documentPurchasePreview, type Preview } from './document-purchase-preview';

export type PurchaseHandoff = {
  supplierId: string;
  reference: string;
  date: string;
  lines: DocumentDraftLine[];
  focusLine: number;
};
const handoffKey = 'eliza.purchase-assistant.handoff';
export function readDocumentHandoff(): PurchaseHandoff | null {
  try {
    const raw = sessionStorage.getItem(handoffKey);
    if (!raw) return null;
    sessionStorage.removeItem(handoffKey);
    const value: PurchaseHandoff = JSON.parse(raw);
    return value.supplierId && Array.isArray(value.lines) && value.lines.length <= 100 ? value : null;
  } catch {
    return null;
  }
}

type Candidate = { supplier: Supplier; score: number };
function supplierCandidates(preview: Preview, suppliers: Supplier[], references: { supplier_id: string }[]): Candidate[] {
  const digits = (value: string) => value.replace(/\D/g, '');
  return suppliers.filter((supplier) => supplier.active).map((supplier) => {
    const name = matchingTextScore(preview.supplierName, supplier.name);
    const code = !!preview.supplierCode && normalizeMatchText(preview.supplierCode) === normalizeMatchText(supplier.code);
    const company = !!preview.companyNumber && normalizeMatchText(preview.companyNumber) === normalizeMatchText(supplier.companyNumber);
    const phone = digits(preview.supplierPhone).length >= 7 && digits(preview.supplierPhone) === digits(supplier.phone);
    const reference = references.some((item) => item.supplier_id === supplier.id);
    return { supplier, score: code || company ? 4 : reference ? 3 + name : phone ? 2 + name : name };
  }).filter((item) => item.score >= .35).sort((a, b) => b.score - a.score).slice(0, 5);
}

export function DocumentPurchasePreparation({ data, documentId }: { data: DocumentData; documentId: string }) {
  useLanguage();
  const preview = documentPurchasePreview(data);
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api<Supplier[]>('/suppliers') });
  const [stage, setStage] = useState<'idle' | 'supplier' | 'products'>('idle');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [lines, setLines] = useState<DocumentDraftLine[]>([]);
  const [duplicate, setDuplicate] = useState(false);
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { setStage('idle'); setSupplierId(''); setLines([]); setError(null); }, [documentId, data]);
  async function start() {
    setBusy(true); setError(null);
    try {
      const current = await api<Supplier[]>('/suppliers');
      let references: { supplier_id: string; supplier_reference: string }[] = [];
      if (preview.reference) {
        references = await api<typeof references>('/purchases?search=' + encodeURIComponent(preview.reference));
        references = references.filter((item) => normalizeMatchText(item.supplier_reference) === normalizeMatchText(preview.reference));
      }
      setDuplicate(references.length > 0);
      setCandidates(supplierCandidates(preview, current, references));
      setStage('supplier');
    } catch (cause) { setError(cause); }
    finally { setBusy(false); }
  }
  async function chooseSupplier(id: string) {
    setBusy(true); setError(null);
    try {
      const catalogue = (await api<Product[]>('/products')).filter((item) => item.active);
      const next = await Promise.all(preview.rows.map(async (row): Promise<DocumentDraftLine> => {
        let product = catalogue.find((item) => row.barcode && item.barcodes?.includes(row.barcode)) ??
          catalogue.find((item) => row.sku && normalizeMatchText(item.sku) === normalizeMatchText(row.sku)) ??
          confidentTextMatch(row.description, catalogue, (item) => item.name);
        let suggestion: DocumentDraftLine['suggestion'];
        if (!product && row.barcode) {
          try {
            const lookup = await api<{ existing?: { id: string }; suggestion?: DocumentDraftLine['suggestion'] }>('/products/lookup/' + encodeURIComponent(row.barcode));
            product = catalogue.find((item) => item.id === lookup.existing?.id);
            suggestion = lookup.suggestion;
          } catch { /* Public lookup is optional. */ }
        }
        return { productId: product?.id ?? '', quantity: row.quantity, unitCost: row.unitCost, taxRate: '', sellingPrice: product?.price ?? '',
          source: { description: row.description, supplierSku: row.sku, barcode: row.barcode, quantity: row.quantity, unitCost: row.unitCost, productId: product?.id ?? null, matchedBy: product ? 'name' : null, ambiguous: false }, suggestion };
      }));
      setSupplierId(id); setLines(next); setStage('products');
    } catch (cause) { setError(cause); }
    finally { setBusy(false); }
  }
  function openOrder(index: number) {
    try {
      sessionStorage.setItem(handoffKey, JSON.stringify({ supplierId, reference: preview.reference, date: preview.date, lines, focusLine: index } satisfies PurchaseHandoff));
      window.location.assign('/purchases?document=1');
    } catch (cause) { setError(cause); }
  }
  if (!preview.rows.length) return null;
  return <section className="document-purchase-preparation">
    {preview.tooManyRows ? <p className="notice">{t('This document has more than 100 product rows. Split it before preparing a purchase order.')}</p> : stage === 'idle' && <Button type="button" variant="outline" disabled={busy} onClick={() => void start()}>{busy ? t('Checking suppliers…') : t('Prepare purchase order')}</Button>}
    <ErrorMessage error={error} />
    {stage === 'supplier' && <div className="document-purchase-step">
      <p>{candidates.length ? t('I found supplier {name}. Is one of these your supplier?', { name: preview.supplierName || '—' }) : t('There is no such supplier in the system. Add one?')}</p>
      {duplicate && <p className="notice">{t('A purchase with reference {reference} already exists. Check it before saving another.', { reference: preview.reference })}</p>}
      {candidates.map(({ supplier }) => <div className="purchase-assistant-candidate" key={supplier.id}><span><strong>{supplier.name}</strong> · {supplier.code}</span><Button type="button" variant="outline" disabled={busy} onClick={() => void chooseSupplier(supplier.id)}>{t('Use this supplier')}</Button></div>)}
      <Button type="button" variant="outline" onClick={() => setAddingSupplier(true)}>{t('Create new supplier')}</Button>
    </div>}
    {stage === 'products' && <div className="document-purchase-step">
      <p>{t('I matched {matched} products; {unmatched} need your review.', { matched: lines.filter((line) => line.productId).length, unmatched: lines.filter((line) => !line.productId).length })}</p>
      <p>{t('Select a product below to open the prefilled purchase order and review that row.')}</p>
      {preview.rows.some((row) => row.derivedCost) && <p className="notice">{t('Some unit costs were estimated from line total divided by quantity. Check tax and costs against the original document before saving.')}</p>}
      {lines.map((line, index) => <button type="button" className="document-chat-product" key={index} onClick={() => openOrder(index)}><span><strong>{line.source?.description}</strong><small>{line.productId ? t('Matched to product in catalogue') : t('Needs product review')}</small><small>{t('Read quantity: {quantity}; unit cost: {cost}', { quantity: line.quantity || '—', cost: line.unitCost || '—' })}</small></span><span aria-hidden="true">→</span></button>)}
      <Button type="button" onClick={() => openOrder(0)}>{t('Review full purchase order')}</Button>
    </div>}
    <Dialog elevated open={addingSupplier} onOpenChange={setAddingSupplier} title={t('Add supplier')} description={t('Keep supplier details available for your team.')}>
      {addingSupplier && <SupplierForm supplier={null} prefill={{ name: preview.supplierName, code: preview.supplierCode && !(suppliers.data ?? []).some((item) => item.code.toLowerCase() === preview.supplierCode.toLowerCase()) ? preview.supplierCode : 'SUP-' + crypto.randomUUID().slice(0, 8).toUpperCase(), companyNumber: preview.companyNumber, contactName: preview.contactName, phone: preview.supplierPhone }} done={() => setAddingSupplier(false)} onCreated={(supplier) => { void refresh(); void chooseSupplier(supplier.id); }} />}
    </Dialog>
  </section>;
}
