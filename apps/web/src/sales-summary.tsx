import { metricFormula } from './metric-formulas';
import { t, useLanguage, getLocale } from './i18n';
import { AnalyticsCharts } from './analytics';
import { GrossProfit } from './gross-profit';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, useSession } from './api';
import { Field, ErrorMessage } from './forms';
import { Button } from './components/ui/button';
import { formatMoney } from './receipts';
export const groups = {
  dayOfMonth: 'Day of month',
  hour: 'Hour of day',
  weekday: 'Day of week',
  monthOfYear: 'Month of year',
  year: 'Year',
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
export type Group = keyof typeof groups;
export type Totals = {
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
  cash: string | null;
  card: string | null;
  average: string;
  cashier: string | null;
  register: string | null;
  openedAt: string | null;
};
export type Summary = {
  currency: string;
  timezone: string;
  totals: Totals;
  groups: Record<string, Totals[]>;
  rows: Totals[];
  options: {
    products: { id: string; label: string; active: boolean }[];
    shifts: { id: string; cashier: string; register: string; openedAt: string }[];
  };
};
export function rowLabel(row: Totals, group: Group, timezone: string) {
  if (group === 'dayOfMonth') return t('Day ') + Number(row.bucket);
  if (group === 'hour') return row.bucket + ':00–' + row.bucket + ':59';
  if (group === 'weekday')
    return new Intl.DateTimeFormat(getLocale(), { weekday: 'long', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2024, 0, Number(row.bucket))),
    );
  if (group === 'monthOfYear')
    return new Intl.DateTimeFormat(getLocale(), { month: 'long', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2024, Number(row.bucket) - 1, 1)),
    );
  if (group === 'payment') return t(row.label ?? row.bucket);
  if (group === 'category' && row.bucket === 'unrecorded') return t('Unrecorded category');
  if (group === 'shift')
    return (
      (row.label ?? row.cashier) +
      ' · ' +
      new Date(row.openedAt!).toLocaleString(getLocale(), { timeZone: timezone })
    );
  return row.label ?? row.bucket;
}
export function SalesSummary({ initialGroup = 'day' }: { initialGroup?: Group }) {
  useLanguage();
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
    productId: '',
    shiftId: '',
  });
  const [filter, setFilter] = useState(draft);
  const [page, setPage] = useState(0);
  const query = useQuery({
    queryKey: ['analytics', store.id, filter],
    queryFn: () => api<Summary>('/reports/analytics?' + new URLSearchParams(filter)),
  });
  const data = query.data
    ? { ...query.data, rows: query.data.groups[filter.group] ?? [] }
    : undefined;
  return (
    <section
      className="panel panel-padding"
      style={{ marginBottom: 24 }}
      aria-label={t('Sales summary')}
    >
      <h2>{t('Sales summary')}</h2>
      <p className="muted">
        {t('All completed sales in the selected dates, using ')}
        {store.timezone}
        {t(
          '. Sales include tax and are after discounts. Refunds are counted on the date issued; breakdown rows show original sales before refunds. Product filters count only that product’s lines. Refunds follow the original sale’s shift. Opening float and cash in/out are excluded. ',
        )}
      </p>
      <div className="analytics-presets" aria-label={t('Quick date ranges')}>
        {['Today', 'This week', 'This month', 'This year'].map((label) => (
          <Button
            key={label}
            type="button"
            variant="outline"
            onClick={() => {
              const date = new Date(today + 'T00:00:00Z');
              if (label === 'This week')
                date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
              const from =
                label === 'This year'
                  ? today.slice(0, 4) + '-01-01'
                  : label === 'This month'
                    ? today.slice(0, 7) + '-01'
                    : date.toISOString().slice(0, 10);
              setDraft({ ...draft, from, to: today });
            }}
          >
            {t(label ?? '')}
          </Button>
        ))}
      </div>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(0);
          setFilter({ ...draft });
        }}
      >
        <Field label={t('From date')}>
          <input
            type="date"
            required
            value={draft.from}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          />
        </Field>
        <Field label={t('To date')}>
          <input
            type="date"
            required
            value={draft.to}
            min={draft.from}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          />
        </Field>
        <Field label={t('Product filter')}>
          <select
            value={draft.productId}
            onChange={(e) => setDraft({ ...draft, productId: e.target.value })}
          >
            <option value="">{t('All products')}</option>
            {data?.options.products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
                {p.active ? '' : t(' (inactive)')}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('Shift filter')}>
          <select
            value={draft.shiftId}
            onChange={(e) => setDraft({ ...draft, shiftId: e.target.value })}
          >
            <option value="">{t('All shifts')}</option>
            {data?.options.shifts.map((s) => (
              <option key={s.id} value={s.id}>
                {s.cashier} · {s.register} ·{' '}
                {new Date(s.openedAt).toLocaleString(getLocale(), { timeZone: store.timezone })}
              </option>
            ))}
          </select>
        </Field>
        <p className="muted">
          {t(
            'Filters combine. Apply a new date range first to load its available shifts and products. ',
          )}
        </p>
        <Field label={t('Group sales by')}>
          <select
            value={draft.group}
            onChange={(e) => setDraft({ ...draft, group: e.target.value as typeof draft.group })}
          >
            {Object.entries(groups).map(([value, label]) => (
              <option key={value} value={value}>
                {t(label ?? '')}
              </option>
            ))}
          </select>
        </Field>
        <Button
          style={{ alignSelf: 'end', justifySelf: 'start', marginBottom: 16 }}
          disabled={query.isFetching}
        >
          {t('Apply filters ')}
        </Button>
      </form>
      <GrossProfit
        from={filter.from}
        to={filter.to}
        productId={filter.productId}
        shiftId={filter.shiftId}
      />
      <ErrorMessage error={query.error} />
      {query.isFetching ? (
        <p className="muted">{t('Loading sales totals…')}</p>
      ) : (
        data && (
          <>
            <p className="muted">
              {t('Showing ')}
              {filter.from} {t(' through ')}
              {filter.to}
              {t(', inclusive.')}{' '}
              {filter.group === 'shift' && t('Shift totals include only sales within these dates.')}
              {filter.group === 'week' &&
                t('Weeks start Monday; boundary weeks include only selected dates.')}
              {filter.group === 'category' &&
                t('Older receipts without a category snapshot appear under Unrecorded category.')}
              {['product', 'category'].includes(filter.group) &&
                t(
                  'Sales, discounts and tax use original receipt lines. Receipts containing multiple groups are counted in each group. Payments are not allocated to products.',
                )}
              {filter.group === 'payment' &&
                t(
                  'Amounts are payments collected, excluding change. Tax and discounts are not allocated between payment methods.',
                )}
            </p>
            <div className="analytics-sales-metrics">
              {[
                ['Sales before refunds', data.totals.total],
                ['Refunds', data.totals.refunds],
                ['Sales less refunds', data.totals.net],
                ['Cash sales', data.totals.cash],
                ['Card sales', data.totals.card],
                ['Tax included', data.totals.tax],
                ['Discounts', data.totals.discount],
                [
                  filter.productId ? 'Average per matching receipt' : 'Average basket',
                  data.totals.average,
                ],
              ].map(([label, value]) => (
                <div className="analytics-sales-metric" key={label} title={metricFormula(label ?? '')}>
                  <small className="analytics-sales-metric-label">{t(label ?? '')}</small>
                  <strong className="analytics-sales-metric-value">
                    {value === null ? t('Not allocated') : formatMoney(value, data.currency)}
                  </strong>
                </div>
              ))}
              <div className="analytics-sales-metric">
                <small className="analytics-sales-metric-label">{t('Transactions')}</small>
                <strong className="analytics-sales-metric-value">
                  {data.totals.transactions}
                </strong>
              </div>
            </div>
            <AnalyticsCharts data={data} />
            <h3>{t('Detailed breakdown')}</h3>
            {filter.productId && (
              <p className="muted">
                {t(
                  'Payment methods are not allocated to individual products. Clear the product filter to compare payments. ',
                )}
              </p>
            )}
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>
                      {filter.group === 'shift'
                        ? t('Cashier / register / shift opened')
                        : groups[filter.group]}
                    </th>
                    <th>{t('Transactions')}</th>
                    <th>{t('Sales')}</th>
                    <th>
                      {['product', 'category', 'payment'].includes(filter.group)
                        ? t('Average per matching receipt')
                        : t('Average basket')}
                    </th>
                    {filter.group === 'product' && <th>{t('Quantity sold')}</th>}
                    <th>{t('Cash sales')}</th>
                    <th>{t('Card sales')}</th>
                    <th>{t('Discounts')}</th>
                    <th>{t('Tax included')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.slice(page * 25, (page + 1) * 25).map((r) => (
                    <tr key={r.bucket}>
                      <td>
                        {filter.group === 'shift' ? (
                          <>
                            <strong>{r.cashier}</strong>
                            <small>
                              {r.register} ·{' '}
                              {new Date(r.openedAt!).toLocaleString(getLocale(), {
                                timeZone: data.timezone,
                              })}
                            </small>
                          </>
                        ) : (
                          rowLabel(r, filter.group, data.timezone)
                        )}
                      </td>
                      <td>{r.transactions}</td>
                      <td>{formatMoney(r.total, data.currency)}</td>
                      <td>{formatMoney(r.average, data.currency)}</td>
                      {filter.group === 'product' && (
                        <td>
                          {r.quantity} {t(r.unit ?? '')}
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
            {data.rows.length > 25 && (
              <div className="analytics-pagination">
                <Button variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>
                  {t('Previous ')}
                </Button>
                <span>
                  {t('Page ')}
                  {page + 1} {t(' of ')}
                  {Math.ceil(data.rows.length / 25)}
                </span>
                <Button
                  variant="outline"
                  disabled={(page + 1) * 25 >= data.rows.length}
                  onClick={() => setPage(page + 1)}
                >
                  {t('Next ')}
                </Button>
              </div>
            )}
            {!data.rows.length && !(filter.group === 'payment' && filter.productId) && (
              <p className="muted">{t('No completed sales in this date range.')}</p>
            )}
          </>
        )
      )}
    </section>
  );
}
