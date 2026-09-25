import { useEffect, useRef, useState } from 'react';
import type { IScannerControls } from '@zxing/browser';
import { ScanLine, X } from 'lucide-react';
import { t, useLanguage } from './i18n';
import { Dialog } from './components/ui/dialog';

export function CameraBarcodeScanner({
  onScan,
  disabled = false,
  continuous = false,
  inline = false,
  onOpen,
}: {
  onScan: (barcode: string) => void;
  disabled?: boolean;
  continuous?: boolean;
  inline?: boolean;
  onOpen?: () => void;
}) {
  useLanguage();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let controls: IScannerControls | undefined;
    let detected = false;
    let lastCode = '';
    let lastSeenAt = 0;
    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(
          t('Camera access is unavailable. Use HTTPS or localhost and allow camera access.'),
        );
        return;
      }
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        if (cancelled) return;
        const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 250 });
        controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' } }, audio: false },
          videoRef.current ?? undefined,
          (result) => {
            if (cancelled || detected) return;
            if (!result) {
              if (Date.now() - lastSeenAt > 650) lastCode = '';
              return;
            }
            const code = result.getText().trim();
            if (!code) return;
            lastSeenAt = Date.now();
            if (continuous && code === lastCode) return;
            lastCode = code;
            if (!continuous) detected = true;
            onScanRef.current(code);
            if (!continuous) setOpen(false);
          },
        );
        if (cancelled) controls.stop();
      } catch (cause) {
        if (!cancelled)
          setError(
            cause instanceof Error && cause.name === 'NotAllowedError'
              ? t('Camera permission was denied. Allow camera access in your browser settings.')
              : t('Could not start the camera. Check that it is connected and not in use.'),
          );
      }
    };
    void start();
    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [open, continuous]);

  const preview = (
    <div className="camera-scan-preview">
      <video ref={videoRef} autoPlay muted playsInline aria-label={t('Camera preview')} />
      <span className="camera-scan-target" aria-hidden="true" />
    </div>
  );
  return (
    <>
      <button
        type="button"
        className="camera-scan-button"
        aria-label={t(open && inline ? 'Close camera' : 'Scan with camera')}
        title={t(open && inline ? 'Close camera' : 'Scan with camera')}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          setError('');
          onOpen?.();
          setOpen(true);
        }}
      >
        {open && inline ? (
          <X size={18} aria-hidden="true" />
        ) : (
          <ScanLine size={18} aria-hidden="true" />
        )}
      </button>
      {inline ? (
        open && (
          <div className="camera-scan-inline">
            <p>
              {t(
                'Point your camera at each barcode. Scanning continues until you close the camera.',
              )}
            </p>
            {preview}
            {error && <p role="alert">{error}</p>}
          </div>
        )
      ) : (
        <Dialog
          open={open}
          onOpenChange={setOpen}
          title={t('Scan barcode with camera')}
          description={t(
            continuous
              ? 'Point your camera at each barcode. Scanning continues until you close this window.'
              : 'Point your camera at a barcode. The code will fill this field automatically.',
          )}
        >
          {preview}
          {error && <p role="alert">{error}</p>}
        </Dialog>
      )}
    </>
  );
}
