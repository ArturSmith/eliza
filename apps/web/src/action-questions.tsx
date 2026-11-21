import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  ArrowRight,
  CalendarClock,
  PackageCheck,
  PackageSearch,
  ShoppingBasket,
  TrendingUp,
  Truck,
} from 'lucide-react';
import {
  actionQuestions,
  productDisplayName,
  type ActionQuestionReport,
  type ActionQuestionPeriod,
  type ActionPlanRow,
} from '@eliza/contracts';
import { api, useSession } from './api';
import { t, useLanguage, getLocale } from './i18n';
import { ErrorMessage } from './forms';
import { Button } from './components/ui/button';
import { formatQuantity } from './quantity-format';
import { formatMoney } from './receipts';

const icons = [ShoppingBasket, CalendarClock, PackageSearch, Truck, TrendingUp, PackageCheck];
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{t(label)}</dt>
      <dd>{children}</dd>
    </div>
  );
}
function ProductLink({ id, name, volume }: { id: string; name: string; volume?: string }) {
  return (
    <Link to="/products/$id" params={{ id }}>
      {productDisplayName({ name, volume })}
      <ArrowRight size={14} />
    </Link>
  );
}
function Notes({ warnings }: { warnings: string[] }) {
  const messages: Record<string, string> = {
    arrival_gap: 'A delivery may arrive after stock runs out.',
    stockout_history: 'Recorded stockouts may understate demand.',
    unknown_expiry: 'Some stock has no expiry date.',
    draft_orders: 'Review existing purchase drafts before ordering.',
    upcoming_expiry: 'Some available stock expires within the planning horizon.',
    stock_mismatch: 'Reconcile stock with batches.',
    uncertain_incoming: 'Confirm overdue or undated deliveries first.',
    choose_supplier: 'Choose a preferred supplier in a shopping list.',
  };
  return warnings.some((key) => messages[key]) ? (
    <ul className="question-notes">
      {warnings
        .filter((key) => messages[key])
        .map((key) => (
          <li key={key}>{t(messages[key])}</li>
        ))}
    </ul>
  ) : null;
}
export function ActionQuestions({ onNoSales }: { onNoSales: () => void }) {
  useLanguage();
  const session = useSession().data!;
  const [period, setPeriod] = useState<ActionQuestionPeriod>('week');
  const q = useQuery({
    queryKey: ['action-questions', session.store.id, period],
    queryFn: () => api<ActionQuestionReport>('/reports/action-center/questions?period=' + period),
  });
  const report = q.data;
  const date = (value: string) =>
    new Intl.DateTimeFormat(getLocale(), {
      dateStyle: 'medium',
      timeZone: value.length === 10 ? 'UTC' : (report?.timezone ?? session.store.timezone),
    }).format(new Date(value.length === 10 ? value + 'T12:00:00Z' : value));
  const qty = (value: string | null, unit: string) =>
    value === null ? '—' : formatQuantity(value) + ' ' + t(unit);
  const money = (value: string) => formatMoney(value, report?.currency ?? session.store.currency);
  function planningCard(p: ActionPlanRow, overstock = false) {
    return (
      <article key={p.productId} className="question-item">
        <div className="question-item-heading">
          <ProductLink id={p.productId} name={p.name} volume={p.volume} />
          <span className={'badge ' + (p.status === 'order_now' ? 'badge-amber' : 'badge-gray')}>
            {t(
              overstock
                ? p.demandStatus === 'no_sales'
                  ? 'No sales'
                  : 'Slow / high stock cover'
                : p.status === 'order_now'
                  ? 'Order now'
                  : 'Order later',
            )}
          </span>
        </div>
        <dl className="question-facts">
          <Fact label="Available stock">{qty(p.available, p.unit)}</Fact>
          <Fact label="Average daily sales">{qty(p.dailySales, p.unit)}</Fact>
          <Fact label="Stock cover">
            {p.daysOfStock === null ? '—' : t('{days} days', { days: p.daysOfStock.toFixed(1) })}
          </Fact>
          {!overstock && (
            <>
              <Fact label="Recommended order">{qty(p.quantity, p.unit)}</Fact>
              <Fact label="Order by">{p.orderBy ? date(p.orderBy) : '—'}</Fact>
              <Fact label="Incoming stock">{qty(p.incoming, p.unit)}</Fact>
              <Fact label="Supplier">{p.supplierName ?? t('Not set')}</Fact>
              <Fact label="Lead time">
                {p.leadDays === null ? '—' : t('{days} days', { days: p.leadDays })}
              </Fact>
            </>
          )}
          {overstock && <Fact label="Observed full days">{p.observedDays}</Fact>}
        </dl>
        <Notes warnings={p.warnings} />
      </article>
    );
  }
  function section(
    index: number,
    scope: string,
    allowed: boolean,
    content: ReactNode,
    action?: ReactNode,
  ) {
    const [id, title] = actionQuestions[index];
    const Icon = icons[index];
    return (
      <section
        key={id}
        id={'question-' + id}
        className="panel question-section"
        aria-labelledby={'question-title-' + id}
      >
        <header className="question-heading">
          <span className="question-icon">
            <Icon size={22} />
          </span>
          <div>
            <p className="question-scope">
              {index + 1} · {t(scope)}
            </p>
            <h2 id={'question-title-' + id}>{t(title)}</h2>
          </div>
        </header>
        {allowed ? (
          content
        ) : (
          <p className="question-message">
            {t('Additional reporting permissions are required for this section.')}
          </p>
        )}
        {allowed && action && <div className="question-footer">{action}</div>}
      </section>
    );
  }
  const link = (to: string, label: string) => (
    <Link to={to} className="button button-outline">
      {t(label)}
      <ArrowRight size={15} />
    </Link>
  );
  return (
    <div className="action-questions">
      <div className="question-period-toolbar">
        <div>
          <strong>{t('Sales analysis period')}</strong>
          <p className="muted">
            {t(
              'The period applies to sales changes and assortment results. Stock and delivery insights use current data.',
            )}
          </p>
        </div>
        <div className="period-tabs" role="group" aria-label={t('Sales analysis period')}>
          {(
            [
              ['today', 'Today so far'],
              ['week', 'Last 7 complete days'],
              ['month', 'Last 28 complete days'],
            ] as const
          ).map(([value, label]) => (
            <button
              type="button"
              key={value}
              aria-pressed={period === value}
              className={'period-tab ' + (period === value ? 'period-tab-active' : '')}
              onClick={() => setPeriod(value)}
            >
              {t(label)}
            </button>
          ))}
        </div>
      </div>
      <ErrorMessage error={q.error} />
      {q.error && (
        <Button variant="outline" onClick={() => void q.refetch()}>
          {t('Try again')}
        </Button>
      )}
      {q.isPending && <p role="status">{t('Preparing manager insights…')}</p>}
      {report && (
        <>
          {section(
            0,
            'Current stock · 28 complete days of sales',
            report.planning.allowed,
            <>
              <p className="question-summary">
                {report.planning.total
                  ? t('Order now: {now}. Products with an order recommendation: {total}.', {
                      now: report.planning.orderNow,
                      total: report.planning.total,
                    })
                  : t('No order quantities are currently recommended from the available data.')}
              </p>
              {(report.planning.needsReview > 0 || report.planning.insufficientHistory > 0) && (
                <p className="question-message">
                  {t('Needs data review: {review}. Insufficient sales history: {history}.', {
                    review: report.planning.needsReview,
                    history: report.planning.insufficientHistory,
                  })}
                </p>
              )}
              <div className="question-items">
                {report.planning.rows.map((p) => planningCard(p))}
              </div>
              <p className="question-explanation">
                {t(
                  'Uses usable batches, confirmed arrivals, supplier lead time, safety stock, pack size and minimum order. A draft is not a confirmed delivery.',
                )}
              </p>
              {report.planning.truncated && (
                <p className="question-message">
                  {t(
                    'Only the first 5,000 matching products were evaluated. Narrow the report before drawing store-wide conclusions.',
                  )}
                </p>
              )}
            </>,
            link('/replenishment', 'Review order recommendations'),
          )}
          {section(
            1,
            'Current batches · next 7 days',
            report.expiry.allowed,
            <>
              <p className="question-summary">
                {report.expiry.total
                  ? t('Batches expired or due within 7 days: {count}.', {
                      count: report.expiry.total,
                    })
                  : t('No recorded batches expire within the next 7 days.')}
              </p>
              <div className="question-items">
                {report.expiry.rows.map((b) => (
                  <article className="question-item" key={b.id}>
                    <div className="question-item-heading">
                      <ProductLink id={b.productId} name={b.name} volume={b.volume} />
                      <span className={'badge ' + (b.expired ? 'badge-amber' : 'badge-gray')}>
                        {t(b.expired ? 'Expired' : 'Expiring soon')}
                      </span>
                    </div>
                    <dl className="question-facts">
                      <Fact label="Batch stock">{qty(b.quantity, b.unit)}</Fact>
                      <Fact label="Expiry date">{date(b.expiryDate)}</Fact>
                      <Fact label="Supplier">{b.supplierName ?? '—'}</Fact>
                    </dl>
                  </article>
                ))}
              </div>
              <p className="question-explanation">
                {t(
                  'These are recorded expiry dates, not a prediction that the stock cannot sell. Review sale pace and the batch before deciding on a markdown or write-off.',
                )}
              </p>
              {report.expiry.unknownProducts > 0 && (
                <p className="question-message">
                  {t(
                    'Products with stock and no expiry date: {count}. Their expiry risk is unknown.',
                    { count: report.expiry.unknownProducts },
                  )}
                </p>
              )}
            </>,
          )}
          {section(
            2,
            'Current stock · 28 complete days of sales',
            report.overstock.allowed,
            <>
              <p className="question-summary">
                {report.overstock.total
                  ? t(
                      'Products with no recent sales or more than 60 days of stock cover: {count}.',
                      { count: report.overstock.total },
                    )
                  : t(
                      'No mature products with no sales or high stock cover were found in the evaluated data.',
                    )}
              </p>
              <div className="question-items">
                {report.overstock.rows.map((p) => planningCard(p, true))}
              </div>
              <p className="question-explanation">
                {t(
                  'Review current stock and existing orders before buying more. No recorded sales alone does not prove a lack of demand; stockouts, seasonality and promotions can change the picture.',
                )}
              </p>
              {report.overstock.truncated && (
                <p className="question-message">
                  {t(
                    'Only the first 5,000 matching products were evaluated. Narrow the report before drawing store-wide conclusions.',
                  )}
                </p>
              )}
            </>,
            <>
              <Button variant="outline" onClick={onNoSales}>
                {t('Analyse no-sales stock')}
                <ArrowRight size={15} />
              </Button>
              {link('/replenishment', 'Review stock cover')}
            </>,
          )}
          {section(
            3,
            'Latest received costs · all delivery history',
            report.costs.allowed,
            <>
              <p className="question-summary">
                {report.costs.total
                  ? t(
                      'Compare the latest actual delivery with the previous delivery from the same supplier.',
                    )
                  : t('No received purchase costs have been recorded yet.')}
              </p>
              <div className="question-items">
                {report.costs.rows.map((p, index) => (
                  <article className="question-item" key={p.productId + '-' + index}>
                    <div className="question-item-heading">
                      <ProductLink id={p.productId} name={p.name} volume={p.volume} />
                      {p.change !== null && (
                        <span
                          className={
                            'badge ' + (Number(p.change) > 0 ? 'badge-amber' : 'badge-gray')
                          }
                        >
                          {Number(p.change) > 0 ? '+' : ''}
                          {p.change}%
                        </span>
                      )}
                    </div>
                    <dl className="question-facts">
                      <Fact label="Supplier">{p.supplierName}</Fact>
                      <Fact label="Received on">{date(p.paidAt)}</Fact>
                      <Fact label="Last paid per selling unit">
                        {money(p.cost)} / {t(p.unit)}
                      </Fact>
                      <Fact label="Previous delivery cost">
                        {p.previousCost === null
                          ? t('No previous delivery')
                          : money(p.previousCost)}
                      </Fact>
                    </dl>
                    {p.alternativeSupplier && p.alternativeCost !== null && (
                      <p className="question-comparison">
                        {t('Another recorded purchase')}:{' '}
                        <strong>
                          {p.alternativeSupplier} · {money(p.alternativeCost)}
                        </strong>
                        {p.alternativeDate && <> · {date(p.alternativeDate)}</>}
                      </p>
                    )}
                  </article>
                ))}
              </div>
              <p className="question-explanation">
                {t(
                  'Costs exclude purchase tax and use the same selling unit. Prices from other suppliers are historical payments, not current offers. Confirm price, pack size and availability before ordering.',
                )}
              </p>
            </>,
            link('/purchases/history', 'Review purchases'),
          )}
          {section(
            4,
            'Selected sales period',
            report.demand.allowed,
            <>
              <p className="question-summary">
                {t('Completed receipts: {current}; comparison period: {previous}.', {
                  current: report.demand.receipts,
                  previous: report.demand.previousReceipts,
                })}
              </p>
              <p className="question-explanation">
                {date(report.range.from)} – {date(report.range.to)} · {t('Compared with')}:{' '}
                {date(report.comparison.from)} – {date(report.comparison.to)}
                {period === 'today' && <> · {t('Same elapsed local time')}</>}
              </p>
              {report.demand.previousReceipts === 0 && (
                <p className="question-message">
                  {t(
                    'No comparable receipts were recorded. A percentage growth claim would be misleading.',
                  )}
                </p>
              )}
              <div className="question-items">
                {report.demand.rows.map((p) => (
                  <article className="question-item" key={p.productId}>
                    <div className="question-item-heading">
                      <ProductLink id={p.productId} name={p.name} volume={p.volume} />
                      <span className="badge badge-gray">
                        {t(Number(p.change) > 0 ? 'Selling more' : 'Selling less')}
                      </span>
                    </div>
                    <dl className="question-facts">
                      <Fact label="Units sold">{qty(p.quantity, p.unit)}</Fact>
                      <Fact label="Previous period units">{qty(p.previousQuantity, p.unit)}</Fact>
                    </dl>
                  </article>
                ))}
              </div>
              {!report.demand.rows.length && (
                <p className="question-message">
                  {t('No product quantity changes were found for these periods.')}
                </p>
              )}
              <p className="question-explanation">
                {t(
                  'These are observed sales changes, not proven causes. Availability and opening hours matter. Returns do not erase the original units sold.',
                )}
              </p>
            </>,
            link('/analytics', 'Explore sales details'),
          )}
          {section(
            5,
            'Selected sales period · historical sale costs',
            report.assortment.allowed,
            <>
              <p className="question-summary">
                {report.assortment.rows.length
                  ? t('Products with the highest verified gross profit in the current shortlist.')
                  : t('No verified product profitability is available for this period.')}
              </p>
              <div className="question-items">
                {report.assortment.rows.map((p) => (
                  <article className="question-item" key={p.productId}>
                    <div className="question-item-heading">
                      <ProductLink id={p.productId} name={p.name} volume={p.volume} />
                    </div>
                    <dl className="question-facts">
                      <Fact label="Gross profit">{money(p.grossProfit)}</Fact>
                      <Fact label="Sales after returns">{money(p.revenue)}</Fact>
                      <Fact label="Units sold">{qty(p.quantity, p.unit)}</Fact>
                    </dl>
                  </article>
                ))}
              </div>
              {report.assortment.incomplete > 0 && (
                <p className="question-message">
                  {t(
                    'Products with incomplete cost data are excluded from the profit ranking: {count}.',
                    { count: report.assortment.incomplete },
                  )}
                </p>
              )}
              <p className="question-explanation">
                {t(
                  'Uses immutable sale and refund cost snapshots from Accounting. This is gross profit, not operating profit. Later purchases do not change past sale costs.',
                )}
              </p>
            </>,
            link('/accounting', 'Open Accounting'),
          )}
        </>
      )}
    </div>
  );
}
