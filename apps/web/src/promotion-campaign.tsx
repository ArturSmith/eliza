import { useId, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from './api';
import { Button } from './components/ui/button';
import { ErrorMessage } from './forms';
import { t } from './i18n';

export type Campaign = {
  id?: string;
  title: string;
  description: string;
  published: boolean;
  version: number;
};
export function CampaignFields({
  value,
  change,
}: {
  value: Campaign;
  change: (value: Campaign) => void;
}) {
  const id = useId();
  return (
    <div className="promotion-campaign-fields">
      <p className="muted">
        {t('The card uses this promotion’s dates and offer. No loyalty membership is required.')}
      </p>
      <div className="field">
        <span>
          <label htmlFor={id + '-title'}>{t('Campaign title')}</label>
        </span>
        <input
          id={id + '-title'}
          required
          maxLength={120}
          value={value.title}
          onChange={(e) => change({ ...value, title: e.target.value })}
        />
      </div>
      <div className="field">
        <span>
          <label htmlFor={id + '-details'}>{t('Campaign details')}</label>
        </span>
        <textarea
          id={id + '-details'}
          required
          rows={3}
          maxLength={2000}
          value={value.description}
          onChange={(e) => change({ ...value, description: e.target.value })}
        />
      </div>
      <label className="promotion-campaign-toggle">
        <input
          type="checkbox"
          checked={value.published}
          onChange={(e) => change({ ...value, published: e.target.checked })}
        />
        {t('Publish to customer app')}
      </label>
      <div className="promotion-campaign-preview" aria-label={t('Campaign card preview')}>
        <small>{value.published ? t('Published') : t('Draft')}</small>
        <h3>{value.title || t('Campaign title')}</h3>
        <p>{value.description || t('Campaign details')}</p>
      </div>
    </div>
  );
}
export function PromotionCampaignEditor({
  promotion,
  done,
}: {
  promotion: { id: string; name: string; campaign: Campaign | null };
  done: () => void;
}) {
  const [value, setValue] = useState<Campaign>(
    promotion.campaign ?? {
      title: promotion.name,
      description: '',
      published: true,
      version: 0,
    },
  );
  const save = useMutation({
    mutationFn: () => api('/promotions/' + promotion.id + '/campaign', value, 'PUT'),
    onSuccess: done,
  });
  return (
    <form
      className="promotion-campaign-editor"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <h3>{t('Customer app campaign')}</h3>
      <CampaignFields value={value} change={setValue} />
      <ErrorMessage error={save.error} />
      <div className="promotion-record-actions">
        <Button disabled={save.isPending}>
          {save.isPending ? t('Saving…') : t('Save campaign')}
        </Button>
        <Button type="button" variant="outline" onClick={done}>
          {t('Cancel')}
        </Button>
      </div>
    </form>
  );
}
