import { formatQuantity, quantityInputValue } from './quantity-format';
import { countText, t, useLanguage, getLocale } from './i18n';
import { useEffect, useRef, useState } from 'react';
import { normalizeCountQuantity } from './stock-count-quantities';
import './stock-counts.css';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { api, ApiError, refresh, useProducts, useSession } from './api';
import { Button } from './components/ui/button';
import { Dialog } from './components/ui/dialog';
import { Field, ErrorMessage } from './forms';
type Line = {
  product_id: string;
  product_name: string;
  sku: string;
  unit: string;
  system_quantity: string | null;
  counted_quantity: string | null;
  difference: string | null;
  counter: string | null;
  stock_changed: boolean;
};
type Count = {
  id: string;
  name: string;
  notes: string;
  status: string;
  version: number;
  creator: string;
  finalizer: string | null;
  finalized_at: string | null;
  lines: Line[];
};
type CountSummary = Omit<Count, 'lines'> & { productCount: number };
type Command = { path: string; body: Record<string, unknown> };
const countStatusTone: Record<string, string> = {
  draft: 'gray',
  counting: 'amber',
  review: 'amber',
  finalized: 'green',
  cancelled: 'gray',
};
export function StockCountsPage() {
  useLanguage();
  const list = useQuery({
    queryKey: ['stock-counts'],
    queryFn: () => api<CountSummary[]>('/stock-counts'),
  });
  const [selected, setSelected] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const session = useSession().data!;
  const manage = session.user.permissions.includes('counts.manage');
  const terms = search.trim().toLowerCase();
  const rows = (list.data ?? []).filter(
    (c) =>
      (filter === 'all' || c.status === filter) &&
      [c.name, c.creator, c.notes].some((v) => (v ?? '').toLowerCase().includes(terms)),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{t('INVENTORY ACCURACY')}</div>
          <h1>{t('Stock counts')}</h1>
          <p className="muted">
            {t(
              'Count physical stock, review differences, then finalize the adjustments. Latest 100 counts. ',
            )}
          </p>
        </div>
        {manage && <Button onClick={() => setCreating(true)}>{t('New stock count')}</Button>}
      </div>
      <p className="notice" style={{ marginBottom: 24 }}>
        {t(
          'Count when stock is not moving. Sales, deliveries, or adjustments after the count starts require a fresh count before finalization. ',
        )}
      </p>
      <section className="panel">
        <div className="table-toolbar">
          <div className="search-box">
            <Search size={18} />
            <input
              aria-label={t('Search stock counts')}
              placeholder={t('Search count name, creator, or notes…')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            aria-label={t('Filter count status')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            {['all', 'draft', 'counting', 'review', 'finalized', 'cancelled'].map((s) => (
              <option key={s} value={s}>
                {s === 'all' ? t('All statuses') : t(s)}
              </option>
            ))}
          </select>
          <span className="muted">{countText('counts', rows.length)}</span>
        </div>
        <ErrorMessage error={list.error} />
        {list.isPending ? (
          <p className="panel-padding">{t('Loading counts…')}</p>
        ) : rows.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t('Count')}</th>
                  <th>{t('Status')}</th>
                  <th className="table-number-column">{t('Products')}</th>
                  <th className="table-actions-column">{t('Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.name}</strong>
                      <small>
                        {c.creator}
                        {c.finalizer ? t(' · finalized by {value0}', { value0: c.finalizer }) : ''}
                      </small>
                    </td>
                    <td>
                      <span className={`badge badge-${countStatusTone[c.status] ?? 'gray'}`}>
                        {t(c.status)}
                      </span>
                    </td>
                    <td className="table-number-column">{c.productCount}</td>
                    <td className="table-actions-column">
                      <Button variant="ghost" onClick={() => setSelected(c.id)}>
                        {t('Open ')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="panel-padding">
            {list.data?.length
              ? t('No counts match this search or filter.')
              : t('No stock counts yet. Create one for the products you want to count.')}
          </p>
        )}
      </section>
      {selected && <CountDetail id={selected} />}
      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title={t('New stock count')}
        description={t('Choose up to 500 products. Only one count can be open per store.')}
      >
        {creating && (
          <CreateCount
            done={(id) => {
              setSelected(id);
              setCreating(false);
            }}
          />
        )}
      </Dialog>
    </>
  );
}
function CreateCount({ done }: { done: (id: string) => void }) {
  useLanguage();
  const products = useProducts();
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [ids, setIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [payload, setPayload] = useState<Record<string, unknown>>();
  const catalog = products.data ?? [];
  const categories = [...new Set(catalog.map((p) => p.category))].sort((a, b) =>
    a.localeCompare(b, getLocale()),
  );
  const categoryProducts = catalog.filter((p) => !category || p.category === category);
  const terms = search.trim().toLowerCase();
  const matches = categoryProducts.filter((p) =>
    [p.name, p.sku, p.brand ?? '', p.volume ?? '', ...p.barcodes].some((value) =>
      value.toLowerCase().includes(terms),
    ),
  );
  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      const body = payload ?? { requestId: crypto.randomUUID(), name, notes, productIds: ids };
      setPayload(body);
      const result = await api<Count>('/stock-counts', body);
      void refresh();
      done(result.id);
    } catch (e) {
      setError(e);
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) setPayload(undefined);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <fieldset disabled={!!payload}>
        <Field label={t('Count name')}>
          <input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('Count notes')}>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <Field
          label={t('Category (optional)')}
          hint={t(
            'Choosing a category selects all its products. You can adjust the selection below or choose products individually.',
          )}
        >
          <select
            value={category}
            disabled={products.isPending}
            onChange={(event) => {
              const next = event.target.value;
              setCategory(next);
              setSearch('');
              if (next) setIds(catalog.filter((p) => p.category === next).map((p) => p.id));
            }}
          >
            <option value="">{t('All categories')}</option>
            {categories.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>
        <div className="count-picker">
          <div className="count-picker-toolbar">
            <div className="search-box">
              <Search size={17} />
              <input
                aria-label={t('Find products')}
                placeholder={t('Search name or SKU…')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIds(categoryProducts.filter((p) => p.active).map((p) => p.id))}
            >
              {t('Select all active ')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setIds([])} disabled={!ids.length}>
              {t('Clear ')}
            </Button>
          </div>
          <div className="count-picker-status">
            <span className={ids.length > 500 ? 'count-picker-over' : 'muted'}>
              {ids.length} {t(' of 500 products selected ')}
            </span>
          </div>
          {ids.length > 500 && (
            <p className="count-selection-warning" role="alert">
              {t('Select at most 500 products. Narrow your selection before creating the count.')}
            </p>
          )}
          <div className="count-picker-list">
            {products.isPending ? (
              <p className="count-picker-empty">{t('Loading products…')}</p>
            ) : matches.length ? (
              matches.map((p) => (
                <label key={p.id} className="count-picker-option">
                  <input
                    type="checkbox"
                    checked={ids.includes(p.id)}
                    onChange={(e) =>
                      setIds(e.target.checked ? [...ids, p.id] : ids.filter((id) => id !== p.id))
                    }
                  />
                  <span className="count-picker-option-text">
                    <strong>{p.name}</strong>
                    <small>
                      {p.sku} · {t(p.unit ?? '')}
                      {!p.active ? t(' · Inactive') : ''}
                    </small>
                  </span>
                </label>
              ))
            ) : (
              <p className="count-picker-empty">
                {t('No products match “')}
                {search.trim()}”.
              </p>
            )}
          </div>
        </div>
      </fieldset>
      <ErrorMessage error={products.error ?? error} />
      <div className="form-actions">
        <Button disabled={busy || products.isPending || !ids.length || ids.length > 500}>
          {busy ? t('Creating…') : payload ? t('Retry creation') : t('Create draft')}
        </Button>
      </div>
    </form>
  );
}
function CountDetail({ id }: { id: string }) {
  useLanguage();
  const root = useRef<HTMLElement>(null);
  const q = useQuery({
    queryKey: ['stock-count', id],
    queryFn: () => api<Count>('/stock-counts/' + id),
  });
  useEffect(() => {
    if (q.isSuccess) root.current?.scrollIntoView({ block: 'start' });
  }, [id, q.isSuccess]);
  return (
    <section
      className="panel panel-padding stock-count-detail"
      ref={root}
      style={{ marginTop: 24 }}
    >
      <ErrorMessage error={q.error} />
      {q.data ? (
        <CountEditor key={id + ':' + q.data.version} count={q.data} />
      ) : (
        <p>{t('Loading count…')}</p>
      )}
    </section>
  );
}
function CountEditor({ count }: { count: Count }) {
  useLanguage();
  const session = useSession().data!;
  const manage = session.user.permissions.includes('counts.manage'),
    finalize = session.user.permissions.includes('counts.finalize');
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      count.lines.map((l) => [l.product_id, quantityInputValue(l.counted_quantity ?? '')]),
    ),
  );
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Command>();
  const [confirmation, setConfirmation] = useState<'finalize' | 'recount' | 'cancel'>();
  const [reason, setReason] = useState('');
  const changed = count.lines.some((l) => l.stock_changed);
  const complete = ['finalized', 'cancelled'].includes(count.status);
  const hasUnsavedQuantities = count.lines.some((line) => {
    const raw = values[line.product_id] ?? '';
    if (!raw.trim()) return line.counted_quantity !== null;
    try {
      return normalizeCountQuantity(raw, line.unit) !== line.counted_quantity;
    } catch {
      return true;
    }
  });
  const savedCount = count.lines.filter((line) => line.counted_quantity !== null).length;
  function saveQuantities() {
    const lines: { productId: string; quantity: string }[] = [];
    for (const line of count.lines) {
      const raw = values[line.product_id] ?? '';
      if (!raw.trim()) {
        if (line.counted_quantity !== null) {
          setError(
            new Error(
              t('Enter the counted quantity for {product}, including zero.', {
                product: line.product_name,
              }),
            ),
          );
          return;
        }
        continue;
      }
      try {
        lines.push({
          productId: line.product_id,
          quantity: normalizeCountQuantity(raw, line.unit),
        });
      } catch (cause) {
        setError(new Error(line.product_name + ': ' + t((cause as Error).message)));
        return;
      }
    }
    if (!lines.length) {
      setError(new Error(t('Enter a quantity for at least one product.')));
      return;
    }
    void send('quantities', { lines });
  }

  async function send(path: string, body: Record<string, unknown>) {
    setBusy(true);
    setError(undefined);
    const command = pending ?? {
      path,
      body: { ...body, requestId: crypto.randomUUID(), version: count.version },
    };
    setPending(command);
    try {
      await api('/stock-counts/' + count.id + '/' + command.path, command.body);
      setPending(undefined);
      setConfirmation(undefined);
      await refresh();
    } catch (e) {
      setError(e);
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        setPending(undefined);
        if (e.status === 409) void refresh();
      }
    } finally {
      setBusy(false);
    }
  }
  const action = (action: string) => send('action', { action, reason });
  return (
    <>
      <h2>{count.name}</h2>
      <p>
        {t(count.status)} {t(' · Created by ')}
        {count.creator}
      </p>
      <p className="muted">{count.notes}</p>
      {count.finalized_at && (
        <p>
          {t('Finalized by ')}
          {count.finalizer} ·{' '}
          {new Date(count.finalized_at).toLocaleString(getLocale(), {
            timeZone: session.store.timezone,
          })}
        </p>
      )}
      {changed && !complete && (
        <p className="notice">
          {t(
            'Stock moved after this count started. Restart and recount all selected products; saved quantities will be cleared. ',
          )}
        </p>
      )}
      <ErrorMessage error={error} />
      {pending && !busy && (
        <div className="notice">
          <p>{t('Confirmation is pending. Retry the same change before continuing.')}</p>
          <Button onClick={() => void send(pending.path, pending.body)}>
            {t('Retry same change')}
          </Button>
        </div>
      )}
      {count.status === 'draft' && manage && (
        <p className="notice">
          {t('Start counting to unlock quantity entry. Stock changes only after finalization.')}
        </p>
      )}
      {count.status === 'counting' && (
        <p className="stock-count-progress" role="status">
          {t('Saved quantities: {saved} of {total} products.', {
            saved: savedCount,
            total: count.lines.length,
          })}
          {hasUnsavedQuantities && <span>{t('Unsaved quantities — save before reviewing.')}</span>}
        </p>
      )}
      <fieldset className="stock-count-fields" disabled={busy || !!pending}>
        <div className="stock-count-actions">
          {manage && (
            <>
              {count.status === 'draft' && (
                <Button onClick={() => void action('start')}>{t('Start counting')}</Button>
              )}
              {count.status === 'counting' && (
                <>
                  <Button onClick={saveQuantities} disabled={!hasUnsavedQuantities}>
                    {t('Save quantities ')}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={
                      count.lines.some((l) => l.counted_quantity === null) || hasUnsavedQuantities
                    }
                    onClick={() => void action('review')}
                  >
                    {t('Review count ')}
                  </Button>
                </>
              )}
              {['counting', 'review'].includes(count.status) && (
                <Button variant="outline" onClick={() => setConfirmation('recount')}>
                  {t('Restart count ')}
                </Button>
              )}
              {!complete && (
                <Button variant="ghost" onClick={() => setConfirmation('cancel')}>
                  {t('Cancel count ')}
                </Button>
              )}
            </>
          )}
          {count.status === 'review' && finalize && (
            <Button disabled={changed} onClick={() => setConfirmation('finalize')}>
              {t('Finalize count ')}
            </Button>
          )}
        </div>

        <div className="table-scroll stock-count-table">
          <table aria-label={t('Count quantities')}>
            <thead>
              <tr>
                <th>{t('Product')}</th>
                <th>{t('System quantity')}</th>
                <th>{t('Counted quantity')}</th>
                <th>{t('Difference')}</th>
                <th>{t('Counted by')}</th>
              </tr>
            </thead>
            <tbody>
              {count.lines.map((l) => (
                <tr key={l.product_id}>
                  <td className="stock-count-product" data-label={t('Product')}>
                    <strong>{l.product_name}</strong>
                    <small>
                      {l.sku} · {t(l.unit ?? '')}
                    </small>
                  </td>
                  <td className="stock-count-system" data-label={t('System quantity')}>
                    {formatQuantity(l.system_quantity)}
                  </td>
                  <td className="stock-count-quantity" data-label={t('Counted quantity')}>
                    {['draft', 'counting'].includes(count.status) && manage ? (
                      <input
                        aria-label={t('Counted {value0}', { value0: l.product_name })}
                        inputMode="decimal"
                        disabled={count.status !== 'counting'}
                        placeholder={t(
                          count.status === 'draft' ? 'Start counting first' : 'Not counted',
                        )}
                        autoComplete="off"
                        style={{ minWidth: 110 }}
                        value={values[l.product_id]}
                        onChange={(e) => {
                          const value = e.target.value;
                          setValues((current) => ({ ...current, [l.product_id]: value }));
                          setError(undefined);
                        }}
                      />
                    ) : l.counted_quantity === null ? (
                      t('Not counted')
                    ) : (
                      formatQuantity(l.counted_quantity)
                    )}
                  </td>
                  <td className="stock-count-difference" data-label={t('Difference')}>
                    {formatQuantity(l.difference)}
                  </td>
                  <td className="stock-count-counter" data-label={t('Counted by')}>
                    {l.counter ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {count.status === 'counting' && (
          <p className="muted">
            {t('Enter zero for products with no stock. Differences reflect saved quantities. ')}
          </p>
        )}
      </fieldset>
      <Dialog
        open={!!confirmation}
        onOpenChange={(v) => !busy && !v && setConfirmation(undefined)}
        title={
          confirmation === 'finalize'
            ? t('Finalize stock count')
            : confirmation === 'recount'
              ? t('Restart stock count')
              : t('Cancel stock count')
        }
        description={
          confirmation === 'finalize'
            ? t(
                'This creates stock movements for the reviewed differences and permanently closes this count.',
              )
            : confirmation === 'recount'
              ? t(
                  'This clears all counted quantities and captures current stock. Count every selected product again.',
                )
              : t('The count stays in history and stock remains unchanged.')
        }
      >
        {confirmation !== 'finalize' && (
          <Field label={t('Reason')}>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required={confirmation === 'cancel'}
            />
          </Field>
        )}
        <ErrorMessage error={error} />
        <Button
          disabled={busy || !!pending || (confirmation === 'cancel' && !reason.trim())}
          onClick={() =>
            void (confirmation === 'finalize' ? send('finalize', {}) : action(confirmation!))
          }
        >
          {t('Confirm')}{' '}
          {confirmation === 'finalize'
            ? t('finalization')
            : confirmation === 'recount'
              ? t('restart')
              : t('cancellation')}
        </Button>
      </Dialog>
    </>
  );
}
