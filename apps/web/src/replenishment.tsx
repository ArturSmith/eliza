import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type Permission, planReplenishment } from '@eliza/contracts';
import { api, useSession } from './api';
import { Field, ErrorMessage } from './forms';
import { Button } from './components/ui/button';
import { t, useLanguage, getLocale } from './i18n';

type Row = ReturnType<typeof planReplenishment> & {
  productId: string;
  name: string;
  sku: string;
  unit: string;
  stock: string;
  available: string;
  expired: string;
  sold: string;
  returned: string;
  observedDays: number;
  incoming: string;
  drafts: string;
  leadDays: number | null;
  supplierName: string | null;
  packSize: string;
  minimumOrder: string;
};
type Report = {
  today: string;
  timezone: string;
  historyDays: number;
  total: number;
  pageSize: number;
  truncated: boolean;
  rows: Row[];
};
const statusLabels: Record<string, string> = {
  insufficient_history: 'Insufficient history',
  no_demand: 'No recorded demand',
  needs_review: 'Review required',
  order_now: 'Order now',
  order_later: 'Order later',
  covered: 'Stock covered',
  no_sales: 'No sales',
  slow: 'Slow / high stock cover',
  selling: 'Selling',
};
const warningLabels: Record<string, string> = {
  invalid_lead_time: 'Supplier lead time must be between 0 and 365 days.',
  upcoming_expiry: 'Some available stock expires within the planning horizon.',
  out_of_stock: 'No stock is available; zero sales do not establish demand.',
  stock_mismatch: 'Reconcile stock with batches.',
  missing_lead_time: 'Record the supplier lead time.',
  uncertain_incoming: 'Confirm overdue or undated deliveries first.',
  invalid_pack_size: 'Check the supplier pack size.',
  arrival_gap: 'A delivery may arrive after stock runs out.',
  stockout_history: 'Recorded stockouts may understate demand.',
  unknown_expiry: 'Some stock has no expiry date.',
  draft_orders: 'Review existing purchase drafts before ordering.',
  choose_supplier: 'Choose a preferred supplier in a shopping list.',
};
export function ReplenishmentPage() {
  useLanguage();
  const session = useSession().data!;
  const allowed = ['sales.read', 'inventory.read', 'purchases.read', 'suppliers.read'].every((p) =>
    session.user.permissions.includes(p as Permission),
  );
  const [draft, setDraft] = useState({
    historyDays: '28',
    reviewDays: '7',
    safetyDays: '2',
    search: '',
    status: 'all',
  });
  const [filters, setFilters] = useState(draft);
  const [page, setPage] = useState(1);
  const report = useQuery({
    queryKey: ['replenishment', session.store.id, filters, page],
    queryFn: () =>
      api<Report>(
        '/reports/replenishment?' + new URLSearchParams({ ...filters, page: String(page) }),
      ),
    enabled: allowed,
  });
  const quantity = (value: string | number | null) =>
    value === null
      ? '—'
      : new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 3 }).format(Number(value));
  const field = (key: keyof typeof draft, value: string) =>
    setDraft((previous) => ({ ...previous, [key]: value }));
  return (
    <div className="replenishment-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">{t('Stock & purchasing')}</div>
          <h1>{t('Replenishment')}</h1>
          <p className="muted">
            {t('What to order, how much, and when — based on recorded sales.')}
          </p>
        </div>
        <Link className="button button-outline" to="/shopping-lists">
          {t('Shopping lists')}
        </Link>
      </div>
      {!allowed ? (
        <p role="alert">{t('Sales, inventory, purchasing and supplier access are required.')}</p>
      ) : (
        <>
          <section className="panel panel-padding">
            <form
              className="replenishment-filters"
              onSubmit={(e) => {
                e.preventDefault();
                setFilters({ ...draft });
                setPage(1);
              }}
            >
              <Field label="Search products">
                <input
                  value={draft.search}
                  maxLength={100}
                  onChange={(e) => field('search', e.target.value)}
                />
              </Field>
              <Field label="History days">
                <input
                  type="number"
                  min="14"
                  max="90"
                  required
                  value={draft.historyDays}
                  onChange={(e) => field('historyDays', e.target.value)}
                />
              </Field>
              <Field label="Review cycle (days)">
                <input
                  type="number"
                  min="1"
                  max="90"
                  required
                  value={draft.reviewDays}
                  onChange={(e) => field('reviewDays', e.target.value)}
                />
              </Field>
              <Field label="Safety days">
                <input
                  type="number"
                  min="0"
                  max="30"
                  required
                  value={draft.safetyDays}
                  onChange={(e) => field('safetyDays', e.target.value)}
                />
              </Field>
              <Field label="Status">
                <select value={draft.status} onChange={(e) => field('status', e.target.value)}>
                  <option value="all">{t('All products')}</option>
                  {[
                    'order_now',
                    'order_later',
                    'no_sales',
                    'slow',
                    'needs_review',
                    'insufficient_history',
                  ].map((status) => (
                    <option key={status} value={status}>
                      {t(statusLabels[status])}
                    </option>
                  ))}
                </select>
              </Field>
              <Button type="submit">{t('Apply filters')}</Button>
            </form>
          </section>
          <p className="notice">
            {t(
              'Planning only. Suggestions do not create orders or change stock. Review them in Shopping lists.',
            )}
          </p>
          <p className="muted">
            {t(
              'Uses completed store-local days and gross units sold; refunds are shown separately. At least 14 recorded days are needed. Stockouts, promotions and seasonality can affect the estimate.',
            )}
          </p>
          <ErrorMessage error={report.error} />
          {report.isPending ? (
            <p>{t('Loading…')}</p>
          ) : (
            report.data && (
              <>
                <p className="muted">
                  {t('Calculated on {date} · {days} completed days · {count} products', {
                    date: report.data.today,
                    days: report.data.historyDays,
                    count: report.data.total,
                  })}
                </p>
                {report.data.truncated && (
                  <p role="alert">
                    {t(
                      'More than 5,000 products match. Narrow your search; totals cover the returned subset.',
                    )}
                  </p>
                )}
                <section className="panel table-scroll replenishment-table">
                  <table>
                    <colgroup>
                      <col style={{ width: 240 }} />
                      <col style={{ width: 135 }} />
                      <col style={{ width: 130 }} />
                      <col style={{ width: 110 }} />
                      <col style={{ width: 155 }} />
                      <col style={{ width: 155 }} />
                      <col style={{ width: 145 }} />
                      <col style={{ width: 120 }} />
                      <col style={{ width: 240 }} />
                    </colgroup>
                    <thead>
                      <tr>
                        {[
                          'Product',
                          'Sales / day',
                          'Available stock',
                          'Incoming',
                          'Supplier / lead time',
                          'Demand',
                          'Suggested quantity',
                          'Order by',
                          'Notes',
                        ].map((label) => (
                          <th key={label}>{t(label)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {report.data.rows.map((row) => (
                        <tr key={row.productId}>
                          <td>
                            <strong>{row.name}</strong>
                            <small>
                              {row.sku} · {t(row.unit)}
                            </small>
                          </td>
                          <td>
                            {quantity(row.dailySales)}
                            <small>
                              {t('{sold} sold · {returned} returned · {days} days', {
                                sold: quantity(row.sold),
                                returned: quantity(row.returned),
                                days: row.observedDays,
                              })}
                            </small>
                          </td>
                          <td>
                            {quantity(row.available)}
                            <small>
                              {t('{expired} expired', { expired: quantity(row.expired) })}
                            </small>
                          </td>
                          <td>
                            {quantity(row.incoming)}
                            <small>
                              {t('{drafts} in drafts', { drafts: quantity(row.drafts) })}
                            </small>
                          </td>
                          <td>
                            {row.supplierName ?? '—'}
                            <small>
                              {row.leadDays === null
                                ? t('Lead time not recorded')
                                : t('{days} days', { days: row.leadDays })}
                            </small>
                          </td>
                          <td>
                            {t(statusLabels[row.demandStatus])}
                            <small>
                              {row.daysOfStock === null
                                ? '—'
                                : t('{days} days of stock', { days: quantity(row.daysOfStock) })}
                            </small>
                          </td>
                          <td>
                            <strong>{quantity(row.quantity)}</strong>
                            <small>{t(statusLabels[row.status])}</small>
                          </td>
                          <td>{row.orderBy ?? '—'}</td>
                          <td className="replenishment-notes">
                            {row.warnings.map((warning, index) => (
                              <small key={index}>{t(warningLabels[warning] ?? warning)}</small>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!report.data.rows.length && (
                    <p className="panel-padding">{t('No matching products.')}</p>
                  )}
                </section>
                <div className="movement-pagination">
                  <Button
                    variant="outline"
                    disabled={page === 1 || report.isFetching}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    {t('Previous')}
                  </Button>
                  <span>
                    {t('Page {page} of {pages}', {
                      page,
                      pages: Math.max(1, Math.ceil(report.data.total / report.data.pageSize)),
                    })}
                  </span>
                  <Button
                    variant="outline"
                    disabled={page * report.data.pageSize >= report.data.total || report.isFetching}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    {t('Next')}
                  </Button>
                </div>
                <details className="panel panel-padding">
                  <summary>{t('How quantities are calculated')}</summary>
                  <p>
                    {t(
                      'Target stock = average daily sales × (supplier lead time + review cycle + safety days). Allow for stock expected to expire, subtract available stock and dated incoming stock within that horizon, then round up to packs and the minimum order. Drafts are not confirmed deliveries.',
                    )}
                  </p>
                  <p>
                    {t(
                      'Slow / high stock cover means more than 60 days of stock at the observed rate. No sales does not prove lack of demand; availability and data completeness matter.',
                    )}
                  </p>
                </details>
              </>
            )
          )}
        </>
      )}
    </div>
  );
}
