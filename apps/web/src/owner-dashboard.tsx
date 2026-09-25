import { dashboardText, dashboardSummary } from './i18n/dashboard';
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { api, useSession } from './api';
import { ErrorMessage } from './forms';
import { Button } from './components/ui/button';
import { formatMoney } from './receipts';
import { SalesSummary } from './sales-summary';
import { t, useLanguage, getLocale } from './i18n';
import { tone, type Period, type Severity } from '@eliza/contracts';

type Change = {
  value: number | null;
  previous: number | null;
  change: number | null;
  metric: string;
  unit?: string;
  restricted?: boolean;
};
type Dashboard = any;

const periods: { key: Period; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
];

/** One decimal, always signed, so a flat number never reads as growth. */
function signed(value: number | null, suffix = '%') {
  if (value === null) return null;
  return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}${suffix}`;
}

function Delta({ change, metric, unit }: { change: number | null; metric: string; unit?: string }) {
  useLanguage();
  if (change === null) return <span className="delta delta-none">{t('No comparison')}</span>;
  const quality = tone(metric, change);
  const arrow = change > 0 ? '↑' : change < 0 ? '↓' : '→';
  return (
    <span className={'delta delta-' + quality}>
      {arrow} {signed(change, unit === 'points' ? ' ' + t('percentage points') : '%')}
    </span>
  );
}

function Kpi({
  label,
  data,
  currency,
  money = true,
  hint,
}: {
  label: string;
  data: Change;
  currency: string;
  money?: boolean;
  hint?: string;
}) {
  useLanguage();
  const value =
    data.value === null
      ? null
      : money
        ? formatMoney(String(data.value.toFixed(2)), currency)
        : data.unit === 'points'
          ? data.value.toFixed(1) + '%'
          : Math.round(data.value).toLocaleString(getLocale());
  return (
    <article className="kpi">
      <span className="kpi-label">{t(label)}</span>
      {value === null ? (
        <strong className="kpi-value kpi-unavailable">
          {data.restricted ? t('Restricted') : t('Unavailable')}
        </strong>
      ) : (
        <strong className="kpi-value">{value}</strong>
      )}
      <Delta change={data.change} metric={data.metric} unit={data.unit} />
      {hint && <small className="muted">{hint}</small>}
    </article>
  );
}

const severityLabel: Record<Severity, string> = {
  critical: 'Critical',
  important: 'Important',
  attention: 'Attention',
  info: 'Info',
};

function Insights({ insights, currency }: { insights: any[]; currency: string }) {
  useLanguage();
  const [all, setAll] = useState(false);
  if (!insights.length)
    return (
      <section className="panel">
        <div className="panel-heading">
          <h2>{t('Needs attention')}</h2>
        </div>
        <p className="panel-padding muted">{t('Nothing needs your attention right now.')}</p>
      </section>
    );
  const shown = all ? insights : insights.slice(0, 5);
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>{t('Needs attention')}</h2>
        <p>{t('Grouped by impact. The most serious items come first.')}</p>
      </div>
      <ul className="insight-list">
        {shown.map((insight) => (
          <li key={insight.id} className={'insight insight-' + insight.severity}>
            <div className="insight-head">
              <span className={'badge badge-' + insight.severity}>
                {t(severityLabel[insight.severity as Severity])}
              </span>
              <strong>{dashboardText(insight.title)}</strong>
            </div>
            <p className="muted">{dashboardText(insight.detail)}</p>
            {insight.impact && (
              <p className="insight-impact">
                {t(insight.impact.label)}:{' '}
                <strong>{formatMoney(insight.impact.amount, currency)}</strong>
                {insight.impact.estimate && <span className="muted"> ({t('estimated')})</span>}
              </p>
            )}
            {!!insight.entities?.length && (
              <ul className="insight-entities">
                {insight.entities.map((e: any) => (
                  <li key={e.id}>
                    {e.label}
                    {e.note && <span className="muted"> · {dashboardText(e.note)}</span>}
                  </li>
                ))}
              </ul>
            )}
            {insight.action && (
              <Link className="insight-action" to={insight.action.to}>
                {t(insight.action.label)} →
              </Link>
            )}
          </li>
        ))}
      </ul>
      {insights.length > 5 && (
        <div className="panel-padding">
          <Button variant="ghost" onClick={() => setAll(!all)}>
            {all ? t('Show less') : t('Show all') + ' (' + insights.length + ')'}
          </Button>
        </div>
      )}
    </section>
  );
}

/** Hourly sales with the comparable-day average drawn behind the live bars. */
function HourlySales({ rows, currency }: { rows: any[]; currency: string }) {
  useLanguage();
  const max = Math.max(...rows.map((r) => Math.max(r.total, r.comparison ?? 0)), 1);
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>{t('Sales by hour')}</h2>
        <p>{t('Bars show today. The line marks a typical same weekday.')}</p>
      </div>
      <div className="hour-chart panel-padding">
        {rows.map((r) => (
          <div key={r.hour} className={'hour-column' + (r.elapsed ? '' : ' hour-future')}>
            <div className="hour-track">
              <div className="hour-bar" style={{ height: (r.total / max) * 100 + '%' }} />
              {r.comparison !== null && (
                <div
                  className="hour-baseline"
                  style={{ bottom: (r.comparison / max) * 100 + '%' }}
                  title={t('Typical') + ': ' + formatMoney(String(r.comparison), currency)}
                />
              )}
            </div>
            <span className="hour-label">{r.hour}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Table({
  title,
  description,
  head,
  rows,
  empty,
}: {
  title: string;
  description?: string;
  head: string[];
  rows: ReactNode[][];
  empty: string;
}) {
  useLanguage();
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>{t(title)}</h2>
        {description && <p>{t(description)}</p>}
      </div>
      {rows.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {head.map((h) => (
                  <th key={h}>{t(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="panel-padding muted">{t(empty)}</p>
      )}
    </section>
  );
}

export function OwnerDashboardPage() {
  useLanguage();
  const session = useSession().data!;
  const [period, setPeriod] = useState<Period>('today');
  const q = useQuery({
    queryKey: ['owner-dashboard', period],
    queryFn: () => api<Dashboard>('/reports/owner-dashboard?period=' + period),
    refetchInterval: 60_000,
  });
  const todayQuery = useQuery({
    queryKey: ['owner-dashboard', 'today'],
    queryFn: () => api<Dashboard>('/reports/owner-dashboard?period=today'),
    refetchInterval: 60_000,
  });
  const data = q.data;
  const today = todayQuery.data;
  const currency = session.store.currency;
  const money = (value: unknown) => formatMoney(String(value ?? 0), currency);

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{t('STORE PERFORMANCE')}</div>
          <h1>{t('Dashboard')}</h1>
          <p className="muted">
            {t('What is happening, what to change, and whether the business is improving.')}
          </p>
        </div>
        <div className="period-tabs" role="tablist">
          {periods.map((p) => (
            <button
              key={p.key}
              role="tab"
              aria-selected={period === p.key}
              className={period === p.key ? 'period-tab period-tab-active' : 'period-tab'}
              onClick={() => setPeriod(p.key)}
            >
              {t(p.label)}
            </button>
          ))}
        </div>
      </div>

      <ErrorMessage error={q.error ?? todayQuery.error} />
      {today && (
        <div className="dashboard-today">
          <section className="today-overview" aria-label={t('Today at a glance')}>
            <h2>{t('Today at a glance')}</h2>
            <div className="today-metrics">
              <article className="kpi">
                <span className="kpi-label">{t('Open shifts')}</span>
                <strong className="kpi-value">{today.shifts.open}</strong>
              </article>
              <article className="kpi">
                <span className="kpi-label">{t('Transactions today')}</span>
                <strong className="kpi-value">{today.kpis.transactions.value ?? 0}</strong>
              </article>
              <article className="kpi">
                <span className="kpi-label">{t('Sales today')}</span>
                <strong className="kpi-value">{money(today.kpis.revenue.value)}</strong>
              </article>
              <article className="kpi">
                <span className="kpi-label">{t('Sales margin today')}</span>
                <strong className="kpi-value">
                  {today.kpis.grossMargin.value === null
                    ? t(today.kpis.grossMargin.restricted ? 'Restricted' : 'Unavailable')
                    : today.kpis.grossMargin.value.toFixed(1) + '%'}
                </strong>
              </article>
            </div>
            <HourlySales rows={today.hourly} currency={currency} />
          </section>
        </div>
      )}
      {q.isPending && <p className="muted">{t('Loading dashboard…')}</p>}

      {data && (
        <div className="dashboard">
          {data.history.days < 7 && (
            <p className="notice">
              {t('Comparisons become more reliable after 7 days of sales history.')}
            </p>
          )}

          {data.summary && <p className="owner-summary">{dashboardSummary(data.summary)}</p>}

          {period !== 'today' && (
            <div className="kpi-row">
              <Kpi label="Sales" data={data.kpis.revenue} currency={currency} />
              <Kpi label="Gross profit" data={data.kpis.grossProfit} currency={currency} />
              <Kpi
                label="Gross margin"
                data={data.kpis.grossMargin}
                currency={currency}
                money={false}
              />
              <Kpi
                label="Transactions"
                data={data.kpis.transactions}
                currency={currency}
                money={false}
              />
              <Kpi label="Average basket" data={data.kpis.averageBasket} currency={currency} />
              <Kpi label="Refunds" data={data.kpis.refunds} currency={currency} />
            </div>
          )}

          <p className="muted comparison-note">
            {t('Compared with')}:{' '}
            {data.comparisons
              .filter((c: any) => c.available)
              .map((c: any) => t(c.label))
              .join(', ') || t('no comparable history yet')}
          </p>

          {data.pace && (
            <section className="panel pace">
              <div className="panel-heading">
                <h2>{t('Sales pace')}</h2>
                <p>
                  {t('Today at')} {data.pace.hour}:00 · {t(data.pace.label)}
                </p>
              </div>
              <div className="pace-body panel-padding">
                <div>
                  <span className="muted">{t('Today so far')}</span>
                  <strong>{money(data.pace.current.toFixed(2))}</strong>
                </div>
                <div>
                  <span className="muted">{t('Typical by this time')}</span>
                  <strong>{money(data.pace.baseline.toFixed(2))}</strong>
                </div>
                <Delta change={data.pace.change} metric="revenue" />
              </div>
            </section>
          )}

          <Insights insights={data.insights} currency={currency} />

          {!!data.whatChanged.length && period !== 'today' && (
            <section className="panel">
              <div className="panel-heading">
                <h2>{t('What changed')}</h2>
                <p>{t('Measured differences against the previous period.')}</p>
              </div>
              <ul className="changed-list">
                {data.whatChanged.map((line: any, i: number) => (
                  <li key={i}>
                    <span>{dashboardText(line.label)}</span>
                    <Delta change={line.change} metric={line.metric} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <Table
            title="Category performance"
            description="Revenue, margin and share of sales."
            head={['Category', 'Sales', 'Change', 'Margin', 'Share']}
            empty="No sales in this period."
            rows={data.categories.rows.map((c: any) => [
              c.category,
              money(c.revenue),
              <Delta change={c.change} metric="revenue" />,
              c.margin === null ? t('—') : c.margin.toFixed(1) + '%',
              c.share === null ? '—' : c.share.toFixed(1) + '%',
            ])}
          />

          {data.inventory && (
            <section className="panel">
              <div className="panel-heading">
                <h2>{t('Inventory health')}</h2>
                <p>{t('How much money is tied up, and how much of it is moving.')}</p>
              </div>
              <div className="stat-row panel-padding">
                <div>
                  <span className="muted">{t('Stock value')}</span>
                  <strong>{money(data.inventory.value)}</strong>
                </div>
                <div>
                  <span className="muted">{t('Out of stock')}</span>
                  <strong>{data.inventory.outOfStock}</strong>
                </div>
                <div>
                  <span className="muted">{t('Low stock')}</span>
                  <strong>{data.inventory.lowStock}</strong>
                </div>
                <div>
                  <span className="muted">
                    {t('Dead stock')} ({data.inventory.dead.days} {t('day abbreviation')})
                  </span>
                  <strong>{money(data.inventory.dead.value)}</strong>
                </div>
              </div>
              {data.inventory.missingCost > 0 && (
                <p className="panel-padding notice">
                  {t('Inventory valuation is incomplete')}: {data.inventory.missingCost}{' '}
                  {t('products have no purchase cost.')}
                </p>
              )}
            </section>
          )}

          <Table
            title="Product performance"
            description="Ranked by revenue in this period."
            head={['Product', 'Units', 'Sales', 'Margin', 'Stock', 'Cover']}
            empty="No products sold in this period."
            rows={data.products.byRevenue.map((p: any) => [
              p.name,
              Number(p.units).toLocaleString(getLocale()),
              money(p.revenue),
              p.margin === null ? t('—') : p.margin.toFixed(1) + '%',
              Number(p.stock).toLocaleString(getLocale()),
              p.daysOfStock === null ? '—' : p.daysOfStock.toFixed(1) + ' ' + t('days'),
            ])}
          />

          {!!data.purchasing.costIncreases.length && (
            <Table
              title="Margin protection"
              description="Products whose purchase cost rose. Retail prices are never changed automatically."
              head={['Product', 'Was', 'Now', 'Change', 'Retail price']}
              empty="No purchase cost increases."
              rows={data.purchasing.costIncreases
                .slice(0, 10)
                .map((p: any) => [
                  p.label,
                  money(p.previousCost),
                  money(p.currentCost),
                  <Delta change={p.percent} metric="purchaseCost" />,
                  p.priceUnchanged ? t('Unchanged') : t('Reviewed'),
                ])}
            />
          )}

          {data.waste.available && (
            <Table
              title="Waste and shrinkage"
              description="Damaged, expired and internal-use stock, valued at cost."
              head={['Category', 'Value', 'Share of waste']}
              empty="No waste recorded in this period."
              rows={data.waste.byCategory.map((w: any) => [
                w.category,
                money(w.value.toFixed(2)),
                w.share === null ? '—' : w.share.toFixed(1) + '%',
              ])}
            />
          )}

          {!!data.suppliers.rows.length && (
            <Table
              title="Suppliers"
              description="Spend received in this period."
              head={['Supplier', 'Received', 'Share', 'Deliveries']}
              empty="No deliveries in this period."
              rows={data.suppliers.rows.map((s: any) => [
                s.name,
                money(s.spend),
                s.share === null ? '—' : s.share.toFixed(1) + '%',
                s.deliveries,
              ])}
            />
          )}

          {!!data.shifts.rows.length && (
            <Table
              title="Shifts and registers"
              description="Cash differences are shown for every closed shift."
              head={['Register', 'Cashier', 'Sales', 'Expected', 'Counted', 'Difference']}
              empty="No shifts in this period."
              rows={data.shifts.rows
                .slice(0, 10)
                .map((s: any) => [
                  s.register,
                  s.cashier,
                  money(s.sales),
                  s.expected === null ? '—' : money(s.expected),
                  s.counted === null ? '—' : money(s.counted),
                  s.difference === null ? (
                    t('Open')
                  ) : (
                    <span className={Number(s.difference) === 0 ? '' : 'delta-bad'}>
                      {money(s.difference)}
                    </span>
                  ),
                ])}
            />
          )}

          {period === 'month' && data.marginTrend && (
            <section className="panel">
              <div className="panel-heading">
                <h2>{t('Gross margin trend')}</h2>
                <p>{t('Last 12 months.')}</p>
              </div>
              <ol className="trend panel-padding">
                {data.marginTrend.map((m: any) => (
                  <li key={m.month}>
                    <span className="muted">{m.month}</span>
                    <div className="trend-track">
                      <div style={{ width: (m.margin ?? 0) * 2 + '%' }} />
                    </div>
                    <strong>{m.margin === null ? t('n/a') : m.margin.toFixed(1) + '%'}</strong>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section className="panel">
            <div className="panel-heading">
              <h2>{t('Data readiness')}</h2>
              <p>{t('Analytics only reflect what has been recorded.')}</p>
            </div>
            <div className="stat-row panel-padding">
              <div>
                <span className="muted">{t('Catalog readiness')}</span>
                <strong>
                  {data.readiness.readiness === null ? '—' : data.readiness.readiness + '%'}
                </strong>
              </div>
              <div>
                <span className="muted">{t('Products')}</span>
                <strong>{data.readiness.products}</strong>
              </div>
              <div>
                <span className="muted">{t('Missing cost')}</span>
                <strong>{data.readiness.missingCost}</strong>
              </div>
              <div>
                <span className="muted">{t('Never counted')}</span>
                <strong>{data.readiness.uncounted}</strong>
              </div>
            </div>
            {!!data.unavailable.length && (
              <ul className="panel-padding muted unavailable-list">
                {data.unavailable.map((u: any) => (
                  <li key={u.metric}>{t(u.reason)}</li>
                ))}
              </ul>
            )}
          </section>

          {/* Drill-down: the full sales explorer stays available beneath the answers. */}
          <SalesSummary />
        </div>
      )}
    </>
  );
}
