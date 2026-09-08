import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, useSession } from './api';
import { Field, ErrorMessage } from './forms';
import { Button } from './components/ui/button';
import { formatMoney } from './receipts';
const groups = {
  day: 'Day',
  week: 'Week starting Monday',
  month: 'Month',
  shift: 'Shift',
  cashier: 'Cashier',
  register: 'Register',
  product: 'Product',
  category: 'Category',
  payment: 'Payment method',
};
type Group = keyof typeof groups;
type Totals = {
  refunds: string;
  net: string;
  label: string | null;
  quantity: string | null;
  unit: string | null;
  bucket: string;
  transactions: string;
  total: string;
  tax: string;
  discount: string;
  cash: string;
  card: string;
  average: string;
  cashier: string | null;
  register: string | null;
  openedAt: string | null;
};
type Summary = { currency: string; timezone: string; totals: Totals; rows: Totals[] };
export function SalesSummary({ initialGroup = 'day' }: { initialGroup?: Group }) {
  const store = useSession().data!.store;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: store.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (key: string) => parts.find((p) => p.type === key)!.value;
  const today = `${part('year')}-${part('month')}-${part('day')}`;
  const [draft, setDraft] = useState({
    from: today.slice(0, 7) + '-01',
    to: today,
    group: initialGroup,
  });
  const [filter, setFilter] = useState(draft);
  const query = useQuery({
    queryKey: ['sales-summary', store.id, filter],
    queryFn: () => api<Summary>('/reports/sales-summary?' + new URLSearchParams(filter)),
  });
  const data = query.data;
  return (
    <section
      className="panel panel-padding"
      style={{ marginBottom: 24 }}
      aria-label="Sales summary"
    >
      <h2>Sales summary</h2>
      <p className="muted">
        All completed sales in the selected dates, using {store.timezone}. Sales include tax and are
        after discounts. Refunds are counted on the date issued; breakdown rows show original sales
        before refunds. Opening float and cash in/out are excluded.
      </p>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter({ ...draft });
        }}
      >
        <Field label="From date">
          <input
            type="date"
            required
            value={draft.from}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          />
        </Field>
        <Field label="To date">
          <input
            type="date"
            required
            value={draft.to}
            min={draft.from}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          />
        </Field>
        <Field label="Group sales by">
          <select
            value={draft.group}
            onChange={(e) => setDraft({ ...draft, group: e.target.value as typeof draft.group })}
          >
            {Object.entries(groups).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Button
          style={{ alignSelf: 'end', justifySelf: 'start', marginBottom: 16 }}
          disabled={query.isFetching}
        >
          Apply dates
        </Button>
      </form>
      <ErrorMessage error={query.error} />
      {query.isFetching ? (
        <p className="muted">Loading sales totals…</p>
      ) : (
        data && (
          <>
            <p className="muted">
              Showing {filter.from} through {filter.to}, inclusive.{' '}
              {filter.group === 'shift' && 'Shift totals include only sales within these dates.'}
              {filter.group === 'week' &&
                'Weeks start Monday; boundary weeks include only selected dates.'}
              {filter.group === 'category' &&
                'Older receipts without a category snapshot appear under Unrecorded category.'}
              {['product', 'category'].includes(filter.group) &&
                'Sales, discounts and tax use original receipt lines. Receipts containing multiple groups are counted in each group. Payments are not allocated to products.'}
              {filter.group === 'payment' &&
                'Amounts are payments collected, excluding change. Tax and discounts are not allocated between payment methods.'}
            </p>
            <div
              className="form-grid"
              style={{
                marginBlock: 20,
                gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))',
              }}
            >
              {[
                ['Sales before refunds', data.totals.total],
                ['Refunds', data.totals.refunds],
                ['Sales less refunds', data.totals.net],
                ['Cash sales', data.totals.cash],
                ['Card sales', data.totals.card],
                ['Tax included', data.totals.tax],
                ['Discounts', data.totals.discount],
                ['Average basket', data.totals.average],
              ].map(([label, value]) => (
                <div key={label}>
                  <small>{label}</small>
                  <strong style={{ display: 'block', fontSize: 20 }}>
                    {formatMoney(value, data.currency)}
                  </strong>
                </div>
              ))}
              <div>
                <small>Transactions</small>
                <strong style={{ display: 'block', fontSize: 20 }}>
                  {data.totals.transactions}
                </strong>
              </div>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>
                      {filter.group === 'shift'
                        ? 'Cashier / register / shift opened'
                        : groups[filter.group]}
                    </th>
                    <th>Transactions</th>
                    <th>Sales</th>
                    <th>
                      {['product', 'category', 'payment'].includes(filter.group)
                        ? 'Average per matching receipt'
                        : 'Average basket'}
                    </th>
                    {filter.group === 'product' && <th>Quantity sold</th>}
                    <th>Cash sales</th>
                    <th>Card sales</th>
                    <th>Discounts</th>
                    <th>Tax included</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.bucket}>
                      <td>
                        {filter.group === 'shift' ? (
                          <>
                            <strong>{r.cashier}</strong>
                            <small>
                              {r.register} ·{' '}
                              {new Date(r.openedAt!).toLocaleString('en-GB', {
                                timeZone: data.timezone,
                              })}
                            </small>
                          </>
                        ) : (
                          (r.label ?? r.bucket)
                        )}
                      </td>
                      <td>{r.transactions}</td>
                      <td>{formatMoney(r.total, data.currency)}</td>
                      <td>{formatMoney(r.average, data.currency)}</td>
                      {filter.group === 'product' && (
                        <td>
                          {r.quantity} {r.unit}
                        </td>
                      )}
                      {[r.cash, r.card, r.discount, r.tax].map((v, i) => (
                        <td key={i}>{v === null ? '—' : formatMoney(v, data.currency)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.rows.length && <p className="muted">No completed sales in this date range.</p>}
          </>
        )
      )}
    </section>
  );
}
