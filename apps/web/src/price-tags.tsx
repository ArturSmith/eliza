import { useEffect, useRef, useState, type FormEvent } from 'react';
import { toScaled, fromScaled, type ScaleBarcodeSettings, type TagDesign } from '@eliza/contracts';
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
  store: {
    name: string;
    currency: string;
    scaleBarcode: ScaleBarcodeSettings;
    tagDesign: TagDesign;
  };
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

type WeightLabel = { barcode: string; name: string; sku: string; price: string; weight: string };
type PrintItem = { product: Product; weightLabel?: WeightLabel };

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
  const [packageWeights, setPackageWeights] = useState<Record<string, string>>({});
  const [printItems, setPrintItems] = useState<PrintItem[]>([]);
  const [search, setSearch] = useState('');
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
      text:
        product.unit === 'kilogram'
          ? t('Enter package weight for {value0}', { value0: product.name })
          : t('Selected for printing: {value0}', { value0: product.name }),
    });
    playScanSound(true);
  }
  const login = useMutation({
    mutationFn: (body: unknown) => api('/price-tags/login', body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['price-tags-context'] }),
  });
  const print = useMutation({
    mutationFn: async (items: Product[]) => {
      const regular = items.filter((product) => product.unit !== 'kilogram');
      const weighted = items.filter((product) => product.unit === 'kilogram');
      const [regularResult, ...weightResults] = await Promise.all([
        regular.length
          ? api<{ products: Product[] }>('/price-tags/prints', {
              productIds: regular.map((product) => product.id),
            })
          : Promise.resolve({ products: [] as Product[] }),
        ...weighted.map((product) =>
          api<WeightLabel>('/price-tags/weight-barcode', {
            productId: product.id,
            weight: packageWeights[product.id].trim().replace(',', '.'),
          }),
        ),
      ]);
      const regularById = new Map(regularResult.products.map((product) => [product.id, product]));
      const weightedById = new Map(
        weighted.map((product, index) => [product.id, weightResults[index]]),
      );
      return items.map((product) => ({
        product: regularById.get(product.id) ?? product,
        weightLabel: weightedById.get(product.id),
      }));
    },
    onSuccess: (items) => {
      setPrintItems(items);
      requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
    },
  });
  const lock = useMutation({
    mutationFn: () => api('/price-tags/lock', {}),
    onSuccess: () => {
      setSelected([]);
      setPackageWeights({});
      setPrintItems([]);
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
  const chosen = selected
    .map((id) => all.find((product) => product.id === id))
    .filter((product): product is Product => !!product);
  const price = (amount: string) =>
    new Intl.NumberFormat(undefined, { style: 'currency', currency: value.store.currency }).format(
      Number(amount),
    );
  const design = value.store.tagDesign;
  const weightReady = chosen.every(
    (product) =>
      product.unit !== 'kilogram' ||
      (/^\d+(?:[.,]\d{1,3})?$/.test(packageWeights[product.id]?.trim() ?? '') &&
        Number((packageWeights[product.id] ?? '').replace(',', '.')) > 0),
  );
  const packagePrice = (label: WeightLabel) =>
    fromScaled((toScaled(label.price, 2) * toScaled(label.weight, 3) + 500n) / 1000n, 2);
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
      <div className="price-tags-product-list">
        {visible.map((product) => (
          <div key={product.id} className="price-tags-product-entry">
            <label className="price-tags-product">
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
                  {product.sku} ·{' '}
                  {product.unit === 'kilogram'
                    ? `PLU ${product.plu || '—'}`
                    : product.barcode || product.plu}
                </small>
              </span>
              <b>
                {price(product.price)}
                {product.unit === 'kilogram' ? `/${t('kg')}` : ''}
              </b>
            </label>
            {product.unit === 'kilogram' && selected.includes(product.id) && (
              <div className="price-tags-weight-details">
                <input
                  aria-label={`${t('Enter package weight')} — ${product.name}`}
                  inputMode="decimal"
                  placeholder={t('Enter package weight')}
                  value={packageWeights[product.id] ?? ''}
                  onChange={(event) =>
                    setPackageWeights((before) => ({ ...before, [product.id]: event.target.value }))
                  }
                />
                {!value.store.scaleBarcode.enabled || value.store.scaleBarcode.mode !== 'weight' ? (
                  <p className="price-tags-scan-feedback error">
                    {t('Ask a manager to enable weight barcodes in Store settings.')}
                  </p>
                ) : !/^\d+$/.test(product.plu) ? (
                  <p className="price-tags-scan-feedback error">
                    {t('Add a numeric PLU to this product before creating a weight barcode.')}
                  </p>
                ) : null}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="price-tags-print-action">
        <Button
          onClick={() => print.mutate(chosen)}
          disabled={
            !chosen.length ||
            !weightReady ||
            print.isPending ||
            chosen.some(
              (product) =>
                product.unit === 'kilogram' &&
                (!value.store.scaleBarcode.enabled ||
                  value.store.scaleBarcode.mode !== 'weight' ||
                  !/^\d+$/.test(product.plu)),
            )
          }
        >
          <Printer size={17} /> {t('Print selected tags')} ({chosen.length})
        </Button>
      </div>
      <div className="price-tags-print-sheet" style={{ gap: `${design.gapMm}mm` }}>
        {printItems.map(({ product, weightLabel }) =>
          weightLabel ? (
            <article
              key={product.id}
              className="price-tag price-tag-weight"
              style={{ width: `${design.weightWidthMm}mm`, height: `${design.weightHeightMm}mm` }}
            >
              {design.showStoreName && <small>{value.store.name}</small>}
              <strong style={{ fontSize: `${design.nameFontPt}pt` }}>{weightLabel.name}</strong>
              {design.showSku && <small>{weightLabel.sku}</small>}
              <div>
                {t('Net weight (kg)')}: {weightLabel.weight}
              </div>
              <small>
                {price(weightLabel.price)}/{t('kg')}
              </small>
              <b style={{ fontSize: `${design.priceFontPt}pt` }}>
                {price(packagePrice(weightLabel))}
              </b>
              <Ean13Barcode code={weightLabel.barcode} showDigits={design.showBarcodeNumber} />
            </article>
          ) : (
            <article
              key={product.id}
              className="price-tag"
              style={{ width: `${design.regularWidthMm}mm`, height: `${design.regularHeightMm}mm` }}
            >
              {design.showStoreName && <small>{value.store.name}</small>}
              <strong style={{ fontSize: `${design.nameFontPt}pt` }}>{product.name}</strong>
              <div className="price-tag-price" style={{ fontSize: `${design.priceFontPt}pt` }}>
                {price(product.price)}
              </div>
              {design.showSku && <small>{product.sku}</small>}
              {design.showUnit && <small>{product.unit}</small>}
              {design.showBarcodeNumber && product.barcode && <small>{product.barcode}</small>}
            </article>
          ),
        )}
      </div>
    </div>
  );
}
