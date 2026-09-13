import { t, useLanguage, getLocale } from './i18n';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type Receipt, type PosContext, toScaled, fromScaled } from '@eliza/contracts';
import { api, ApiError, refresh } from './api';
import { Button } from './components/ui/button';
import { Dialog } from './components/ui/dialog';
import { Field, ErrorMessage } from './forms';
import { formatMoney, ReceiptView } from './receipts';
type Refund = {
  id: string;
  number: string;
  total: string;
  reason: string;
  method: string;
  cashier: string;
  approver: string;
  createdAt: string;
  lines: { name: string; quantity: string; restock: boolean; total: string }[];
};
type Detail = {
  receipt: Receipt;
  returned: { productId: string; quantity: string }[];
  refunds: Refund[];
};
export function ReceiptSearch({ context }: { context?: PosContext }) {
  useLanguage();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [filter, setFilter] = useState({ q: '', page: 1, from: '', to: '' });
  const [id, setId] = useState<string>();
  const base = context ? '/pos' : '/reports';
  const scope = context
    ? `${context.store!.id}:${context.device!.id}:${context.operator!.id}`
    : 'management';
  const query = useQuery({
    queryKey: ['receipt-search', scope, filter],
    queryFn: () =>
      api<{ receipts: Receipt[]; hasMore: boolean }>(
        base +
          '/receipt-search?' +
          new URLSearchParams({
            q: filter.q,
            page: String(filter.page),
            ...(filter.from ? { from: filter.from } : {}),
            ...(filter.to ? { to: filter.to } : {}),
          }),
      ),
    enabled: open,
  });
  const detail = useQuery({
    queryKey: ['receipt-detail', scope, id],
    queryFn: () => api<Detail>(base + '/receipt-search/' + id),
    enabled: open && !!id,
  });
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        {context ? t('Search / refund') : t('Search all receipts')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t('Receipt search')}
        description={t(
          'Search all stored receipts by number or transaction ID, with optional dates.',
        )}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setId(undefined);
            setFilter({ q, from, to, page: 1 });
          }}
        >
          <Field label={t('Receipt number or transaction ID')}>
            <input value={q} onChange={(e) => setQ(e.target.value)} />
          </Field>
          <div className="form-grid">
            <Field label={t('From date')}>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label={t('To date')}>
              <input type="date" min={from} value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
          <Button>{t('Search receipts')}</Button>
        </form>
        <ErrorMessage error={query.error} />
        {query.isFetching ? (
          <p>{t('Searching…')}</p>
        ) : (
          <>
            {query.data?.receipts.map((r) => (
              <div key={r.id} className="cash-history-row">
                <span>
                  {r.receiptNumber}
                  <small>
                    {new Date(r.createdAt).toLocaleString(getLocale(), { timeZone: r.timezone })} ·{' '}
                    {formatMoney(r.total, r.currency)}
                  </small>
                </span>
                <Button variant="ghost" onClick={() => setId(r.id)}>
                  {t('Open receipt ')}
                </Button>
              </div>
            ))}
            {query.data?.receipts.length === 0 && <p>{t('No matching receipts.')}</p>}
            <Button
              variant="ghost"
              disabled={filter.page === 1}
              onClick={() => setFilter({ ...filter, page: filter.page - 1 })}
            >
              {t('Previous ')}
            </Button>
            <span>
              {t('Page ')}
              {filter.page}
            </span>
            <Button
              variant="ghost"
              disabled={!query.data?.hasMore}
              onClick={() => setFilter({ ...filter, page: filter.page + 1 })}
            >
              {t('Next ')}
            </Button>
          </>
        )}
        <ErrorMessage error={detail.error} />
        {id && detail.isFetching && <p>{t('Loading receipt…')}</p>}
        {detail.data && (
          <>
            <ReceiptView
              receipt={detail.data.receipt}
              reprint
              beforePrint={() =>
                api(
                  context
                    ? '/pos/receipt-search/' + id + '/reprint'
                    : '/reports/sales/' + id + '/reprint',
                  {},
                )
              }
            />
            <h3>{t('Refund history')}</h3>
            {!detail.data.refunds.length && <p>{t('No refunds recorded.')}</p>}
            {detail.data.refunds.map((r) => (
              <details key={r.id}>
                <summary>
                  {r.number} · {formatMoney(r.total, detail.data!.receipt.currency)}
                </summary>
                <p>
                  {r.reason} · {t(r.method)} · {r.cashier}
                  {t(', approved by ')}
                  {r.approver}
                </p>
                {r.lines.map((l, i) => (
                  <p key={i}>
                    {l.name}: {l.quantity} ·{' '}
                    {l.restock ? t('Returned to stock') : t('Not restocked')} ·{' '}
                    {formatMoney(l.total, detail.data!.receipt.currency)}
                  </p>
                ))}
              </details>
            ))}
            {context ? (
              <RefundForm key={id} context={context} detail={detail.data} />
            ) : (
              <p className="muted">
                {t('Issue refunds from an enrolled checkout register with an open shift. ')}
              </p>
            )}
          </>
        )}
      </Dialog>
    </>
  );
}
function RefundForm({ context, detail }: { context: PosContext; detail: Detail }) {
  useLanguage();
  const key = `eliza-refund:${context.store!.id}:${context.device!.id}:${context.operator!.id}:${detail.receipt.id}`;
  const [pending, setPending] = useState<Record<string, unknown> | undefined>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(key) ?? 'null') ?? undefined;
    } catch {
      return undefined;
    }
  });
  const [quantities, setQuantities] = useState<Record<string, string>>({}),
    [restock, setRestock] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [code, setCode] = useState(''),
    [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [result, setResult] = useState<Refund>();
  let preview = '—';
  try {
    let total = 0n;
    for (const l of detail.receipt.lines) {
      const qty = toScaled(quantities[l.productId] ?? '0', 3),
        sold = toScaled(l.quantity, 3),
        prior = toScaled(
          detail.returned.find((r) => r.productId === l.productId)?.quantity ?? '0',
          3,
        ),
        cents = toScaled(l.total, 2);
      if (qty < 0n || qty + prior > sold) throw new Error();
      total += (cents * (prior + qty) + sold / 2n) / sold - (cents * prior + sold / 2n) / sold;
    }
    preview = formatMoney(fromScaled(total, 2), detail.receipt.currency);
  } catch {}
  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      const payload = pending ?? {
        requestId: crypto.randomUUID(),
        saleId: detail.receipt.id,
        reason,
        method: detail.receipt.payment.method,
        confirmed,
        lines: detail.receipt.lines
          .filter((l) => Number(quantities[l.productId] ?? 0) > 0)
          .map((l) => ({
            productId: l.productId,
            quantity: quantities[l.productId],
            restock: restock[l.productId] ?? false,
          })),
      };
      sessionStorage.setItem(key, JSON.stringify(payload));
      setPending(payload);
      const r = await api<Refund>('/pos/refunds', {
        ...payload,
        ...(code && pin ? { approval: { employeeCode: code, pin } } : {}),
      });
      sessionStorage.removeItem(key);
      setPending(undefined);
      setResult(r);
      void refresh();
    } catch (e) {
      setError(e);
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        sessionStorage.removeItem(key);
        setPending(undefined);
      }
    } finally {
      setPin('');
      setBusy(false);
    }
  }
  if (result)
    return (
      <div className="notice">
        <h3>
          {t('Refund recorded: ')}
          {result.number}
        </h3>
        <p>
          {formatMoney(result.total, detail.receipt.currency)} · {result.method}
        </p>
        <p>
          {result.method === 'cash'
            ? t('Return this amount from the drawer.')
            : t('The external card refund has been recorded.')}
        </p>
      </div>
    );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h3>{t('Return items')}</h3>
      <fieldset disabled={!!pending || busy}>
        {detail.receipt.lines.map((l) => {
          const remaining = fromScaled(
            toScaled(l.quantity, 3) -
              toScaled(
                detail.returned.find((r) => r.productId === l.productId)?.quantity ?? '0',
                3,
              ),
            3,
          );
          return (
            <div key={l.productId}>
              <Field
                label={t('{value0} — {value1} {value2} remaining', {
                  value0: l.name,
                  value1: remaining,
                  value2: t(l.unit ?? ''),
                })}
              >
                <input
                  inputMode="decimal"
                  value={quantities[l.productId] ?? '0'}
                  onChange={(e) => setQuantities({ ...quantities, [l.productId]: e.target.value })}
                />
              </Field>
              <label>
                <input
                  type="checkbox"
                  checked={restock[l.productId] ?? false}
                  onChange={(e) => setRestock({ ...restock, [l.productId]: e.target.checked })}
                />{' '}
                {t('Saleable: restore stock ')}
              </label>
            </div>
          );
        })}
        <p>
          <strong>
            {t('Refund amount: ')}
            {preview}
          </strong>
        </p>
        <Field label={t('Return reason')}>
          <input required value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <label>
          <input
            type="checkbox"
            required
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          {detail.receipt.payment.method === 'card'
            ? t(' I confirm the card refund was completed on the external terminal.')
            : t(' I confirm these items should be refunded in cash.')}
        </label>
      </fieldset>
      {!context.operator!.permissions.includes('refund.approve') && (
        <>
          <Field label={t('Approving manager code')}>
            <input value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Field label={t('Approving manager PIN')}>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
            />
          </Field>
        </>
      )}
      <ErrorMessage error={error} />
      {pending && (
        <p className="notice">
          {t(
            'A refund confirmation is pending. Retry this same request; do not issue another payment. ',
          )}
        </p>
      )}
      <Button disabled={busy || (!context.shift && !pending)}>
        {pending ? t('Recover refund') : t('Confirm refund')}
      </Button>
      {!context.shift && <p>{t('Start a shift before issuing a refund.')}</p>}
    </form>
  );
}
