import { useQuery } from '@tanstack/react-query';
import { api, useSession } from './api';
import { ErrorMessage } from './forms';
import { DashboardTable } from './report-table';
import { formatMoney } from './receipts';
import { t, useLanguage } from './i18n';

export function AccountingBreakdowns({ from, to }: { from: string; to: string }) {
  useLanguage();
  const session = useSession().data!;
  const currency = session.store.currency;
  const money = (value: unknown) =>
    value == null ? t('Unavailable') : formatMoney(String(value), currency);
  const q = useQuery({
    queryKey: ['owner-dashboard', 'accounting', from, to],
    queryFn: () =>
      api<any>('/reports/owner-dashboard?' + new URLSearchParams({ period: 'custom', from, to })),
    enabled: session.user.permissions.includes('analytics.view'),
  });
  const pricingSources = useQuery({
    queryKey: ['pricing-sources', from, to],
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
      >('/reports/pricing-sources?' + new URLSearchParams({ period: 'custom', from, to })),
    enabled: session.user.permissions.includes('analytics.margin'),
  });

  const data = q.data;
  return (
    <div className="accounting-breakdowns">
      <ErrorMessage error={q.error} />
      <ErrorMessage error={pricingSources.error} />
      {!!pricingSources.data?.length && (
        <DashboardTable
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

      {data && (
        <>
          <section className="panel" aria-label={t('Purchases and stock value')}>
            <div className="panel-heading">
              <h2>{t('Purchases and stock value')}</h2>
              <p>
                {t(
                  'Stock values reflect current inventory; purchase payments use the selected dates.',
                )}
              </p>
            </div>
            <div className="stat-row panel-padding">
              <div>
                <span className="muted">{t('Paid purchases')}</span>
                <strong>
                  {data.kpis.paidPurchases.value == null
                    ? t('Restricted')
                    : money(data.kpis.paidPurchases.value)}
                </strong>
              </div>
              {data.inventory && (
                <>
                  <div>
                    <span className="muted">{t('Stock value')}</span>
                    <strong>{money(data.inventory.value)}</strong>
                  </div>
                  <div>
                    <span className="muted">{t('Dead stock')}</span>
                    <strong>{money(data.inventory.dead.value)}</strong>
                  </div>
                </>
              )}
            </div>
            <p className="panel-padding muted">
              {t(
                'Purchase payments are cash movements, not operating expenses. Profit uses the cost of goods actually sold.',
              )}
            </p>
          </section>
          <DashboardTable
            title="Profitability by category"
            head={['Category', 'Revenue', 'Gross margin']}
            empty="No sales in this period."
            rows={data.categories.rows.map((category: any) => [
              category.category,
              money(category.revenue),
              category.margin === null ? t('Unavailable') : category.margin.toFixed(1) + '%',
            ])}
          />
          <DashboardTable
            title="Profitability by product"
            head={['Product', 'Revenue', 'Gross margin']}
            empty="No products sold in this period."
            rows={data.products.byRevenue.map((product: any) => [
              product.name,
              money(product.revenue),
              product.margin === null ? t('Unavailable') : product.margin.toFixed(1) + '%',
            ])}
          />
          {!!data.purchasing.costIncreases.length && (
            <DashboardTable
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
                  p.percent === null
                    ? '—'
                    : (p.percent >= 0 ? '+' : '') + p.percent.toFixed(1) + '%',
                  p.priceUnchanged ? t('Unchanged') : t('Reviewed'),
                ])}
            />
          )}

          {data.waste.available && (
            <DashboardTable
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
            <DashboardTable
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
            <DashboardTable
              title="Cash reconciliation"
              description="Opening and closing balances belong to the whole shift, including shifts spanning multiple dates."
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
        </>
      )}
    </div>
  );
}
