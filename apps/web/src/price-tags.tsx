import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ScaleBarcodeSettings } from '@eliza/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { LockKeyhole, Printer } from 'lucide-react';
import { api, queryClient } from './api';
import { t, useLanguage } from './i18n';
import { Button } from './components/ui/button';
import { ErrorMessage } from './forms';
import { CameraBarcodeScanner } from './camera-barcode-scanner';
import { Ean13Barcode } from './ean13-barcode';
import './price-tags.css';

type Context = {
  device: { id: string; name: string };
  store: { name: string; currency: string; scaleBarcode: ScaleBarcodeSettings };
  employees: { name: string; employeeCode: string }[];
  operator: { id: string; name: string } | null;
};
type Product = {
  id: string;
  name: string;
  sku: string;
  price: string;
  unit: string;
  plu: string;
  barcode: string;
  barcodes: string[];
};

export function PriceTagsPage() {
  useLanguage();
  const context = useQuery({
    queryKey: ['price-tags-context'],
    queryFn: () => api<Context>('/price-tags/context'),
    refetchOnWindowFocus: true,
  });
  const products = useQuery({
    queryKey: ['price-tags-products'],
    queryFn: () => api<Product[]>('/price-tags/products'),
    enabled: !!context.data?.operator,
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [printItems, setPrintItems] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [weightProductId, setWeightProductId] = useState('');
  const [packageWeight, setPackageWeight] = useState('');
  const [weightLabel, setWeightLabel] = useState<{
    barcode: string;
    name: string;
    weight: string;
  } | null>(null);
  const [scanFeedback, setScanFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const scanSound = useRef<AudioContext | null>(null);
  useEffect(
    () => () => {
      void scanSound.current?.close();
    },
    [],
  );
  function prepareScanSound() {
    try {
      scanSound.current ??= new AudioContext();
      void scanSound.current.resume();
    } catch {
      // Product selection still works without audio output.
    }
  }
  function playScanSound(success: boolean) {
    const audio = scanSound.current;
    if (!audio) return;
    const start = audio.currentTime;
    for (const [index, frequency] of (success ? [880, 1320] : [330, 220]).entries()) {
      const oscillator = audio.createOscillator();
      const volume = audio.createGain();
      const from = start + index * 0.09;
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      volume.gain.setValueAtTime(0.0001, from);
      volume.gain.exponentialRampToValueAtTime(0.12, from + 0.01);
      volume.gain.exponentialRampToValueAtTime(0.0001, from + 0.08);
      oscillator.connect(volume).connect(audio.destination);
      oscillator.start(from);
      oscillator.stop(from + 0.09);
    }
  }
  function selectScannedProduct(code: string) {
    setSearch(code);
    const matching = (products.data ?? []).filter(
      (product) => (product.barcodes ?? []).includes(code) || product.barcode === code,
    );
    if (matching.length !== 1) {
      setScanFeedback({
        type: 'error',
        text: t(
          matching.length
            ? 'This code matches multiple products. Select the correct product below.'
            : 'No active product matches this barcode. Check the code or select a product.',
        ),
      });
      playScanSound(false);
      return;
    }
    const product = matching[0];
    setSelected((before) => (before.includes(product.id) ? before : [...before, product.id]));
    setScanFeedback({
      type: 'success',
      text: t('Selected for printing: {value0}', { value0: product.name }),
    });
    playScanSound(true);
  }
  const login = useMutation({
    mutationFn: (body: unknown) => api('/price-tags/login', body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['price-tags-context'] }),
  });
  const print = useMutation({
    mutationFn: (productIds: string[]) =>
      api<{ products: Product[] }>('/price-tags/prints', { productIds }),
    onSuccess: (result) => {
      setPrintItems(result.products);
      requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
    },
  });
  const createWeightLabel = useMutation({
    mutationFn: (input: { productId: string; weight: string }) =>
      api<{ barcode: string; name: string; weight: string }>('/price-tags/weight-barcode', input),
    onSuccess: setWeightLabel,
  });
  const lock = useMutation({
    mutationFn: () => api('/price-tags/lock', {}),
    onSuccess: () => {
      setSelected([]);
      setWeightLabel(null);
      setWeightProductId('');
      setPackageWeight('');
      void queryClient.invalidateQueries({ queryKey: ['price-tags-context'] });
    },
  });
  if (context.isPending) return <div className="price-tags-shell">{t('Loading…')}</div>;
  if (context.error)
    return (
      <div className="price-tags-shell">
        <ErrorMessage error={context.error} />
        <p>{t('Ask a manager to assign this device to Price Tags in Devices.')}</p>
      </div>
    );
  const value = context.data!;
  if (!value.operator)
    return (
      <div className="price-tags-shell price-tags-login">
        <LockKeyhole size={32} />
        <h1>{t('Price Tags')}</h1>
        <p>
          {value.store.name} · {value.device.name}
        </p>
        <form
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            login.mutate({ employeeCode: data.get('employeeCode'), pin: data.get('pin') });
          }}
        >
          <label>
            {t('Employee')}
            <select name="employeeCode" required defaultValue="">
              <option value="" disabled>
                {t('Select your name')}
              </option>
              {value.employees.map((employee) => (
                <option key={employee.employeeCode} value={employee.employeeCode}>
                  {employee.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('PIN')}
            <input
              name="pin"
              type="password"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              autoComplete="off"
            />
          </label>
          <ErrorMessage error={login.error} />
          <Button disabled={login.isPending || !value.employees.length}>
            {t('Unlock Price Tags')}
          </Button>
        </form>
        {!value.employees.length && (
          <p>{t('No General employees are assigned. Ask a manager to assign the role in Team.')}</p>
        )}
        <a href="/management-access?from=price-tags">{t('Management sign in')}</a>
      </div>
    );
  const all = products.data ?? [];
  const visible = all.filter((product) =>
    [product.name, product.sku, product.barcode, product.plu, ...(product.barcodes ?? [])].some(
      (text) => text?.toLowerCase().includes(search.toLowerCase()),
    ),
  );
  const weightProducts = all.filter(
    (product) => product.unit === 'kilogram' && /^\d+$/.test(product.plu),
  );
  const chosen = selected
    .map((id) => all.find((product) => product.id === id))
    .filter((product): product is Product => !!product);
  const price = (amount: string) =>
    new Intl.NumberFormat(undefined, { style: 'currency', currency: value.store.currency }).format(
      Number(amount),
    );
  return (
    <div className="price-tags-shell">
      <header className="price-tags-header">
        <div>
          <h1>{t('Price Tags')}</h1>
          <p>
            {value.store.name} · {value.device.name} · {value.operator.name}
          </p>
        </div>
        <Button variant="outline" onClick={() => lock.mutate()} disabled={lock.isPending}>
          {t('Lock')}
        </Button>
        <a href="/management-access?from=price-tags">{t('Management sign in')}</a>
      </header>
      <div className="price-tags-controls">
        <div className="price-tags-search-field">
          <label htmlFor="price-tags-search">{t('Find products')}</label>
          <div className="price-tags-search-row">
            <input
              id="price-tags-search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setScanFeedback(null);
              }}
              placeholder={t('Name, SKU, PLU or barcode')}
            />
            <CameraBarcodeScanner
              inline
              continuous
              disabled={products.isPending || !!products.error}
              onOpen={prepareScanSound}
              onScan={selectScannedProduct}
            />
          </div>
        </div>
      </div>
      {scanFeedback && (
        <p className={`price-tags-scan-feedback ${scanFeedback.type}`} role="status">
          {scanFeedback.text}
        </p>
      )}
      <ErrorMessage error={products.error ?? print.error} />
      <section className="weight-label-panel" aria-labelledby="weight-label-title">
        <h2 id="weight-label-title">{t('Weight barcode for a package')}</h2>
        <p>
          {t(
            'Choose the original product and enter the measured net weight. At checkout, scanning the code adds exactly this weight in kilograms.',
          )}
        </p>
        {!value.store.scaleBarcode.enabled || value.store.scaleBarcode.mode !== 'weight' ? (
          <p className="price-tags-scan-feedback error">
            {t('Ask a manager to enable weight barcodes in Store settings.')}
          </p>
        ) : (
          <form
            className="weight-label-form"
            onSubmit={(event) => {
              event.preventDefault();
              setWeightLabel(null);
              createWeightLabel.mutate({
                productId: weightProductId,
                weight: packageWeight.trim().replace(',', '.'),
              });
            }}
          >
            <label>
              {t('Product sold by kilogram')}
              <select
                required
                disabled={createWeightLabel.isPending}
                value={weightProductId}
                onChange={(event) => {
                  setWeightProductId(event.target.value);
                  setWeightLabel(null);
                }}
              >
                <option value="">{t('Choose product…')}</option>
                {weightProducts.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} · PLU {product.plu}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('Net weight (kg)')}
              <input
                required
                disabled={createWeightLabel.isPending}
                inputMode="decimal"
                pattern="[0-9]+([.,][0-9]{1,3})?"
                placeholder="0.500"
                value={packageWeight}
                onChange={(event) => {
                  setPackageWeight(event.target.value);
                  setWeightLabel(null);
                }}
              />
            </label>
            <Button disabled={!weightProducts.length || createWeightLabel.isPending}>
              {t('Generate weight barcode')}
            </Button>
          </form>
        )}
        {!products.isPending &&
          !products.error &&
          !weightProducts.length &&
          value.store.scaleBarcode.enabled && (
            <p className="muted">{t('Add an active kilogram product with a numeric PLU first.')}</p>
          )}
        <ErrorMessage error={createWeightLabel.error} />
        {weightLabel && (
          <div className="weight-label-result" role="status">
            <strong>
              {weightLabel.name} · {weightLabel.weight} {t('kg')}
            </strong>
            <Ean13Barcode code={weightLabel.barcode} />
            <code>{weightLabel.barcode}</code>
          </div>
        )}
      </section>
      <div className="price-tags-product-list">
        {visible.map((product) => (
          <label key={product.id} className="price-tags-product">
            <input
              type="checkbox"
              checked={selected.includes(product.id)}
              onChange={(event) =>
                setSelected((before) =>
                  event.target.checked
                    ? [...before, product.id]
                    : before.filter((id) => id !== product.id),
                )
              }
            />
            <span>
              <strong>{product.name}</strong>
              <small>
                {product.sku} · {product.barcode || product.plu}
              </small>
            </span>
            <b>{price(product.price)}</b>
          </label>
        ))}
      </div>
      <div className="price-tags-print-action">
        <Button
          onClick={() => print.mutate(chosen.map((product) => product.id))}
          disabled={!chosen.length || print.isPending}
        >
          <Printer size={17} /> {t('Print selected tags')} ({chosen.length})
        </Button>
      </div>
      <div className="price-tags-print-sheet">
        {printItems.map((product) => (
          <article key={product.id} className="price-tag">
            <strong>{product.name}</strong>
            <div className="price-tag-price">{price(product.price)}</div>
            <small>
              {product.unit} · {product.barcode || product.plu || product.sku}
            </small>
          </article>
        ))}
      </div>
    </div>
  );
}
