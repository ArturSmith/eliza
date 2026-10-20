import { metricFormula } from './metric-formulas';
import { t, useLanguage } from './i18n';
import { useQuery } from '@tanstack/react-query';
import { api, useSession } from './api';
import { ErrorMessage } from './forms';
import { formatMoney } from './receipts';
type Profit = {
  completedSales: string;
  completedRefunds: string;
  netRevenue: string;
  soldCost: string | null;
  restoredCost: string | null;
  costOfGoodsSold: string | null;
  grossProfit: string | null;
  marginPercent: string | null;
  missingCostRecords: string;
  currency: string;
};
type FinancialSummary = {
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
  dataQuality: { missingCostSaleItems: number; missingCostRefundLines: number };
};
type Props = { from: string; to: string; productId?: string; shiftId?: string };

export function GrossProfit(props: Props) {
  const session = useSession().data!;
  if (session.user.permissions.includes('analytics.margin') &&
      session.user.permissions.includes('expenses.read'))
    return <FinancialProfit {...props} />;
  return <LegacyGrossProfit {...props} />;
}

function FinancialProfit({ from, to, productId = '', shiftId = '' }: Props) {
  useLanguage();
  const session = useSession().data!;
  const filtered = Boolean(productId || shiftId);
  const q = useQuery({
    queryKey: ['financial-summary', session.store.id, from, to, productId, shiftId],
    queryFn: () => api<FinancialSummary>('/reports/financial-summary?' +
      new URLSearchParams({ from, to, ...(productId ? { productId } : {}), ...(shiftId ? { shiftId } : {}) })),
    refetchInterval: 60_000,
  });
  const summary = q.data;
  const estimate = summary?.estimated;
  const cards: { label: string; value: string | null; estimate?: string | null; percent?: boolean }[] = summary
    ? [
        { label: 'Revenue', value: summary.revenue },
        { label: 'Cost of goods sold', value: summary.cogs, estimate: estimate?.cogs },
        { label: 'Gross profit', value: summary.grossProfit, estimate: estimate?.grossProfit },
        { label: 'Gross margin', value: summary.grossMarginPercent, estimate: estimate?.grossMarginPercent, percent: true },
        ...(!filtered ? [
          { label: 'Inventory losses', value: summary.inventoryLosses },
          { label: 'Operating expenses', value: summary.operatingExpenses },
          { label: 'Store operating profit', value: summary.storeOperatingProfit, estimate: estimate?.storeOperatingProfit },
        ] : []),
      ]
    : [];
  return (
    <section className="analytics-financial" aria-label={t('Store profitability')}>
      <h3>{t('Store profitability')}</h3>
      <p className="muted">
        {filtered
          ? t('Product and shift filters apply to revenue and gross profit. Store-wide losses and expenses are not allocated to these filters.')
          : t('Revenue is sales less refunds. Gross profit subtracts the cost recorded at sale; store operating profit also subtracts inventory losses and operating expenses.')}
      </p>
      <ErrorMessage error={q.error} />
      {q.isPending ? <p className="muted">{t('Calculating gross profit…')}</p> : null}
      {summary && <>
        <div className="today-metrics today-financial-metrics analytics-financial-metrics">
          {cards.map((card) => {
            const estimated = card.value === null && card.estimate != null;
            const value = card.value ?? card.estimate ?? null;
            return <article className="kpi" key={card.label} title={metricFormula(card.label)}>
              <span className="kpi-label">{t(card.label)}</span>
              <strong className={'kpi-value' + (value === null ? ' kpi-unavailable' : '')}>
                {value === null ? t('Unavailable') : (estimated ? '≈' : '') +
                  (card.percent ? Number(value).toFixed(1) + '%' : formatMoney(value, session.store.currency))}
              </strong>
              {estimated && <small className="muted">{t('Estimated')}</small>}
            </article>;
          })}
        </div>
        {(summary.dataQuality.missingCostSaleItems > 0 || summary.dataQuality.missingCostRefundLines > 0) &&
          <p className="muted">{t('Historical cost records are missing. Profit is unavailable for this range. ')}</p>}
      </>}
    </section>
  );
}

function LegacyGrossProfit({
  from,
  to,
  productId = '',
  shiftId = '',
}: {
  from: string;
  to: string;
  productId?: string;
  shiftId?: string;
}) {
  useLanguage();
  const session = useSession().data!;
  const allowed =
    session.user.permissions.includes('costs.read') &&
    session.user.permissions.includes('sales.read');
  const q = useQuery({
    queryKey: ['gross-profit', session.store.id, session.user.id, from, to, productId, shiftId],
    queryFn: () =>
      api<Profit>('/reports/gross-profit?' + new URLSearchParams({ from, to, productId, shiftId })),
    enabled: allowed,
  });
  if (!allowed) return null;
  const p = q.data;
  return (
    <section
      aria-label={t('Gross profit')}
      style={{ borderTop: '1px solid var(--border)', marginTop: 24, paddingTop: 20 }}
    >
      <h3>{t('Gross profit')}</h3>
      <p className="muted">
        {from} {t(' through ')}
        {to}
        {t(
          '. Revenue is completed sales less refunds. Costs use the purchase cost saved at each sale, not today’s product cost. Product and original-sale shift filters apply here too. This is gross profit before inventory losses and operating expenses. ',
        )}
      </p>
      <ErrorMessage error={q.error} />
      {q.isFetching ? (
        <p>{t('Calculating gross profit…')}</p>
      ) : (
        p && (
          <>
            {p.missingCostRecords !== '0' && (
              <p role="alert">
                {t('Historical cost records are missing. Profit is unavailable for this range. ')}
              </p>
            )}
            <div
              className="form-grid"
              style={{
                gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))',
                marginBlock: 16,
              }}
            >
              {[
                ['Completed sales', p.completedSales],
                ['Completed refunds', p.completedRefunds],
                ['Net revenue', p.netRevenue],
                ['Original goods cost', p.soldCost],
                ['Restocked goods cost', p.restoredCost],
                ['Cost of goods sold', p.costOfGoodsSold],
                ['Gross profit', p.grossProfit],
              ].map(([label, value]) => (
                <div key={label} title={metricFormula(label ?? '')}>
                  <small>{t(label ?? '')}</small>
                  <strong style={{ display: 'block', fontSize: 20 }}>
                    {value === null ? t('Unavailable') : formatMoney(value, p.currency)}
                  </strong>
                </div>
              ))}
              <div title={metricFormula('Gross margin')}>
                <small>{t('Gross margin')}</small>
                <strong style={{ display: 'block', fontSize: 20 }}>
                  {p.marginPercent === null ? '—' : p.marginPercent + '%'}
                </strong>
              </div>
            </div>
            <p className="muted">
              {t(
                'Refunds reduce revenue on the refund date. Returned items reverse their original cost; non-saleable returns become inventory losses. Stock-count adjustments and other write-offs are not included in gross profit. Margin is shown only when net revenue is positive. ',
              )}
            </p>
          </>
        )
      )}
    </section>
  );
}
