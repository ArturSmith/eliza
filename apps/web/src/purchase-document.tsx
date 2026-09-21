import { useState } from 'react';
import {
  type Extraction,
  type Product,
  type Supplier,
  confidentTextMatch,
  documentImageSchema,
  matchingTextScore,
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
type PurchaseReference = {
  id: string;
  number: string;
  supplier_id: string;
  supplier_reference: string;
};

type SupplierPrefill = {
  name: string;
  code: string;
  companyNumber: string;
  contactName: string;
  phone: string;
  notes: string;
};

function matchingSuppliers(
  document: Extraction,
  suppliers: Supplier[],
  referenceMatches: PurchaseReference[],
) {
  const digits = (value: string) => value.replace(/\D/g, '');
  const code = normalizeMatchText(document.supplierCode);
  const company = normalizeMatchText(document.supplierCompanyNumber);
  return suppliers
    .filter((supplier) => supplier.active)
    .map((supplier) => {
      const name = document.supplierName
        ? matchingTextScore(document.supplierName, supplier.name)
        : 0;
      const phone = [document.supplierPhone, document.contactPhone].some(
        (value) => digits(value).length >= 7 && digits(value) === digits(supplier.phone),
      );
      const reference = referenceMatches.some((purchase) => purchase.supplier_id === supplier.id);
      const exactCode = !!code && normalizeMatchText(supplier.code) === code;
      const exactCompany = !!company && normalizeMatchText(supplier.companyNumber) === company;
      const score = exactCompany || exactCode ? 4 : reference ? 3 + name : phone ? 2 + name : name;
      return { supplier, score, phone, reference, exactCode, exactCompany, name };
    })
    .filter((candidate) => candidate.score >= 0.35)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
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
  onSelectSupplier,
}: {
  supplierId: string;
  products: Product[];
  suppliers: Supplier[];
  onApply: (lines: DocumentDraftLine[], reference: string, date: string) => void;
  onAddSupplier: (prefill: SupplierPrefill) => void;
  onSelectSupplier: (id: string) => void;
}) {
  useLanguage();
  const [open, setOpen] = useState(false);
  const [image, setImage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<Extraction | null>(null);
  const [candidates, setCandidates] = useState<ReturnType<typeof matchingSuppliers>>([]);
  const [referenceMatches, setReferenceMatches] = useState<PurchaseReference[]>([]);
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<unknown>(null);
  const activeProducts = products.filter((p) => p.active);
  async function upload(file?: File) {
    setError(null);
    setResult(null);
    setCandidates([]);
    setReferenceMatches([]);
    setMessages([]);
    setChatError(null);
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
      let matchingPurchases: PurchaseReference[] = [];
      if (document.supplierReference) {
        try {
          const purchases = await api<PurchaseReference[]>(
            '/purchases?search=' + encodeURIComponent(document.supplierReference),
          );
          matchingPurchases = purchases.filter(
            (purchase) =>
              normalizeMatchText(purchase.supplier_reference) ===
              normalizeMatchText(document.supplierReference),
          );
        } catch {
          // Supplier name and phone matching remain available if purchase history cannot load.
        }
      }
      setReferenceMatches(matchingPurchases);
      setCandidates(matchingSuppliers(document, supplierCandidates, matchingPurchases));
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
      setMessages([]);
      setChatError(null);
      onApply(enriched, document.supplierReference, document.documentDate);
      setOpen(false);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function ask() {
    if (!result || !question.trim() || chatBusy) return;
    const asked = question.trim();
    setChatBusy(true);
    setChatError(null);
    try {
      const response = await api<{ answer: string }>('/purchases/document-chat', {
        document: {
          supplierName: result.supplierName,
          supplierCode: result.supplierCode,
          supplierCompanyNumber: result.supplierCompanyNumber,
          supplierPhone: result.supplierPhone,
          contactName: result.contactName,
          contactPhone: result.contactPhone,
          supplierReference: result.supplierReference,
          documentDate: result.documentDate,
          lines: result.lines.map((line) => ({
            description: line.description,
            supplierSku: line.supplierSku,
            barcode: line.barcode,
            quantity: line.quantity,
            unitCost: line.unitCost,
          })),
        },
        question: asked,
        history: messages.slice(-6).map((message) => ({
          role: message.role,
          content: message.content.slice(0, 1000),
        })),
      });
      setMessages((current) => [
        ...current,
        { role: 'user', content: asked },
        { role: 'assistant', content: response.answer },
      ]);
      setQuestion('');
    } catch (error) {
      setChatError(error);
    } finally {
      setChatBusy(false);
    }
  }
  return (
    <>
      <div className="purchase-document-entry">
        <div className="purchase-document-actions">
          <Button type="button" variant="outline" onClick={() => setOpen(true)}>
            {t('Read supplier document')}
          </Button>
        </div>
        <small className="muted">
          {supplierId
            ? t('Upload a document to prepare purchase lines.')
            : t('You can read the document first. Add or select a supplier before saving.')}
        </small>
        {result && (
          <div className="purchase-assistant" role="log" aria-label={t('Document assistant')}>
            <p className="purchase-assistant-message">
              {t('I read document {reference} dated {date} and found {count} product rows.', {
                reference: result.supplierReference || '—',
                date: result.documentDate || '—',
                count: result.lines.length,
              })}
            </p>
            {referenceMatches.length > 0 && (
              <p className="notice">
                {t(
                  'A purchase with reference {reference} already exists. Check it before saving another.',
                  {
                    reference: result.supplierReference,
                  },
                )}
              </p>
            )}
            {supplierId ? (
              <p className="purchase-assistant-message">
                {t('Supplier confirmed. Review the product rows and save the draft when ready.')}
              </p>
            ) : (
              <>
                <p className="purchase-assistant-message">
                  {t('I found supplier {name}. Is one of these your supplier?', {
                    name: result.supplierName || '—',
                  })}
                </p>
                {candidates.map(({ supplier, exactCode, exactCompany, reference, phone, name }) => (
                  <div className="purchase-assistant-candidate" key={supplier.id}>
                    <span>
                      <strong>{supplier.name}</strong> · {supplier.code}
                      <small>
                        {exactCompany || exactCode
                          ? t('Matching supplier identifier')
                          : reference
                            ? t('Previous purchase with this reference')
                            : phone
                              ? t('Matching phone number')
                              : t('Similar supplier name')}
                        {name >= 0.35 && phone ? ' · ' + t('Similar supplier name') : ''}
                      </small>
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => onSelectSupplier(supplier.id)}
                    >
                      {t('Use this supplier')}
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    onAddSupplier({
                      name: result.supplierName,
                      code: result.supplierCode,
                      companyNumber: result.supplierCompanyNumber,
                      contactName: result.contactName,
                      phone: result.contactPhone || result.supplierPhone,
                      notes:
                        result.contactPhone && result.supplierPhone
                          ? t('Supplier business phone: {phone}', {
                              phone: result.supplierPhone,
                            })
                          : '',
                    })
                  }
                >
                  {t('Create new supplier')}
                </Button>
                <small className="muted">
                  {t('Review these details before approving a new supplier.')}
                </small>
              </>
            )}
            <p className="purchase-assistant-message">
              {t('I matched {matched} products; {unmatched} need your review.', {
                matched: result.lines.filter((line) => line.productId).length,
                unmatched: result.lines.filter((line) => !line.productId).length,
              })}
            </p>
            <small className="muted">
              {t(
                'Choose or create unmatched products in the table below. Check quantities, units, costs and tax before saving the purchase draft.',
              )}
            </small>
            {messages.map((message, index) => (
              <p
                className={'purchase-assistant-message purchase-assistant-' + message.role}
                key={index}
              >
                <strong>{message.role === 'user' ? t('You') : t('Eliza')}:</strong>{' '}
                {message.content}
              </p>
            ))}
            <div className="purchase-assistant-question">
              <input
                aria-label={t('Ask about this document')}
                placeholder={t('Ask about this document')}
                maxLength={500}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void ask();
                  }
                }}
              />
              <Button
                type="button"
                disabled={chatBusy || !question.trim()}
                onClick={() => void ask()}
              >
                {chatBusy ? t('Thinking…') : t('Ask')}
              </Button>
            </div>
            <ErrorMessage error={chatError} />
          </div>
        )}
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
