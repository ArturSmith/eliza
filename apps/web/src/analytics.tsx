import { useState } from 'react';
import {
  SalesSummary,
  type Summary,
  type Totals,
  type Group,
  groups,
  rowLabel,
} from './sales-summary';
import { formatMoney } from './receipts';
import { Field } from './forms';
export function AnalyticsPage() {
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">STORE PERFORMANCE</div>
          <h1>Analytics</h1>
          <p className="muted">
            Explore sales trends and compare products, shifts, and time periods.
          </p>
        </div>
      </div>
      <SalesSummary />
    </>
  );
}
function Bars({
  rows,
  currency,
  group,
  timezone,
  label,
}: {
  rows: Totals[];
  currency: string;
  group: Group;
  timezone: string;
  label: string;
}) {
  const max = Math.max(...rows.map((r) => Number(r.total)), 1);
  return (
    <ol className="analytics-bars" aria-label={label}>
      {rows.map((r) => (
        <li key={r.bucket}>
          <div className="analytics-bar-label">
            <span>{rowLabel(r, group, timezone)}</span>
            <strong>{formatMoney(r.total, currency)}</strong>
          </div>
          <div className="analytics-bar-track" aria-hidden="true">
            <div style={{ width: (Number(r.total) / max) * 100 + '%' }} />
          </div>
          <small className="muted">
            {r.transactions} matching receipts
            {group === 'product' ? ' · ' + r.quantity + ' ' + r.unit : ''}
          </small>
        </li>
      ))}
      {!rows.length && <li className="muted">No sales to rank for these filters.</li>}
    </ol>
  );
}
function Rankings({ data, dimension, name }: { data: Summary; dimension: Group; name: string }) {
  const rows = data.groups[dimension] ?? [];
  const descending = [...rows]
    .filter((r) => Number(r.total) > 0)
    .sort((a, b) => Number(b.total) - Number(a.total) || a.bucket.localeCompare(b.bucket))
    .slice(0, 5);
  const ascending = [...rows]
    .sort((a, b) => Number(a.total) - Number(b.total) || a.bucket.localeCompare(b.bucket))
    .slice(0, 5);
  return (
    <div className="analytics-comparison">
      <section className="analytics-chart" aria-label={'Best ' + name}>
        <h3>{dimension === 'product' ? 'Bestsellers' : 'Best ' + name}</h3>
        <Bars
          rows={descending}
          currency={data.currency}
          group={dimension}
          timezone={data.timezone}
          label={'Best ' + name}
        />
      </section>
      <section className="analytics-chart" aria-label={'Lowest ' + name}>
        <h3>Lowest-selling {name}</h3>
        <Bars
          rows={ascending}
          currency={data.currency}
          group={dimension}
          timezone={data.timezone}
          label={'Lowest ' + name}
        />
      </section>
    </div>
  );
}
export function AnalyticsCharts({ data }: { data: Summary }) {
  const [timeline, setTimeline] = useState<Group>('day');
  const [period, setPeriod] = useState<Group>('hour');
  const rows = data.groups[timeline] ?? [];
  const max = Math.max(...rows.map((r) => Number(r.total)), 1);
  const point = (r: Totals, i: number) => [
    65 + (i / Math.max(rows.length - 1, 1)) * 860,
    220 - (Number(r.total) / max) * 175,
  ];
  const points = rows.map((r, i) => point(r, i).join(',')).join(' ');
  const ticks = [
    ...new Set([
      0,
      Math.floor(rows.length / 4),
      Math.floor(rows.length / 2),
      Math.floor((rows.length * 3) / 4),
      rows.length - 1,
    ]),
  ].filter((i) => i >= 0 && i < rows.length);
  return (
    <div className="analytics-visuals">
      <section className="analytics-chart" aria-label="Sales over time">
        <div className="analytics-chart-heading">
          <div>
            <h3>Sales over time</h3>
            <p className="muted">Sales after discounts, including tax and before refunds.</p>
          </div>
          <Field label="Chart interval">
            <select value={timeline} onChange={(e) => setTimeline(e.target.value as Group)}>
              {(['day', 'month', 'year'] as Group[]).map((g) => (
                <option key={g} value={g}>
                  {groups[g]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <svg
          className="analytics-line-chart"
          viewBox="0 0 960 270"
          role="img"
          aria-label={'Sales by ' + groups[timeline]}
        >
          <title>
            Sales by {groups[timeline]} in {data.currency}
          </title>
          <desc>
            {rows.length} periods. Total sales {formatMoney(data.totals.total, data.currency)}.
            Exact values are available in the detailed breakdown.
          </desc>
          {[0, 0.5, 1].map((fraction) => (
            <g key={fraction}>
              <line
                x1="65"
                x2="925"
                y1={220 - fraction * 175}
                y2={220 - fraction * 175}
                stroke="#dfe6d7"
              />
              <text x="58" y={224 - fraction * 175} textAnchor="end" fill="#637359" fontSize="12">
                {new Intl.NumberFormat('en', { notation: 'compact' }).format(max * fraction)}
              </text>
            </g>
          ))}
          <polyline
            points={points}
            fill="none"
            stroke="#245a42"
            strokeWidth="3"
            vectorEffect="non-scaling-stroke"
          />
          {rows.length === 1 && (
            <circle cx={point(rows[0], 0)[0]} cy={point(rows[0], 0)[1]} r="5" fill="#245a42" />
          )}
          {ticks.map((i) => (
            <text
              key={i}
              x={point(rows[i], i)[0]}
              y="247"
              textAnchor={i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle'}
              fill="#637359"
              fontSize="12"
            >
              {rows[i].bucket}
            </text>
          ))}
        </svg>
        {Number(data.totals.transactions) === 0 && (
          <p className="muted">No completed sales in this date range.</p>
        )}
      </section>
      <div className="analytics-chart-heading">
        <div>
          <h3>Product performance</h3>
          <p className="muted">
            Ranked by sales value. Includes active products with no sales. Quantities retain each
            product’s unit.
          </p>
        </div>
      </div>
      <Rankings data={data} dimension="product" name="products" />
      <div className="analytics-chart-heading">
        <div>
          <h3>Shift performance</h3>
          <p className="muted">
            Totals within the selected dates, including shifts with zero matching sales. Shift
            lengths can differ.
          </p>
        </div>
      </div>
      <Rankings data={data} dimension="shift" name="shifts" />
      <div className="analytics-chart-heading">
        <div>
          <h3>Best and quietest periods</h3>
          <p className="muted">
            Totals in {data.timezone}. Hours with no sales include closed hours. Partial months and
            years include only selected dates.
          </p>
        </div>
        <Field label="Compare periods">
          <select value={period} onChange={(e) => setPeriod(e.target.value as Group)}>
            {(
              ['hour', 'weekday', 'dayOfMonth', 'day', 'month', 'monthOfYear', 'year'] as Group[]
            ).map((g) => (
              <option key={g} value={g}>
                {groups[g]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Rankings data={data} dimension={period} name="periods" />
      <p className="muted">
        Top five shown in each ranking. Equal totals share the same performance level. Zero sales
        alone does not show whether an item was available or the shop was open.
      </p>
    </div>
  );
}
