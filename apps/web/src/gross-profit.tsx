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
export function GrossProfit({ from, to }: { from: string; to: string }) {
  const session = useSession().data!;
  const allowed =
    session.user.permissions.includes('costs.read') &&
    session.user.permissions.includes('sales.read');
  const q = useQuery({
    queryKey: ['gross-profit', session.store.id, session.user.id, from, to],
    queryFn: () => api<Profit>('/reports/gross-profit?' + new URLSearchParams({ from, to })),
    enabled: allowed,
  });
  if (!allowed) return null;
  const p = q.data;
  return (
    <section
      aria-label="Gross profit"
      style={{ borderTop: '1px solid var(--border)', marginTop: 24, paddingTop: 20 }}
    >
      <h3>Gross profit</h3>
      <p className="muted">
        {from} through {to}. Revenue excludes tax and refunds. Costs use the purchase cost saved at
        each sale, not today’s product cost. This is gross profit before operating expenses.
      </p>
      <ErrorMessage error={q.error} />
      {q.isFetching ? (
        <p>Calculating gross profit…</p>
      ) : (
        p && (
          <>
            {p.missingCostRecords !== '0' && (
              <p role="alert">
                Historical cost records are missing. Profit is unavailable for this range.
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
                  <small>{label}</small>
                  <strong style={{ display: 'block', fontSize: 20 }}>
                    {value === null ? 'Unavailable' : formatMoney(value, p.currency)}
                  </strong>
                </div>
              ))}
              <div>
                <small>Gross margin</small>
                <strong style={{ display: 'block', fontSize: 20 }}>
                  {p.marginPercent === null ? '—' : p.marginPercent + '%'}
                </strong>
              </div>
            </div>
            <p className="muted">
              Refunds reduce revenue on the refund date. Saleable returns reverse their original
              cost; non-saleable returns retain that cost. Stock-count adjustments and other
              write-offs are not included. Margin is shown only when net revenue is positive.
            </p>
          </>
        )
      )}
    </section>
  );
}
