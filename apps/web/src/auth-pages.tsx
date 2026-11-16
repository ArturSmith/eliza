import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { AuthForm, ErrorMessage } from './forms';
import { Button } from './components/ui/button';
import { t, useLanguage } from './i18n';

export function AuthEntryPage({ register = false }: { register?: boolean }) {
  useLanguage();
  const status = useQuery({
    queryKey: ['setup'],
    queryFn: () => api<{ needsSetup: boolean; registrationEnabled: boolean }>('/auth/status'),
  });
  if (status.isPending) return <div className="loading">{t('Loading…')}</div>;
  if (status.error)
    return (
      <div className="connection-error">
        <ErrorMessage error={status.error} />
        <Button onClick={() => void status.refetch()}>{t('Try again')}</Button>
      </div>
    );
  if (register && !status.data.registrationEnabled)
    return (
      <div className="connection-error">
        <p>{t('Store registration is currently disabled.')}</p>
        <a className="text-link" href="/login">
          {t('Sign in')}
        </a>
      </div>
    );
  return (
    <AuthForm
      setup={register}
      registration={register}
      canRegister={status.data.registrationEnabled}
    />
  );
}
