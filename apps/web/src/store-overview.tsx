import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ChevronDown } from 'lucide-react';
import { addDays, storeToday } from '@eliza/contracts';
import { api, useSession } from './api';
import { ErrorMessage } from './forms';
import { HourlySales } from './owner-dashboard';
import { metricFormula } from './metric-formulas';
import { formatMoney } from './receipts';
import { getLocale, t, useLanguage } from './i18n';
import './store-overview.css';

type OverviewData = {
  day: string;
  today: string;
  totalSales: string;
  refunds: string;
  comparisonDate: string | null;
  transactions: number;
  averageBasket: string | null;
  hourly: { hour: string; total: number; comparison: number | null; elapsed: boolean }[];
  shifts: {
    total: number;
    open: number;
    closed: number;
    rows: {
      id: string;
      cashier: string;
      register: string;
      status: 'open' | 'closed';
      openedAt: string;
      closedAt: string | null;
      sales: string;
    }[];
  };
};

function calendarDate(day: string, referenceDay: string) {
  return new Intl.DateTimeFormat(getLocale(), {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
    ...(day.slice(0, 4) !== referenceDay.slice(0, 4) ? { year: 'numeric' as const } : {}),
  }).format(new Date(day + 'T12:00:00Z'));
}
function Metric({
  label,
  value,
  currency,
  formula,
  note,
  count = false,
}: {
  label: string;
  value: string | null;
  currency: string;
  formula: string;
  note: string;
  count?: boolean;
}) {
  return (
    <article className="overview-metric" title={metricFormula(formula)}>
      <span className="overview-metric-label">{t(label)}</span>
      <strong
        className={'overview-metric-value' + (value === null ? ' overview-metric-unavailable' : '')}
      >
        {value === null ? '—' : count ? value : formatMoney(value, currency)}
      </strong>
      <p className="overview-metric-note">{note}</p>
    </article>
  );
}

export function StoreOverview() {
  useLanguage();
  const session = useSession().data!;
  const today = storeToday(new Date(), session.store.timezone);
  const [period, setPeriod] = useState('today');
  const [customDay, setCustomDay] = useState(today);
  const day = period === 'today' ? today : period === 'yesterday' ? addDays(today, -1) : customDay;
  const allowed = session.user.permissions.includes('analytics.view');
  const report = useQuery({
    queryKey: ['store-overview', day],
    queryFn: () =>
      api<OverviewData>('/reports/store-overview?' + new URLSearchParams({ date: day })),
    enabled: allowed,
    refetchInterval: 60_000,
  });
  const data = report.data;
  const currency = session.store.currency;
  const time = (value: string) =>
    new Intl.DateTimeFormat(getLocale(), {
      timeZone: session.store.timezone,
      hour: '2-digit',
      minute: '2-digit',
      ...(storeToday(new Date(value), session.store.timezone) !== day
        ? { day: 'numeric' as const, month: 'short' as const }
        : {}),
    }).format(new Date(value));
  const comparisonLabel = data?.comparisonDate
    ? t('Previous comparable day: {date}', { date: calendarDate(data.comparisonDate, today) })
    : undefined;
  return (
    <div className="store-overview">
      <header className="overview-header page-heading">
        <div>
          <div className="eyebrow">ELIZA / {t('Overview')}</div>
          <h1>{t('Store overview')}</h1>
          <p>
            {calendarDate(day, today)}
            {day === today
              ? ' · ' + t('Today')
              : day === addDays(today, -1)
                ? ' · ' + t('Yesterday')
                : ''}
          </p>
        </div>
        <div className="overview-date-controls">
          <label className="overview-period-control">
            <CalendarDays size={20} aria-hidden="true" />
            <select
              aria-label={t('Overview day')}
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            >
              <option value="today">{t('Today')}</option>
              <option value="yesterday">{t('Yesterday')}</option>
              <option value="custom">{t('Choose date')}</option>
            </select>
            <ChevronDown size={16} aria-hidden="true" />
          </label>
          {period === 'custom' && (
            <input
              aria-label={t('Overview date')}
              type="date"
              max={today}
              value={customDay}
              onChange={(e) => {
                if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value) && e.target.value <= today)
                  setCustomDay(e.target.value);
              }}
            />
          )}
        </div>
      </header>
      {!allowed ? (
        <p className="notice">{t('Access restricted')}</p>
      ) : report.isPending ? (
        <p role="status">{t('Loading dashboard…')}</p>
      ) : report.error ? (
        <ErrorMessage error={report.error} />
      ) : (
        data && (
          <>
            <section className="overview-summary" aria-label={t('Daily sales overview')}>
              <Metric
                label="Total sales"
                value={data.totalSales}
                currency={currency}
                formula="Sales before refunds"
                note={
                  Number(data.refunds) > 0
                    ? t('Across all shifts · {amount} refunded', {
                        amount: formatMoney(data.refunds, currency),
                      })
                    : t('Across all shifts')
                }
              />
              <Metric
                label="Transactions"
                value={String(data.transactions)}
                currency={currency}
                formula="Transactions"
                count
                note={t('Completed receipts')}
              />
              <Metric
                label="Average basket"
                value={data.averageBasket}
                currency={currency}
                formula="Average basket"
                note={t('Per completed receipt')}
              />
            </section>
            <section className="panel overview-shifts" aria-labelledby="overview-shifts-heading">
              <div className="overview-section-heading">
                <h2 id="overview-shifts-heading">
                  {day === today ? t('Today’s shifts') : t('Shifts')}
                </h2>
                <p>
                  {t('{closed} completed · {open} open', {
                    closed: data.shifts.closed,
                    open: data.shifts.open,
                  })}
                </p>
              </div>
              {data.shifts.rows.length ? (
                <div className="overview-shifts-table">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('Shift')}</th>
                        <th>{t('Sales')}</th>
                        <th>{t('Status')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.shifts.rows.map((shift) => (
                        <tr key={shift.id}>
                          <td>
                            <strong>{shift.cashier}</strong>
                            <small>
                              {shift.register} · {time(shift.openedAt)}–
                              {shift.closedAt ? time(shift.closedAt) : t('Now')}
                            </small>
                          </td>
                          <td>{formatMoney(shift.sales, currency)}</td>
                          <td>
                            <span
                              className={
                                'badge badge-' + (shift.status === 'open' ? 'green' : 'gray')
                              }
                            >
                              {t(shift.status === 'open' ? 'Open' : 'Closed')}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="overview-empty">{t('No shifts for this day.')}</p>
              )}
              {data.shifts.total > data.shifts.rows.length && (
                <p className="overview-empty muted">
                  {t('Showing {shown} of {total} shifts', {
                    shown: data.shifts.rows.length,
                    total: data.shifts.total,
                  })}
                </p>
              )}
            </section>
            <div className="overview-sales-chart">
              <HourlySales
                key={day}
                rows={data.hourly}
                currency={currency}
                responsive
                title="Sales throughout the day"
                description={
                  data.comparisonDate
                    ? 'Hourly sales compared with the previous matching weekday.'
                    : 'Hourly sales. A comparison appears when a previous matching weekday has sales.'
                }
                comparisonLabel={comparisonLabel}
              />
            </div>
          </>
        )
      )}
    </div>
  );
}
