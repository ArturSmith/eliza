import { t, useLanguage } from './i18n';
import { formatMoney } from './receipts';
import { formatQuantity } from './quantity-format';
export type LoyaltyFinancials = {
  issued: string;
  redeemed: string;
  reversed: string;
  restored: string;
  netRedeemed: string;
  netIssued: string;
  openingAvailable: string;
  closingAvailable: string;
  openingNegative: string;
  closingNegative: string;
  revenueBeforeLoyaltyDiscounts: string;
};
export function LoyaltyFinancialsPanel({
  data,
  revenue,
  currency,
}: {
  data: LoyaltyFinancials;
  revenue: string;
  currency: string;
}) {
  useLanguage();
  const money = (value: string) => formatMoney(value, currency);
  return (
    <section
      className="panel panel-padding accounting-card accounting-loyalty"
      aria-label={t('Loyalty and profit')}
    >
      <h3>{t('Loyalty and profit')}</h3>
      <p className="muted">
        {t(
          'Points are discounts at checkout. Issuing points does not move cash or reduce the profit shown above. Spending points reduces sales receipts and profit automatically; do not enter it again as an operating expense.',
        )}
      </p>
      <div className="loyalty-financial-stats">
        {[
          ['Points issued', data.issued],
          ['Points used', data.redeemed],
          ['Earned points reversed on returns', data.reversed],
          ['Spent points restored on returns', data.restored],
        ].map(([label, value]) => (
          <div key={label}>
            <span>{t(label)}</span>
            <strong>
              {formatQuantity(value)} <small>{t('points')}</small>
            </strong>
          </div>
        ))}
      </div>
      <h4>{t('How loyalty affects revenue')}</h4>
      <dl className="loyalty-financial-reconciliation">
        <div>
          <dt>{t('Revenue before point discounts')}</dt>
          <dd>{money(data.revenueBeforeLoyaltyDiscounts)}</dd>
        </div>
        <div>
          <dt>{t('Minus point discounts after returns')}</dt>
          <dd>{money(data.netRedeemed)}</dd>
        </div>
        <div className="loyalty-financial-total">
          <dt>{t('Reported revenue')}</dt>
          <dd>{money(revenue)}</dd>
        </div>
      </dl>
      <p className="muted">
        {t(
          'Point discounts after returns = points used − points restored. Cash/card refunds include only the amount actually paid. Goods paid for with points still carry their original stock cost.',
        )}
      </p>
      <h4>{t('Points available for future purchases')}</h4>
      <dl className="loyalty-financial-reconciliation">
        <div>
          <dt>{t('At the start of the period')}</dt>
          <dd>{money(data.openingAvailable)}</dd>
        </div>
        <div>
          <dt>{t('At the end of the period')}</dt>
          <dd>{money(data.closingAvailable)}</dd>
        </div>
      </dl>
      <p className="muted">
        {t(
          'Shown at face value: one point gives one unit of shop currency as a discount. These are future discounts, not cash paid out or an expense already deducted from profit.',
        )}
      </p>
      {Number(data.closingNegative) < 0 && (
        <p className="muted">
          {t('Balances below zero after returns:')} {formatQuantity(data.closingNegative)}{' '}
          {t('points')}.{' '}
          {t('Negative customer balances do not reduce the points available to other customers.')}
        </p>
      )}
    </section>
  );
}
