import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { api, queryClient, useSession } from './api';
import { ErrorMessage } from './forms';
import { formatMoney } from './receipts';
import { dashboardText } from './i18n/dashboard';
import { t, useLanguage } from './i18n';
import './action-center.css';

type Insight = {
  id: string;
  type: string;
  title: string;
  detail: string;
  severity: string;
  group: string;
  status: string;
  active: boolean;
  impact?: { amount: string; label: string; estimate: boolean };
  entities?: { id: string; label: string; note?: string }[];
  action?: { to: string; label: string };
  firstDetectedAt?: string;
  lastDetectedAt?: string;
  snoozedUntil?: string | null;
};
type Center = { currency: string; thresholdDays: number; insights: Insight[] };
const categoryLabel: Record<string, string> = {
  inventory: 'Stock',
  margin: 'Money',
  refunds: 'Money',
  discounts: 'Money',
  waste: 'Waste',
  shifts: 'Shifts',
  data: 'Data Quality',
  purchasing: 'Purchasing',
  staff: 'Staff',
};
const insightCategory = (type: string) => categoryLabel[type] ?? type;
const groups = ['All', 'Action now', 'Today', 'Review', 'Opportunities', 'Setup', 'Resolved'];
const priority: Record<string, number> = {
  'Action now': 0,
  Today: 1,
  Review: 2,
  Opportunities: 3,
  Setup: 4,
};
function ordered(items: Insight[]) {
  return [...items].sort((a, b) => (priority[a.group] ?? 5) - (priority[b.group] ?? 5) || 0);
}
export function ActionCenterPage() {
  useLanguage();
  const session = useSession();
  const [group, setGroup] = useState(
    new URLSearchParams(window.location.search).get('analysis') === 'no-sales'
      ? 'Opportunities'
      : 'All',
  );
  const [category, setCategory] = useState('All');
  const [days, setDays] = useState<number | null>(null);
  const [sort, setSort] = useState('days');
  const [noSalesCategory, setNoSalesCategory] = useState('All');
  const [noSalesSupplier, setNoSalesSupplier] = useState('All');
  const [customSnooze, setCustomSnooze] = useState<Record<string, string>>({});
  const q = useQuery({
    queryKey: ['action-center'],
    queryFn: () => api<Center>('/reports/action-center'),
  });
  const threshold = days ?? q.data?.thresholdDays ?? 60;
  const noSales = useQuery({
    queryKey: ['action-center', 'no-sales', threshold],
    queryFn: () =>
      api<{
        rows: {
          id: string;
          name: string;
          sku: string;
          category: string;
          suppliers: string;
          quantity: string;
          sellingPrice: string;
          lastSaleAt: string | null;
          inventoryValue: string | null;
          unitCost: string | null;
          costEstimated: boolean | null;
          costMissing: boolean | null;
          daysWithoutSale: number;
        }[];
        currency: string;
        timezone: string;
      }>('/reports/action-center/no-sales?days=' + threshold),
    enabled: group === 'Opportunities',
  });
  const saveDefault = useMutation({
    mutationFn: async (thresholdDays: number) => {
      const profile = await api<Record<string, unknown>>('/store-profile');
      return api('/store-profile', { ...profile, noSalesThresholdDays: thresholdDays });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['store-profile'] });
      void queryClient.invalidateQueries({ queryKey: ['action-center'] });
      void queryClient.invalidateQueries({ queryKey: ['owner-dashboard'] });
      setDays(null);
    },
  });
  const mutation = useMutation({
    mutationFn: ({
      id,
      status,
      snoozedUntil,
    }: {
      id: string;
      status: string;
      snoozedUntil?: string;
    }) =>
      api('/reports/action-center/' + encodeURIComponent(id) + '/state', { status, snoozedUntil }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['action-center'] });
      void queryClient.invalidateQueries({ queryKey: ['owner-dashboard'] });
    },
  });
  const insights = ordered(
    (q.data?.insights ?? [])
      .filter((i) =>
        group === 'Resolved'
          ? ['RESOLVED', 'DISMISSED'].includes(i.status)
          : !['RESOLVED', 'DISMISSED'].includes(i.status) && (group === 'All' || i.group === group),
      )
      .filter((i) => category === 'All' || insightCategory(i.type) === category),
  );
  const categories = [
    ...new Set((q.data?.insights ?? []).map((i) => insightCategory(i.type))),
  ].sort();
  const currency = q.data?.currency ?? session.data?.store.currency ?? 'USD';
  const rows = [...(noSales.data?.rows ?? [])]
    .filter((r) => noSalesCategory === 'All' || r.category === noSalesCategory)
    .filter((r) => noSalesSupplier === 'All' || r.suppliers.split(', ').includes(noSalesSupplier))
    .sort((a, b) =>
      sort === 'value'
        ? Number(b.inventoryValue ?? 0) - Number(a.inventoryValue ?? 0)
        : sort === 'quantity'
          ? Number(b.quantity) - Number(a.quantity)
          : b.daysWithoutSale - a.daysWithoutSale,
    );
  function update(id: string, status: string, daysToSnooze?: number) {
    mutation.mutate({
      id,
      status,
      snoozedUntil: daysToSnooze
        ? new Date(Date.now() + daysToSnooze * 86400000).toISOString()
        : undefined,
    });
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{t('STORE OPERATIONS')}</div>
          <h1>{t('Manager Action Center')}</h1>
          <p className="muted">
            {t('Prioritised conditions from store data. Review and track what needs action.')}
          </p>
        </div>
      </div>
      <ErrorMessage error={q.error ?? mutation.error ?? saveDefault.error} />
      <nav className="action-tabs" aria-label={t('Action groups')}>
        {groups.map((g) => (
          <button
            key={g}
            type="button"
            className={g === group ? 'active' : ''}
            onClick={() => setGroup(g)}
          >
            {t(g)}{' '}
            <span>
              {
                (q.data?.insights ?? []).filter((i) =>
                  g === 'Resolved'
                    ? ['RESOLVED', 'DISMISSED'].includes(i.status)
                    : !['RESOLVED', 'DISMISSED'].includes(i.status) &&
                      (g === 'All' || i.group === g),
                ).length
              }
            </span>
          </button>
        ))}
      </nav>
      <div className="action-filter">
        <label>
          {t('Category')}{' '}
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="All">{t('All categories')}</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {t(c)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {q.isPending && <p className="muted">{t('Loading actions…')}</p>}
      {!q.isPending && !insights.length && group !== 'Opportunities' && (
        <p className="panel panel-padding muted">{t('No actions in this view.')}</p>
      )}
      <div className="action-list">
        {insights.map((i) => (
          <article key={i.id} className={'action-card action-' + i.severity}>
            <div className="action-head">
              <div>
                <span className="action-group">{t(i.group)}</span>
                <span className={'badge badge-' + i.severity}>{t(i.severity)}</span>
                <h2>{dashboardText(i.title)}</h2>
              </div>
              <span className="muted">{t(i.status)}</span>
            </div>
            <p className="muted">{dashboardText(i.detail)}</p>
            {i.impact && (
              <p>
                {t(i.impact.label)}: <strong>{formatMoney(i.impact.amount, currency)}</strong>
                {i.impact.estimate && <span className="muted"> ({t('estimated')})</span>}
              </p>
            )}
            {!!i.entities?.length && (
              <ul>
                {i.entities.map((e) => (
                  <li key={e.id}>
                    {e.label}
                    {e.note && <span className="muted"> · {dashboardText(e.note)}</span>}
                  </li>
                ))}
              </ul>
            )}
            <div className="action-controls">
              {i.action &&
                (i.id === 'dead-stock' ? (
                  <a href="/action-center?analysis=no-sales" className="insight-action">
                    {t(i.action.label)} →
                  </a>
                ) : (
                  <Link to={i.action.to} className="insight-action">
                    {t(i.action.label)} →
                  </Link>
                ))}
              {i.id === 'dead-stock' && (
                <button
                  type="button"
                  onClick={() => {
                    setGroup('Opportunities');
                    setTimeout(
                      () =>
                        document
                          .getElementById('no-sales-analysis')
                          ?.scrollIntoView({ behavior: 'smooth' }),
                      0,
                    );
                  }}
                >
                  {t('Analyse no-sales stock')}
                </button>
              )}
              {i.active && (
                <>
                  <button type="button" onClick={() => update(i.id, 'SEEN')}>
                    {t('Mark seen')}
                  </button>
                  <button type="button" onClick={() => update(i.id, 'IN_PROGRESS')}>
                    {t('In progress')}
                  </button>
                  <select
                    aria-label={t('Snooze action')}
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) update(i.id, 'SNOOZED', Number(e.target.value));
                      e.target.value = '';
                    }}
                  >
                    <option value="">{t('Snooze…')}</option>
                    <option value="1">{t('Tomorrow')}</option>
                    <option value="3">{t('3 days')}</option>
                    <option value="7">{t('7 days')}</option>
                  </select>
                  <input
                    type="datetime-local"
                    aria-label={t('Custom snooze until')}
                    value={customSnooze[i.id] ?? ''}
                    onChange={(e) => setCustomSnooze({ ...customSnooze, [i.id]: e.target.value })}
                  />
                  <button
                    type="button"
                    disabled={
                      !customSnooze[i.id] || new Date(customSnooze[i.id]).getTime() <= Date.now()
                    }
                    onClick={() =>
                      mutation.mutate({
                        id: i.id,
                        status: 'SNOOZED',
                        snoozedUntil: new Date(customSnooze[i.id]).toISOString(),
                      })
                    }
                  >
                    {t('Snooze until')}
                  </button>
                  <button type="button" onClick={() => update(i.id, 'RESOLVED')}>
                    {t('Resolve')}
                  </button>
                  <button type="button" onClick={() => update(i.id, 'DISMISSED')}>
                    {t('Dismiss')}
                  </button>
                </>
              )}
            </div>
          </article>
        ))}
      </div>
      {group === 'Opportunities' && (
        <section id="no-sales-analysis" className="panel no-sales-analysis">
          <div className="panel-heading">
            <div>
              <h2>{t('Products without sales')}</h2>
              <p className="muted">
                {t(
                  'Active products with stock and no sales for the selected number of store-local days.',
                )}
              </p>
            </div>
          </div>
          <div className="action-filter">
            <label>
              {t('Threshold')}{' '}
              <select value={threshold} onChange={(e) => setDays(Number(e.target.value))}>
                {[14, 30, 60, 90, threshold]
                  .filter((v, i, a) => a.indexOf(v) === i)
                  .sort((a, b) => a - b)
                  .map((v) => (
                    <option key={v} value={v}>
                      {v} {t('days')}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              {t('Sort by')}{' '}
              <select value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="days">{t('Days without sale')}</option>
                <option value="value">{t('Inventory value')}</option>
                <option value="quantity">{t('Quantity')}</option>
              </select>
            </label>
            <label>
              {t('Custom days')}{' '}
              <input
                type="number"
                min="7"
                max="365"
                value={threshold}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (n >= 7 && n <= 365) setDays(n);
                }}
              />
            </label>
            {days !== null && session.data?.user.permissions.includes('settings.manage') && (
              <button
                type="button"
                disabled={saveDefault.isPending}
                onClick={() => saveDefault.mutate(threshold)}
              >
                {t('Set {days} days as store default', { days: threshold })}
              </button>
            )}
            {days !== null && (
              <span className="muted">
                {t('Temporary analysis threshold.')}{' '}
                <Link to="/settings">{t('Save default in Store settings')}</Link>
              </span>
            )}
          </div>
          <ErrorMessage error={noSales.error} />
          <div className="action-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t('Product')}</th>
                  <th>{t('Last sale')}</th>
                  <th>{t('Days')}</th>
                  <th>{t('Stock')}</th>
                  <th>{t('Supplier')}</th>
                  <th>{t('Unit cost')}</th>
                  <th>{t('Inventory value')}</th>
                  <th>{t('Selling price')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.name}</strong>
                      <small>
                        {r.sku} · {r.category}
                      </small>
                    </td>
                    <td>
                      {r.lastSaleAt
                        ? new Intl.DateTimeFormat(undefined, {
                            dateStyle: 'medium',
                            timeZone: noSales.data?.timezone,
                          }).format(new Date(r.lastSaleAt))
                        : t('Never sold')}
                    </td>
                    <td>{r.daysWithoutSale}</td>
                    <td>{r.quantity}</td>
                    <td>{r.suppliers || '—'}</td>
                    <td>
                      {r.unitCost === null
                        ? t('Restricted')
                        : r.costMissing
                          ? t('Incomplete')
                          : formatMoney(r.unitCost, currency)}
                    </td>
                    <td>
                      {r.inventoryValue === null
                        ? t('Restricted')
                        : r.costMissing && Number(r.inventoryValue) === 0
                          ? t('Missing cost')
                          : formatMoney(r.inventoryValue, currency)}
                      {r.costMissing && <small>{t('Incomplete valuation')}</small>}
                      {r.costEstimated && <small>{t('Estimated from legacy cost')}</small>}
                    </td>
                    <td>{formatMoney(r.sellingPrice, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!noSales.isPending && !rows.length && (
            <p className="panel-padding muted">{t('No products meet this threshold.')}</p>
          )}
        </section>
      )}
    </>
  );
}
