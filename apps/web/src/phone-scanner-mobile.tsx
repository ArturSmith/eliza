import { useEffect, useRef, useState } from 'react';
import { Check, Smartphone, Volume2, WifiOff } from 'lucide-react';
import type { ScannerEvent, ScannerPhoneStatus, ScannerScanInput } from '@eliza/contracts';
import { scannerScanSchema } from '@eliza/contracts';
import { api, ApiError } from './api';
import { BrandLogo } from './brand';
import { Button } from './components/ui/button';
import { CameraBarcodeScanner } from './camera-barcode-scanner';
import { LanguageSwitcher } from './i18n/LanguageSwitcher';
import { t, translateError, useLanguage } from './i18n';
import { useScannerSound } from './use-scanner-sound';
import './phone-scanner.css';
const key = 'eliza:phone-scanner:mobile';
let claimInFlight: { token: string; promise: Promise<{ credential: string }> } | undefined;
function claim(pairingToken: string) {
  if (claimInFlight?.token === pairingToken) return claimInFlight.promise;
  const promise = api<{ credential: string }>('/scanner-phone/claim', { pairingToken });
  claimInFlight = { token: pairingToken, promise };
  return promise;
}
function readSaved() {
  try {
    const data = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    return data && /^[a-f0-9]{64}$/.test(data.credential)
      ? (data as { credential: string; pending?: ScannerScanInput })
      : null;
  } catch {
    return null;
  }
}
export function PhoneScannerPage() {
  useLanguage();
  const sound = useScannerSound();
  const [visible, setVisible] = useState(document.visibilityState === 'visible');
  const [healthy, setHealthy] = useState(false);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  const [pairingToken] = useState(() =>
    new URLSearchParams(window.location.hash.slice(1)).get('pair'),
  );
  const [credential, setCredential] = useState(''),
    [status, setStatus] = useState<ScannerPhoneStatus | null>(null),
    [pending, setPending] = useState<ScannerScanInput | null>(null),
    [error, setError] = useState<unknown>(),
    [ended, setEnded] = useState(false),
    [busy, setBusy] = useState(false),
    [manual, setManual] = useState(''),
    [last, setLast] = useState<ScannerEvent | null>(null);
  const pendingRef = useRef<ScannerScanInput | null>(null),
    statusRef = useRef(status),
    credentialRef = useRef(''),
    sending = useRef(false),
    lastSent = useRef<{ target: string; code: string } | null>(null),
    confirmed = useRef('');
  statusRef.current = status;
  function save(next: ScannerScanInput | null, secret = credentialRef.current) {
    pendingRef.current = next;
    setPending(next);
    try {
      sessionStorage.setItem(key, JSON.stringify({ credential: secret, pending: next }));
    } catch {}
  }
  function complete(event: ScannerEvent) {
    if (event.status === 'pending') return;
    setLast(event);
    save(null);
    setError(undefined);
    if (event.status === 'cancelled') lastSent.current = null;
    if (event.status === 'delivered' && confirmed.current !== event.id) {
      confirmed.current = event.id;
      sound.play();
      navigator.vibrate?.(80);
      setError(undefined);
    }
  }
  async function send(body: ScannerScanInput) {
    if (sending.current || !credentialRef.current) return;
    sending.current = true;
    setBusy(true);
    setError(undefined);
    save(body);
    try {
      const event = await api<ScannerEvent>('/scanner-phone/scans', body, 'POST', {
        'X-Scanner-Token': credentialRef.current,
      });
      setLast(event);
      complete(event);
    } catch (cause) {
      setError(cause);
      if (
        cause instanceof ApiError &&
        cause.status >= 400 &&
        cause.status < 500 &&
        cause.status !== 408
      ) {
        save(null);
        lastSent.current = null;
        if (cause.status === 410) setEnded(true);
      }
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  function scan(value: string, allowRepeat = false) {
    const current = statusRef.current,
      code = value.trim();
    if (
      !healthy ||
      !visible ||
      !current?.ready ||
      !current.targetId ||
      pendingRef.current ||
      sending.current ||
      !code
    )
      return;
    if (
      !allowRepeat &&
      lastSent.current?.target === current.targetId &&
      lastSent.current.code === code
    )
      return;
    const body = scannerScanSchema.safeParse({
      id: crypto.randomUUID(),
      targetId: current.targetId,
      barcode: code,
    });
    if (!body.success) {
      setError(new Error('Use valid scanned text.'));
      return;
    }
    lastSent.current = { target: current.targetId, code };
    setManual('');
    void send(body.data);
  }
  useEffect(() => {
    let stopped = false;
    if (pairingToken)
      history.replaceState(null, '', window.location.pathname + window.location.search);
    const start = async () => {
      try {
        let secret: string,
          saved: ReturnType<typeof readSaved> = null;
        if (pairingToken) secret = (await claim(pairingToken)).credential;
        else {
          saved = readSaved();
          if (!saved)
            throw new Error('Scan the connection QR on your laptop to open this scanner.');
          secret = saved.credential;
        }
        if (stopped) return;
        credentialRef.current = secret;
        setCredential(secret);
        save(null, secret);
        const old = scannerScanSchema.safeParse(saved?.pending);
        if (old.success) {
          save(old.data, secret);
          void send(old.data);
        }
      } catch (cause) {
        if (!stopped) {
          setError(cause);
          setEnded(true);
        }
      }
    };
    void start();
    return () => {
      stopped = true;
    };
  }, []);
  useEffect(() => {
    if (!credential || ended) return;
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api<ScannerPhoneStatus>('/scanner-phone/status', {}, 'POST', {
          'X-Scanner-Token': credential,
        });
        if (stopped) return;
        setStatus(next);
        setHealthy(true);
        setError((previous: unknown) =>
          previous instanceof ApiError && previous.status === 0 && !pendingRef.current
            ? undefined
            : previous,
        );
        const request = pendingRef.current;
        if (request && next.lastScan?.id === request.id) {
          setLast(next.lastScan);
          complete(next.lastScan);
        }
      } catch (cause) {
        if (!stopped) {
          setHealthy(false);
          setError(cause);
          if (cause instanceof ApiError && cause.status === 410) {
            setEnded(true);
            setStatus(null);
          }
        }
      } finally {
        if (!stopped) timer = setTimeout(() => void poll(), 1000);
      }
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [credential, ended]);
  const ready = !!status?.ready && !pending && !ended && healthy && visible;
  return (
    <div className="phone-scanner-mobile">
      <header>
        <BrandLogo />
        <LanguageSwitcher />
      </header>
      <main>
        <span className="eyebrow">{status?.shopName ?? t('Eliza scanner')}</span>
        <h1>{t('Phone as scanner')}</h1>
        <div className={'phone-mobile-status' + (ready ? ' is-ready' : '')} role="status">
          {ended ? (
            <WifiOff size={22} />
          ) : pending ? (
            <Smartphone size={22} />
          ) : ready ? (
            <Check size={22} />
          ) : (
            <Smartphone size={22} />
          )}
          <div>
            <strong>
              {t(
                ended
                  ? 'Scanner connection ended'
                  : pending
                    ? 'Sending to laptop…'
                    : ready
                      ? 'Ready to scan'
                      : 'Waiting for the laptop',
              )}
            </strong>
            <p>
              {t(
                ended
                  ? 'Reconnect using a new QR code on the laptop.'
                  : pending
                    ? 'Keep this page open until the laptop confirms receipt.'
                    : ready
                      ? 'Selected field: {field}'
                      : 'Select an editable text field on the laptop. The connection stays active between products.',
                { field: status?.label || t('Text field') },
              )}
            </p>
          </div>
        </div>
        {credential && !ended && sound.supported && !sound.enabled && (
          <Button type="button" variant="outline" onClick={() => void sound.enable()}>
            <Volume2 size={18} />
            {t('Enable scanner sound')}
          </Button>
        )}
        {credential && !ended && (
          <CameraBarcodeScanner
            alwaysOn
            continuous
            scanTarget={status?.targetId ?? undefined}
            disabled={!visible}
            paused={!ready}
            onScan={scan}
          />
        )}
        {last && (
          <div className="phone-last-scan">
            <small>
              {t(
                last.status === 'delivered'
                  ? 'Received on laptop'
                  : last.status === 'cancelled'
                    ? 'Scan not inserted. Select a field and scan again.'
                    : 'Last scan',
              )}
            </small>
            <strong>{last.barcode}</strong>
          </div>
        )}
        {!!error && (
          <p className="error" role="alert">
            {translateError(error instanceof Error ? error.message : String(error))}
          </p>
        )}
        {pending && !busy && !ended && (
          <Button onClick={() => void send(pending)}>{t('Retry sending this scan')}</Button>
        )}
        {!ended && (
          <details className="phone-manual">
            <summary>{t('Enter code or text manually')}</summary>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                scan(manual, true);
              }}
            >
              <label>
                {t('Code or text')}
                <textarea
                  aria-label={t('Code or text')}
                  value={manual}
                  maxLength={4096}
                  onChange={(event) => setManual(event.target.value)}
                  autoComplete="off"
                  inputMode="text"
                />
              </label>
              <Button type="submit" disabled={!ready || !manual.trim()}>
                {t('Send to laptop')}
              </Button>
            </form>
          </details>
        )}
        <p className="muted">
          {t('Scanned text fills the selected field. Review and save on the laptop.')}
        </p>
      </main>
    </div>
  );
}
