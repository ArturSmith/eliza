import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Gift, Check } from 'lucide-react';
import { api, queryClient } from './api';
import { Field, ErrorMessage } from './forms';
import { Button } from './components/ui/button';
import { t, useLanguage } from './i18n';
import './loyalty.css';
type Program = {
  enabled: boolean;
  name: string;
  description: string;
  earnPercent: string;
  version: number;
};
export function LoyaltyPage() {
  useLanguage();
  const q = useQuery({
    queryKey: ['loyalty-management'],
    queryFn: () => api<{ program: Program; members: number }>('/loyalty'),
  });
  return (
    <div className="loyalty-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">{t('CUSTOMER RELATIONSHIPS')}</div>
          <h1>{t('Loyalty program')}</h1>
          <p className="muted">{t('Set how customers earn and spend bonuses in your shop.')}</p>
        </div>
        <Gift size={28} />
      </div>
      <ErrorMessage error={q.error} />
      {q.isPending ? (
        <p>{t('Loading…')}</p>
      ) : (
        q.data && (
          <>
            <div className="loyalty-layout">
              <ProgramEditor key={q.data.program.version} program={q.data.program} />
              <section className="card loyalty-explainer">
                <div className="icon-tile">
                  <Gift />
                </div>
                <h2>{t('One shop, your own rewards')}</h2>
                <strong>
                  {t('Members')}: {q.data.members}
                </strong>
                <p>
                  {t(
                    'Customers join through the Eliza Customer app and show their QR code at checkout.',
                  )}
                </p>
                <p>
                  {t(
                    'One point gives one unit of your shop currency as a discount. Scan the customer QR and choose Collect to earn bonuses or Spend to use them, up to the balance and purchase total. Spend purchases do not earn new bonuses.',
                  )}
                </p>
                <p className="muted">
                  {t(
                    'Refunds reverse earned bonuses and restore spent bonuses. Refunded points that have already been spent can leave a negative balance.',
                  )}
                </p>
              </section>
            </div>
          </>
        )
      )}
    </div>
  );
}
function ProgramEditor({ program }: { program: Program }) {
  const [v, setV] = useState(program),
    [saved, setSaved] = useState(false);
  const mutation = useMutation({
    mutationFn: () => api('/loyalty/program', v, 'PUT'),
    onSuccess: async () => {
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: ['loyalty-management'] });
    },
  });
  return (
    <form
      className="card loyalty-program"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
    >
      <h2>{t('Loyalty program')}</h2>
      <label className="loyalty-toggle">
        <input
          type="checkbox"
          checked={v.enabled}
          onChange={(e) => setV({ ...v, enabled: e.target.checked })}
        />
        <span>{t('Accept customer memberships and enable rewards')}</span>
      </label>
      <Field label={t('Program name')}>
        <input
          required
          maxLength={100}
          value={v.name}
          onChange={(e) => setV({ ...v, name: e.target.value })}
        />
      </Field>
      <Field label={t('About your program')}>
        <textarea
          rows={3}
          maxLength={1000}
          value={v.description}
          onChange={(e) => setV({ ...v, description: e.target.value })}
        />
      </Field>
      <div className="form-grid">
        <Field
          label={t('Bonuses earned, %')}
          hint={t('For example: 3 points for every 100 spent.')}
        >
          <input
            required
            type="number"
            min="0"
            max="25"
            step="0.01"
            value={v.earnPercent}
            onChange={(e) => setV({ ...v, earnPercent: e.target.value })}
          />
        </Field>
      </div>
      <ErrorMessage error={mutation.error} />
      <Button disabled={mutation.isPending}>
        {mutation.isPending ? t('Saving…') : t('Save loyalty program')}
      </Button>
      {saved && (
        <p role="status">
          <Check size={16} />
          {t('Saved')}
        </p>
      )}
    </form>
  );
}
