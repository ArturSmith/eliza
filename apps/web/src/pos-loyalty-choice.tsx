import { Coins, Gift, Percent } from 'lucide-react';
import { applyLoyaltyDiscount, fromScaled, toScaled, type LoyaltyMember } from '@eliza/contracts';
import { Button } from './components/ui/button';
import { t, useLanguage } from './i18n';
import { formatQuantity } from './quantity-format';

type PricedLine = { total: string; discount: string; tax: string; taxRate: string };
export function PosLoyaltyChoice({
  member,
  lines,
  onSelect,
}: {
  member: LoyaltyMember;
  lines: PricedLine[];
  onSelect: (mode: 'collect' | 'spend') => void;
}) {
  useLanguage();
  const collect = lines.length ? applyLoyaltyDiscount(lines, { ...member, mode: 'collect' }) : null;
  const spend = lines.length ? applyLoyaltyDiscount(lines, { ...member, mode: 'spend' }) : null;
  const basket = lines.reduce((sum, line) => sum + toScaled(line.total, 2), 0n);
  const limit = lines.length
    ? fromScaled((basket * toScaled(member.redeemPercent, 2)) / 10000n, 2)
    : undefined;
  const amount = (value: string | undefined) => (value === undefined ? '—' : formatQuantity(value));
  return (
    <div className="pos-loyalty-choice">
      <p className="pos-loyalty-program-name">{member.programName}</p>
      <div className="pos-loyalty-widgets">
        <section className="pos-loyalty-widget pos-loyalty-balance" aria-label={t('Bonus balance')}>
          <h3>
            <Coins size={18} aria-hidden="true" />
            {t('Bonus balance')}
          </h3>
          <strong className="pos-loyalty-stat-value">
            {formatQuantity(member.balance)} <small>{t('points')}</small>
          </strong>
        </section>
        <section
          className="pos-loyalty-widget pos-loyalty-earn"
          aria-label={t('Earn with Collect')}
        >
          <h3>
            <Gift size={18} aria-hidden="true" />
            {t('Earn with Collect')}
          </h3>
          <strong className="pos-loyalty-stat-value">
            {amount(collect?.earned)} <small>{t('points')}</small>
          </strong>
          <p>{t('{percent}% of this purchase', { percent: formatQuantity(member.earnPercent) })}</p>
        </section>
        <section className="pos-loyalty-widget pos-loyalty-spend" aria-label={t('Pay with points')}>
          <h3>
            <Percent size={18} aria-hidden="true" />
            {t('Pay with points')}
          </h3>
          <div className="pos-loyalty-spend-summary">
            <div>
              <strong className="pos-loyalty-stat-value">
                <small>{t('Up to')}</small> {formatQuantity(member.redeemPercent)}%
              </strong>
              <p>{t('Purchase limit: {points} points', { points: amount(limit) })}</p>
            </div>
            <div className="pos-loyalty-spend-available">
              <span>{t('Can spend now')}</span>
              <strong>
                {amount(spend?.spent)} <small>{t('points')}</small>
              </strong>
            </div>
          </div>
        </section>
      </div>
      <p className="pos-loyalty-choice-note">
        {t(
          lines.length
            ? 'Spending points earns no new bonuses.'
            : 'Add products to see the points for this purchase.',
        )}
      </p>
      <div className="pos-loyalty-options">
        <Button onClick={() => onSelect('collect')}>
          <Gift size={18} aria-hidden="true" />
          {t('Collect')}
        </Button>
        <Button
          variant="outline"
          disabled={
            toScaled(member.balance, 2) <= 0n ||
            toScaled(member.redeemPercent, 2) === 0n ||
            (spend !== null && toScaled(spend.spent, 2) === 0n)
          }
          onClick={() => onSelect('spend')}
        >
          <Coins size={18} aria-hidden="true" />
          {t('Spend')}
        </Button>
      </div>
    </div>
  );
}
