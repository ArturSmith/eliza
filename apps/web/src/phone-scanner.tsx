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
import {
  fillScanField,
  isScanField,
  scanFieldLabel,
  scanFieldReady,
  scanFieldVisible,
  type ScanField,
} from './phone-scan-fields';
import './phone-scanner.css';
type Target = { id: string; field: ScanField };
type RecordState = { tabId: string; linkId: string | null };
type ScannerContext = {
  allowed: boolean;
  linked: boolean;
  online: boolean;
  claimed: boolean;
  initializing: boolean;
  show: () => void;
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
    cancel = useRef<string | undefined>(undefined),
    wake = useRef<(() => void) | null>(null),
    linked = useRef(false),
    seen = useRef<string[]>([]);
  linked.current = !!record?.linkId;
  useEffect(() => {
    if (record?.linkId) target.current?.field.setAttribute('data-phone-scanner-target', 'true');
    else target.current?.field.removeAttribute('data-phone-scanner-target');
  }, [record?.linkId]);
  useEffect(() => {
    if (!allowed) return;
    const select = (field: ScanField | null) => {
      if (field === target.current?.field) return;
      target.current?.field.removeAttribute('data-phone-scanner-target');
      target.current = field ? { id: crypto.randomUUID(), field } : null;
      if (linked.current) field?.setAttribute('data-phone-scanner-target', 'true');
      wake.current?.();
    };
    const focused = (event: FocusEvent) => {
      const field = event.target;
      if (isScanField(field)) select(scanFieldVisible(field) ? field : null);
      else if (
        field instanceof HTMLInputElement ||
        field instanceof HTMLSelectElement ||
        field instanceof HTMLTextAreaElement
      )
        select(null);
    };
    const control = (event: Event) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-scan-control]'))
        return;
      const field = event.target.closest('.scan-input-row')?.querySelector('input, textarea');
      if (isScanField(field) && scanFieldVisible(field)) select(field);
    };
    const submitted = () => select(null);
    const observer = new MutationObserver(() => {
      if (target.current && !scanFieldVisible(target.current.field)) select(null);
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['readonly', 'hidden', 'open', 'inert', 'style', 'class'],
    });
    document.addEventListener('focusin', focused, true);
    document.addEventListener('pointerdown', control, true);
    document.addEventListener('click', control, true);
    document.addEventListener('submit', submitted, true);
    if (isScanField(document.activeElement)) select(document.activeElement);
    return () => {
      observer.disconnect();
      document.removeEventListener('focusin', focused, true);
      document.removeEventListener('pointerdown', control, true);
      document.removeEventListener('click', control, true);
      document.removeEventListener('submit', submitted, true);
      target.current?.field.removeAttribute('data-phone-scanner-target');
      target.current = null;
    };
  }, [allowed, ownerKey]);
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
    cancel.current = undefined;
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
      running = false,
      urgent = false;
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
          ackId = ack.current,
          cancelId = cancel.current;
        const next = await api<ScannerDesktopStatus>(`/scanner-links/${id}/sync`, {
          targetId: receiver?.id ?? null,
          ready: !!receiver && scanFieldReady(receiver.field) && visible,
          label: receiver ? scanFieldLabel(receiver.field) || t('Text field') : '',
          ...(ackId ? { ackId } : {}),
          ...(cancelId ? { cancelId } : {}),
        });
        if (stopped) return;
        setStatus(next);
        setError(undefined);

        if (ack.current === ackId) ack.current = undefined;
        if (cancel.current === cancelId) cancel.current = undefined;
        const event = next.event;
        if (
          event &&
          target.current?.id === event.targetId &&
          target.current === receiver &&
          scanFieldReady(receiver.field) &&
          document.visibilityState === 'visible'
        ) {
          if (seen.current.includes(event.id)) ack.current = event.id;
          else {
            const result = await fillScanField(receiver.field, event.barcode);
            if (result === 'rejected') cancel.current = event.id;
            else if (result) {
              seen.current = [...seen.current, event.id].slice(-64);
              ack.current = event.id;
              try {
                sessionStorage.setItem(`${storageKey}:seen:${id}`, JSON.stringify(seen.current));
              } catch {}
            }
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
        if (!stopped)
          timer = setTimeout(
            () => void poll(),
            urgent ? 0 : ack.current || cancel.current ? 150 : 1000,
          );
        urgent = false;
      }
    };
    const syncNow = () => {
      clearTimeout(timer);
      if (running) urgent = true;
      else void poll();
    };
    wake.current = syncNow;
    const pause = () => {
      if (document.visibilityState === 'visible') {
        clearTimeout(timer);
        void poll();
      } else
        void api(`/scanner-links/${id}/sync`, {
          targetId: target.current?.id ?? null,
          ready: false,
          label: target.current ? scanFieldLabel(target.current.field) : '',
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
      wake.current = null;
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
    <Context.Provider
      value={{
        allowed,
        linked: !!record?.linkId,
        online,
        claimed: !!status?.claimed,
        initializing: !record || (!!record.linkId && !status && !error),
        show,
      }}
    >
      {children}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t('Phone as scanner')}
        description={t(
          'Connect once. Select a text field on the laptop, then scan with your phone.',
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
                    'Select an editable text field on the laptop. The connection stays active between products.',
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
            {t(
              'The phone sends scanned text to the selected field. Review and saving stay on the laptop.',
            )}
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
export function PhoneScannerDeviceCard() {
  useLanguage();
  const scanner = useContext(Context);
  if (!scanner?.allowed) return null;
  const status = scanner.initializing
    ? 'Connecting…'
    : !scanner.linked
      ? 'Not connected'
      : !scanner.claimed
        ? 'Waiting for phone'
        : scanner.online
          ? 'Phone connected'
          : 'Phone is offline';
  return (
    <section
      className="panel device-card phone-scanner-device-card"
      aria-label={t('Phone as scanner')}
    >
      <div className="device-card-top">
        <span className="icon-tile">
          <Smartphone size={24} />
        </span>
        <span className={'badge badge-' + (scanner.online ? 'green' : 'gray')} role="status">
          {t(status)}
        </span>
      </div>
      <h2>{t('Phone as scanner')}</h2>
      <p className="muted">
        {t(
          'Connect your phone here once, then scan into the selected field on any management page.',
        )}
      </p>
      <small>
        {t('The connection belongs to this browser tab. Keep the scanner open on your phone.')}
      </small>
      <Button
        type="button"
        variant="outline"
        disabled={scanner.initializing}
        onClick={scanner.show}
      >
        <Smartphone size={16} />
        {t(scanner.linked ? 'Manage scanner connection' : 'Connect phone')}
      </Button>
    </section>
  );
}
