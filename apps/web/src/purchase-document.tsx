import { useState } from 'react';
import {
  type Extraction,
  type Product,
  documentImageSchema,
  purchaseDraftSchema,
} from '@eliza/contracts';
import { api } from './api';
import { t, useLanguage } from './i18n';
import { Field, ErrorMessage, SearchSelect } from './forms';
import { Dialog } from './components/ui/dialog';
import { Button } from './components/ui/button';

export type DocumentDraftLine = {
  productId: string;
  quantity: string;
  unitCost: string;
  taxRate: string;
  sellingPrice: string;
};
type ReviewLine = DocumentDraftLine & { source: Extraction['lines'][number]; id: number };

export function PurchaseDocument({
  supplierId,
  products,
  existingLines,
  onApply,
}: {
  supplierId: string;
  products: Product[];
  existingLines: DocumentDraftLine[];
  onApply: (lines: DocumentDraftLine[], reference: string) => void;
}) {
  useLanguage();
  const [open, setOpen] = useState(false);
  const [image, setImage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<Extraction | null>(null);
  const [rows, setRows] = useState<ReviewLine[]>([]);
  const [reference, setReference] = useState('');
  const [checked, setChecked] = useState(false);
  const activeProducts = products.filter((p) => p.active);
  function update(id: number, patch: Partial<DocumentDraftLine>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
    setChecked(false);
  }
  async function upload(file?: File) {
    setError(null);
    setResult(null);
    setRows([]);
    setImage('');
    setChecked(false);
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Upload a JPEG, PNG, or WebP photo of the document.');
      return;
    }
    if (file.size > 4_400_000) {
      setError('Use an image smaller than 4.4 MB.');
      return;
    }
    setBusy(true);
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('This image could not be opened.'));
        reader.readAsDataURL(file);
      });
      if (!documentImageSchema.safeParse(data).success)
        throw new Error('This image could not be opened.');
      setImage(data);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function read() {
    setBusy(true);
    setError(null);
    setChecked(false);
    setResult(null);
    setRows([]);
    try {
      const document = await api<Extraction>('/purchases/extract', { supplierId, image });
      setResult(document);
      setReference(document.supplierReference);
      setRows(
        document.lines.map((source, id) => {
          const product = activeProducts.find((p) => p.id === source.productId);
          return {
            id,
            source,
            productId: product?.id ?? '',
            quantity: source.quantity,
            unitCost: source.unitCost,
            taxRate: '',
            sellingPrice: product?.price ?? '',
          };
        }),
      );
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  const draftLines = rows.map(({ source: _source, id: _id, ...line }) => line);
  const combined = [...existingLines.filter((l) => l.productId), ...draftLines];
  const duplicates = new Set(combined.map((l) => l.productId)).size !== combined.length;
  const valid =
    purchaseDraftSchema.safeParse({
      supplierId,
      supplierReference: reference,
      lines: combined.map((l) => ({ ...l, sellingPrice: l.sellingPrice || undefined })),
    }).success &&
    rows.length > 0 &&
    rows.every((row) => {
      const product = activeProducts.find((p) => p.id === row.productId);
      return (
        product &&
        (!['piece', 'pack', 'box'].includes(product.unit) || Number.isInteger(Number(row.quantity)))
      );
    });
  return (
    <>
      <div className="purchase-document-entry">
        <Button
          type="button"
          variant="outline"
          disabled={!supplierId}
          onClick={() => setOpen(true)}
        >
          {t('Read supplier document')}
        </Button>
        <small className="muted">
          {t('Choose a supplier, then upload a document to prepare purchase lines.')}
        </small>
      </div>
      <Dialog
        elevated
        open={open}
        onOpenChange={setOpen}
        title={t('Review supplier document')}
        description={t(
          'Upload one invoice or delivery-note image. Review the suggestions before adding them to your draft.',
        )}
      >
        <div className="purchase-document">
          <p className="muted">
            {t(
              'Reading sends this image to OpenAI. Eliza does not save the image. Nothing is ordered or received automatically.',
            )}
          </p>
          <Field
            label={t('Document image')}
            hint={t('JPEG, PNG or WebP, up to 4.4 MB. PDFs are not supported yet.')}
          >
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy}
              onChange={(e) => void upload(e.target.files?.[0])}
            />
          </Field>
          {image && (
            <details className="purchase-document-preview">
              <summary>{t('Open original image')}</summary>
              <img src={image} alt={t('Original supplier document')} />
            </details>
          )}
          {!result && (
            <Button type="button" disabled={!image || busy} onClick={() => void read()}>
              {busy ? t('Reading document…') : t('Read document')}
            </Button>
          )}
          <ErrorMessage error={error} />
          {result && (
            <>
              <Field label={t('Supplier reference')}>
                <input
                  value={reference}
                  maxLength={120}
                  onChange={(e) => {
                    setReference(e.target.value);
                    setChecked(false);
                  }}
                />
              </Field>
              {result.documentDate && (
                <p>
                  {t('Document date')}: {result.documentDate}
                </p>
              )}
              {result.mergedCount > 0 && (
                <p className="notice">
                  {t('{count} duplicate lines with the same cost were combined.', {
                    count: result.mergedCount,
                  })}
                </p>
              )}
              <p className="notice">
                {t(
                  'Check every line against the image. Quantities must use the product’s stock unit; convert cartons yourself. Costs are per stock unit, excluding tax. Enter the tax shown on the document.',
                )}
              </p>
              {rows.map((row) => {
                const product = activeProducts.find((p) => p.id === row.productId);
                return (
                  <section
                    key={row.id}
                    className="purchase-document-line"
                    aria-label={t('Document line {number}', { number: row.id + 1 })}
                  >
                    <strong>{row.source.description || t('Unreadable description')}</strong>
                    <p className="muted">
                      {[row.source.supplierSku, row.source.barcode].filter(Boolean).join(' · ')}
                    </p>
                    <p className="muted">
                      {t('Read quantity: {quantity}; unit cost: {cost}', {
                        quantity: row.source.quantity || '—',
                        cost: row.source.unitCost || '—',
                      })}
                    </p>
                    {!row.productId && (
                      <p className="notice">
                        {t('No reliable product match. Choose the correct catalogue product.')}
                      </p>
                    )}
                    <SearchSelect
                      label={t('Product')}
                      placeholder={t('Select a product')}
                      value={product && { title: product.name, subtitle: product.sku }}
                      options={activeProducts.map((p) => ({
                        id: p.id,
                        title: p.name,
                        subtitle: p.sku,
                        keywords: [p.name, p.sku, ...p.barcodes],
                      }))}
                      onSelect={(id) => {
                        const p = activeProducts.find((p) => p.id === id);
                        update(row.id, { productId: id, sellingPrice: p?.price ?? '' });
                      }}
                    />
                    {product && (
                      <p className="muted">
                        {t('Stock unit')}: {t(product.unit)}
                      </p>
                    )}
                    <div className="form-grid">
                      <Field label={t('Quantity')}>
                        <input
                          inputMode="decimal"
                          value={row.quantity}
                          onChange={(e) => update(row.id, { quantity: e.target.value })}
                        />
                      </Field>
                      <Field label={t('Unit cost excl. tax')}>
                        <input
                          inputMode="decimal"
                          value={row.unitCost}
                          onChange={(e) => update(row.id, { unitCost: e.target.value })}
                        />
                      </Field>
                      <Field label={t('Tax %')}>
                        <input
                          inputMode="decimal"
                          value={row.taxRate}
                          onChange={(e) => update(row.id, { taxRate: e.target.value })}
                        />
                      </Field>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setRows((current) => current.filter((r) => r.id !== row.id));
                        setChecked(false);
                      }}
                    >
                      {t('Remove line')}
                    </Button>
                  </section>
                );
              })}
              <p className="muted">
                {t(
                  'Missing catalogue product? Close this review, create it in the purchase form, then reopen the document review.',
                )}
              </p>
              {duplicates && (
                <p className="error" role="alert">
                  {t(
                    'A product appears more than once, including existing draft lines. Review different costs, combine quantities manually and remove extra lines before continuing.',
                  )}
                </p>
              )}
              {!valid && (
                <p className="muted">
                  {t(
                    'Choose active products and enter valid quantities, costs and tax rates for every line. The draft can contain at most 100 products.',
                  )}
                </p>
              )}
              <label className="purchase-document-confirm">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => setChecked(e.target.checked)}
                />
                <span>
                  {t(
                    'I checked the products, stock units, quantities, costs and tax against the document.',
                  )}
                </span>
              </label>
              <Button
                type="button"
                disabled={!checked || !valid || busy}
                onClick={() => {
                  onApply(draftLines, reference);
                  setOpen(false);
                  setRows([]);
                  setResult(null);
                  setImage('');
                  setChecked(false);
                }}
              >
                {t('Add reviewed lines to draft')}
              </Button>
            </>
          )}
        </div>
      </Dialog>
    </>
  );
}
