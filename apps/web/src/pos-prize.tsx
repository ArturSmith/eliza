import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Gift, Check } from 'lucide-react';
import { api } from './api';
import { Button } from './components/ui/button';
import { ErrorMessage } from './forms';
import { t, useLanguage } from './i18n';
import { formatQuantity } from './quantity-format';
export type PrizePreview = {
  kind: 'prize';
  code: string;
  tier: 'bronze' | 'silver' | 'gold' | 'diamond';
  progress: string;
  balance: string;
  requestId: string;
};
const labels = {
  bronze: 'Bronze prize',
  silver: 'Silver prize',
  gold: 'Gold prize',
  diamond: 'Diamond prize',
};
export function PosPrize({ prize, onClose }: { prize: PrizePreview; onClose: () => void }) {
  useLanguage();
  const [handedOver, setHandedOver] = useState(false);
  const claim = useMutation({
    mutationFn: () =>
      api('/pos/loyalty/prizes/claim', {
        code: prize.code,
        requestId: prize.requestId,
        confirmed: true,
      }),
  });
  return (
    <div className="pos-loyalty-choice pos-prize">
      <div className="pos-prize-icon">
        {claim.isSuccess ? <Check size={32} /> : <Gift size={32} />}
      </div>
      <h3>{t(labels[prize.tier])}</h3>
      <p>
        {t(
          claim.isSuccess
            ? 'Prize handed over. Level progress has restarted; bonus points are unchanged.'
            : 'Hand the customer their prize, then confirm. Only level progress will restart; bonus points stay on the account.',
        )}
      </p>
      <p>
        {t('Bonus balance')}:{' '}
        <strong>
          {formatQuantity(prize.balance)} {t('points')}
        </strong>
      </p>
      <ErrorMessage error={claim.error} />
      {claim.isSuccess ? (
        <Button onClick={onClose}>{t('Done')}</Button>
      ) : (
        <>
          <label className="pos-prize-confirmation">
            <input
              type="checkbox"
              checked={handedOver}
              onChange={(e) => setHandedOver(e.target.checked)}
              disabled={claim.isPending}
            />
            {t('I have handed the prize to the customer.')}
          </label>
          <div className="pos-loyalty-options">
            <Button variant="outline" onClick={onClose} disabled={claim.isPending}>
              {t('Cancel')}
            </Button>
            <Button onClick={() => claim.mutate()} disabled={!handedOver || claim.isPending}>
              {t(claim.isPending ? 'Saving…' : 'Confirm prize handed over')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
