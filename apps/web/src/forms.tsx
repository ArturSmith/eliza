import { t, useLanguage, translateError } from './i18n';
import {
  useState,
  useId,
  useRef,
  useEffect,
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type FormEvent,
  type ReactNode,
} from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, ArrowRight, Store, PackagePlus, ChevronDown } from 'lucide-react';
import {
  productSchema,
  productSku,
  suggestSellingPrice,
  calculateLine,
  toScaled,
  fromScaled,
  setupSchema,
  adjustmentSchema,
  type Product,
  units,
} from '@eliza/contracts';
import { api, queryClient, refresh } from './api';
import { Button } from './components/ui/button';
import { Dialog } from './components/ui/dialog';
import { prepareProductImage } from './product-image';
import { BarcodeLookup } from './barcode-lookup';
import { CameraBarcodeScanner } from './camera-barcode-scanner';
export function ErrorMessage({ error }: { error: unknown }) {
  useLanguage();
  return error ? (
    <p className="error" role="alert">
      {translateError(error instanceof Error ? error.message : String(error))}
    </p>
  ) : null;
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  useLanguage();
  const id = useId();
  return (
    <label className="field">
      <span id={`${id}-label`}>{t(label)}</span>
      {Children.map(children, (child) =>
        isValidElement(child) && ['input', 'select', 'textarea'].includes(String(child.type))
          ? cloneElement(child as ReactElement<Record<string, unknown>>, {
              'aria-labelledby': `${id}-label`,
              'aria-describedby': hint ? `${id}-hint` : undefined,
            })
          : child,
      )}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </label>
  );
}
function values(e: FormEvent<HTMLFormElement>) {
  e.preventDefault();
  return Object.fromEntries(new FormData(e.currentTarget));
}
export function AuthForm({ setup }: { setup: boolean }) {
  useLanguage();
  const [setupToken, setSetupToken] = useState('');
  const [error, setError] = useState<unknown>(null);
  const mutation = useMutation({
    mutationFn: (body: unknown) =>
      api(
        `/auth/${setup ? 'setup' : 'login'}`,
        body,
        'POST',
        setup ? { 'X-Eliza-Setup-Token': setupToken } : {},
      ),
    onSuccess: () => {
      queryClient.clear();
      window.location.assign('/');
    },
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    setError(null);
    const data = values(e);
    if (setup) {
      const result = setupSchema.safeParse(data);
      if (!result.success) {
        setError(result.error.issues.map((i) => i.message).join('. '));
        return;
      }
      mutation.mutate(result.data);
    } else mutation.mutate(data);
  }
  return (
    <div className="auth-layout">
      <section className="auth-story">
        <div className="brand">
          <span className="brand-mark">
            <Store size={22} />
          </span>
          {t('eliza')}
          <span className="brand-period">.</span>
        </div>
        <div>
          <span className="eyebrow">{t('MADE FOR YOUR EVERYDAY')}</span>
          <h1>
            {t('A little less admin. ')}
            <br />
            {t('A lot more store. ')}
          </h1>
          <p>
            {t('Your products, your stock, your people. ')}
            <br />
            {t('One clear place to bring it all together. ')}
          </p>
          <div className="auth-illustration">
            <div className="shelf">
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className="shelf lower">
              <span />
              <span />
              <span />
              <span />
            </div>
            <span className="illustration-label">{t('Good things in store.')}</span>
          </div>
        </div>
        <small>{t('Your store. Your workspace.')}</small>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <div className="icon-tile">
            <Store size={25} />
          </div>
          <h2>{setup ? t('Let’s open your store') : t('Welcome back')}</h2>
          <p className="muted">
            {setup ? t('Create your store owner account.') : t('Sign in to your store workspace.')}
          </p>
          <form onSubmit={submit}>
            {setup && (
              <>
                <Field
                  label={t('Setup token')}
                  hint={t(
                    'For a hosted installation, enter the token supplied by your administrator. Leave blank for local development.',
                  )}
                >
                  <input
                    type="password"
                    value={setupToken}
                    onChange={(event) => setSetupToken(event.target.value)}
                    autoComplete="off"
                  />
                </Field>
                <Field label={t('Store name')}>
                  <input
                    name="storeName"
                    required
                    maxLength={120}
                    placeholder={t('e.g. Eliza Market')}
                    autoFocus
                  />
                </Field>
                <Field label={t('Your name')}>
                  <input
                    name="ownerName"
                    autoComplete="name"
                    required
                    maxLength={120}
                    placeholder={t('Store owner')}
                  />
                </Field>
              </>
            )}
            <Field label={t('Email address')}>
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
                placeholder={t('you@yourstore.com')}
              />
            </Field>
            <Field
              label={t('Password')}
              hint={
                setup
                  ? t('At least 12 characters. This account is created on your local server.')
                  : undefined
              }
            >
              <input
                name="password"
                type="password"
                autoComplete={setup ? 'new-password' : 'current-password'}
                required
                minLength={setup ? 12 : 1}
                maxLength={128}
              />
            </Field>
            {setup && (
              <div className="form-grid">
                <Field label={t('Currency')}>
                  <select name="currency" defaultValue="NOK">
                    {['NOK', 'EUR', 'USD', 'GBP', 'SEK', 'DKK', 'RUB'].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Field>
                <Field label={t('Time zone')}>
                  <input name="timezone" required defaultValue="Europe/Oslo" />
                </Field>
              </div>
            )}
            <ErrorMessage error={error ?? mutation.error} />
            <Button disabled={mutation.isPending} className="full">
              {mutation.isPending ? t('Please wait…') : setup ? t('Create my store') : t('Sign in')}
              <ArrowRight size={17} />
            </Button>
          </form>
          <p className="auth-foot">
            {setup
              ? t('You can start adding products right away.')
              : t('Forgot your password? Local account recovery is not available yet.')}
          </p>
        </div>
      </section>
    </div>
  );
}
export function ProductForm({
  onDone,
  initial,
  prefill,
  onCreated,
}: {
  onDone: () => void;
  initial?: Product;
  prefill?: Partial<
    Pick<Product, 'name' | 'description' | 'category' | 'cost' | 'price' | 'barcodes' | 'source'>
  >;
  onCreated?: (product: Product) => void;
}) {
  useLanguage();
  const formRef = useRef<HTMLFormElement>(null);
  const [cost, setCost] = useState(initial?.cost ?? prefill?.cost ?? '');
  const [price, setPrice] = useState(initial?.price ?? prefill?.price ?? '');
  const [taxRate, setTaxRate] = useState<string | undefined>(initial?.taxRate);
  const [manualPrice, setManualPrice] = useState(!!initial || !!prefill?.price);
  const [productName, setProductName] = useState(initial?.name ?? prefill?.name ?? '');
  const [sku, setSku] = useState(initial?.sku ?? '');
  const [plu, setPlu] = useState(initial?.plu ?? '');
  const [manualSku, setManualSku] = useState(!!initial);
  const [manualPlu, setManualPlu] = useState(!!initial);
  const nextPlu = useQuery({
    queryKey: ['next-plu'],
    queryFn: () => api<{ plu: string }>('/products/next-plu'),
    enabled: !initial,
    staleTime: 0,
  });
  const effectivePlu = manualPlu ? plu : (nextPlu.data?.plu ?? '');
  const effectiveSku = manualSku ? sku : productSku(productName, effectivePlu);
  const [source, setSource] = useState(initial?.source ?? prefill?.source ?? null);
  const [existingProduct, setExistingProduct] = useState<Product>();
  function fillField(name: string, value: string, append = false) {
    const field = formRef.current?.elements.namedItem(name) as
      HTMLInputElement | HTMLTextAreaElement | null;
    if (!field) return;
    if (append) {
      const codes = field.value
        .split(/[\n,]/)
        .map((v) => v.trim())
        .filter(Boolean);
      if (!codes.includes(value)) field.value = [...codes, value].join('\n');
    } else if (!field.value.trim()) {
      field.value = value;
      if (name === 'name') setProductName(value);
    }
  }
  const [image, setImage] = useState(initial?.image ?? '');
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<unknown>(null);
  const profile = useQuery({
    queryKey: ['store-profile'],
    queryFn: () => api<{ defaultTaxRate: string; defaultMarkupPercent: string }>('/store-profile'),
  });
  const markup = profile.data?.defaultMarkupPercent ?? '15';
  const suggestedPrice = suggestSellingPrice(cost, markup);
  const effectiveTaxRate = taxRate ?? profile.data?.defaultTaxRate ?? '0';
  let marginPreview = '—';
  const selling = productSchema.shape.price.safeParse(manualPrice ? price : suggestedPrice);
  const buying = productSchema.shape.cost.safeParse(cost);
  const tax = productSchema.shape.taxRate.safeParse(effectiveTaxRate);
  if (selling.success && buying.success && tax.success) {
    const line = calculateLine(selling.data, '1', tax.data);
    const net = toScaled(line.total, 2) - toScaled(line.tax, 2);
    const profit = net - toScaled(buying.data, 2);
    const percent =
      net > 0n
        ? (((profit < 0n ? -profit : profit) * 10000n + net / 2n) / net) * (profit < 0n ? -1n : 1n)
        : 0n;
    marginPreview = fromScaled(percent, 2) + '%';
  }

  const [error, setError] = useState<unknown>(null);
  const mutation = useMutation({
    mutationFn: (body: unknown) =>
      api<Product>(
        initial ? `/products/${initial.id}` : '/products',
        body,
        initial ? 'PATCH' : 'POST',
      ),
    onSuccess: (product) => {
      void refresh();
      if (!initial) onCreated?.(product);
      onDone();
    },
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    setError(null);
    const data = values(e);
    const result = productSchema.safeParse({
      ...data,
      image,
      source,
      barcodes: String(data.barcodes)
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean),
    });
    if (!result.success) {
      setError(result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('. '));
      return;
    }
    mutation.mutate({
      ...result.data,
      ...(!initial ? { autoPlu: !manualPlu, autoSku: !manualSku } : {}),
    });
  }
  if (existingProduct) return <ProductForm initial={existingProduct} onDone={onDone} />;
  if (!initial && (profile.isPending || nextPlu.isPending))
    return <p>{t('Loading product defaults…')}</p>;
  if (!initial && (profile.error || nextPlu.error))
    return <ErrorMessage error={profile.error ?? nextPlu.error} />;
  return (
    <form ref={formRef} onSubmit={submit}>
      {!initial && (
        <BarcodeLookup
          onBarcode={(barcode) => fillField('barcodes', barcode, true)}
          onExisting={setExistingProduct}
          onUse={async (suggestion) => {
            fillField('name', suggestion.name);
            fillField('description', suggestion.description ?? '');
            fillField('category', suggestion.category);
            fillField('barcodes', suggestion.barcode, true);
            let imageImported = false;
            if (!image && suggestion.image) {
              setImageBusy(true);
              try {
                const blob = await (await fetch(suggestion.image)).blob();
                setImage(
                  await prepareProductImage(
                    new File([blob], 'product.jpg', { type: 'image/jpeg' }),
                  ),
                );
                imageImported = true;
              } catch {
                setImageError(
                  new Error(
                    'Details imported, but the photo could not be read. You can upload one manually.',
                  ),
                );
              } finally {
                setImageBusy(false);
              }
            }
            setSource({
              barcode: suggestion.barcode,
              brand: suggestion.brand,
              quantity: suggestion.quantity,
              imageImported,
            });
          }}
        />
      )}
      {source && (
        <p className="muted">
          {t('Source:')}{' '}
          <a
            href={'https://world.openfoodfacts.org/product/' + source.barcode}
            target="_blank"
            rel="noreferrer"
          >
            {t('Open Food Facts contributors ')}
          </a>{' '}
          ·{' '}
          <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noreferrer">
            {t('ODbL ')}
          </a>
          {source.imageImported && (
            <>
              {' '}
              {t('· Photo resized from source,')}{' '}
              <a
                href="https://creativecommons.org/licenses/by-sa/3.0/"
                target="_blank"
                rel="noreferrer"
              >
                {t('CC BY-SA 3.0 ')}
              </a>
            </>
          )}
          {source.brand && <> · {source.brand}</>}
          {source.quantity && (
            <>
              {' '}
              {t(' · Package: ')}
              {source.quantity}
            </>
          )}
        </p>
      )}
      <Field
        label={t('Product photo')}
        hint={t('Optional. JPEG, PNG, or WebP up to 10 MB. Photos are resized automatically.')}
      >
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={imageBusy || mutation.isPending}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            setImageBusy(true);
            setImageError(null);
            try {
              setImage(await prepareProductImage(file));
              setSource((value) => (value ? { ...value, imageImported: false } : null));
            } catch (error) {
              setImageError(
                error instanceof Error ? error : new Error('Unable to read this image.'),
              );
            } finally {
              setImageBusy(false);
            }
          }}
        />
      </Field>
      {imageBusy && <p role="status">{t('Preparing photo…')}</p>}
      <ErrorMessage error={imageError} />
      {image && (
        <div className="product-photo-preview">
          <img src={image} alt={t('Product photo preview')} />
          <Button
            type="button"
            variant="ghost"
            disabled={imageBusy || mutation.isPending}
            onClick={() => {
              setImage('');
              setSource((value) => (value ? { ...value, imageImported: false } : null));
            }}
          >
            {t('Remove photo ')}
          </Button>
        </div>
      )}
      <Field label={t('Product name')}>
        <input
          name="name"
          placeholder={t('e.g. Organic whole milk')}
          value={productName}
          onChange={(e) => setProductName(e.target.value)}
          required
          maxLength={120}
        />
      </Field>
      <Field label={t('Description (optional)')}>
        <textarea
          name="description"
          defaultValue={initial?.description ?? prefill?.description ?? ''}
          maxLength={2000}
          rows={3}
          placeholder={t('Additional details about this product')}
        />
      </Field>
      <div className="form-grid">
        <Field label={t('SKU')}>
          <input
            name="sku"
            placeholder={t('e.g. MILK-001')}
            value={effectiveSku}
            onChange={(e) => {
              setManualSku(true);
              setSku(e.target.value);
            }}
            required
            maxLength={120}
          />
        </Field>
        <Field label={t('Category')}>
          <input
            name="category"
            list="categories"
            placeholder={t('e.g. Dairy')}
            defaultValue={initial?.category ?? prefill?.category}
            required
            maxLength={120}
          />
          <datalist id="categories">
            {['Produce', 'Dairy', 'Bakery', 'Pantry', 'Drinks', 'Household'].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </datalist>
        </Field>
      </div>
      <div className="form-grid">
        <Field label={t('Purchase cost')}>
          <input
            name="cost"
            inputMode="decimal"
            placeholder={t('0.00')}
            value={cost}
            onChange={(e) => {
              setCost(e.target.value);
              if (!initial) setManualPrice(false);
            }}
            required
          />
        </Field>
        <Field
          label={t('Selling price')}
          hint={
            !manualPrice
              ? t(
                  'Suggested using {percent}% markup on purchase cost. This price already includes VAT.',
                  { percent: markup },
                )
              : undefined
          }
        >
          <input
            name="price"
            inputMode="decimal"
            placeholder={t('0.00')}
            value={manualPrice ? price : suggestedPrice}
            onChange={(e) => {
              setPrice(e.target.value);
              setManualPrice(true);
            }}
            required
          />
          <small className="product-margin-preview" aria-live="polite">
            {t('Gross margin')}: {marginPreview}
          </small>
        </Field>
        <Field
          label={t('Tax rate (%)')}
          hint={t('Selling prices include this tax. Set the appropriate rate for this product.')}
        >
          <input
            name="taxRate"
            inputMode="decimal"
            value={effectiveTaxRate}
            onChange={(event) => setTaxRate(event.target.value)}
            required
          />
        </Field>
      </div>
      <div className="form-grid">
        <Field label={t('Unit')}>
          <select name="unit" defaultValue={initial?.unit ?? 'piece'}>
            {units.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('Low-stock threshold')}>
          <input
            name="minStock"
            inputMode="decimal"
            defaultValue={initial?.minStock ?? '5'}
            required
          />
        </Field>
      </div>
      <Field
        label={t('Barcodes (optional)')}
        hint={t('Add one per line, or separate with commas. Leave blank to generate a barcode.')}
      >
        <div className="barcode-input-with-camera">
          <textarea
            name="barcodes"
            rows={2}
            defaultValue={(initial?.barcodes ?? prefill?.barcodes)?.join('\n')}
            placeholder={t('Scan or enter a barcode')}
          />
          <CameraBarcodeScanner onScan={(code) => fillField('barcodes', code, true)} />
        </div>
      </Field>
      {!initial && (
        <p className="muted">
          {t('Codes are suggested automatically. The next PLU is confirmed when you save.')}
        </p>
      )}
      <Field label={t('PLU / short code (optional)')}>
        <input
          name="plu"
          value={effectivePlu}
          onChange={(e) => {
            setManualPlu(true);
            setPlu(e.target.value);
          }}
          maxLength={20}
          placeholder={t('e.g. 4011')}
        />
      </Field>
      <ErrorMessage error={error ?? mutation.error} />
      <div className="form-actions">
        <Button type="button" variant="outline" onClick={onDone}>
          {t('Cancel ')}
        </Button>
        <Button disabled={mutation.isPending || imageBusy}>
          <PackagePlus size={17} />
          {mutation.isPending ? t('Saving…') : initial ? t('Save changes') : t('Create product')}
        </Button>
      </div>
    </form>
  );
}
export function AddProduct() {
  useLanguage();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus size={17} />
        {t('Add product ')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t('Add a product')}
        description={t('Start with the basics. Record opening stock in Inventory.')}
      >
        <ProductForm onDone={() => setOpen(false)} />
      </Dialog>
    </>
  );
}
export function SearchSelect({
  label,
  placeholder,
  value,
  options,
  createLabel,
  onCreate,
  onSelect,
  panelHeader,
}: {
  label: string;
  placeholder: string;
  value?: { title: string; subtitle?: string };
  options: { id: string; title: string; subtitle?: string; keywords: string[] }[];
  createLabel?: string;
  onCreate?: () => void;
  onSelect: (id: string) => void;
  panelHeader?: (close: () => void) => ReactNode;
}) {
  useLanguage();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const container = useRef<HTMLDivElement>(null);
  const [panelLayout, setPanelLayout] = useState({ above: false, height: 360 });
  useEffect(() => {
    if (!open) return;
    function position() {
      const bounds = container.current?.getBoundingClientRect();
      if (!bounds) return;
      const viewport = window.visualViewport;
      const top = viewport?.offsetTop ?? 0;
      const bottom = top + (viewport?.height ?? window.innerHeight);
      const below = Math.max(0, bottom - bounds.bottom - 12);
      const above = Math.max(0, bounds.top - top - 12);
      const opensAbove = below < 300 && above > below;
      setPanelLayout({ above: opensAbove, height: Math.min(420, opensAbove ? above : below) });
    }
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    window.visualViewport?.addEventListener('resize', position);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      window.visualViewport?.removeEventListener('resize', position);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);
  const terms = query.trim().toLowerCase();
  const matches = terms
    ? options.filter((option) => option.keywords.some((k) => k.toLowerCase().includes(terms)))
    : options;
  return (
    <div className="search-select" ref={container}>
      <span className="search-select-label">{t(label)}</span>
      <button
        type="button"
        className="search-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setQuery('');
          setOpen((current) => !current);
        }}
      >
        <span className={value ? 'search-select-value' : 'search-select-placeholder'}>
          {value ? value.title : placeholder}
          {value?.subtitle && <small>{value.subtitle}</small>}
        </span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div
          className="search-select-panel"
          style={{
            maxHeight: panelLayout.height,
            top: panelLayout.above ? 'auto' : 'calc(100% + 4px)',
            bottom: panelLayout.above ? 'calc(100% + 4px)' : 'auto',
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
          }}
        >
          {panelHeader?.(() => setOpen(false))}
          <input
            autoFocus
            className="search-select-search"
            placeholder={t('Search…')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
              if (e.key === 'Enter') {
                e.preventDefault();
                if (matches.length === 1) {
                  onSelect(matches[0].id);
                  setOpen(false);
                }
              }
            }}
          />
          <div className="search-select-options" role="listbox">
            {createLabel && onCreate && (
              <button
                type="button"
                className="search-select-option search-select-create"
                onClick={() => {
                  setOpen(false);
                  onCreate();
                }}
              >
                <Plus size={15} />
                {createLabel}
              </button>
            )}
            {matches.length ? (
              matches.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  className="search-select-option"
                  onClick={() => {
                    onSelect(option.id);
                    setOpen(false);
                  }}
                >
                  <span>{option.title}</span>
                  {option.subtitle && <small>{option.subtitle}</small>}
                </button>
              ))
            ) : (
              <p className="search-select-empty">
                {t('No matches for “')}
                {query.trim()}”.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
export function AdjustmentForm({ products, onDone }: { products: Product[]; onDone: () => void }) {
  useLanguage();
  const [error, setError] = useState<unknown>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [productId, setProductId] = useState('');
  const selected = products.find((p) => p.id === productId);
  function selectScannedProduct(code: string) {
    const matches = products.filter(
      (p) => p.active && (p.barcodes.includes(code) || p.sku === code || p.plu === code),
    );
    if (matches.length !== 1) {
      setError(
        matches.length
          ? t('This code matches multiple products. Select the correct product.')
          : t('No active product matches this barcode. Check the code or select a product.'),
      );
      return;
    }
    setProductId(matches[0].id);
    setRequestId(crypto.randomUUID());
    mutation.reset();
    setError(null);
  }
  const mutation = useMutation({
    mutationFn: (body: unknown) => api('/inventory/adjustments', body),
    onSuccess: () => {
      void refresh();
      onDone();
    },
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    setError(null);
    const data = values(e);
    const result = adjustmentSchema.safeParse({ ...data, productId, requestId });
    if (!result.success) {
      setError(result.error.issues.map((i) => i.message).join('. '));
      return;
    }
    mutation.mutate(result.data);
  }
  return (
    <form
      onSubmit={submit}
      onChange={() => {
        setRequestId(crypto.randomUUID());
        mutation.reset();
      }}
    >
      <div className="adjustment-product-picker">
        <SearchSelect
          label={t('Product')}
          placeholder={t('Select a product')}
          value={
            selected && {
              title: selected.name,
              subtitle: `${Number(selected.stock)} ${t(selected.unit)} ${t('on hand')}`,
            }
          }
          options={products
            .filter((p) => p.active)
            .map((p) => ({
              id: p.id,
              title: p.name,
              subtitle: `${p.sku} · ${Number(p.stock)} ${t(p.unit ?? '')} ${t('on hand')}`,
              keywords: [p.name, p.sku, p.plu ?? '', ...p.barcodes],
            }))}
          onSelect={(id) => {
            setProductId(id);
            setRequestId(crypto.randomUUID());
            mutation.reset();
          }}
        />
        <CameraBarcodeScanner onScan={selectScannedProduct} />
      </div>
      <Field
        label={t('Quantity change')}
        hint={t('Use a positive quantity to add stock or a negative quantity to remove it.')}
      >
        <input name="quantity" placeholder={t('e.g. 24 or -2')} inputMode="decimal" required />
      </Field>
      <Field label={t('Reason')}>
        <select name="reason">
          <option value="opening_balance">{t('Opening stock')}</option>
          <option value="received">{t('Goods received (manual)')}</option>
          <option value="count_correction">{t('Count correction')}</option>
          <option value="damaged">{t('Damaged goods')}</option>
          <option value="expired">{t('Expired goods')}</option>
          <option value="internal_use">{t('Internal use')}</option>
          <option value="other">{t('Other')}</option>
        </select>
      </Field>
      <Field label={t('Notes')}>
        <textarea
          name="notes"
          rows={3}
          maxLength={500}
          placeholder={t('Add a reference or explain the change')}
        />
      </Field>
      <div className="notice">
        {t('This creates a permanent stock movement attributed to your account and device. ')}
      </div>
      <ErrorMessage error={error ?? mutation.error} />
      <div className="form-actions">
        <Button type="button" variant="outline" onClick={onDone}>
          {t('Cancel ')}
        </Button>
        <Button disabled={mutation.isPending || !productId}>
          {mutation.isPending ? t('Recording…') : t('Record adjustment')}
        </Button>
      </div>
    </form>
  );
}
