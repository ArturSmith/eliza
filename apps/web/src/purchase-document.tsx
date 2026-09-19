import { useState } from 'react';
import {
  type Extraction,
  type Product,
  type Supplier,
  confidentTextMatch,
  documentImageSchema,
  normalizeMatchText,
} from '@eliza/contracts';
import { api, ApiError } from './api';
import { t, useLanguage } from './i18n';
import { Field, ErrorMessage } from './forms';
import { Dialog } from './components/ui/dialog';
import { Button } from './components/ui/button';

type ProductSuggestion = {
  barcode: string;
  name: string;
  description?: string;
  brand: string;
  quantity: string;
  category: string;
  image: string;
};
type ProductLookup = {
  existing?: { id: string; name: string };
  suggestion?: ProductSuggestion | null;
};
type SupplierPrefill = { name: string; code: string; companyNumber: string };

function matchSupplier(document: Extraction, suppliers: Supplier[]) {
  const active = suppliers.filter((supplier) => supplier.active);
  const code = normalizeMatchText(document.supplierCode);
  const company = normalizeMatchText(document.supplierCompanyNumber);
  const exact = active.filter(
    (supplier) =>
      (code && normalizeMatchText(supplier.code) === code) ||
      (company && normalizeMatchText(supplier.companyNumber) === company),
  );
  if (exact.length === 1) return exact[0];
  return confidentTextMatch(document.supplierName, active, (supplier) => supplier.name);
}

export type DocumentDraftLine = {
  productId: string;
  quantity: string;
  unitCost: string;
  taxRate: string;
  sellingPrice: string;
  source?: Extraction['lines'][number];
  suggestion?: ProductSuggestion;
};

export function PurchaseDocument({
  supplierId,
  products,
  suppliers,
  onApply,
  onAddSupplier,
}: {
  supplierId: string;
  products: Product[];
  suppliers: Supplier[];
  onApply: (lines: DocumentDraftLine[], reference: string, supplierId?: string) => void;
  onAddSupplier: (prefill: SupplierPrefill) => void;
}) {
  useLanguage();
  const [open, setOpen] = useState(false);
  const [image, setImage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<Extraction | null>(null);
  const [supplierMatched, setSupplierMatched] = useState(false);
  const activeProducts = products.filter((p) => p.active);
  async function upload(file?: File) {
    setError(null);
    setResult(null);
    setSupplierMatched(false);
    setImage('');
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
    setResult(null);
    try {
      const document = await api<Extraction>('/purchases/extract', {
        ...(supplierId ? { supplierId } : {}),
        image,
      });
      let supplierCandidates = suppliers;
      if (!supplierId) {
        try {
          supplierCandidates = await api<Supplier[]>('/suppliers');
        } catch {
          // The already loaded list can still be used if refreshing it fails.
        }
      }
      const matchedSupplier = supplierId
        ? supplierCandidates.find((supplier) => supplier.id === supplierId)
        : matchSupplier(document, supplierCandidates);
      const enriched = await Promise.all(
        document.lines.map(async (source) => {
          let product =
            activeProducts.find((item) => item.id === source.productId) ??
            confidentTextMatch(source.description, activeProducts, (item) => item.name);
          let suggestion: ProductSuggestion | undefined;
          if (!product && source.barcode) {
            try {
              const lookup = await api<ProductLookup>(
                '/products/lookup/' + encodeURIComponent(source.barcode),
              );
              product = activeProducts.find((item) => item.id === lookup.existing?.id);
              suggestion = lookup.suggestion ?? undefined;
            } catch {
              // Document transcription remains usable when the optional product service is unavailable.
            }
          }
          return {
            source: {
              ...source,
              productId: product?.id ?? null,
              matchedBy: product
                ? source.productId
                  ? source.matchedBy
                  : source.barcode && product.barcodes.includes(source.barcode)
                    ? ('barcode' as const)
                    : ('name' as const)
                : null,
            },
            suggestion,
            productId: product?.id ?? '',
            quantity: source.quantity,
            unitCost: source.unitCost,
            taxRate: '',
            sellingPrice: product?.price ?? '',
          };
        }),
      );
      setResult({ ...document, lines: enriched.map((line) => line.source) });
      setSupplierMatched(!!matchedSupplier);
      onApply(enriched, document.supplierReference, matchedSupplier?.id);
      setOpen(false);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="purchase-document-entry">
        <div className="purchase-document-actions">
          <Button type="button" variant="outline" onClick={() => setOpen(true)}>
            {t('Read supplier document')}
          </Button>
          {!supplierId && result && !supplierMatched && (
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                onAddSupplier({
                  name: result.supplierName,
                  code: result.supplierCode,
                  companyNumber: result.supplierCompanyNumber,
                })
              }
            >
              {t('Add new supplier')}
            </Button>
          )}
        </div>
        <small className="muted">
          {supplierId
            ? t('Upload a document to prepare purchase lines.')
            : t('You can read the document first. Add or select a supplier before saving.')}
        </small>
        {result && image && (
          <details className="purchase-document-preview">
            <summary>{t('Open original image')}</summary>
            <img src={image} alt={t('Original supplier document')} />
          </details>
        )}
        {result?.documentDate && (
          <small>
            {t('Document date')}: {result.documentDate}
          </small>
        )}
        {!!result?.mergedCount && (
          <small>
            {t('{count} duplicate lines with the same cost were combined.', {
              count: result.mergedCount,
            })}
          </small>
        )}
      </div>
      <Dialog
        elevated
        open={open}
        onOpenChange={setOpen}
        title={t('Read supplier document')}
        description={t(
          'Upload a purchase photo to fill the table. Review and edit every row before saving.',
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
          {
            <Button type="button" disabled={!image || busy} onClick={() => void read()}>
              {busy ? t('Reading document…') : t('Read document')}
            </Button>
          }
          <ErrorMessage error={error} />
          {error instanceof ApiError && error.details && (
            <details className="purchase-document-diagnostics">
              <summary>{t('Technical details')}</summary>
              <dl>
                {error.details.providerStatus != null && (
                  <>
                    <dt>{t('OpenAI HTTP status')}</dt>
                    <dd>{error.details.providerStatus}</dd>
                  </>
                )}
                {error.details.providerCode && (
                  <>
                    <dt>{t('Error code')}</dt>
                    <dd>{error.details.providerCode}</dd>
                  </>
                )}
                {error.details.requestId && (
                  <>
                    <dt>{t('OpenAI request ID')}</dt>
                    <dd>{error.details.requestId}</dd>
                  </>
                )}
              </dl>
            </details>
          )}
        </div>
      </Dialog>
    </>
  );
}
