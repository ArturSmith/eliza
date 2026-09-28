import { useState, type FormEvent } from 'react';
import { t, useLanguage } from './i18n';
import { CameraBarcodeScanner } from './camera-barcode-scanner';
import { Button } from './components/ui/button';

export function EmployeeQrUnlock({
  onUnlock,
  disabled = false,
}: {
  onUnlock: (credential: string) => void;
  disabled?: boolean;
}) {
  useLanguage();
  const [credential, setCredential] = useState('');
  const [error, setError] = useState('');
  function unlock(value: string) {
    if (!/^ELIZA-STAFF:[0-9a-f]{64}$/.test(value.trim())) {
      setError(t('This is not an employee QR code.'));
      return;
    }
    setError('');
    onUnlock(value.trim());
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    unlock(credential);
  }
  return (
    <div className="employee-qr-unlock">
      <p className="employee-qr-heading">{t('Or scan your employee QR code')}</p>
      <form className="employee-qr-form" onSubmit={submit}>
        <div className="employee-qr-input-row">
          <input
            type="password"
            autoComplete="off"
            aria-label={t('Employee QR code')}
            value={credential}
            onChange={(event) => setCredential(event.target.value)}
            placeholder={t('Scan employee QR')}
            disabled={disabled}
          />
          <CameraBarcodeScanner onScan={unlock} disabled={disabled} />
        </div>
        <Button className="full" disabled={disabled || !credential}>
          {t('Unlock with QR')}
        </Button>
      </form>
      {error && (
        <p className="employee-qr-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
