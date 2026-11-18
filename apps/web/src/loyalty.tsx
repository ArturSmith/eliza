import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Gift, Plus, ArrowRight, Check } from 'lucide-react';
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
  redeemPercent: string;
  version: number;
};
type Campaign = {
  id?: string;
  title: string;
  description: string;
  published: boolean;
  startsAt: string;
  endsAt: string;
  version: number;
};
const localDate = (date: string) => {
  const d = new Date(date);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const emptyCampaign = (): Campaign => ({
  title: '',
  description: '',
  published: false,
  startsAt: new Date().toISOString(),
  endsAt: new Date(Date.now() + 7 * 86400000).toISOString(),
  version: 0,
});
export function LoyaltyPage() {
  useLanguage();
  const q = useQuery({
    queryKey: ['loyalty-management'],
    queryFn: () => api<{ program: Program; campaigns: Campaign[]; members: number }>('/loyalty'),
  });
  const [editing, setEditing] = useState<Campaign | null>(null);
  return (
    <div className="loyalty-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">{t('CUSTOMER RELATIONSHIPS')}</div>
          <h1>{t('Loyalty & campaigns')}</h1>
          <p className="muted">
            {t('Reward your regulars and share what is happening in your shop.')}
          </p>
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
                    'One point gives one unit of your shop currency as a discount. Bonuses are earned on the amount paid after discounts. Customer-authorized redemption codes expire after five minutes.',
                  )}
                </p>
                <p className="muted">
                  {t(
                    'Refunds reverse earned bonuses and restore spent bonuses. Refunded points that have already been spent can leave a negative balance.',
                  )}
                </p>
              </section>
            </div>
            <section className="card loyalty-campaigns">
              <div className="section-heading">
                <div>
                  <h2>{t('Customer campaigns')}</h2>
                  <p className="muted">
                    {t(
                      'Published campaigns are visible to your members during the selected dates. Set checkout prices separately in Promotions.',
                    )}
                  </p>
                </div>
                <Button onClick={() => setEditing(emptyCampaign())}>
                  <Plus size={17} />
                  {t('New campaign')}
                </Button>
              </div>
              {editing && (
                <CampaignEditor
                  key={editing.id ?? 'new'}
                  campaign={editing}
                  done={() => setEditing(null)}
                />
              )}
              <div className="loyalty-campaign-grid">
                {q.data.campaigns.map((c) => (
                  <article className="loyalty-campaign" key={c.id}>
                    <span className="eyebrow">{c.published ? t('Published') : t('Draft')}</span>
                    <h3>{c.title}</h3>
                    <p>{c.description}</p>
                    <small>
                      {new Date(c.startsAt).toLocaleDateString()} –{' '}
                      {new Date(c.endsAt).toLocaleDateString()}
                    </small>
                    <Button variant="outline" onClick={() => setEditing(c)}>
                      {t('Edit campaign')}
                      <ArrowRight size={16} />
                    </Button>
                  </article>
                ))}
              </div>
              {!q.data.campaigns.length && !editing && (
                <p className="muted">
                  {t('No campaigns yet. Create your first update or member offer.')}
                </p>
              )}
            </section>
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
        <Field label={t('Maximum purchase paid with bonuses, %')}>
          <input
            required
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={v.redeemPercent}
            onChange={(e) => setV({ ...v, redeemPercent: e.target.value })}
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
function CampaignEditor({ campaign, done }: { campaign: Campaign; done: () => void }) {
  const [v, setV] = useState(campaign);
  const mutation = useMutation({
    mutationFn: () =>
      api('/loyalty/campaigns' + (v.id ? '/' + v.id : ''), v, v.id ? 'PUT' : 'POST'),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['loyalty-management'] });
      done();
    },
  });
  return (
    <form
      className="loyalty-campaign-editor"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
    >
      <h3>{v.id ? t('Edit campaign') : t('New campaign')}</h3>
      <Field label={t('Campaign title')}>
        <input
          required
          maxLength={120}
          value={v.title}
          onChange={(e) => setV({ ...v, title: e.target.value })}
        />
      </Field>
      <Field label={t('Campaign details')}>
        <textarea
          required
          rows={4}
          maxLength={2000}
          value={v.description}
          onChange={(e) => setV({ ...v, description: e.target.value })}
        />
      </Field>
      <div className="form-grid">
        <Field label={t('Starts at')}>
          <input
            type="datetime-local"
            required
            value={localDate(v.startsAt)}
            onChange={(e) => {
              if (e.target.value) setV({ ...v, startsAt: new Date(e.target.value).toISOString() });
            }}
          />
        </Field>
        <Field label={t('Ends at')}>
          <input
            type="datetime-local"
            required
            value={localDate(v.endsAt)}
            onChange={(e) => {
              if (e.target.value) setV({ ...v, endsAt: new Date(e.target.value).toISOString() });
            }}
          />
        </Field>
      </div>
      <label className="loyalty-toggle">
        <input
          type="checkbox"
          checked={v.published}
          onChange={(e) => setV({ ...v, published: e.target.checked })}
        />
        {t('Publish to customer app')}
      </label>
      <ErrorMessage error={mutation.error} />
      <div className="loyalty-actions">
        <Button disabled={mutation.isPending}>{t('Save campaign')}</Button>
        <Button type="button" variant="outline" onClick={done}>
          {t('Cancel')}
        </Button>
      </div>
    </form>
  );
}
