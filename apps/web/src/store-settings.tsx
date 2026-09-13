import { t, useLanguage } from './i18n';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, refresh } from './api';
import { Field, ErrorMessage } from './forms';
import { Button } from './components/ui/button';
type Profile = {
  name: string;
  currency: string;
  timezone: string;
  address: string;
  phone: string;
  businessNumber: string;
  receiptFooter: string;
  defaultTaxRate: string;
  version: number;
};
export function StoreSettingsPage() {
  useLanguage();
  const q = useQuery({
    queryKey: ['store-profile'],
    queryFn: () => api<Profile>('/store-profile'),
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{t('STORE CONFIGURATION')}</div>
          <h1>{t('Store settings')}</h1>
          <p className="muted">
            {t('Business details, receipt text, and defaults for new products.')}
          </p>
        </div>
      </div>
      <ErrorMessage error={q.error} />
      {q.data ? <Editor key={q.data.version} profile={q.data} /> : <p>{t('Loading settings…')}</p>}
    </>
  );
}
function Editor({ profile }: { profile: Profile }) {
  useLanguage();
  const [value, setValue] = useState(profile),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  async function save() {
    setBusy(true);
    try {
      await api('/store-profile', value);
      await refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel panel-padding">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={busy}>
          <div className="form-grid">
            {(
              [
                ['name', 'Store name'],
                ['address', 'Business address'],
                ['phone', 'Phone'],
                ['businessNumber', 'Business / tax registration number'],
                ['defaultTaxRate', 'Default tax rate (%)'],
              ] as const
            ).map(([key, label]) => (
              <Field key={key} label={t(label)}>
                <input
                  required={key === 'name' || key === 'defaultTaxRate'}
                  value={value[key]}
                  onChange={(e) => setValue({ ...value, [key]: e.target.value })}
                />
              </Field>
            ))}
          </div>
          <Field label={t('Receipt footer')}>
            <textarea
              rows={3}
              value={value.receiptFooter}
              onChange={(e) => setValue({ ...value, receiptFooter: e.target.value })}
            />
          </Field>
          <p className="muted">
            {t(
              'Default tax applies to new products only. Existing product rates and old receipts remain unchanged. ',
            )}
          </p>
          <p>
            {t('Currency: ')}
            {profile.currency} {t(' · Timezone: ')}
            {profile.timezone}
          </p>
          <p className="muted">
            {t('Currency and timezone remain fixed to keep historical reporting consistent. ')}
          </p>
          <h3 style={{ marginTop: 24, marginBottom: 12 }}>{t('Receipt header preview')}</h3>
          <div style={{ whiteSpace: 'pre-wrap', padding: 20, border: '1px solid var(--border)' }}>
            <strong>{value.name}</strong>
            <div>{value.address}</div>
            <div>{value.phone}</div>
            <div>{value.businessNumber}</div>
            <p>{value.receiptFooter}</p>
          </div>
          <ErrorMessage error={error} />
          <Button style={{ marginTop: 16 }}>{t('Save store settings')}</Button>
        </fieldset>
      </form>
    </section>
  );
}
