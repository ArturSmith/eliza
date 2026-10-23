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
  async function connect() {
    if (working || busy) return;
    setWorking(true);
    setError('');
    setMessage('');
    let selected: PrinterDevice | undefined;
    try {
      const bluetooth = printerBluetooth();
      if (!window.isSecureContext || !bluetooth)
        throw new Error(t('Use Chrome on Android over HTTPS to connect a Bluetooth printer.'));
      channel.current = null;
      setConnected(false);
      device?.gatt?.disconnect();
      selected = await bluetooth.requestDevice({
        filters: [{ namePrefix: 'P1' }, { services: [p1Service] }],
        optionalServices: [p1Service],
      });
      if (!selected.gatt)
        throw new Error(t('This printer does not support the P1 Bluetooth connection.'));
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
      if (selected || !(err instanceof DOMException && err.name === 'NotFoundError'))
        setError(err instanceof Error ? err.message : t('Could not connect to the printer.'));
    } finally {
      setWorking(false);
    }
  }
  async function printLabels(labels: LabelContent[]) {
    if (sending.current) throw new Error(t('A print job is already running.'));
    if (!connected || !device?.gatt?.connected || !channel.current)
      throw new Error(t('Connect the P1 printer before printing.'));
    const gapMm = Number(gap.replace(',', '.'));
    // Render and validate the entire job before transmitting anything.
    const jobs = labels.map((label) => labelBytes(renderLabel(label), gapMm));
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
        await sendLabel(channel.current, job);
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
          {working && (
            <p role="status">
              {t('Sending to printer. Keep this screen open; a label may take about 40 seconds.')}
            </p>
          )}
          {message && <p role="status">{message}</p>}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </div>
      </Dialog>
    </>
  );
  return { mode, connected, working, printLabels, controls };
}
