import { TagLayoutEditor, useStoredLabelLayout } from './printing/tag-layout-editor';
import { labelLayoutStorageKey } from './printing/tag-layout';
import { renderLabel } from './printing/label-image';
import { useLabelPrinter } from './printing/use-label-printer';
import type { LabelContent } from './printing/label-image';
import { PageOnboarding } from './onboarding/PageOnboarding';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  encodeScaleBarcode,
  toScaled,
  fromScaled,
  type ScaleBarcodeSettings,
  type TagDesign,
} from '@eliza/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Copy,
  LockKeyhole,
  Printer,
  Tags,
  LayoutTemplate,
  MoreHorizontal,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { api, queryClient } from './api';
import { t, useLanguage } from './i18n';
import { Button } from './components/ui/button';
import { ErrorMessage } from './forms';
import { CameraBarcodeScanner } from './camera-barcode-scanner';
import { EmployeeQrUnlock } from './employee-qr-unlock';
import { Ean13Barcode } from './ean13-barcode';
import './price-tags.css';

type Context = {
  device: { id: string; name: string };
  store: {
    id: string;
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
  regularPrice: string | null;
  unit: string;
  plu: string;
  barcode: string;
  barcodes: string[];
  priceVersion: number;
  priceChanged: boolean;
};

type WeightLabel = { barcode: string; name: string; sku: string; price: string; weight: string };
type PrintItem = { product: Product; weightLabel?: WeightLabel };
type MarkdownLabel = {
  id: string;
  productId: string;
  name: string;
  sku: string;
  barcode: string;
  price: string;
  regularPrice: string;
  expiryDate: string | null;
  validUntil: string | null;
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
  const markdownLabels = useQuery({
    queryKey: ['price-tags-markdown-labels'],
    queryFn: () => api<MarkdownLabel[]>('/price-tags/markdown-labels'),
    enabled: !!context.data?.operator,
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
  });
  const [section, setSection] = useState<'products' | 'layout' | 'printer' | 'more'>('products');
  const contentScroll = useRef<HTMLElement>(null);
  useEffect(() => {
    contentScroll.current?.scrollTo({ top: 0 });
  }, [section]);
  const [tab, setTab] = useState<'changed' | 'all' | 'markdowns'>('changed');
  const [completingPrint, setCompletingPrint] = useState(false);
  const [confirmingPrint, setConfirmingPrint] = useState(false);
  const [pendingBluetoothJob, setPendingBluetoothJob] = useState<{
    id: string;
    items: PrintItem[];
  } | null>(null);
  const [preparingPrint, setPreparingPrint] = useState(false);
  const tagLayout = useStoredLabelLayout(
    context.data ? labelLayoutStorageKey(context.data.store.id, context.data.device.id) : null,
  );
  const printer = useLabelPrinter(
    completingPrint || preparingPrint || !!pendingBluetoothJob,
    tagLayout.layout,
  );
  const [customPrintImages, setCustomPrintImages] = useState<string[] | null>(null);

  const [bluetoothError, setBluetoothError] = useState<unknown>(null);
  const [bluetoothNotice, setBluetoothNotice] = useState('');
  async function sendLabels(labels: LabelContent[]) {
    setBluetoothNotice('');
    await printer.printLabels(labels);
    setBluetoothNotice(
      t('Sent to printer. Check the physical labels; Bluetooth does not confirm printing.'),
    );
  }
  async function confirmBluetoothPrint() {
    if (!pendingBluetoothJob || confirmingPrint) return;
    setConfirmingPrint(true);
    setBluetoothError(null);
    try {
      await api('/price-tags/prints/' + pendingBluetoothJob.id + '/complete', {});
      setSelected((before) =>
        before.filter((id) => !pendingBluetoothJob.items.some((item) => item.product.id === id)),
      );
      setPendingBluetoothJob(null);
      await queryClient.invalidateQueries({ queryKey: ['price-tags-products'] });
    } catch (error) {
      setBluetoothError(error);
    } finally {
      setConfirmingPrint(false);
    }
  }

  const [selected, setSelected] = useState<string[]>([]);
  const [packageWeights, setPackageWeights] = useState<Record<string, string>>({});
  const [printItems, setPrintItems] = useState<PrintItem[]>([]);
  const [markdownPrintItems, setMarkdownPrintItems] = useState<MarkdownLabel[]>([]);
  const [selectedMarkdownIds, setSelectedMarkdownIds] = useState<string[]>([]);
  const [copyFeedback, setCopyFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
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
    const markdown = (markdownLabels.data ?? []).find((label) => label.barcode === code);
    if (markdown) {
      setTab('markdowns');
      setSelectedMarkdownIds((before) =>
        before.includes(markdown.id) ? before : [...before, markdown.id],
      );
      setScanFeedback({
        type: 'success',
        text: t('Selected markdown label for {value0}', { value0: markdown.name }),
      });
      playScanSound(true);
      return;
    }
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
    if (!product.priceChanged) setTab('all');
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
      setPreparingPrint(true);
      // Validate package weights before creating the print snapshot.
      const weights = new Map(
        items
          .filter((p) => p.unit === 'kilogram')
          .map((p) => {
            const weight = packageWeights[p.id].trim().replace(',', '.');
            encodeScaleBarcode(p.plu, weight, context.data!.store.scaleBarcode);
            return [p.id, weight];
          }),
      );
      const job = await api<{ id: string; products: Product[] }>('/price-tags/prints', {
        productIds: items.map((product) => product.id),
      });
      const snapshots = new Map(job.products.map((product) => [product.id, product]));
      return {
        id: job.id,
        items: items.map((item) => {
          const product = snapshots.get(item.id)!;
          const weight = weights.get(product.id);
          return {
            product,
            weightLabel: weight
              ? {
                  barcode: encodeScaleBarcode(
                    product.plu,
                    weight,
                    context.data!.store.scaleBarcode,
                  ),
                  name: product.name,
                  sku: product.sku,
                  price: product.price,
                  weight,
                }
              : undefined,
          };
        }),
      };
    },
    onSettled: () => setPreparingPrint(false),
    onSuccess: (job) => {
      setCompletingPrint(true);
      setCustomPrintImages(null);
      setMarkdownPrintItems([]);
      setPrintItems(job.items);
      requestAnimationFrame(() =>
        requestAnimationFrame(async () => {
          try {
            if (printer.mode === 'p1') {
              await sendLabels(normalContents(job.items));
              setPendingBluetoothJob(job);
              return;
            }
            if (tagLayout.layout) {
              const images = normalContents(job.items).map((label) =>
                renderLabel(label, tagLayout.layout).toDataURL('image/png'),
              );
              setCustomPrintImages(images);
              await new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
              );
              await Promise.all(
                [...document.querySelectorAll<HTMLImageElement>('.price-tag-custom img')].map(
                  (image) => image.decode(),
                ),
              );
            } else setCustomPrintImages(null);
            window.print();
            await api('/price-tags/prints/' + job.id + '/complete', {});
            setSelected((before) =>
              before.filter((id) => !job.items.some((item) => item.product.id === id)),
            );
            await queryClient.invalidateQueries({ queryKey: ['price-tags-products'] });
          } catch (error) {
            setPrintError(error);
          } finally {
            setCompletingPrint(false);
          }
        }),
      );
    },
  });
  const printMarkdowns = useMutation({
    mutationFn: async (unitIds: string[]) => {
      setPreparingPrint(true);
      return api<{ labels: MarkdownLabel[] }>('/price-tags/markdown-prints', { unitIds });
    },
    onSettled: () => setPreparingPrint(false),
    onSuccess: ({ labels }) => {
      setCompletingPrint(true);
      setCustomPrintImages(null);
      setPrintItems([]);
      setMarkdownPrintItems(labels);
      requestAnimationFrame(() =>
        requestAnimationFrame(async () => {
          try {
            if (printer.mode === 'p1') await sendLabels(markdownContents(labels));
            else {
              if (tagLayout.layout) {
                setCustomPrintImages(
                  markdownContents(labels).map((label) =>
                    renderLabel(label, tagLayout.layout).toDataURL('image/png'),
                  ),
                );
                await new Promise<void>((resolve) =>
                  requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
                );
                await Promise.all(
                  [...document.querySelectorAll<HTMLImageElement>('.price-tag-custom img')].map(
                    (image) => image.decode(),
                  ),
                );
              } else setCustomPrintImages(null);
              window.print();
            }
            void queryClient.invalidateQueries({ queryKey: ['price-tags-markdown-labels'] });
          } catch (error) {
            setPrintError(error);
          } finally {
            setCompletingPrint(false);
          }
        }),
      );
    },
  });
  const [printError, setPrintError] = useState<unknown>(null);
  async function copyBarcode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopyFeedback({ type: 'success', text: t('Barcode copied: {value0}', { value0: code }) });
    } catch {
      setCopyFeedback({
        type: 'error',
        text: t('Could not copy automatically. Select the barcode number to copy it.'),
      });
    }
  }

  const lock = useMutation({
    mutationFn: () => api('/price-tags/lock', {}),
    onSuccess: () => {
      setSelected([]);
      setPackageWeights({});
      setPrintItems([]);
      setMarkdownPrintItems([]);
      setSelectedMarkdownIds([]);
      void queryClient.invalidateQueries({ queryKey: ['price-tags-context'] });
    },
  });
  if (context.isPending)
    return (
      <div className="price-tags-shell" data-tour-scope="price-tags">
        {t('Loading…')}
      </div>
    );
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
        <EmployeeQrUnlock
          disabled={login.isPending}
          onUnlock={(qrCredential) => login.mutate({ qrCredential })}
        />
        {!value.employees.length && (
          <p>{t('No General employees are assigned. Ask a manager to assign the role in Team.')}</p>
        )}
        <a href="/management-access?from=price-tags">{t('Management sign in')}</a>
      </div>
    );
  const all = products.data ?? [];
  const allMarkdowns = markdownLabels.data ?? [];
  const changedCount = all.filter((product) => product.priceChanged).length;
  const visible = all
    .filter((product) => tab === 'all' || product.priceChanged)
    .filter((product) =>
      [product.name, product.sku, product.barcode, product.plu, ...(product.barcodes ?? [])].some(
        (text) => text?.toLowerCase().includes(search.toLowerCase()),
      ),
    );
  const chosen = selected
    .map((id) => all.find((product) => product.id === id))
    .filter((product): product is Product => !!product);
  const visibleMarkdowns = allMarkdowns.filter((label) =>
    [label.name, label.sku, label.barcode].some((text) =>
      text.toLowerCase().includes(search.toLowerCase()),
    ),
  );
  const chosenMarkdowns = selectedMarkdownIds.filter((id) =>
    allMarkdowns.some((label) => label.id === id),
  );
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
  const formatLabelPrice = (amount: string) =>
    new Intl.NumberFormat(undefined, { style: 'currency', currency: value.store.currency }).format(
      Number(amount),
    );
  const normalContents = (items: PrintItem[]): LabelContent[] =>
    items.map(({ product, weightLabel }) => ({
      name: product.name,
      store:
        tagLayout.layout || context.data!.store.tagDesign.showStoreName
          ? context.data!.store.name
          : undefined,
      price: formatLabelPrice(weightLabel ? packagePrice(weightLabel) : product.price),
      barcode: weightLabel?.barcode || product.barcode || undefined,
      details: [
        ...(product.regularPrice
          ? [
              t('Discount from') +
                ' ' +
                formatLabelPrice(
                  weightLabel
                    ? packagePrice({ ...weightLabel, price: product.regularPrice })
                    : product.regularPrice,
                ),
            ]
          : []),
        ...(weightLabel
          ? [
              t('Net weight (kg)') + ': ' + weightLabel.weight,
              formatLabelPrice(product.price) + '/' + t('kg'),
            ]
          : [t(product.unit)]),
        ...(context.data!.store.tagDesign.showSku ? [product.sku] : []),
      ],
    }));
  const markdownContents = (labels: MarkdownLabel[]): LabelContent[] =>
    labels.map((label) => ({
      name: label.name,
      store:
        tagLayout.layout || context.data!.store.tagDesign.showStoreName
          ? context.data!.store.name
          : undefined,
      price: formatLabelPrice(label.price),
      barcode: label.barcode,
      details: [
        t('Discount from') + ' ' + formatLabelPrice(label.regularPrice),
        ...(label.expiryDate ? [t('Expires') + ' ' + label.expiryDate.slice(0, 10)] : []),
      ],
    }));
  const cannotPrint =
    preparingPrint ||
    printer.working ||
    !!pendingBluetoothJob ||
    (printer.mode === 'p1' && !printer.connected);
  const navigation = [
    { id: 'products', label: t('Products'), icon: Tags },
    { id: 'layout', label: t('Layout'), icon: LayoutTemplate },
    { id: 'printer', label: t('Printer'), icon: Printer },
    { id: 'more', label: t('More'), icon: MoreHorizontal },
  ] as const;
  const lockedNavigation = preparingPrint || completingPrint || printer.working || confirmingPrint;
  const layoutEditor = (
    <TagLayoutEditor
      embedded
      layout={tagLayout.layout}
      storeName={value.store.name}
      onSave={tagLayout.save}
      preview={
        (tab === 'markdowns'
          ? markdownContents(allMarkdowns.filter((label) => chosenMarkdowns.includes(label.id)))
          : normalContents(
              chosen.map((product) => ({
                product,
                weightLabel:
                  product.unit === 'kilogram' &&
                  /^\d+(?:[.,]\d{1,3})?$/.test(packageWeights[product.id]?.trim() ?? '') &&
                  Number((packageWeights[product.id] ?? '').replace(',', '.')) > 0
                    ? {
                        barcode: product.barcode,
                        name: product.name,
                        sku: product.sku,
                        price: product.price,
                        weight: packageWeights[product.id].replace(',', '.'),
                      }
                    : undefined,
              })),
            ))[0] ?? {
          name: t('Sample product'),
          price: formatLabelPrice('123.45'),
          barcode: '0400000000046',
          store: value.store.name,
          details: [t('Label details')],
        }
      }
      disabled={completingPrint || preparingPrint || printer.working || !!pendingBluetoothJob}
    />
  );
  return (
    <div className="price-tags-shell price-tags-app" data-tour-scope="price-tags">
      <header className="price-tags-header">
        <div className="price-tags-heading">
          <h1>{t('Price Tags')}</h1>
          <p title={value.store.name + ' · ' + value.operator.name}>
            {value.store.name} · {value.operator.name}
          </p>
        </div>
        <button
          type="button"
          className={'price-tags-printer-status' + (printer.connected ? ' connected' : '')}
          disabled={lockedNavigation || !!pendingBluetoothJob}
          onClick={() => setSection('printer')}
          aria-label={t('Printer status')}
          title={
            printer.mode === 'p1'
              ? printer.connected
                ? t('Connected')
                : t('Not connected')
              : t('Browser printing')
          }
        >
          <Printer size={20} aria-hidden="true" />
          <span className="status-dot" aria-hidden="true" />
        </button>
      </header>
      <main
        className="price-tags-content"
        ref={contentScroll}
        id="price-tags-active-panel"
        role="tabpanel"
        aria-labelledby={'price-tags-nav-' + section}
      >
        {section === 'products' && (
          <>
            <div className="price-tags-product-tools">
              <div className="price-tags-tabs" role="tablist" aria-label={t('Product lists')}>
                {(
                  [
                    {
                      id: 'changed',
                      label: t('Price changed'),
                      short: t('Changed'),
                      count: changedCount,
                    },
                    { id: 'all', label: t('All products'), short: t('All'), count: all.length },
                    {
                      id: 'markdowns',
                      label: t('Markdown labels'),
                      short: t('Markdowns'),
                      count: allMarkdowns.length,
                    },
                  ] as const
                ).map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-label={item.label}
                    title={item.label + ' · ' + item.count}
                    aria-selected={tab === item.id}
                    tabIndex={tab === item.id ? 0 : -1}
                    onClick={() => setTab(item.id)}
                    onKeyDown={(event) => {
                      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                      event.preventDefault();
                      const ids = ['changed', 'all', 'markdowns'] as const;
                      const next =
                        event.key === 'Home'
                          ? 0
                          : event.key === 'End'
                            ? 2
                            : (index + (event.key === 'ArrowRight' ? 1 : -1) + 3) % 3;
                      setTab(ids[next]);
                      (
                        event.currentTarget.parentElement?.children[next] as HTMLButtonElement
                      )?.focus();
                    }}
                  >
                    <span className="price-tags-filter-label">{item.short}</span>
                    {item.count > 0 && (
                      <span className="price-tags-counter" aria-hidden="true">
                        {item.count > 99 ? '99+' : item.count}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <div className="price-tags-controls">
                <div className="price-tags-search-field">
                  <label htmlFor="price-tags-search">{t('Find products')}</label>
                  <div className="price-tags-search-row">
                    <input
                      id="price-tags-search"
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          prepareScanSound();
                          selectScannedProduct(search.trim());
                        }
                      }}
                      value={search}
                      onChange={(event) => {
                        setSearch(event.target.value);
                        setScanFeedback(null);
                        setCopyFeedback(null);
                      }}
                      placeholder={t('Name, SKU, PLU or barcode')}
                    />
                    <CameraBarcodeScanner
                      inline
                      continuous
                      disabled={products.isPending || !!products.error || lockedNavigation}
                      onOpen={prepareScanSound}
                      onScan={selectScannedProduct}
                    />
                  </div>
                </div>
              </div>
            </div>
            {scanFeedback && (
              <p className={`price-tags-scan-feedback ${scanFeedback.type}`} role="status">
                {scanFeedback.text}
              </p>
            )}
            {copyFeedback && (
              <p className={'price-tags-scan-feedback ' + copyFeedback.type} role="status">
                {copyFeedback.text}
              </p>
            )}
            {printer.working && (
              <p role="status">
                {t('Sending to printer. Keep this screen open until the transfer finishes.')}
              </p>
            )}
            {bluetoothNotice && <p role="status">{bluetoothNotice}</p>}
            {pendingBluetoothJob && (
              <section className="label-printer-confirm" aria-label={t('Confirm label printing')}>
                <p>
                  {t(
                    'Did all selected labels print correctly? Confirm only after checking the paper. Until then, prices remain in the Price changed list.',
                  )}
                </p>
                <Button disabled={confirmingPrint} onClick={() => void confirmBluetoothPrint()}>
                  {t('All labels printed correctly')}
                </Button>
                <Button
                  variant="outline"
                  disabled={confirmingPrint}
                  onClick={() => setPendingBluetoothJob(null)}
                >
                  {t('Not all labels printed')}
                </Button>
              </section>
            )}
            <ErrorMessage error={bluetoothError} />
            <ErrorMessage
              error={
                products.error ??
                markdownLabels.error ??
                print.error ??
                printMarkdowns.error ??
                printError
              }
            />
            {tab === 'markdowns' && (
              <p className="price-tags-list-description muted">
                {t(
                  'Each label is for one physical item. Print it and attach it to the matching package.',
                )}
              </p>
            )}
            {tab !== 'markdowns' && !products.isPending && !products.error && !visible.length && (
              <p className="price-tags-empty">
                {t(
                  tab === 'changed' && !search
                    ? 'No price changes waiting for tags.'
                    : 'No products found.',
                )}
              </p>
            )}
            {tab === 'markdowns' &&
              !markdownLabels.isPending &&
              !markdownLabels.error &&
              !visibleMarkdowns.length && (
                <p className="price-tags-empty">
                  {t(search ? 'No markdown labels found.' : 'No markdown labels waiting to print.')}
                </p>
              )}
            {tab === 'markdowns' ? (
              <div className="price-tags-product-list" role="tabpanel">
                {visibleMarkdowns.map((label) => (
                  <div key={label.id} className="price-tags-markdown-entry">
                    <label className="price-tags-product">
                      <input
                        type="checkbox"
                        checked={selectedMarkdownIds.includes(label.id)}
                        onChange={(event) =>
                          setSelectedMarkdownIds((before) =>
                            event.target.checked
                              ? [...before, label.id]
                              : before.filter((id) => id !== label.id),
                          )
                        }
                      />
                      <span>
                        <strong>{label.name}</strong>
                        <small>{label.sku}</small>
                        <small className="price-tags-markdown-code">{label.barcode}</small>
                        {label.expiryDate && (
                          <small>
                            {t('Expires')} {label.expiryDate}
                          </small>
                        )}
                      </span>
                      <b>{price(label.price)}</b>
                    </label>
                    <div className="price-tags-markdown-actions">
                      <small>
                        {t('Discount from')} <s>{price(label.regularPrice)}</s>
                      </small>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void copyBarcode(label.barcode)}
                      >
                        <Copy size={15} /> {t('Copy barcode')}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="price-tags-product-list" role="tabpanel">
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
                            setPackageWeights((before) => ({
                              ...before,
                              [product.id]: event.target.value,
                            }))
                          }
                        />
                        {!value.store.scaleBarcode.enabled ||
                        value.store.scaleBarcode.mode !== 'weight' ? (
                          <p className="price-tags-scan-feedback error">
                            {t('Ask a manager to enable weight barcodes in Store settings.')}
                          </p>
                        ) : !/^\d+$/.test(product.plu) ? (
                          <p className="price-tags-scan-feedback error">
                            {t(
                              'Add a numeric PLU to this product before creating a weight barcode.',
                            )}
                          </p>
                        ) : null}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {section === 'layout' && layoutEditor}
        {section === 'printer' && (
          <section className="price-tags-settings-panel" aria-label={t('Label printer')}>
            <h2>{t('Label printer')}</h2>
            <p className="muted">
              {t(
                'Connect on this Android device. A manager’s laptop cannot connect the printer for this device.',
              )}
            </p>
            {printer.panel}
            {printer.mode === 'p1' && (
              <p className="muted" role="status">
                {t(
                  'P1 labels: 50 × 60 mm. Keep this screen open while sending. Check each markdown label before attaching it.',
                )}
              </p>
            )}
          </section>
        )}
        <section className="price-tags-more" hidden={section !== 'more'} aria-label={t('More')}>
          <h2>{t('More')}</h2>
          <div className="price-tags-account">
            <UserRound size={22} />
            <div>
              <strong>{value.operator.name}</strong>
              <small>
                {value.store.name} · {value.device.name}
              </small>
            </div>
          </div>
          <PageOnboarding
            storeId={value.store.id}
            employeeId={value.operator.id}
            endpoint="/price-tags/onboarding"
            scope='[data-tour-scope="price-tags"]'
          />
          <Button
            variant="outline"
            onClick={() => lock.mutate()}
            disabled={lock.isPending || lockedNavigation || !!pendingBluetoothJob}
          >
            <LockKeyhole size={20} />
            {t('Lock')}
          </Button>
          <a className="price-tags-management-link" href="/management-access?from=price-tags">
            <ShieldCheck size={20} />
            {t('Management sign in')}
          </a>
        </section>
      </main>
      <footer className="price-tags-bottom">
        {section === 'products' && (
          <div className="price-tags-print-action">
            {tab === 'markdowns' ? (
              <Button
                aria-label={`${t('Print selected labels')} (${chosenMarkdowns.length})`}
                onClick={() => {
                  setPrintError(null);
                  printMarkdowns.mutate(chosenMarkdowns);
                }}
                disabled={
                  cannotPrint ||
                  !chosenMarkdowns.length ||
                  printMarkdowns.isPending ||
                  completingPrint
                }
              >
                <Printer size={17} /> {t('Print labels')} ({chosenMarkdowns.length})
              </Button>
            ) : (
              <Button
                aria-label={`${t('Print selected tags')} (${chosen.length})`}
                onClick={() => {
                  setPrintError(null);
                  print.mutate(chosen);
                }}
                disabled={
                  cannotPrint ||
                  !chosen.length ||
                  !weightReady ||
                  print.isPending ||
                  completingPrint ||
                  chosen.some(
                    (product) =>
                      product.unit === 'kilogram' &&
                      (!value.store.scaleBarcode.enabled ||
                        value.store.scaleBarcode.mode !== 'weight' ||
                        !/^\d+$/.test(product.plu)),
                  )
                }
              >
                <Printer size={17} /> {t('Print tags')} ({chosen.length})
              </Button>
            )}
          </div>
        )}
        <nav
          className="price-tags-bottom-nav"
          role="tablist"
          aria-label={t('Price Tags navigation')}
        >
          {navigation.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={'price-tags-nav-' + item.id}
              aria-label={item.label}
              aria-selected={section === item.id}
              aria-controls="price-tags-active-panel"
              tabIndex={section === item.id ? 0 : -1}
              disabled={lockedNavigation || (!!pendingBluetoothJob && item.id !== 'products')}
              onClick={() => {
                setSection(item.id);
              }}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? navigation.length - 1
                      : (index + (event.key === 'ArrowRight' ? 1 : -1) + navigation.length) %
                        navigation.length;
                const target = event.currentTarget.parentElement?.children[next] as
                  HTMLButtonElement | undefined;
                if (target && !target.disabled) {
                  setSection(navigation[next].id);
                  target.focus();
                }
              }}
            >
              <item.icon size={22} aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </footer>
      <div className="price-tags-print-sheet" style={{ gap: `${design.gapMm}mm` }}>
        {customPrintImages ? (
          customPrintImages.map((src, index) => (
            <article
              className="price-tag price-tag-custom"
              key={index}
              style={{ width: '50mm', height: '60mm', padding: 0, border: 0 }}
            >
              <img
                src={src}
                alt={t('Label preview')}
                style={{ width: '50mm', height: '60mm', display: 'block' }}
              />
            </article>
          ))
        ) : (
          <>
            {markdownPrintItems.map((label) => (
              <article
                key={label.id}
                className="price-tag price-tag-weight price-tag-markdown"
                style={{ width: `${design.weightWidthMm}mm`, height: `${design.weightHeightMm}mm` }}
              >
                {design.showStoreName && <small>{value.store.name}</small>}
                <strong style={{ fontSize: `${design.nameFontPt}pt` }}>{label.name}</strong>
                {design.showSku && <small>{label.sku}</small>}
                <div className="price-tag-price" style={{ fontSize: `${design.priceFontPt}pt` }}>
                  {price(label.price)}
                </div>
                <small>
                  {t('Discount from')} <s>{price(label.regularPrice)}</s>
                </small>
                {label.expiryDate && (
                  <small>
                    {t('Expires')} {label.expiryDate}
                  </small>
                )}
                <Ean13Barcode code={label.barcode} showDigits={design.showBarcodeNumber} />
              </article>
            ))}
            {printItems.map(({ product, weightLabel }) =>
              weightLabel ? (
                <article
                  key={product.id}
                  className="price-tag price-tag-weight"
                  style={{
                    width: `${design.weightWidthMm}mm`,
                    height: `${design.weightHeightMm}mm`,
                  }}
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
                  {product.regularPrice && (
                    <small>
                      {t('Discount from')}{' '}
                      <s>{price(packagePrice({ ...weightLabel, price: product.regularPrice }))}</s>
                    </small>
                  )}
                  <b style={{ fontSize: `${design.priceFontPt}pt` }}>
                    {price(packagePrice(weightLabel))}
                  </b>
                  <Ean13Barcode code={weightLabel.barcode} showDigits={design.showBarcodeNumber} />
                </article>
              ) : (
                <article
                  key={product.id}
                  className="price-tag"
                  style={{
                    width: `${design.regularWidthMm}mm`,
                    height: `${design.regularHeightMm}mm`,
                  }}
                >
                  {design.showStoreName && <small>{value.store.name}</small>}
                  <strong style={{ fontSize: `${design.nameFontPt}pt` }}>{product.name}</strong>
                  <div className="price-tag-price" style={{ fontSize: `${design.priceFontPt}pt` }}>
                    {price(product.price)}
                  </div>
                  {product.regularPrice && (
                    <small>
                      {t('Discount from')} <s>{price(product.regularPrice)}</s>
                    </small>
                  )}
                  {design.showSku && <small>{product.sku}</small>}
                  {design.showUnit && <small>{product.unit}</small>}
                  {design.showBarcodeNumber && product.barcode && <small>{product.barcode}</small>}
                </article>
              ),
            )}
          </>
        )}
      </div>
    </div>
  );
}
