import { useState } from 'react';
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
type Command = { path: string; body: Record<string, unknown> };
const countStatusTone: Record<string, string> = {
  draft: 'gray',
  counting: 'amber',
  review: 'amber',
  finalized: 'green',
  cancelled: 'gray',
};
export function StockCountsPage() {
  const list = useQuery({
    queryKey: ['stock-counts'],
    queryFn: () => api<Count[]>('/stock-counts'),
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
          <div className="eyebrow">INVENTORY ACCURACY</div>
          <h1>Stock counts</h1>
          <p className="muted">
            Count physical stock, review differences, then finalize the adjustments. Latest 100
            counts.
          </p>
        </div>
        {manage && <Button onClick={() => setCreating(true)}>New stock count</Button>}
      </div>
      <p className="notice">
        Count when stock is not moving. Sales, deliveries, or adjustments after the count starts
        require a fresh count before finalization.
      </p>
      <section className="panel">
        <div className="table-toolbar">
          <div className="search-box">
            <Search size={18} />
            <input
              aria-label="Search stock counts"
              placeholder="Search count name, creator, or notes…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            aria-label="Filter count status"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            {['all', 'draft', 'counting', 'review', 'finalized', 'cancelled'].map((s) => (
              <option key={s} value={s}>
                {s === 'all' ? 'All statuses' : s}
              </option>
            ))}
          </select>
          <span className="muted">
            {rows.length} {rows.length === 1 ? 'count' : 'counts'}
          </span>
        </div>
        <ErrorMessage error={list.error} />
        {list.isPending ? (
          <p className="panel-padding">Loading counts…</p>
        ) : rows.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Count</th>
                  <th>Status</th>
                  <th className="table-number-column">Products</th>
                  <th className="table-actions-column">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.name}</strong>
                      <small>
                        {c.creator}
                        {c.finalizer ? ` · finalized by ${c.finalizer}` : ''}
                      </small>
                    </td>
                    <td>
                      <span className={`badge badge-${countStatusTone[c.status] ?? 'gray'}`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="table-number-column">{c.lines.length}</td>
                    <td className="table-actions-column">
                      <Button variant="ghost" onClick={() => setSelected(c.id)}>
                        Open
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
              ? 'No counts match this search or filter.'
              : 'No stock counts yet. Create one for the products you want to count.'}
          </p>
        )}
      </section>
      {selected && <CountDetail id={selected} />}
      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title="New stock count"
        description="Choose up to 500 products. Only one count can be open per store."
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
  const products = useProducts();
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [search, setSearch] = useState('');
  const [ids, setIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [payload, setPayload] = useState<Record<string, unknown>>();
  const terms = search.trim().toLowerCase();
  const matches = (products.data ?? []).filter((p) =>
    [p.name, p.sku].some((v) => v.toLowerCase().includes(terms)),
  );
  async function submit() {
    setBusy(true);
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
        <Field label="Count name">
          <input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Count notes">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <div className="count-picker">
          <div className="count-picker-toolbar">
            <div className="search-box">
              <Search size={17} />
              <input
                aria-label="Find products"
                placeholder="Search name or SKU…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setIds(
                  (products.data ?? [])
                    .filter((p) => p.active)
                    .slice(0, 500)
                    .map((p) => p.id),
                )
              }
            >
              Select all active
            </Button>
            <Button type="button" variant="ghost" onClick={() => setIds([])} disabled={!ids.length}>
              Clear
            </Button>
          </div>
          <div className="count-picker-status">
            <span className={ids.length > 500 ? 'count-picker-over' : 'muted'}>
              {ids.length} of 500 products selected
            </span>
          </div>
          <div className="count-picker-list">
            {matches.length ? (
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
                      {p.sku} · {p.unit}
                      {!p.active ? ' · Inactive' : ''}
                    </small>
                  </span>
                </label>
              ))
            ) : (
              <p className="count-picker-empty">No products match “{search.trim()}”.</p>
            )}
          </div>
        </div>
      </fieldset>
      <ErrorMessage error={products.error ?? error} />
      <div className="form-actions">
        <Button disabled={busy || !ids.length || ids.length > 500}>
          {busy ? 'Creating…' : payload ? 'Retry creation' : 'Create draft'}
        </Button>
      </div>
    </form>
  );
}
function CountDetail({ id }: { id: string }) {
  const q = useQuery({
    queryKey: ['stock-count', id],
    queryFn: () => api<Count>('/stock-counts/' + id),
  });
  return (
    <section className="panel panel-padding" style={{ marginTop: 24 }}>
      <ErrorMessage error={q.error} />
      {q.data ? (
        <CountEditor key={id + ':' + q.data.version} count={q.data} />
      ) : (
        <p>Loading count…</p>
      )}
    </section>
  );
}
function CountEditor({ count }: { count: Count }) {
  const session = useSession().data!;
  const manage = session.user.permissions.includes('counts.manage'),
    finalize = session.user.permissions.includes('counts.finalize');
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(count.lines.map((l) => [l.product_id, l.counted_quantity ?? ''])),
  );
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Command>();
  const [confirmation, setConfirmation] = useState<'finalize' | 'recount' | 'cancel'>();
  const [reason, setReason] = useState('');
  const changed = count.lines.some((l) => l.stock_changed);
  const complete = ['finalized', 'cancelled'].includes(count.status);
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
        {count.status} · Created by {count.creator}
      </p>
      <p className="muted">{count.notes}</p>
      {count.finalized_at && (
        <p>
          Finalized by {count.finalizer} ·{' '}
          {new Date(count.finalized_at).toLocaleString('en-GB', {
            timeZone: session.store.timezone,
          })}
        </p>
      )}
      {changed && !complete && (
        <p className="notice">
          Stock moved after this count started. Restart and recount all selected products; saved
          quantities will be cleared.
        </p>
      )}
      <ErrorMessage error={error} />
      {pending && !busy && (
        <div className="notice">
          <p>Confirmation is pending. Retry the same change before continuing.</p>
          <Button onClick={() => void send(pending.path, pending.body)}>Retry same change</Button>
        </div>
      )}
      <fieldset disabled={busy || !!pending}>
        <div className="table-scroll">
          <table aria-label="Count quantities">
            <thead>
              <tr>
                <th>Product</th>
                <th>System quantity</th>
                <th>Counted quantity</th>
                <th>Difference</th>
                <th>Counted by</th>
              </tr>
            </thead>
            <tbody>
              {count.lines.map((l) => (
                <tr key={l.product_id}>
                  <td>
                    <strong>{l.product_name}</strong>
                    <small>
                      {l.sku} · {l.unit}
                    </small>
                  </td>
                  <td>{l.system_quantity ?? '—'}</td>
                  <td>
                    {count.status === 'counting' && manage ? (
                      <input
                        aria-label={`Counted ${l.product_name}`}
                        inputMode="decimal"
                        style={{ minWidth: 110 }}
                        value={values[l.product_id]}
                        onChange={(e) => setValues({ ...values, [l.product_id]: e.target.value })}
                      />
                    ) : (
                      (l.counted_quantity ?? 'Not counted')
                    )}
                  </td>
                  <td>{l.difference ?? '—'}</td>
                  <td>{l.counter ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {count.status === 'counting' && (
          <p className="muted">
            Enter zero for products with no stock. Differences reflect saved quantities.
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
          {manage && (
            <>
              {count.status === 'draft' && (
                <Button onClick={() => void action('start')}>Start counting</Button>
              )}
              {count.status === 'counting' && (
                <>
                  <Button
                    onClick={() =>
                      void send('quantities', {
                        lines: Object.entries(values)
                          .filter(([, v]) => v !== '')
                          .map(([productId, quantity]) => ({ productId, quantity })),
                      })
                    }
                  >
                    Save quantities
                  </Button>
                  <Button
                    variant="outline"
                    disabled={
                      count.lines.some((l) => l.counted_quantity === null) ||
                      count.lines.some((l) => values[l.product_id] !== l.counted_quantity)
                    }
                    onClick={() => void action('review')}
                  >
                    Review count
                  </Button>
                </>
              )}
              {['counting', 'review'].includes(count.status) && (
                <Button variant="outline" onClick={() => setConfirmation('recount')}>
                  Restart count
                </Button>
              )}
              {!complete && (
                <Button variant="ghost" onClick={() => setConfirmation('cancel')}>
                  Cancel count
                </Button>
              )}
            </>
          )}
          {count.status === 'review' && finalize && (
            <Button disabled={changed} onClick={() => setConfirmation('finalize')}>
              Finalize count
            </Button>
          )}
        </div>
      </fieldset>
      <Dialog
        open={!!confirmation}
        onOpenChange={(v) => !busy && !v && setConfirmation(undefined)}
        title={
          confirmation === 'finalize'
            ? 'Finalize stock count'
            : confirmation === 'recount'
              ? 'Restart stock count'
              : 'Cancel stock count'
        }
        description={
          confirmation === 'finalize'
            ? 'This creates stock movements for the reviewed differences and permanently closes this count.'
            : confirmation === 'recount'
              ? 'This clears all counted quantities and captures current stock. Count every selected product again.'
              : 'The count stays in history and stock remains unchanged.'
        }
      >
        {confirmation !== 'finalize' && (
          <Field label="Reason">
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
          Confirm{' '}
          {confirmation === 'finalize'
            ? 'finalization'
            : confirmation === 'recount'
              ? 'restart'
              : 'cancellation'}
        </Button>
      </Dialog>
    </>
  );
}
