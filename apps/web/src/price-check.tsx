import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ScanLine, Tag } from 'lucide-react';
import { api } from './api';
import { CameraBarcodeScanner } from './camera-barcode-scanner';
import { t, translateError, useLanguage } from './i18n';
import { formatMoney } from './receipts';
import './price-check.css';

type CheckedProduct = {
  name: string;
  unit: string;
  price: string;
  regularPrice: string | null;
  discountType: 'markdown' | 'promotion' | null;
  quantity: string | null;
  totalPrice: string | null;
};

export function PriceCheckPage() {
  useLanguage();
  const context = useQuery({
    queryKey: ['price-check-context'],
    queryFn: () => api<{ storeName: string; currency: string }>('/price-check/context'),
    refetchOnWindowFocus: true,
  });
  const [code, setCode] = useState('');
  const [product, setProduct] = useState<CheckedProduct | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const audio = useRef<AudioContext | null>(null);
  const request = useRef(0);

  useEffect(() => {
    if (context.data) input.current?.focus();
  }, [context.data]);
  useEffect(
    () => () => {
      void audio.current?.close();
    },
    [],
  );

  function prepareAudio() {
    try {
      audio.current ??= new AudioContext();
      void audio.current.resume().catch(() => {});
    } catch {
      // The visual result remains available when sound is blocked by the browser.
    }
  }
  function signal(success: boolean) {
    const output = audio.current;
    if (!output) return;
    const start = output.currentTime;
    for (const [index, frequency] of (success ? [880, 1320] : [330, 220]).entries()) {
      const oscillator = output.createOscillator();
      const volume = output.createGain();
      const at = start + index * 0.09;
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      volume.gain.setValueAtTime(0.0001, at);
      volume.gain.exponentialRampToValueAtTime(0.12, at + 0.01);
      volume.gain.exponentialRampToValueAtTime(0.0001, at + 0.08);
      oscillator.connect(volume).connect(output.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.09);
    }
  }
  async function scan(value: string) {
    const barcode = value.trim();
    if (!barcode) return;
    prepareAudio();
    const current = ++request.current;
    setCode('');
    setProduct(null);
    setMessage('');
    setBusy(true);
    try {
      const found = await api<CheckedProduct>(
        '/price-check/lookup?code=' + encodeURIComponent(barcode),
      );
      if (current !== request.current) return;
      setProduct(found);
      signal(true);
    } catch (error) {
      if (current !== request.current) return;
      setMessage(
        error instanceof Error ? translateError(error.message) : t('Could not check the price.'),
      );
      signal(false);
    } finally {
      if (current === request.current) {
        setBusy(false);
        input.current?.focus();
      }
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void scan(code);
  }
  const currency = context.data?.currency ?? 'USD';
  return (
    <main className="price-check-screen">
      <div className="price-check-content">
        <header className="price-check-header">
          <span className="price-check-mark">
            <Tag size={30} aria-hidden="true" />
          </span>
          <div>
            <p className="price-check-store">{context.data?.storeName ?? t('Price checker')}</p>
            <h1>{t('Check a price')}</h1>
          </div>
        </header>
        {context.error ? (
          <section className="price-check-result price-check-error" role="alert">
            {translateError(context.error.message)}
          </section>
        ) : (
          <>
            <form className="price-check-form" onSubmit={submit}>
              <label htmlFor="price-check-barcode">{t('Scan the product barcode')}</label>
              <div className="price-check-input-row">
                <ScanLine size={28} aria-hidden="true" />
                <input
                  id="price-check-barcode"
                  ref={input}
                  value={code}
                  autoComplete="off"
                  autoFocus
                  disabled={!context.data}
                  inputMode="none"
                  maxLength={100}
                  placeholder={t('Ready to scan')}
                  onFocus={prepareAudio}
                  onChange={(event) => setCode(event.target.value)}
                />
                <CameraBarcodeScanner
                  disabled={!context.data}
                  onScan={(value) => void scan(value)}
                  onOpen={prepareAudio}
                  continuous
                />
              </div>
              <button
                type="submit"
                className="price-check-submit"
                disabled={!context.data || !code.trim()}
              >
                {t('Check price')}
              </button>
            </form>
            <section
              className={`price-check-result${message ? ' price-check-error' : ''}`}
              aria-live="polite"
            >
              {busy ? (
                <p className="price-check-placeholder">{t('Checking price…')}</p>
              ) : message ? (
                <p role="alert">{message}</p>
              ) : product ? (
                <div className="price-check-product">
                  {product.discountType && (
                    <span className="price-check-badge">
                      {t(product.discountType === 'markdown' ? 'Reduced price' : 'Promotion')}
                    </span>
                  )}
                  <h2>{product.name}</h2>
                  {product.regularPrice && product.regularPrice !== product.price && (
                    <p className="price-check-regular">
                      {t('Regular price')}: <s>{formatMoney(product.regularPrice, currency)}</s>
                    </p>
                  )}
                  <p className="price-check-price">
                    {formatMoney(product.price, currency)}
                    <span> / {t(product.unit)}</span>
                  </p>
                  {product.quantity && product.totalPrice && (
                    <p className="price-check-weight">
                      {product.quantity} {t('kg')} · {t('Package price')}:{' '}
                      <strong>{formatMoney(product.totalPrice, currency)}</strong>
                    </p>
                  )}
                </div>
              ) : (
                <p className="price-check-placeholder">
                  {t('Scan a product to see its current price.')}
                </p>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
