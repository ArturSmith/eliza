import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, LockKeyhole } from 'lucide-react';
import { api, queryClient } from './api';
import { Button } from './components/ui/button';
import { ErrorMessage, Field } from './forms';
import { t, useLanguage } from './i18n';

export function ManagementAccessPage() {
  useLanguage();
  const [confirm, setConfirm] = useState(false);
  const back =
    new URLSearchParams(window.location.search).get('from') === 'price-tags'
      ? '/price-tags'
      : '/pos';
  const mutation = useMutation({
    mutationFn: (body: unknown) => api('/auth/reclaim-device', body),
    onSuccess: () => {
      queryClient.clear();
      window.location.assign('/');
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    mutation.mutate({ email: data.get('email'), password: data.get('password') });
  }
  return (
    <div className="register-welcome">
      <a className="text-link" href={back}>
        <ArrowLeft size={16} />
        {t('Back to device workspace')}
      </a>
      <div className="icon-tile">
        <LockKeyhole size={26} />
      </div>
      <h1>{t('Switch to Management')}</h1>
      <p className="muted">
        {t('A manager must sign in to change this device. Close any open cashier shift first.')}
      </p>
      <form onSubmit={submit}>
        <Field label={t('Management email')}>
          <input name="email" type="email" required autoComplete="username" />
        </Field>
        <Field label={t('Password')}>
          <input name="password" type="password" required autoComplete="current-password" />
        </Field>
        <label className="field">
          <span>{t('Device environment')}</span>
          <span>{t('Switch this device to Management')}</span>
          <input
            type="checkbox"
            checked={confirm}
            onChange={(event) => setConfirm(event.target.checked)}
            required
          />
        </label>
        <ErrorMessage error={mutation.error} />
        <Button className="full" disabled={mutation.isPending || !confirm}>
          {mutation.isPending ? t('Please wait…') : t('Switch to Management')}
        </Button>
      </form>
    </div>
  );
}
