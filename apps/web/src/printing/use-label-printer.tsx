import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { labelBytes, renderLabel, type LabelContent } from './label-image';
import {
  p1Characteristic,
  p1Service,
  printerBluetooth,
  sendLabel,
  type PrintSpeed,
  type PrinterCharacteristic,
  type PrinterDevice,
} from './p1';

export function useLabelPrinter(busy: boolean) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'browser' | 'p1'>(() => {
    try {
      return localStorage.getItem('eliza:label-printer-mode') === 'p1' ? 'p1' : 'browser';
    } catch {
      return 'browser';
    }
  });
  const [speed, setSpeed] = useState<PrintSpeed>(() => {
    try {
      return localStorage.getItem('eliza:label-printer-speed') === 'compatible'
        ? 'compatible'
        : 'fast';
    } catch {
      return 'fast';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('eliza:label-printer-speed', speed);
    } catch {
      /* Optional preference. */
    }
  }, [speed]);
  const [gap, setGap] = useState(() => {
    try {
      const saved = localStorage.getItem('eliza:label-printer-gap');
      return saved && Number(saved) >= 0.5 && Number(saved) <= 6 ? saved : '2';
    } catch {
      return '2';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('eliza:label-printer-gap', gap);
    } catch {
      /* Optional local preference. */
    }
  }, [gap]);
  const [device, setDevice] = useState<PrinterDevice | null>(null);
  const [connected, setConnected] = useState(false);
  const [working, setWorking] = useState(false);
  const [connectionStage, setConnectionStage] = useState<'choosing' | 'connecting' | null>(null);
  const feedback = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const channel = useRef<PrinterCharacteristic | null>(null);
  const sending = useRef(false);
  const preview = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!device) return;
    const lost = () => {
      channel.current = null;
      setConnected(false);
    };
    device.addEventListener('gattserverdisconnected', lost);
    return () => {
      device.removeEventListener('gattserverdisconnected', lost);
      device.gatt?.disconnect();
    };
  }, [device]);
  useEffect(() => {
    if (open && preview.current)
      preview.current.replaceChildren(
        renderLabel({
          name: t('Test label'),
          price: '123.45',
          barcode: '0400000000046',
          details: ['Eliza · P1', '50 × 60 mm'],
        }),
      );
  }, [open, mode]);
  function selectMode(value: 'browser' | 'p1') {
    setMode(value);
    try {
      localStorage.setItem('eliza:label-printer-mode', value);
    } catch {
      /* Selection works without storage. */
    }
  }
  useEffect(() => {
    if (error || message || connectionStage) feedback.current?.scrollIntoView({ block: 'nearest' });
  }, [error, message, connectionStage]);
  async function connect() {
    if (working || busy) return;
    setWorking(true);
    setError('');
    setMessage('');
    let selected: PrinterDevice | undefined;
    try {
      const bluetooth = printerBluetooth();
      if (!window.isSecureContext)
        throw new Error(
          t('Bluetooth requires a secure HTTPS page. Open the HTTPS address of Eliza in Chrome.'),
        );
      if (!bluetooth)
        throw new Error(
          t(
            'Bluetooth printing is unavailable in this browser. Open Eliza directly in Chrome on Android, not inside another app.',
          ),
        );
      setConnectionStage('choosing');
      channel.current = null;
      setConnected(false);
      device?.gatt?.disconnect();
      selected = await bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [p1Service],
      });
      if (!selected.gatt)
        throw new Error(t('This printer does not support the P1 Bluetooth connection.'));
      setConnectionStage('connecting');
      const server = await selected.gatt.connect();
      const service = await server.getPrimaryService(p1Service);
      const characteristic = await service.getCharacteristic(p1Characteristic);
      if (!characteristic.properties.write && !characteristic.properties.writeWithoutResponse)
        throw new Error(t('This printer does not support the P1 Bluetooth connection.'));
      setDevice(selected);
      channel.current = characteristic;
      setConnected(true);
      selectMode('p1');
    } catch (err) {
      selected?.gatt?.disconnect();
      if (!selected && err instanceof DOMException && err.name === 'NotFoundError') {
        setMessage(
          t(
            'No printer selected. Close Toprint, restart the printer and check Chrome’s Nearby devices permission, then try again.',
          ),
        );
      } else if (
        err instanceof DOMException &&
        ['SecurityError', 'NotAllowedError'].includes(err.name)
      ) {
        setError(
          t(
            'Bluetooth access was blocked. Open Eliza directly in Chrome and allow Nearby devices in Android settings for Chrome.',
          ),
        );
      } else if (selected && err instanceof DOMException && err.name === 'NotFoundError') {
        setError(
          t(
            'The printer was found, but its P1 / TSPL service is unavailable. This firmware may need a different printer profile.',
          ),
        );
      } else {
        setError(err instanceof Error ? err.message : t('Could not connect to the printer.'));
      }
    } finally {
      setConnectionStage(null);
      setWorking(false);
    }
  }
  async function printLabels(labels: LabelContent[]) {
    if (sending.current) throw new Error(t('A print job is already running.'));
    if (!connected || !device?.gatt?.connected || !channel.current)
      throw new Error(t('Connect the P1 printer before printing.'));
    const gapMm = Number(gap.replace(',', '.'));
    // Render and validate the entire job before transmitting anything.
    const jobs = labels.map((label) => labelBytes(renderLabel(label), gapMm, speed === 'fast'));
    sending.current = true;
    setWorking(true);
    setMessage('');
    try {
      for (const job of jobs) {
        if (!device.gatt.connected || !channel.current)
          throw new Error(
            t(
              'Printer disconnected. Check the labels before retrying; do not attach duplicate markdown barcodes.',
            ),
          );
        await sendLabel(channel.current, job, undefined, speed);
      }
      setMessage(
        t('Sent to printer. Check the physical labels; Bluetooth does not confirm printing.'),
      );
    } catch {
      throw new Error(
        t(
          'Printing was interrupted. Check the labels before retrying; do not attach duplicate markdown barcodes.',
        ),
      );
    } finally {
      sending.current = false;
      setWorking(false);
    }
  }
  const controls = (
    <>
      <Button variant="outline" disabled={busy || working} onClick={() => setOpen(true)}>
        {t('Printer')}:{' '}
        {mode === 'p1'
          ? connected
            ? (device?.name ?? 'P1')
            : t('Not connected')
          : t('Browser printing')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!working && !busy) setOpen(value);
        }}
        title={t('Label printer')}
        description={t(
          'Connect on this Android device. A manager’s laptop cannot connect the printer for this device.',
        )}
      >
        <div className="label-printer-settings">
          <label>
            {t('Print using')}
            <select
              value={mode}
              disabled={busy || working}
              onChange={(e) => selectMode(e.target.value as 'browser' | 'p1')}
            >
              <option value="browser">{t('Browser printing')}</option>
              <option value="p1">P1 Bluetooth · 50 × 60 mm</option>
            </select>
          </label>
          {mode === 'p1' && (
            <>
              <p className="muted">
                {t(
                  'Experimental P1 / TSPL support. Close Toprint before connecting. Confirm compatibility with one test label first.',
                )}
              </p>
              <div ref={feedback} className="label-printer-feedback">
                {connectionStage && (
                  <p role="status">
                    {connectionStage === 'choosing'
                      ? t(
                          'Choose your P1 in Chrome’s Bluetooth device window. Pairing in Android settings alone does not connect Eliza.',
                        )
                      : t('Connecting to the selected printer…')}
                  </p>
                )}
                {working && !connectionStage && (
                  <p role="status">
                    {t('Sending to printer. Keep this screen open until the transfer finishes.')}
                  </p>
                )}
                {message && <p role="status">{message}</p>}
                {error && (
                  <p role="alert" className="error">
                    {error}
                  </p>
                )}
              </div>
              <p role="status">
                {connected ? `${t('Connected')}: ${device?.name ?? 'P1'}` : t('Not connected')}
              </p>
              <label>
                {t('Gap between labels (mm)')}
                <input
                  type="number"
                  min="0.5"
                  max="6"
                  step="0.1"
                  value={gap}
                  disabled={working || busy}
                  onChange={(e) => setGap(e.target.value)}
                />
              </label>
              <label>
                {t('Print speed')}
                <select
                  value={speed}
                  disabled={working || busy}
                  onChange={(event) => setSpeed(event.target.value as PrintSpeed)}
                >
                  <option value="fast">{t('Fast')}</option>
                  <option value="compatible">{t('Compatibility (slower)')}</option>
                </select>
              </label>
              <small className="muted">
                {t(
                  'Fast mode sends less image data without reducing barcode quality. If labels are incomplete, restart the printer and try Compatibility mode.',
                )}
              </small>
              <small className="muted">
                {t(
                  'Label size is 50 × 60 mm. The 2 mm gap is a starting value; measure the gap on your roll.',
                )}
              </small>
              <div className="label-printer-buttons">
                <Button disabled={working || busy} onClick={() => void connect()}>
                  {t('Connect printer')}
                </Button>
                <Button
                  variant="outline"
                  disabled={!connected || working || busy}
                  onClick={() => {
                    device?.gatt?.disconnect();
                    channel.current = null;
                    setConnected(false);
                  }}
                >
                  {t('Disconnect printer')}
                </Button>
                <Button
                  variant="outline"
                  disabled={!connected || working || busy}
                  onClick={() => {
                    setError('');
                    void printLabels([
                      {
                        name: t('Test label'),
                        price: '123.45',
                        barcode: '0400000000046',
                        details: ['Eliza · P1', '50 × 60 mm'],
                      },
                    ]).catch((err) => setError(err.message));
                  }}
                >
                  {t('Print test label')}
                </Button>
              </div>
              <div className="label-printer-preview" ref={preview} />
            </>
          )}
        </div>
      </Dialog>
    </>
  );
  return { mode, connected, working, printLabels, controls };
}
