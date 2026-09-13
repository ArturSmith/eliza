import { t, useLanguage } from './i18n';
import { useQuery } from '@tanstack/react-query';
import { api, useSession } from './api';
import { ErrorMessage } from './forms';
import { formatMoney } from './receipts';
type Profit = {
  salesExTax: string;
  refundsExTax: string;
  netRevenue: string;
  soldCost: string | null;
  restoredCost: string | null;
  costOfGoodsSold: string | null;
  grossProfit: string | null;
  marginPercent: string | null;
  missingCostRecords: string;
  currency: string;
};
export function GrossProfit({
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
          '. Revenue excludes tax and refunds. Costs use the purchase cost saved at each sale, not today’s product cost. Product and original-sale shift filters apply here too. This is gross profit before operating expenses. ',
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
                ['Sales excl. tax', p.salesExTax],
                ['Refunds excl. tax', p.refundsExTax],
                ['Net revenue', p.netRevenue],
                ['Original goods cost', p.soldCost],
                ['Restocked goods cost', p.restoredCost],
                ['Cost of goods sold', p.costOfGoodsSold],
                ['Gross profit', p.grossProfit],
              ].map(([label, value]) => (
                <div key={label}>
                  <small>{t(label ?? '')}</small>
                  <strong style={{ display: 'block', fontSize: 20 }}>
                    {value === null ? t('Unavailable') : formatMoney(value, p.currency)}
                  </strong>
                </div>
              ))}
              <div>
                <small>{t('Gross margin')}</small>
                <strong style={{ display: 'block', fontSize: 20 }}>
                  {p.marginPercent === null ? '—' : p.marginPercent + '%'}
                </strong>
              </div>
            </div>
            <p className="muted">
              {t(
                'Refunds reduce revenue on the refund date. Saleable returns reverse their original cost; non-saleable returns retain that cost. Stock-count adjustments and other write-offs are not included. Margin is shown only when net revenue is positive. ',
              )}
            </p>
          </>
        )
      )}
    </section>
  );
}
