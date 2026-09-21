import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
import { ErrorMessage } from './forms';
import { Button } from './components/ui/button';
import { Dialog } from './components/ui/dialog';
import { SupplierForm } from './purchasing';
import type { DocumentDraftLine } from './purchase-document';

type Handoff = {
  supplierId: string;
  reference: string;
  date: string;
  lines: DocumentDraftLine[];
  focusLine: number;
};
const handoffKey = 'eliza.purchase-assistant.handoff';
export function readDocumentHandoff(): Handoff | null {
  try {
    const raw = sessionStorage.getItem(handoffKey);
    if (!raw) return null;
    sessionStorage.removeItem(handoffKey);
    const value: Handoff = JSON.parse(raw);
    return value.supplierId && Array.isArray(value.lines) && value.lines.length <= 100
      ? value
      : null;
  } catch {
    return null;
  }
}
type Lookup = { existing?: { id: string }; suggestion?: DocumentDraftLine['suggestion'] };
export function PurchaseAssistantPage() {
  useLanguage();
  const suppliers = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api<Supplier[]>('/suppliers'),
  });
  const [image, setImage] = useState('');
  const [document, setDocument] = useState<Extraction | null>(null);
  const [candidates, setCandidates] = useState<Supplier[]>([]);
  const [duplicate, setDuplicate] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [lines, setLines] = useState<DocumentDraftLine[]>([]);
  const [stage, setStage] = useState<'upload' | 'supplier' | 'products'>('upload');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<unknown>(null);
  async function upload(file?: File) {
    setDocument(null);
    setLines([]);
    setCandidates([]);
    setSupplierId('');
    setMessages([]);
    setStage('upload');
    setImage('');
    setError(null);
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 4_400_000) {
      setError('Upload a JPEG, PNG, or WebP photo smaller than 4.4 MB.');
      return;
    }
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
    }
  }
  async function read() {
    if (!image || busy) return;
    setBusy(true);
    setError(null);
    setStatus(t('Reading document…'));
    try {
      const result = await api<Extraction>('/purchases/extract', { image });
      setStatus(t('Checking suppliers…'));
      const current = await api<Supplier[]>('/suppliers');
      let references: { supplier_id: string; supplier_reference: string }[] = [];
      if (result.supplierReference) {
        try {
          references = (
            await api<typeof references>(
              '/purchases?search=' + encodeURIComponent(result.supplierReference),
            )
          ).filter(
            (row) =>
              normalizeMatchText(row.supplier_reference) ===
              normalizeMatchText(result.supplierReference),
          );
        } catch {
          /* Continue with supplier details. */
        }
      }
      setDuplicate(references.length > 0);
      const digits = (value: string) => value.replace(/\D/g, '');
      const ranked = current
        .filter((supplier) => supplier.active)
        .map((supplier) => {
          const name = result.supplierName
            ? matchingTextScore(result.supplierName, supplier.name)
            : 0;
          const code =
            !!result.supplierCode &&
            normalizeMatchText(result.supplierCode) === normalizeMatchText(supplier.code);
          const company =
            !!result.supplierCompanyNumber &&
            normalizeMatchText(result.supplierCompanyNumber) ===
              normalizeMatchText(supplier.companyNumber);
          const phone = [result.supplierPhone, result.contactPhone].some(
            (value) => digits(value).length >= 7 && digits(value) === digits(supplier.phone),
          );
          const reference = references.some((purchase) => purchase.supplier_id === supplier.id);
          return {
            supplier,
            score: code || company ? 4 : reference ? 3 + name : phone ? 2 + name : name,
          };
        })
        .filter((row) => row.score >= 0.35)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
      setCandidates(ranked.map((row) => row.supplier));
      setDocument(result);
      setStage('supplier');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      setStatus('');
    }
  }
  async function chooseSupplier(id: string) {
    if (!document || busy) return;
    setBusy(true);
    setError(null);
    setStatus(t('Checking products…'));
    try {
      const catalogue = (await api<Product[]>('/products')).filter((item) => item.active);
      const next = await Promise.all(
        document.lines.map(async (source): Promise<DocumentDraftLine> => {
          let product =
            catalogue.find((item) => item.id === source.productId) ??
            confidentTextMatch(source.description, catalogue, (item) => item.name);
          let suggestion: DocumentDraftLine['suggestion'];
          if (!product && source.barcode) {
            try {
              const lookup = await api<Lookup>(
                '/products/lookup/' + encodeURIComponent(source.barcode),
              );
              product = catalogue.find((item) => item.id === lookup.existing?.id);
              suggestion = lookup.suggestion ?? undefined;
            } catch {
              /* Public lookup is optional. */
            }
          }
          return {
            productId: product?.id ?? '',
            quantity: source.quantity,
            unitCost: source.unitCost,
            taxRate: '',
            sellingPrice: product?.price ?? '',
            source: { ...source, productId: product?.id ?? null },
            suggestion,
          };
        }),
      );
      setSupplierId(id);
      setLines(next);
      setStage('products');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      setStatus('');
    }
  }
  function openOrder(index: number) {
    if (!document || !supplierId) return;
    try {
      sessionStorage.setItem(
        handoffKey,
        JSON.stringify({
          supplierId,
          reference: document.supplierReference,
          date: document.documentDate,
          lines,
          focusLine: index,
        } satisfies Handoff),
      );
      window.location.assign('/purchases?document=1');
    } catch (e) {
      setError(e);
    }
  }
  async function ask() {
    if (!document || !question.trim() || chatBusy) return;
    const asked = question.trim();
    setQuestion('');
    setMessages((current) => [...current, { role: 'user', content: asked }]);
    setChatBusy(true);
    setChatError(null);
    try {
      const response = await api<{ answer: string }>('/purchases/document-chat', {
        document: {
          supplierName: document.supplierName,
          supplierCode: document.supplierCode,
          supplierCompanyNumber: document.supplierCompanyNumber,
          supplierPhone: document.supplierPhone,
          contactName: document.contactName,
          contactPhone: document.contactPhone,
          supplierReference: document.supplierReference,
          documentDate: document.documentDate,
          lines: document.lines.map(
            ({ description, supplierSku, barcode, quantity, unitCost }) => ({
              description,
              supplierSku,
              barcode,
              quantity,
              unitCost,
            }),
          ),
        },
        question: asked,
        history: messages
          .slice(-6)
          .map(({ role, content }) => ({ role, content: content.slice(0, 1000) })),
      });
      setMessages((current) => [...current, { role: 'assistant', content: response.answer }]);
    } catch (e) {
      setChatError(e);
    } finally {
      setChatBusy(false);
    }
  }
  return (
    <div className="document-chat-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">{t('PURCHASING')}</div>
          <h1>{t('Document assistant')}</h1>
          <p className="muted">
            {t(
              'Upload a supplier document. Confirm the supplier first, then review the purchase and products.',
            )}
          </p>
        </div>
      </div>
      <div className="document-chat" role="log" aria-live="polite">
        <div className="document-chat-bubble assistant">
          {t('Upload a supplier document and I will help prepare the purchase.')}
          <small>
            {t(
              'Reading sends the image to OpenAI. No supplier, product or purchase is saved without your approval.',
            )}
          </small>
        </div>
        <div className="document-chat-upload">
          <input
            aria-label={t('Document image')}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(event) => void upload(event.target.files?.[0])}
          />
          <Button type="button" disabled={!image || busy} onClick={() => void read()}>
            {t('Read document')}
          </Button>
        </div>
        {status && (
          <div className="document-chat-bubble assistant thinking" role="status">
            <span className="thinking-dots">● ● ●</span> {status}
          </div>
        )}
        <ErrorMessage error={error} />
        {error instanceof ApiError && error.details && (
          <details className="purchase-document-diagnostics">
            <summary>{t('Technical details')}</summary>
            <pre>{JSON.stringify(error.details, null, 2)}</pre>
          </details>
        )}
        {document && (
          <div className="document-chat-bubble assistant">
            {t('I read document {reference} dated {date} and found {count} product rows.', {
              reference: document.supplierReference || '—',
              date: document.documentDate || '—',
              count: document.lines.length,
            })}
          </div>
        )}
        {duplicate && document && (
          <div className="document-chat-bubble assistant notice">
            {t(
              'A purchase with reference {reference} already exists. Check it before saving another.',
              { reference: document.supplierReference },
            )}
          </div>
        )}
        {stage === 'supplier' && document && (
          <div className="document-chat-bubble assistant">
            <p>
              {candidates.length
                ? t('I found supplier {name}. Is one of these your supplier?', {
                    name: document.supplierName || '—',
                  })
                : t('There is no such supplier in the system. Add one?')}
            </p>
            {candidates.map((supplier) => (
              <div className="purchase-assistant-candidate" key={supplier.id}>
                <span>
                  <strong>{supplier.name}</strong> · {supplier.code}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void chooseSupplier(supplier.id)}
                >
                  {t('Use this supplier')}
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" onClick={() => setAddingSupplier(true)}>
              {t('Create new supplier')}
            </Button>
            <small>{t('Review these details before approving a new supplier.')}</small>
          </div>
        )}
        {stage === 'products' && document && (
          <>
            <div className="document-chat-bubble user">{t('Supplier confirmed.')}</div>
            <div className="document-chat-bubble assistant">
              <p>
                {t('I matched {matched} products; {unmatched} need your review.', {
                  matched: lines.filter((line) => line.productId).length,
                  unmatched: lines.filter((line) => !line.productId).length,
                })}
              </p>
              <p>
                {t(
                  'Select a product below to open the prefilled purchase order and review that row.',
                )}
              </p>
            </div>
            {lines.map((line, index) => (
              <button
                type="button"
                className="document-chat-product"
                key={index}
                onClick={() => openOrder(index)}
              >
                <span>
                  <strong>{line.source?.description || t('Unreadable description')}</strong>
                  <small>
                    {line.productId
                      ? t('Matched to product in catalogue')
                      : t('Needs product review')}
                  </small>
                  <small>
                    {t('Read quantity: {quantity}; unit cost: {cost}', {
                      quantity: line.quantity || '—',
                      cost: line.unitCost || '—',
                    })}
                  </small>
                </span>
                <span aria-hidden="true">→</span>
              </button>
            ))}
            <Button type="button" onClick={() => openOrder(0)}>
              {t('Review full purchase order')}
            </Button>
          </>
        )}
        {stage === 'products' && document && (
          <>
            {messages.map((message, index) => (
              <div className={'document-chat-bubble ' + message.role} key={index}>
                <strong>{message.role === 'user' ? t('You') : t('Eliza')}:</strong>{' '}
                {message.content}
              </div>
            ))}
            {chatBusy && (
              <div className="document-chat-bubble assistant thinking" role="status">
                <span className="thinking-dots">● ● ●</span> {t('Thinking…')}
              </div>
            )}
            <form
              className="purchase-assistant-question"
              onSubmit={(event) => {
                event.preventDefault();
                void ask();
              }}
            >
              <input
                aria-label={t('Ask about this document')}
                placeholder={t('Ask about this document')}
                maxLength={500}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
              />
              <Button type="submit" disabled={chatBusy || !question.trim()}>
                {t('Ask')}
              </Button>
            </form>
            <ErrorMessage error={chatError} />
            {image && (
              <details className="purchase-document-preview">
                <summary>{t('Open original image')}</summary>
                <img src={image} alt={t('Original supplier document')} />
              </details>
            )}
          </>
        )}
      </div>
      <Dialog
        elevated
        open={addingSupplier}
        onOpenChange={setAddingSupplier}
        title={t('Add supplier')}
        description={t('Keep supplier details available for your team.')}
      >
        {addingSupplier && document && (
          <SupplierForm
            supplier={null}
            prefill={{
              name: document.supplierName,
              code:
                document.supplierCode &&
                !(suppliers.data ?? []).some(
                  (item) => item.code.toLowerCase() === document.supplierCode.toLowerCase(),
                )
                  ? document.supplierCode
                  : 'SUP-' + crypto.randomUUID().slice(0, 8).toUpperCase(),
              companyNumber: document.supplierCompanyNumber,
              contactName: document.contactName,
              phone: document.contactPhone || document.supplierPhone,
              notes:
                document.contactPhone && document.supplierPhone
                  ? t('Supplier business phone: {phone}', { phone: document.supplierPhone })
                  : '',
            }}
            done={() => setAddingSupplier(false)}
            onCreated={(supplier) => void chooseSupplier(supplier.id)}
          />
        )}
      </Dialog>
    </div>
  );
}
