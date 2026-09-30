import { dashboardText, dashboardSummary } from './i18n/dashboard';
import { useState, useId, type ReactNode } from 'react';
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
type OverviewFinancialSummary = {
  revenue: string;
  cogs: string | null;
  grossProfit: string | null;
  grossMarginPercent: string | null;
  inventoryLosses: string | null;
  operatingExpenses: string | null;
  storeOperatingProfit: string | null;
  estimated: {
    cogs: string;
    grossProfit: string;
    grossMarginPercent: string | null;
    storeOperatingProfit: string | null;
  } | null;
  permissions: { margin: boolean; expenses: boolean };
};

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
  showComparison = true,
}: {
  label: string;
  data: Change;
  currency: string;
  money?: boolean;
  hint?: string;
  showComparison?: boolean;
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
      {showComparison && <Delta change={data.change} metric={data.metric} unit={data.unit} />}
      {hint && <small className="muted">{hint}</small>}
    </article>
  );
}

function FinancialCard({
  label,
  value,
  currency,
  percent = false,
  estimated = false,
  restricted = false,
}: {
  label: string;
  value: string | null;
  currency: string;
  percent?: boolean;
  estimated?: boolean;
  restricted?: boolean;
}) {
  return (
    <article className="kpi">
      <span className="kpi-label">{t(label)}</span>
      <strong className={'kpi-value' + (value === null ? ' kpi-unavailable' : '')}>
        {restricted
          ? t('Restricted')
          : value === null
            ? t('Unavailable')
            : percent
              ? (estimated ? '≈' : '') + Number(value).toFixed(1) + '%'
              : (estimated ? '≈' : '') + formatMoney(value, currency)}
      </strong>
      {estimated && !restricted && <small className="muted">{t('Estimated')}</small>}
    </article>
  );
}

const severityLabel: Record<Severity, string> = {
  critical: 'Critical',
  important: 'Important',
  attention: 'Attention',
  info: 'Info',
};

function Insights({ insights }: { insights: any[] }) {
  useLanguage();
  const active = insights.filter(
    (i) =>
      !['RESOLVED', 'DISMISSED'].includes(i.status) &&
      !(
        i.status === 'SNOOZED' &&
        i.snoozedUntil &&
        new Date(i.snoozedUntil).getTime() > Date.now()
      ),
  );
  const ranked = [...active].sort(
    (a, b) =>
      (({ 'Action now': 0, Today: 1, Review: 2, Opportunities: 3, Setup: 4 })[a.group as string] ??
        5) -
      ({ 'Action now': 0, Today: 1, Review: 2, Opportunities: 3, Setup: 4 }[b.group as string] ??
        5),
  );
  const shown = ranked.slice(0, 3);
  return (
    <section className="panel overview-actions">
      <div className="panel-heading">
        <h2>
          {t('Manager Action Center')}{' '}
          <span className="overview-actions-count">{active.length}</span>
        </h2>
        <Link to="/action-center">{t('View all actions')} →</Link>
      </div>
      {!active.length ? (
        <p className="panel-padding muted">{t('Nothing needs your attention right now.')}</p>
      ) : (
        <ul className="insight-list">
          {shown.map((insight) => (
            <li key={insight.id} className={'insight insight-' + insight.severity}>
              <div className="insight-head">
                <span className={'badge badge-' + insight.severity}>
                  {t(severityLabel[insight.severity as Severity])}
                </span>
                <strong>{dashboardText(insight.title)}</strong>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Store-local hourly sales, with an optional comparable-weekday line. */
function HourlySales({ rows, currency }: { rows: any[]; currency: string }) {
  useLanguage();
  const [selected, setSelected] = useState<number | null>(null);
  const tooltipId = useId();
  const values = rows.flatMap((row) => [Number(row.total) || 0, Number(row.comparison) || 0]);
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  const x = (index: number) => 80 + (index * 900) / Math.max(1, rows.length - 1);
  const y = (value: number) => 210 - ((value - min) * 180) / (max - min);
  const path = (key: 'total' | 'comparison') =>
    rows
      .map((row, index) =>
        (key === 'total' && !row.elapsed) || (key === 'comparison' && row.comparison == null)
          ? null
          : { index, value: Number(row[key]) || 0 },
      )
      .reduce(
        (result, point, index, points) =>
          point
            ? result +
              `${index === 0 || !points[index - 1] ? 'M' : 'L'}${x(point.index)},${y(point.value)} `
            : result,
        '',
      );
  const current = selected === null ? null : rows[selected];
  const hasComparison = rows.some((row) => row.comparison != null);
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>{t('Sales by hour')}</h2>
        <p>{t('Hover over the line to see hourly sales.')}</p>
      </div>
      <div className="hour-line-chart panel-padding" onPointerLeave={() => setSelected(null)}>
        <div className="hour-line-legend">
          <span>{t('Sales')}</span>
          {hasComparison && <span className="hour-line-typical">{t('Typical')}</span>}
        </div>
        <svg viewBox="0 0 1000 245" role="group" aria-label={t('Sales by hour')}>
          {[min, (min + max) / 2, max].map((value) => (
            <g key={value}>
              <line x1="80" x2="980" y1={y(value)} y2={y(value)} stroke="#e4e9df" />
              <text x="70" y={y(value) + 4} textAnchor="end" className="hour-line-label">
                {formatMoney(String(value), currency)}
              </text>
            </g>
          ))}
          {hasComparison && (
            <path
              d={path('comparison')}
              fill="none"
              stroke="#b77a28"
              strokeWidth="2"
              strokeDasharray="6 5"
              vectorEffect="non-scaling-stroke"
            />
          )}
          <path
            className="hour-sales-line"
            d={path('total')}
            fill="none"
            stroke="var(--green)"
            strokeWidth="3"
            vectorEffect="non-scaling-stroke"
          />
          {current && (
            <>
              <line
                x1={x(selected!)}
                x2={x(selected!)}
                y1="30"
                y2="210"
                stroke="#8c9f85"
                strokeDasharray="4 4"
              />
              {current.elapsed && (
                <circle
                  cx={x(selected!)}
                  cy={y(Number(current.total) || 0)}
                  r="5"
                  fill="var(--green)"
                  stroke="white"
                  strokeWidth="2"
                />
              )}
            </>
          )}
          {rows.map((row, index) => (
            <g key={row.hour}>
              {(index % 4 === 0 || index === rows.length - 1) && (
                <text x={x(index)} y="234" textAnchor="middle" className="hour-line-label">
                  {row.hour}:00
                </text>
              )}
              <rect
                className="hour-line-hit"
                x={Math.max(80, x(index) - 450 / Math.max(1, rows.length - 1))}
                y="20"
                width={
                  Math.min(980, x(index) + 450 / Math.max(1, rows.length - 1)) -
                  Math.max(80, x(index) - 450 / Math.max(1, rows.length - 1))
                }
                height="195"
                fill="transparent"
                tabIndex={0}
                role="button"
                aria-label={`${row.hour}:00 · ${formatMoney(String(row.total), currency)}`}
                aria-describedby={selected === index ? tooltipId : undefined}
                onPointerEnter={() => setSelected(index)}
                onPointerDown={() => setSelected(index)}
                onFocus={() => setSelected(index)}
                onBlur={() => setSelected(null)}
              />
            </g>
          ))}
        </svg>
        {current && (
          <div
            id={tooltipId}
            role="tooltip"
            className="hour-line-tooltip"
            style={{ left: Math.max(20, Math.min(80, x(selected!) / 10)) + '%' }}
          >
            <strong>
              {current.hour}:00–{current.hour}:59
            </strong>
            <span>
              {t('Sales')}: {formatMoney(String(current.total), currency)}
            </span>
            {current.comparison != null && (
              <span>
                {t('Typical')}: {formatMoney(String(current.comparison), currency)}
              </span>
            )}
          </div>
        )}
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

export function TodayOperations() {
  useLanguage();
  const session = useSession().data!;
  const canView = session.user.permissions.includes('analytics.view');
  const q = useQuery({
    queryKey: ['owner-dashboard', 'today'],
    queryFn: () => api<Dashboard>('/reports/owner-dashboard?period=today'),
    enabled: canView,
    refetchInterval: 60_000,
  });
  if (!canView) return null;
  if (q.isPending) return <p className="muted">{t('Loading dashboard…')}</p>;
  if (q.error) return <ErrorMessage error={q.error} />;
  const today = q.data;
  if (!today) return null;
  const currency = session.store.currency;
  const financial = today.financialSummary as OverviewFinancialSummary;
  const costEstimate = financial.estimated;
  return (
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
            <span className="kpi-label">{t('Average basket')}</span>
            <strong className="kpi-value">
              {formatMoney(String(today.kpis.averageBasket.value ?? 0), currency)}
            </strong>
          </article>
        </div>
        <h3 className="today-financial-heading">{t('Store profitability')}</h3>
        <div className="today-metrics" aria-label={t('Store profitability')}>
          <FinancialCard label="Revenue" value={financial.revenue} currency={currency} />
          <FinancialCard
            label="Cost of goods sold"
            value={financial.cogs ?? costEstimate?.cogs ?? null}
            currency={currency}
            estimated={financial.cogs === null && costEstimate !== null}
            restricted={!financial.permissions.margin}
          />
          <FinancialCard
            label="Gross profit"
            value={financial.grossProfit ?? costEstimate?.grossProfit ?? null}
            currency={currency}
            estimated={financial.grossProfit === null && costEstimate !== null}
            restricted={!financial.permissions.margin}
          />
          <FinancialCard
            label="Gross margin"
            value={financial.grossMarginPercent ?? costEstimate?.grossMarginPercent ?? null}
            currency={currency}
            percent
            estimated={
              financial.grossMarginPercent === null && costEstimate?.grossMarginPercent != null
            }
            restricted={!financial.permissions.margin}
          />
          <FinancialCard
            label="Inventory losses"
            value={financial.inventoryLosses}
            currency={currency}
            restricted={!financial.permissions.margin}
          />
          <FinancialCard
            label="Operating expenses"
            value={financial.operatingExpenses}
            currency={currency}
            restricted={!financial.permissions.expenses}
          />
          <FinancialCard
            label="Store operating profit"
            value={financial.storeOperatingProfit ?? costEstimate?.storeOperatingProfit ?? null}
            currency={currency}
            estimated={
              financial.storeOperatingProfit === null && costEstimate?.storeOperatingProfit != null
            }
            restricted={!financial.permissions.margin || !financial.permissions.expenses}
          />
        </div>
        <HourlySales rows={today.hourly} currency={currency} />
      </section>
      <Insights insights={today.insights ?? []} />
    </div>
  );
}

export function OwnerDashboardPage() {
  useLanguage();
  const session = useSession().data!;
  const [period, setPeriod] = useState<Period>('today');
  const q = useQuery({
    queryKey: ['owner-dashboard', period],
    queryFn: () => api<Dashboard>('/reports/owner-dashboard?period=' + period),
  });
  const pricingSources = useQuery({
    queryKey: ['pricing-sources', period],
    queryFn: () =>
      api<
        {
          source: string;
          units: string;
          revenue: string;
          discount: string;
          refunds: string;
          netRevenue: string;
          costOfGoodsSold: string | null;
          grossProfit: string | null;
        }[]
      >('/reports/pricing-sources?period=' + period),
    enabled: session.user.permissions.includes('analytics.margin'),
  });
  const data = q.data;
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

      <ErrorMessage error={q.error} />
      {q.isPending && <p className="muted">{t('Loading dashboard…')}</p>}

      {data && (
        <div className="dashboard">
          {data.history.days < 7 && (
            <p className="notice">
              {t('Comparisons become more reliable after 7 days of sales history.')}
            </p>
          )}

          {data.summary && <p className="owner-summary">{dashboardSummary(data.summary)}</p>}

          <div className="kpi-row">
            <Kpi label="Sales" data={data.kpis.revenue} currency={currency} />
            <Kpi label="Gross profit" data={data.kpis.grossProfit} currency={currency} />
            <Kpi
              label="Total spending"
              data={data.kpis.totalSpending}
              currency={currency}
              showComparison={false}
            />
            <Kpi
              label="Store operating profit"
              data={data.kpis.netProfit}
              currency={currency}
              showComparison={false}
            />
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

          {!!pricingSources.data?.length && (
            <Table
              title="Pricing and discounts"
              description="Sales and gross profit by the price actually used at checkout."
              head={[
                'Price source',
                'Sales',
                'Discount',
                'Refunds',
                'Cost of goods sold',
                'Gross profit',
              ]}
              empty="No sales in this period."
              rows={pricingSources.data.map((row) => [
                t(
                  row.source === 'BASE'
                    ? 'Regular price'
                    : row.source === 'PRODUCT_PROMOTION'
                      ? 'Product promotion'
                      : row.source === 'CATEGORY_PROMOTION'
                        ? 'Category promotion'
                        : row.source === 'MARKDOWN'
                          ? 'Unit markdown'
                          : row.source === 'LEGACY_MARKDOWN'
                            ? 'Legacy markdown'
                            : 'Prior sale',
                ),
                money(row.revenue),
                money(row.discount),
                money(row.refunds),
                row.costOfGoodsSold === null ? t('Unavailable') : money(row.costOfGoodsSold),
                row.grossProfit === null ? t('Unavailable') : money(row.grossProfit),
              ])}
            />
          )}

          <p className="muted">
            {t('Operating expenses')}:{' '}
            {data.kpis.operatingExpenses.value === null
              ? t('Restricted')
              : formatMoney(String(data.kpis.operatingExpenses.value), currency)}
            {' · '}
            {t('Paid purchases')}:{' '}
            {data.kpis.paidPurchases.value === null
              ? t('Restricted')
              : formatMoney(String(data.kpis.paidPurchases.value), currency)}
          </p>
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

          {period === 'today' && <HourlySales rows={data.hourly} currency={currency} />}

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
