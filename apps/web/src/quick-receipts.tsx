import { useState, type FormEvent } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Check, PackagePlus, Pencil, Plus, Truck } from 'lucide-react';
import {
  quickReceiptInputSchema,
  quickReceiptShortcutSchema,
  calculatePurchaseLine,
  type Permission,
  type QuickReceiptShortcut,
  type QuickReceiptResult,
} from '@eliza/contracts';
import { z } from 'zod';
import { api, ApiError, refresh, useSession } from './api';
import { ErrorMessage, Field, SearchSelect } from './forms';
import { Button } from './components/ui/button';
import { t, useLanguage } from './i18n';
import { formatQuantity } from './quantity-format';
import './quick-receipts.css';
const canConfigure = (permissions: Permission[]) =>
  permissions.includes('purchases.write') && permissions.includes('purchases.cost');
const useShortcuts = (pos = false, enabled = true) =>
  useQuery({
    queryKey: ['quick-receipts', pos ? 'pos' : 'management'],
    queryFn: () => api<QuickReceiptShortcut[]>(pos ? '/pos/quick-receipts' : '/quick-receipts'),
    enabled,
  });
function Money({ value, currency }: { value: string; currency: string }) {
  return (
    <>
      {formatQuantity(value)} {currency}
    </>
  );
}
function ShortcutCards({
  rows,
  onSelect,
  canReceive,
  configure = false,
}: {
  rows: QuickReceiptShortcut[];
  onSelect?: (q: QuickReceiptShortcut) => void;
  canReceive: boolean;
  configure?: boolean;
}) {
  return (
    <div className="quick-shortcut-grid">
      {rows.map((q) => (
        <article className="quick-shortcut" key={q.id}>
          <div className="quick-shortcut-product">
            {q.image ? (
              <img src={q.image} alt="" />
            ) : (
              <span className="icon-tile">
                <PackagePlus size={24} />
              </span>
            )}
            <div>
              <h3>{q.name}</h3>
              <p>{q.productName}</p>
              <small>
                <Truck size={14} />
                {q.supplierName}
              </small>
            </div>
          </div>
          {!q.available && (
            <p className="muted">
              {t(q.active ? 'Product or supplier is inactive.' : 'Shortcut archived.')}
            </p>
          )}
          <div className="quick-shortcut-actions">
            {canReceive &&
              (onSelect ? (
                <Button disabled={!q.available} onClick={() => onSelect(q)}>
                  {t('Receive delivery')}
                </Button>
              ) : (
                <Link
                  to="/purchases/quick-receive/$id"
                  params={{ id: q.id }}
                  className={'button button-primary' + (!q.available ? ' quick-disabled' : '')}
                  aria-disabled={!q.available}
                  onClick={(e) => {
                    if (!q.available) e.preventDefault();
                  }}
                >
                  {t('Receive delivery')}
                </Link>
              ))}
            {configure && (
              <Link
                to="/purchases/quick-receive/$id/edit"
                params={{ id: q.id }}
                className="button button-outline"
                aria-label={t('Edit {value0}', { value0: q.name })}
              >
                <Pencil size={16} />
              </Link>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
export function QuickReceivingPanel() {
  useLanguage();
  const session = useSession().data!;
  const configure = canConfigure(session.user.permissions);
  const receive = session.user.permissions.includes('purchases.quick_receive');
  const rows = useShortcuts(false, configure || receive);
  if (!configure && !receive) return null;
  return (
    <section className="panel quick-panel">
      <div className="quick-heading">
        <div>
          <h2>{t('Quick receiving')}</h2>
          <p className="muted">
            {t('Regular deliveries: choose a product, enter quantity and actual purchase cost.')}
          </p>
        </div>
        {configure && (
          <Link to="/purchases/quick-receive/new" className="button button-outline">
            <Plus size={17} />
            {t('Add shortcut')}
          </Link>
        )}
      </div>
      {rows.isPending ? (
        <p role="status">{t('Loading…')}</p>
      ) : (
        <>
          <ErrorMessage error={rows.error} />
          {rows.isError && (
            <Button variant="outline" onClick={() => void rows.refetch()}>
              {t('Try again')}
            </Button>
          )}
          {rows.data?.length === 0 && (
            <p className="muted">
              {t('No receiving shortcuts yet. A manager can add recurring products here.')}
            </p>
          )}
          <ShortcutCards rows={rows.data ?? []} canReceive={receive} configure={configure} />
        </>
      )}
      {configure && (
        <p className="quick-permission-note muted">
          {t(
            'Assign the “Receiving clerk” role in Team to let staff accept these deliveries. Combine it with Cashier for register access.',
          )}
        </p>
      )}
    </section>
  );
}
type PendingReceipt = z.infer<typeof quickReceiptInputSchema>;
function QuickReceiptForm({
  shortcut: q,
  pos = false,
  currency,
  actorKey,
  onBack,
  canViewPurchase = false,
}: {
  shortcut: QuickReceiptShortcut;
  pos?: boolean;
  currency: string;
  actorKey: string;
  onBack?: () => void;
  canViewPurchase?: boolean;
}) {
  useLanguage();
  const storageKey = `eliza:quick-receipt:${actorKey}:${q.id}`;
  const [initial] = useState(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      return raw
        ? { body: quickReceiptInputSchema.parse(JSON.parse(raw)), error: null }
        : { body: null, error: null };
    } catch {
      return {
        body: null,
        error: new Error('Enable browser storage before receiving so retries can be recovered.'),
      };
    }
  });
  const [pending, setPending] = useState<PendingReceipt | null>(initial.body);
  const [quantity, setQuantity] = useState(initial.body?.quantity ?? '');
  const [cost, setCost] = useState(initial.body?.unitCost ?? '');
  const [error, setError] = useState<unknown>(initial.error);
  const [result, setResult] = useState<QuickReceiptResult | null>(null);
  const mutation = useMutation({
    mutationFn: (b: PendingReceipt) =>
      api<QuickReceiptResult>(`${pos ? '/pos' : ''}/quick-receipts/${q.id}/receive`, b),
    onSuccess: (r) => {
      setResult(r);
      setPending(null);
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        /* A later retry safely returns the recorded result. */
      }
      void refresh();
    },
    onError: (e) => {
      setError(e);
      if (
        e instanceof ApiError &&
        e.status >= 400 &&
        e.status < 500 &&
        ![401, 403, 408].includes(e.status)
      ) {
        setPending(null);
        try {
          sessionStorage.removeItem(storageKey);
        } catch {}
      }
    },
  });
  const parsed = quickReceiptInputSchema.safeParse({
    requestId: crypto.randomUUID(),
    version: q.version,
    quantity: quantity.replace(',', '.'),
    unitCost: cost.replace(',', '.'),
  });
  const totals = parsed.success
    ? calculatePurchaseLine(parsed.data.unitCost, parsed.data.quantity, q.taxRate)
    : null;
  const back = onBack ? (
    <Button variant="ghost" onClick={onBack} disabled={mutation.isPending}>
      <ArrowLeft size={16} />
      {t('Back')}
    </Button>
  ) : (
    <Link to="/purchases" className="text-link">
      <ArrowLeft size={16} />
      {t('Back to purchases')}
    </Link>
  );
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (initial.error) return;
    setError(null);
    if (pending) {
      mutation.mutate(pending);
      return;
    }
    const form = new FormData(e.currentTarget);
    const payload = quickReceiptInputSchema.safeParse({
      requestId: crypto.randomUUID(),
      version: q.version,
      quantity: quantity.replace(',', '.'),
      unitCost: cost.replace(',', '.'),
      expiryDate: String(form.get('expiryDate') ?? ''),
      deliveryReference: String(form.get('deliveryReference') ?? ''),
      notes: String(form.get('notes') ?? ''),
    });
    if (!payload.success) {
      setError(new Error(payload.error.issues.map((i) => i.message).join('. ')));
      return;
    }
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(payload.data));
    } catch {
      setError(new Error('Enable browser storage before receiving so retries can be recovered.'));
      return;
    }
    setPending(payload.data);
    mutation.mutate(payload.data);
  }
  if (result)
    return (
      <section className="panel quick-receipt-form quick-success" role="status">
        <Check size={32} />
        <h1>{t('Delivery received')}</h1>
        <p>
          {q.productName} · {formatQuantity(result.quantity)} {t(q.unit)}
        </p>
        <p>
          {result.receiptNumber} · <Money value={result.total} currency={currency} />
        </p>
        <p className="muted">{t('Stock and batch cost recorded. Payment status: unpaid.')}</p>
        <div className="quick-shortcut-actions">
          <Button
            onClick={() => {
              setResult(null);
              setQuantity('');
              setCost('');
              setError(null);
              mutation.reset();
            }}
          >
            {t('Receive another delivery')}
          </Button>
          {canViewPurchase && (
            <Link
              to="/purchases/$id"
              params={{ id: result.purchaseId }}
              className="button button-outline"
            >
              {t('View purchase')}
            </Link>
          )}
          {back}
        </div>
      </section>
    );
  return (
    <div className="quick-receipt-page">
      {back}
      <section className="panel quick-receipt-form">
        <div className="quick-heading">
          <div>
            <span className="eyebrow">{t('Quick receiving')}</span>
            <h1>{q.name}</h1>
            <p>
              {q.productName} · {q.sku}
            </p>
            <p className="muted quick-supplier">
              <Truck size={16} /> {q.supplierName}
            </p>
          </div>
        </div>
        <form onSubmit={submit}>
          <fieldset disabled={!!pending || mutation.isPending || !q.available}>
            <div className="quick-form-grid quick-required-fields">
              <Field label="Quantity" hint={t('Receiving unit: {value0}', { value0: t(q.unit) })}>
                <input
                  autoFocus
                  required
                  inputMode="decimal"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="0"
                />
              </Field>
              <Field
                label="Actual unit cost excl. tax"
                hint={t('Enter the actual price for this delivery, per {value0}.', {
                  value0: t(q.unit),
                })}
              >
                <input
                  required
                  inputMode="decimal"
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  placeholder={currency}
                />
              </Field>
            </div>
            <details className="quick-extra">
              <summary>{t('Expiry date, document and notes (optional)')}</summary>
              <div className="quick-form-grid">
                <Field label="Expiry date">
                  <input
                    type="date"
                    name="expiryDate"
                    defaultValue={initial.body?.expiryDate ?? ''}
                  />
                </Field>
                <Field label="Supplier document number">
                  <input
                    name="deliveryReference"
                    maxLength={120}
                    defaultValue={initial.body?.deliveryReference ?? ''}
                  />
                </Field>
                <Field label="Notes">
                  <textarea
                    name="notes"
                    maxLength={2000}
                    defaultValue={initial.body?.notes ?? ''}
                  />
                </Field>
              </div>
            </details>
          </fieldset>
          <div className="quick-receipt-summary">
            <div>
              <span>{t('Subtotal excl. tax')}</span>
              <strong>
                {totals ? <Money value={totals.subtotal} currency={currency} /> : '—'}
              </strong>
            </div>
            <div>
              <span>
                {t('Purchase tax')} ({formatQuantity(q.taxRate)}%)
              </span>
              <strong>{totals ? <Money value={totals.tax} currency={currency} /> : '—'}</strong>
            </div>
            <div>
              <span>{t('Total incl. tax')}</span>
              <strong>{totals ? <Money value={totals.total} currency={currency} /> : '—'}</strong>
            </div>
          </div>
          <p className="muted">
            {t(
              'Creates a delivered, unpaid purchase and a separate stock batch. The selling price stays unchanged.',
            )}
          </p>
          <ErrorMessage error={error} />
          {pending && !mutation.isPending && (
            <p role="status">
              {t('The result is not confirmed. Retry this same receipt to avoid duplicates.')}
            </p>
          )}
          <Button
            type="submit"
            disabled={mutation.isPending || !!initial.error || (!pending && !q.available)}
          >
            <PackagePlus size={18} />
            {t(mutation.isPending ? 'Receiving…' : pending ? 'Retry receipt' : 'Confirm delivery')}
          </Button>
        </form>
      </section>
    </div>
  );
}
export function QuickReceiptPage() {
  const session = useSession().data!;
  const { id } = useParams({ strict: false }) as { id: string };
  const rows = useShortcuts();
  if (rows.isPending) return <p role="status">{t('Loading…')}</p>;
  if (rows.error)
    return (
      <>
        <ErrorMessage error={rows.error} />
        <Button onClick={() => void rows.refetch()}>{t('Try again')}</Button>
      </>
    );
  const q = rows.data?.find((q) => q.id === id);
  if (!q) return <p>{t('Shortcut not found.')}</p>;
  return (
    <QuickReceiptForm
      key={q.id}
      shortcut={q}
      currency={session.store.currency}
      actorKey={`${session.store.id}:${session.user.id}`}
      canViewPurchase={session.user.permissions.includes('purchases.read')}
    />
  );
}
export function PosQuickReceiving({
  storeId,
  employeeId,
  currency,
  onBack,
}: {
  storeId: string;
  employeeId: string;
  currency: string;
  onBack: () => void;
}) {
  useLanguage();
  const rows = useShortcuts(true);
  const [selected, setSelected] = useState<QuickReceiptShortcut | null>(null);
  if (selected)
    return (
      <div className="pos-quick-receiving">
        <QuickReceiptForm
          key={selected.id}
          shortcut={rows.data?.find((q) => q.id === selected.id) ?? selected}
          pos
          currency={currency}
          actorKey={`${storeId}:${employeeId}`}
          onBack={() => setSelected(null)}
        />
      </div>
    );
  return (
    <div className="pos-quick-receiving">
      <Button variant="ghost" onClick={onBack}>
        <ArrowLeft size={16} />
        {t('Back to checkout')}
      </Button>
      <section className="panel quick-panel">
        <h1>{t('Quick receiving')}</h1>
        <p className="muted">
          {t('Regular deliveries: choose a product, enter quantity and actual purchase cost.')}
        </p>
        <ErrorMessage error={rows.error} />
        {rows.isError && <Button onClick={() => void rows.refetch()}>{t('Try again')}</Button>}
        {rows.isPending && <p>{t('Loading…')}</p>}
        {rows.data?.length === 0 && (
          <p>{t('No receiving shortcuts yet. A manager can add recurring products here.')}</p>
        )}
        <ShortcutCards rows={rows.data ?? []} canReceive onSelect={setSelected} />
      </section>
    </div>
  );
}
type Options = {
  suppliers: { id: string; name: string }[];
  products: { id: string; name: string; sku: string; unit: string; barcodes: string[] }[];
};
export function QuickShortcutEditor({ create = false }: { create?: boolean }) {
  useLanguage();
  const session = useSession().data!;
  const allowed = canConfigure(session.user.permissions);
  const { id } = useParams({ strict: false }) as { id?: string };
  const rows = useShortcuts(false, allowed);
  const options = useQuery({
    queryKey: ['quick-receipt-options'],
    queryFn: () => api<Options>('/quick-receipts/options'),
    enabled: allowed,
  });
  if (!allowed) return <p>{t('Access restricted')}</p>;
  if (rows.isPending || options.isPending) return <p role="status">{t('Loading…')}</p>;
  if (rows.error || options.error) return <ErrorMessage error={rows.error ?? options.error} />;
  const q = create ? undefined : rows.data?.find((q) => q.id === id);
  if (!create && !q) return <p>{t('Shortcut not found.')}</p>;
  return <QuickShortcutForm key={q?.id ?? 'new'} shortcut={q} options={options.data!} />;
}
function QuickShortcutForm({
  shortcut: q,
  options,
}: {
  shortcut?: QuickReceiptShortcut;
  options: Options;
}) {
  const [name, setName] = useState(q?.name ?? '');
  const [supplierId, setSupplier] = useState(q?.supplierId ?? '');
  const [productId, setProduct] = useState(q?.productId ?? '');
  const [tax, setTax] = useState(q ? String(Number(q.taxRate)) : '0');
  const [active, setActive] = useState(q?.active ?? true);
  const [error, setError] = useState<unknown>();
  const [saved, setSaved] = useState(false);
  const [requestId, setRequest] = useState(() => crypto.randomUUID());
  const mutation = useMutation({
    mutationFn: (body: unknown) => api('/quick-receipts', body),
    onSuccess: () => {
      setSaved(true);
      void refresh();
    },
    onError: setError,
  });
  const [frozen, setFrozen] = useState<unknown>(null);
  const supplier = options.suppliers.find((s) => s.id === supplierId);
  const product = options.products.find((p) => p.id === productId);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (frozen) {
      mutation.mutate(frozen);
      return;
    }
    const parsed = quickReceiptShortcutSchema.safeParse({
      name,
      supplierId,
      productId,
      taxRate: tax.replace(',', '.'),
      active,
    });
    if (!parsed.success) {
      setError(new Error(parsed.error.issues.map((i) => i.message).join('. ')));
      return;
    }
    const body = { ...parsed.data, requestId, ...(q ? { id: q.id, version: q.version } : {}) };
    setFrozen(body);
    mutation.mutate(body, {
      onError: (e) => {
        if (
          e instanceof ApiError &&
          e.status >= 400 &&
          e.status < 500 &&
          ![401, 403, 408].includes(e.status)
        ) {
          setFrozen(null);
          setRequest(crypto.randomUUID());
        }
      },
    });
  }
  return (
    <div className="quick-receipt-page">
      <Link to="/purchases" className="text-link">
        <ArrowLeft size={16} />
        {t('Back to purchases')}
      </Link>
      <section className="panel quick-receipt-form">
        <h1>{t(q ? 'Edit receiving shortcut' : 'New receiving shortcut')}</h1>
        {saved ? (
          <div role="status">
            <p>{t('Shortcut saved.')}</p>
            <Link to="/purchases" className="button button-primary">
              {t('Back to purchases')}
            </Link>
          </div>
        ) : (
          <form onSubmit={submit}>
            <fieldset disabled={!!frozen || mutation.isPending}>
              <Field
                label="Shortcut name"
                hint={t('For example: Bread. Use the same shortcut for every delivery.')}
              >
                <input
                  required
                  maxLength={120}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <SearchSelect
                label={t('Supplier')}
                placeholder={t('Search suppliers')}
                value={
                  supplier ? { title: supplier.name } : q ? { title: q.supplierName } : undefined
                }
                options={options.suppliers.map((s) => ({
                  id: s.id,
                  title: s.name,
                  keywords: [s.name],
                }))}
                onSelect={setSupplier}
              />
              <SearchSelect
                label={t('Product')}
                placeholder={t('Search by name, SKU or barcode')}
                value={
                  product
                    ? { title: product.name, subtitle: product.sku }
                    : q
                      ? { title: q.productName, subtitle: q.sku }
                      : undefined
                }
                options={options.products.map((p) => ({
                  id: p.id,
                  title: p.name,
                  subtitle: p.sku,
                  keywords: [p.name, p.sku, ...p.barcodes],
                }))}
                onSelect={setProduct}
              />
              <Field label="Purchase tax %">
                <input
                  required
                  inputMode="decimal"
                  value={tax}
                  onChange={(e) => setTax(e.target.value)}
                />
              </Field>
              {q && (
                <label className="quick-checkbox">
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={(e) => setActive(e.target.checked)}
                  />
                  {t('Active shortcut')}
                </label>
              )}
            </fieldset>
            <p className="muted">
              {t(
                'Staff must enter quantity and actual cost every time. No purchase price is saved in this shortcut.',
              )}
            </p>
            <ErrorMessage error={error} />
            <Button type="submit" disabled={mutation.isPending}>
              {t(mutation.isPending ? 'Saving…' : frozen ? 'Try again' : 'Save shortcut')}
            </Button>
          </form>
        )}
      </section>
    </div>
  );
}
