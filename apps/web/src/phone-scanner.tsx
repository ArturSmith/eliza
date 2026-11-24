import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Smartphone, Unplug } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import type { ScannerDesktopStatus, ScannerPair } from '@eliza/contracts';
import { api, ApiError, useSession } from './api';
import { Button } from './components/ui/button';
import { Dialog } from './components/ui/dialog';
import { t, translateError, useLanguage } from './i18n';
import './phone-scanner.css';
type Target = {
  id: string;
  label: string;
  enabled: boolean;
  receive: (code: string) => boolean | Promise<boolean>;
};
type RecordState = { tabId: string; linkId: string | null };
type ScannerContext = {
  allowed: boolean;
  linked: boolean;
  online: boolean;
  show: () => void;
  register: (target: Target) => () => void;
};
const Context = createContext<ScannerContext | null>(null);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function PhoneScannerProvider({ children }: { children: ReactNode }) {
  useLanguage();
  const session = useSession().data;
  const allowed = !!session?.user.permissions.includes('catalog.write');
  const ownerKey = session ? `${session.store.id}:${session.user.id}:${session.device.id}` : '';
  const storageKey = `eliza:phone-scanner:${ownerKey}`;
  const [record, setRecord] = useState<RecordState | null>(null),
    [status, setStatus] = useState<ScannerDesktopStatus | null>(null),
    [pairing, setPairing] = useState<ScannerPair | null>(null),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const target = useRef<Target | null>(null),
    ack = useRef<string | undefined>(undefined),
    seen = useRef<string[]>([]);
  const register = useCallback((next: Target) => {
    target.current = next;
    return () => {
      if (target.current?.id === next.id) target.current = null;
    };
  }, []);
  const persist = useCallback(
    (next: RecordState) => {
      setRecord(next);
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* Connection remains usable on this page. */
      }
    },
    [storageKey],
  );
  useEffect(() => {
    setRecord(null);
    setStatus(null);
    setPairing(null);
    setOpen(false);
    ack.current = undefined;
    seen.current = [];
    if (!allowed || !ownerKey) return;
    let stopped = false,
      release: (() => void) | undefined;
    let saved: RecordState = { tabId: crypto.randomUUID(), linkId: null };
    try {
      const old = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
      if (old && uuid.test(old.tabId) && (!old.linkId || uuid.test(old.linkId))) saved = old;
    } catch {}
    // A duplicated tab gets its own connection; reloads retain the original one.
    const activate = (value: RecordState) => {
      if (!stopped) persist(value);
    };
    if (navigator.locks) {
      const acquire = (value: RecordState) =>
        navigator.locks.request(
          `eliza-phone-scanner:${ownerKey}:${value.tabId}`,
          { ifAvailable: true },
          async (lock) => {
            if (stopped) return;
            if (!lock) {
              void acquire({ tabId: crypto.randomUUID(), linkId: null });
              return;
            }
            activate(value);
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          },
        );
      void acquire(saved).catch(() => activate({ tabId: crypto.randomUUID(), linkId: null }));
    } else activate({ tabId: crypto.randomUUID(), linkId: null });
    return () => {
      stopped = true;
      release?.();
    };
  }, [allowed, ownerKey, storageKey, persist]);
  useEffect(() => {
    if (!allowed || !record?.linkId) return;
    const id = record.linkId;
    let stopped = false,
      timer: ReturnType<typeof setTimeout>,
      running = false;
    try {
      seen.current = JSON.parse(sessionStorage.getItem(`${storageKey}:seen:${id}`) ?? '[]')
        .filter((v: unknown) => typeof v === 'string')
        .slice(-64);
    } catch {
      seen.current = [];
    }
    const poll = async () => {
      if (stopped || running) return;
      running = true;
      try {
        const receiver = target.current,
          visible = document.visibilityState === 'visible',
          ackId = ack.current;
        const next = await api<ScannerDesktopStatus>(`/scanner-links/${id}/sync`, {
          targetId: receiver?.id ?? null,
          ready: !!receiver?.enabled && visible,
          label: receiver?.label ?? '',
          ...(ackId ? { ackId } : {}),
        });
        if (stopped) return;
        setStatus(next);
        setError(undefined);

        if (ack.current === ackId) ack.current = undefined;
        const event = next.event;
        if (
          event &&
          target.current?.id === event.targetId &&
          target.current.enabled &&
          document.visibilityState === 'visible'
        ) {
          if (seen.current.includes(event.id)) ack.current = event.id;
          else if (await target.current.receive(event.barcode)) {
            seen.current = [...seen.current, event.id].slice(-64);
            ack.current = event.id;
            try {
              sessionStorage.setItem(`${storageKey}:seen:${id}`, JSON.stringify(seen.current));
            } catch {}
          }
        }
      } catch (cause) {
        if (stopped) return;
        setError(cause);
        if (cause instanceof ApiError && [401, 403, 410].includes(cause.status)) {
          persist({ tabId: record.tabId, linkId: null });
          setStatus(null);
          setPairing(null);
        }
      } finally {
        running = false;
        if (!stopped) timer = setTimeout(() => void poll(), ack.current ? 150 : 1000);
      }
    };
    const pause = () => {
      if (document.visibilityState === 'visible') {
        clearTimeout(timer);
        void poll();
      } else
        void api(`/scanner-links/${id}/sync`, {
          targetId: target.current?.id ?? null,
          ready: false,
          label: target.current?.label ?? '',
        }).catch(() => {});
    };
    const pageHide = () => {
      void fetch(`/api/scanner-links/${id}/sync`, {
        method: 'POST',
        credentials: 'same-origin',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', 'X-Eliza-Request': '1' },
        body: JSON.stringify({ targetId: null, ready: false, label: '' }),
      }).catch(() => {});
    };
    void poll();
    document.addEventListener('visibilitychange', pause);
    window.addEventListener('pagehide', pageHide);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', pause);
      window.removeEventListener('pagehide', pageHide);
    };
  }, [allowed, record?.linkId, record?.tabId, storageKey, persist]);
  useEffect(() => {
    if (status?.claimed && pairing) {
      setPairing(null);
      setOpen(false);
    }
  }, [status?.claimed, pairing]);
  async function pair() {
    if (!record || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const next = await api<ScannerPair>('/scanner-links', { tabId: record.tabId });
      persist({ ...record, linkId: next.id });
      setPairing(next);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }
  function show() {
    setOpen(true);
    if (!status?.claimed && !pairing) void pair();
  }
  async function disconnect() {
    if (!record?.linkId || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await api(`/scanner-links/${record.linkId}/disconnect`, {});
      persist({ ...record, linkId: null });
      setStatus(null);
      setPairing(null);
      setOpen(false);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 410) {
        persist({ ...record, linkId: null });
        setStatus(null);
        setPairing(null);
      } else setError(cause);
    } finally {
      setBusy(false);
    }
  }
  const online = !!status?.phoneOnline && !error;
  const pairExpired = !!pairing && Date.parse(pairing.pairExpiresAt) <= Date.now();
  const url = pairing ? `${window.location.origin}/phone-scanner#pair=${pairing.pairingToken}` : '';
  return (
    <Context.Provider value={{ allowed, linked: !!record?.linkId, online, show, register }}>
      {children}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t('Phone as scanner')}
        description={t(
          'Connect once. Keep the phone scanner open while you create products on this laptop.',
        )}
      >
        <div className="phone-pairing">
          {pairing && (
            <>
              {pairExpired ? (
                <p className="notice">{t('Connection QR expired. Refresh it on this laptop.')}</p>
              ) : (
                <>
                  <div className="phone-pairing-qr">
                    <QRCodeSVG value={url} size={240} level="M" marginSize={4} />
                  </div>
                  <p>
                    {t(
                      'Scan this QR code with your phone camera to connect. The code is single-use and expires in 5 minutes.',
                    )}
                  </p>
                </>
              )}
              <Button variant="outline" disabled={busy} onClick={() => void pair()}>
                {t('Refresh connection QR')}
              </Button>
            </>
          )}
          {busy && <p role="status">{t('Connecting…')}</p>}
          {status?.claimed && (
            <div className="phone-connection-state" role="status">
              <Smartphone size={22} />
              <div>
                <strong>{t(online ? 'Phone connected' : 'Phone is offline')}</strong>
                <p>
                  {t(
                    'Creating the next product keeps this connection. Open a product form to receive barcodes.',
                  )}
                </p>
              </div>
            </div>
          )}
          {!pairing && !status?.claimed && !busy && (
            <Button onClick={() => void pair()} disabled={!record}>
              {t('Connect phone')}
            </Button>
          )}
          {!!error && (
            <p className="error" role="alert">
              {translateError(error instanceof Error ? error.message : String(error))}
            </p>
          )}
          {record?.linkId && (
            <Button variant="outline" disabled={busy} onClick={() => void disconnect()}>
              <Unplug size={16} />
              {t('Disconnect phone')}
            </Button>
          )}
          <p className="muted">
            {t('The phone can only send barcodes. Product review and saving stay on the laptop.')}
          </p>
          {['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname) && (
            <p className="notice">
              {t('For a real phone connection, open Eliza using its public HTTPS address.')}
            </p>
          )}
        </div>
      </Dialog>
    </Context.Provider>
  );
}
export function PhoneScannerStatus() {
  useLanguage();
  const scanner = useContext(Context);
  if (!scanner?.allowed || !scanner.linked) return null;
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="phone-scanner-header"
      aria-label={t(scanner.online ? 'Phone connected' : 'Phone scanner')}
      onClick={scanner.show}
    >
      <Smartphone size={16} />
      <span>{t(scanner.online ? 'Phone connected' : 'Phone scanner')}</span>
    </Button>
  );
}
export function PhoneScannerControl({
  onScan,
  disabled = false,
  label,
}: {
  onScan: (code: string) => boolean | Promise<boolean>;
  disabled?: boolean;
  label: string;
}) {
  useLanguage();
  const scanner = useContext(Context),
    root = useRef<HTMLDivElement>(null),
    handler = useRef(onScan);
  handler.current = onScan;
  const [id] = useState(() => crypto.randomUUID()),
    [sectionOpen, setSectionOpen] = useState(false);
  useEffect(() => {
    const details = root.current?.closest('details');
    const update = () => setSectionOpen(!details || details.open);
    update();
    details?.addEventListener('toggle', update);
    return () => details?.removeEventListener('toggle', update);
  }, []);
  useEffect(() => {
    if (!scanner?.allowed) return;
    return scanner.register({
      id,
      label,
      enabled: !disabled && sectionOpen,
      receive: (code) => handler.current(code),
    });
  }, [scanner?.allowed, scanner?.register, id, label, disabled, sectionOpen]);
  if (!scanner?.allowed) return null;
  return (
    <div className="phone-scanner-control" ref={root}>
      <Button type="button" variant="outline" size="sm" onClick={scanner.show}>
        <Smartphone size={16} />
        {t(scanner.online ? 'Phone connected' : 'Connect phone')}
      </Button>
      {scanner.online && (
        <small>
          {t(
            disabled
              ? 'Scanner paused while the form is busy.'
              : 'Scan a barcode on your phone to fill this form.',
          )}
        </small>
      )}
    </div>
  );
}
