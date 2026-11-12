import { formatQuantity } from './quantity-format';
import { useState, useId, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, useSession } from './api';
import { ErrorMessage } from './forms';
import { formatMoney } from './receipts';
import { SalesSummary } from './sales-summary';
import { DashboardTable } from './report-table';
import { t, useLanguage, getLocale } from './i18n';
import { tone, type Period } from '@eliza/contracts';

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

/** Store-local hourly sales, with an optional comparable-weekday line. */
export function HourlySales({
  rows,
  currency,
  title = 'Sales by hour',
  description = 'Hover over the line to see hourly sales.',
  comparisonLabel,
  responsive = false,
}: {
  rows: any[];
  currency: string;
  title?: string;
  description?: string;
  comparisonLabel?: string;
  responsive?: boolean;
}) {
  useLanguage();
  const [selected, setSelected] = useState<number | null>(null);
  const tooltipId = useId();
  const chartRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(1000);
  useEffect(() => {
    if (!responsive || !chartRef.current) return;
    const observer = new ResizeObserver((entries) => {
      setChartWidth(Math.max(260, Math.min(1000, entries[0].contentRect.width)));
    });
    observer.observe(chartRef.current);
    return () => observer.disconnect();
  }, [responsive]);
  const width = responsive ? chartWidth : 1000;
  const left = responsive ? 72 : 80;
  const right = width - 20;
  const typical = comparisonLabel ?? t('Typical');

  const values = rows.flatMap((row) => [Number(row.total) || 0, Number(row.comparison) || 0]);
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  const x = (index: number) => left + (index * (right - left)) / Math.max(1, rows.length - 1);
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
        <h2>{t(title)}</h2>
        <p>{t(description)}</p>
      </div>
      <div
        ref={chartRef}
        className="hour-line-chart panel-padding"
        onPointerLeave={() => setSelected(null)}
      >
        <div className="hour-line-legend">
          <span>{t('Sales')}</span>
          {hasComparison && <span className="hour-line-typical">{typical}</span>}
        </div>
        <svg viewBox={`0 0 ${width} 245`} role="group" aria-label={t('Sales by hour')}>
          {[min, (min + max) / 2, max].map((value) => (
            <g key={value}>
              <line
                x1={left}
                x2={right}
                y1={y(value)}
                y2={y(value)}
                stroke="var(--color-border-e4e9df)"
              />
              <text x={left - 10} y={y(value) + 4} textAnchor="end" className="hour-line-label">
                {responsive
                  ? new Intl.NumberFormat(getLocale(), {
                      style: 'currency',
                      currency,
                      notation: 'compact',
                      maximumFractionDigits: 1,
                    }).format(value)
                  : formatMoney(String(value), currency)}
              </text>
            </g>
          ))}
          {hasComparison && (
            <path
              d={path('comparison')}
              fill="none"
              stroke="var(--color-text-b77a28)"
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
                stroke="var(--color-text-8c9f85)"
                strokeDasharray="4 4"
              />
              {current.elapsed && (
                <circle
                  cx={x(selected!)}
                  cy={y(Number(current.total) || 0)}
                  r="5"
                  fill="var(--green)"
                  stroke="var(--surface)"
                  strokeWidth="2"
                />
              )}
            </>
          )}
          {rows.map((row, index) => (
            <g key={row.hour}>
              {(index % (responsive && width < 450 ? 6 : 4) === 0 || index === rows.length - 1) && (
                <text x={x(index)} y="234" textAnchor="middle" className="hour-line-label">
                  {row.hour}:00
                </text>
              )}
              <rect
                className="hour-line-hit"
                x={Math.max(left, x(index) - (right - left) / 2 / Math.max(1, rows.length - 1))}
                y="20"
                width={
                  Math.min(right, x(index) + (right - left) / 2 / Math.max(1, rows.length - 1)) -
                  Math.max(left, x(index) - (right - left) / 2 / Math.max(1, rows.length - 1))
                }
                height="195"
                fill="transparent"
                tabIndex={0}
                role="button"
                aria-label={`${row.hour}:00 · ${responsive && !row.elapsed ? t('Not yet') : formatMoney(String(row.total), currency)}`}
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
            style={{ left: Math.max(20, Math.min(80, (x(selected!) / width) * 100)) + '%' }}
          >
            <strong>
              {current.hour}:00–{current.hour}:59
            </strong>
            <span>
              {t('Sales')}:{' '}
              {responsive && !current.elapsed
                ? t('Not yet')
                : formatMoney(String(current.total), currency)}
            </span>
            {current.comparison != null && (
              <span>
                {typical}: {formatMoney(String(current.comparison), currency)}
              </span>
            )}
          </div>
        )}
      </div>
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
  });
  const data = q.data;
  const currency = session.store.currency;
  const money = (value: unknown) => formatMoney(String(value ?? 0), currency);

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{t('STORE PERFORMANCE')}</div>
          <h1>{t('Analytics')}</h1>
          <p className="muted">
            {t(
              'Explore sales by product, category, shift and time. Financial results are in Accounting.',
            )}
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

          <DashboardTable
            title="Category performance"
            description="Sales, growth and share of sales."
            head={['Category', 'Sales', 'Change', 'Share']}
            empty="No sales in this period."
            rows={data.categories.rows.map((c: any) => [
              c.category,
              money(c.revenue),
              <Delta change={c.change} metric="revenue" />,
              c.share === null ? '—' : c.share.toFixed(1) + '%',
            ])}
          />

          {data.inventory && (
            <section className="panel">
              <div className="panel-heading">
                <h2>{t('Inventory health')}</h2>
              </div>
              <div className="stat-row panel-padding">
                <div>
                  <span className="muted">{t('Out of stock')}</span>
                  <strong>{data.inventory.outOfStock}</strong>
                </div>
                <div>
                  <span className="muted">{t('Low stock')}</span>
                  <strong>{data.inventory.lowStock}</strong>
                </div>
              </div>
            </section>
          )}

          <DashboardTable
            title="Product performance"
            description="Ranked by revenue in this period."
            head={['Product', 'Units', 'Sales', 'Stock', 'Cover']}
            empty="No products sold in this period."
            rows={data.products.byRevenue.map((p: any) => [
              p.name,
              formatQuantity(p.units),
              money(p.revenue),
              formatQuantity(p.stock),
              p.daysOfStock === null ? '—' : p.daysOfStock.toFixed(1) + ' ' + t('days'),
            ])}
          />

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
          </section>

          {/* Drill-down: the full sales explorer stays available beneath the answers. */}
          <SalesSummary />
        </div>
      )}
    </>
  );
}
