import { useEffect, useId, useRef, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { prepareProductImage } from './product-image';
import { useMutation } from '@tanstack/react-query';
import { api } from './api';
import { Button } from './components/ui/button';
import { ErrorMessage } from './forms';
import { t } from './i18n';

export type Campaign = {
  id?: string;
  image?: string;
  title: string;
  description: string;
  published: boolean;
  version: number;
};
export function CampaignFields({
  value,
  change,
  disabled = false,
  onImageBusyChange,
}: {
  value: Campaign;
  change: (value: Campaign) => void;
  disabled?: boolean;
  onImageBusyChange?: (busy: boolean) => void;
}) {
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null),
    latest = useRef(value),
    upload = useRef(0);
  latest.current = value;
  const [imageBusy, setImageBusy] = useState(false),
    [imageError, setImageError] = useState<unknown>();
  useEffect(
    () => () => {
      upload.current++;
      onImageBusyChange?.(false);
    },
    [],
  );
  async function chooseImage(file: File) {
    const epoch = ++upload.current;
    setImageError(undefined);
    setImageBusy(true);
    onImageBusyChange?.(true);
    try {
      const image = await prepareProductImage(file);
      if (epoch === upload.current) change({ ...latest.current, image });
    } catch (error) {
      if (epoch === upload.current)
        setImageError(
          error instanceof DOMException ? new Error('Choose a valid campaign image.') : error,
        );
    } finally {
      if (epoch === upload.current) {
        setImageBusy(false);
        onImageBusyChange?.(false);
      }
    }
  }
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
          disabled={disabled}
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
          disabled={disabled}
          required
          rows={3}
          maxLength={2000}
          value={value.description}
          onChange={(e) => change({ ...value, description: e.target.value })}
        />
      </div>
      <div className="promotion-campaign-image-field">
        <label htmlFor={id + '-image'}>{t('Campaign image (optional)')}</label>
        <input
          ref={fileInput}
          className="promotion-campaign-image-input"
          id={id + '-image'}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={disabled || imageBusy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void chooseImage(file);
          }}
        />
        <div className="promotion-campaign-image-actions">
          <Button
            type="button"
            variant="outline"
            disabled={disabled || imageBusy}
            onClick={() => fileInput.current?.click()}
          >
            <ImagePlus size={18} />
            {t(value.image ? 'Change image' : 'Upload image')}
          </Button>
          {value.image && (
            <Button
              type="button"
              variant="ghost"
              disabled={disabled || imageBusy}
              onClick={() => {
                setImageError(undefined);
                change({ ...value, image: '' });
              }}
            >
              <Trash2 size={17} />
              {t('Remove image')}
            </Button>
          )}
        </div>
        <small className="muted">{t('JPEG, PNG or WebP, up to 10 MB.')}</small>
        {imageBusy && <p role="status">{t('Preparing image…')}</p>}
        <ErrorMessage error={imageError} />
      </div>
      <label className="promotion-campaign-toggle">
        <input
          type="checkbox"
          disabled={disabled}
          checked={value.published}
          onChange={(e) => change({ ...value, published: e.target.checked })}
        />
        {t('Publish to customer app')}
      </label>
      <div className="promotion-campaign-preview" aria-label={t('Campaign card preview')}>
        {value.image && (
          <img
            className="promotion-campaign-cover"
            src={value.image}
            alt={t('Campaign image preview')}
          />
        )}
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
  const [imageBusy, setImageBusy] = useState(false);
  const save = useMutation({
    mutationFn: () => api('/promotions/' + promotion.id + '/campaign', value, 'PUT'),
    onSuccess: done,
  });
  return (
    <form
      className="promotion-campaign-editor"
      onSubmit={(e) => {
        e.preventDefault();
        if (!imageBusy && !save.isPending) save.mutate();
      }}
    >
      <h3>{t('Customer app campaign')}</h3>
      <CampaignFields
        value={value}
        change={setValue}
        disabled={save.isPending}
        onImageBusyChange={setImageBusy}
      />
      <ErrorMessage error={save.error} />
      <div className="promotion-record-actions">
        <Button disabled={save.isPending || imageBusy}>
          {save.isPending ? t('Saving…') : t('Save campaign')}
        </Button>
        <Button type="button" variant="outline" onClick={done}>
          {t('Cancel')}
        </Button>
      </div>
    </form>
  );
}
