import { useState } from 'react';
import { type Extraction, type Product, documentImageSchema } from '@eliza/contracts';
import { api, ApiError } from './api';
import { t, useLanguage } from './i18n';
import { Field, ErrorMessage } from './forms';
import { Dialog } from './components/ui/dialog';
import { Button } from './components/ui/button';

export type DocumentDraftLine = {
  productId: string;
  quantity: string;
  unitCost: string;
  taxRate: string;
  sellingPrice: string;
  source?: Extraction['lines'][number];
};

export function PurchaseDocument({
  supplierId,
  products,
  onApply,
}: {
  supplierId: string;
  products: Product[];
  onApply: (lines: DocumentDraftLine[], reference: string) => void;
}) {
  useLanguage();
  const [open, setOpen] = useState(false);
  const [image, setImage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<Extraction | null>(null);
  const activeProducts = products.filter((p) => p.active);
  async function upload(file?: File) {
    setError(null);
    setResult(null);
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
      const document = await api<Extraction>('/purchases/extract', { supplierId, image });
      setResult(document);
      onApply(
        document.lines.map((source) => {
          const product = activeProducts.find((p) => p.id === source.productId);
          return {
            source,
            productId: product?.id ?? '',
            quantity: source.quantity,
            unitCost: source.unitCost,
            taxRate: '',
            sellingPrice: product?.price ?? '',
          };
        }),
        document.supplierReference,
      );
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
