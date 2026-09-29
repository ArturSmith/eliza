import { t, useLanguage, translateError } from './i18n';
import { LanguageSwitcher } from './i18n/LanguageSwitcher';
import { CameraBarcodeScanner } from './camera-barcode-scanner';
import { EmployeeQrUnlock } from './employee-qr-unlock';
import { ReceiptSearch } from './refunds';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  Barcode,
  Check,
  CreditCard,
  LockKeyhole,
  Monitor,
  Package,
  Plus,
  Search,
  ShoppingBag,
  Trash2,
  UserRound,
  Pause,
  Clock3,
  RefreshCw,
  Star,
} from 'lucide-react';
import {
  decodeScaleBarcode,
  scalePriceQuantity,
  type ScaleBarcodeSettings,
  calculateLine,
  calculatePricedLine,
  fromScaled,
  toScaled,
  money,
  quantity,
  saleSchema,
  type PosContext,
  type PosProduct,
  type Receipt,
  type Shift,
} from '@eliza/contracts';
import { api, ApiError, productCatalogUpdateKey, queryClient } from './api';
import { ErrorMessage, Field } from './forms';
import { Button } from './components/ui/button';
import { Dialog } from './components/ui/dialog';
import { ReceiptView, formatMoney } from './receipts';
const posRefresh = () =>
  queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('pos-') });
const draftLine = z.object({
  product: z.object({
    id: z.uuid(),
    name: z.string(),
    sku: z.string(),
    unit: z.string(),
    price: money,
    regularPrice: money.nullable().optional(),
    priceKind: z.enum(['standard', 'discount_all', 'limited_discount']).optional(),
    taxRate: money,
    category: z.string(),
    stock: quantity,
    plu: z.string(),
    barcodes: z.array(z.string()),
    markdownUnitId: z.uuid().optional(),
    priceSource: z.string().optional(),
    promotionId: z.uuid().nullable().optional(),
  }),
  quantity: quantity.refine((v) => /^\d+(\.\d{1,3})?$/.test(v) && toScaled(v, 3) > 0n),
});
const draftSchema = z.object({
  lines: z.array(draftLine).max(100),
  discount: money.refine((v) => /^\d+(\.\d{1,2})?$/.test(v) && toScaled(v, 2) <= 10000n),
  requestId: z.uuid(),
  pending: saleSchema.optional(),
});
type Draft = z.infer<typeof draftSchema>;
type Line = Draft['lines'][number];
const fresh = (): Draft => ({ lines: [], discount: '0', requestId: crypto.randomUUID() });
function loadDraft(key: string): Draft {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    const parsed = draftSchema.safeParse(value);
    return parsed.success
      ? parsed.data.pending
        ? parsed.data
        : { ...parsed.data, discount: '0' }
      : fresh();
  } catch {
    return fresh();
  }
}
// Kept mounted at all times: inserting these inputs while the cashier was still
// typing an amount moved the caret into the manager code field mid-entry.
function ApprovalFields({ active }: { active: boolean }) {
  const [qrCredential, setQrCredential] = useState('');
  return (
    <div className="approval-fields" hidden={!active}>
      <div className="notice">
        {t('Manager approval keeps this sale assigned to the current cashier. ')}
      </div>
      <Field label={t('Manager employee code')}>
        <input
          name="employeeCode"
          autoComplete="off"
          required={active && !qrCredential}
          disabled={!active}
        />
      </Field>
      <Field label={t('Manager PIN')}>
        <input
          name="pin"
          type="password"
          inputMode="numeric"
          pattern="[0-9]{6}"
          required={active && !qrCredential}
          disabled={!active}
          maxLength={6}
          autoComplete="off"
        />
      </Field>
      <Field label={t('Or scan manager QR')}>
        <input
          name="qrCredential"
          type="password"
          autoComplete="off"
          value={qrCredential}
          onChange={(event) => setQrCredential(event.target.value)}
          disabled={!active}
        />
      </Field>
      <CameraBarcodeScanner disabled={!active} onScan={setQrCredential} />
    </div>
  );
}
function approvalFrom(data: FormData) {
  return data.get('qrCredential')
    ? { qrCredential: String(data.get('qrCredential')) }
    : data.get('employeeCode')
      ? { employeeCode: String(data.get('employeeCode')), pin: String(data.get('pin')) }
      : undefined;
}
export function PosPage() {
  useLanguage();
  const context = useQuery({
    queryKey: ['pos-context'],
    queryFn: () => api<PosContext>('/pos/enter', {}),
    refetchOnWindowFocus: true,
  });
  const enroll = useMutation({
    mutationFn: (body: unknown) => api('/pos/enroll', body),
    onSuccess: () => window.location.assign('/pos'),
  });
  const login = useMutation({
    mutationFn: (body: unknown) => api('/pos/login', body),
    onSuccess: () => {
      void posRefresh();
    },
  });
  const value = context.data;
  if (context.isPending) return <div className="loading">{t('Opening register…')}</div>;
  if (context.error)
    return (
      <div className="connection-error">
        <ErrorMessage error={context.error} />
        <Button onClick={() => void context.refetch()}>{t('Try again')}</Button>
        <a href="/">{t('Back to management')}</a>
      </div>
    );
  if (!value?.registered)
    return (
      <div className="register-welcome">
        <a className="text-link" href="/">
          <ArrowLeft size={16} />
          {t('Back to management ')}
        </a>
        <div className="icon-tile">
          <Monitor size={26} />
        </div>
        <div className="eyebrow">{t('CHECKOUT STARTS HERE')}</div>
        <h1>{t('Give this register a name.')}</h1>
        <p className="muted">
          {t(
            'Sign in to management as the owner first, then enroll this browser. Set employee PINs in Team before starting. ',
          )}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            enroll.mutate({ name: new FormData(e.currentTarget).get('name') });
          }}
        >
          <Field label={t('Register name')}>
            <input name="name" required placeholder={t('e.g. Checkout 01')} maxLength={120} />
          </Field>
          <ErrorMessage error={enroll.error} />
          <Button disabled={enroll.isPending} className="full">
            {t('Enroll this register ')}
            <ArrowRight size={16} />
          </Button>
        </form>
        <p className="muted">{t('Enrollment ends the management session on this browser.')}</p>
      </div>
    );
  if (value.blocked)
    return (
      <div className="connection-error">
        <LockKeyhole size={35} />
        <h1>{t('This register is blocked')}</h1>
        <p>{t('Ask the owner to reactivate it from Devices.')}</p>
        <a href="/">{t('Management sign in')}</a>
        <Button onClick={() => void context.refetch()}>{t('Check again')}</Button>
      </div>
    );
  if (!value.operator)
    return (
      <div className="pin-screen">
        <div className="pin-brand">
          <ShoppingBag size={26} />
          {t('eliza. ')}
        </div>
        <div className="pin-card">
          <span className="icon-tile">
            <LockKeyhole size={25} />
          </span>
          <div className="eyebrow">
            {value.store?.name} · {value.device?.name}
          </div>
          <h1>{t('Ready for your shift?')}</h1>
          <p className="muted">
            {t('Use your employee code and PIN, or scan your employee QR code.')}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              login.mutate({ employeeCode: data.get('employeeCode'), pin: data.get('pin') });
            }}
          >
            <Field label={t('Employee code')}>
              <select name="employeeCode" required defaultValue="">
                <option value="" disabled>
                  {t('Select your name ')}
                </option>
                {value.employees?.map((e) => (
                  <option key={e.employeeCode} value={e.employeeCode}>
                    {e.name} · {e.employeeCode}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('Register PIN')}>
              <input
                name="pin"
                className="pin-input"
                type="password"
                inputMode="numeric"
                maxLength={6}
                minLength={6}
                pattern="[0-9]{6}"
                required
                autoComplete="off"
              />
            </Field>
            <ErrorMessage error={login.error} />
            <Button className="full" disabled={login.isPending || !value.employees?.length}>
              {t('Unlock register ')}
              <ArrowRight size={16} />
            </Button>
          </form>
          <EmployeeQrUnlock
            disabled={login.isPending}
            onUnlock={(qrCredential) => login.mutate({ qrCredential })}
          />
          {!value.employees?.length && (
            <p className="notice">
              {t('No employees have a PIN yet. Set one in Team using management login. ')}
            </p>
          )}
          <a href="/management-access" className="text-link">
            {t('Management sign in ')}
          </a>
        </div>
        <p className="muted">
          {t('Your held cart stays on this tab while the register is locked.')}
        </p>
      </div>
    );
  return (
    <RegisterWorkspace
      key={`${value.device!.id}:${value.operator.id}:${value.shift?.id ?? 'no-shift'}`}
      context={value}
    />
  );
}
function ShiftForm({
  context,
  mode,
  onDone,
}: {
  context: PosContext;
  mode: 'start' | 'close' | 'cash';
  onDone: () => void;
}) {
  useLanguage();
  const [requestId] = useState(() => crypto.randomUUID());
  const [counted, setCounted] = useState('');
  const canApprove = context.operator!.permissions.includes('shift.approve');
  const needsApproval =
    mode === 'close' &&
    !canApprove &&
    money.safeParse(counted).success &&
    toScaled(counted, 2) !== toScaled(context.shift!.expectedCash, 2);
  const mutation = useMutation({
    mutationFn: (body: unknown) =>
      api(
        mode === 'start'
          ? '/pos/shifts'
          : mode === 'cash'
            ? '/pos/cash'
            : `/pos/shifts/${context.shift!.id}/close`,
        body,
      ),
    onSuccess: () => {
      void posRefresh();
      onDone();
    },
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const body =
      mode === 'start'
        ? { requestId, openingCash: data.get('openingCash') }
        : mode === 'cash'
          ? {
              requestId,
              amount: data.get('amount'),
              direction: data.get('direction'),
              reason: data.get('reason'),
            }
          : {
              requestId,
              countedCash: counted,
              notes: data.get('notes'),
              approval: approvalFrom(data),
            };
    mutation.mutate(body);
  }
  return (
    <form onSubmit={submit} className={mode === 'close' ? 'shift-close-form' : undefined}>
      {mode === 'start' ? (
        <Field
          label={t('Opening cash')}
          hint={t('Count the cash already in the drawer before taking sales.')}
        >
          <input name="openingCash" inputMode="decimal" required defaultValue="0.00" />
        </Field>
      ) : mode === 'cash' ? (
        <>
          <Field label={t('Direction')}>
            <select name="direction">
              <option value="in">{t('Cash in')}</option>
              <option value="out">{t('Cash out / safe drop')}</option>
            </select>
          </Field>
          <Field label={t('Amount')}>
            <input name="amount" inputMode="decimal" required />
          </Field>
          <Field label={t('Reason')}>
            <input name="reason" required maxLength={300} />
          </Field>
        </>
      ) : (
        <>
          <p className="notice">
            {t('Expected drawer cash:')}{' '}
            <strong>{formatMoney(context.shift!.expectedCash, context.store!.currency)}</strong>
          </p>
          <Field label={t('Counted cash')}>
            <input
              name="countedCash"
              inputMode="decimal"
              value={counted}
              onChange={(e) => setCounted(e.target.value)}
              required
            />
          </Field>
          <Field label={t('Closing notes')}>
            <textarea name="notes" maxLength={500} rows={2} />
          </Field>
          <ApprovalFields active={needsApproval} />
          <p className="muted">
            {t(
              'Closing makes this shift’s totals permanent. Finish or hold your cart before closing. ',
            )}
          </p>
        </>
      )}
      <ErrorMessage error={mutation.error} />
      <div className="form-actions">
        <Button variant="outline" type="button" onClick={onDone}>
          {t('Cancel ')}
        </Button>
        <Button disabled={mutation.isPending}>
          {mutation.isPending
            ? t('Saving…')
            : mode === 'start'
              ? t('Start shift')
              : mode === 'cash'
                ? t('Record cash movement')
                : t('Close shift')}
        </Button>
      </div>
    </form>
  );
}
function RegisterWorkspace({ context }: { context: PosContext }) {
  useLanguage();
  const storageKey = `eliza-cart:${context.store!.id}:${context.device!.id}:${context.operator!.id}:${context.shift?.id ?? 'unopened'}`;
  const [draft, setDraft] = useState(() => loadDraft(storageKey));
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [storageError, setStorageError] = useState<unknown>(null);
  const [held, setHeld] = useState<Draft[]>(() => {
    try {
      return z
        .array(draftSchema)
        .max(10)
        .parse(JSON.parse(sessionStorage.getItem(`${storageKey}:held`) ?? '[]'))
        .map((cart) => ({ ...cart, discount: '0' }));
    } catch {
      return [];
    }
  });
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [favorites, setFavorites] = useState(false);
  const [popular, setPopular] = useState(false);
  const [page, setPage] = useState(1);
  const catalog = useQuery({
    queryKey: [
      'pos-products',
      context.store!.id,
      context.operator!.id,
      search,
      category,
      favorites,
      popular,
      page,
    ],
    queryFn: () =>
      api<{
        products: (PosProduct & { favorite: boolean })[];
        total: number;
        categories: string[];
      }>(
        '/pos/catalog?' +
          new URLSearchParams({
            search,
            category,
            favorites: String(favorites),
            popular: String(popular),
            page: String(page),
          }),
      ),
    staleTime: 0,
    refetchInterval: 5_000,
  });
  useEffect(() => {
    const onCatalogUpdate = (event: StorageEvent) => {
      if (event.key === productCatalogUpdateKey)
        void queryClient.invalidateQueries({ queryKey: ['pos-products'] });
    };
    window.addEventListener('storage', onCatalogUpdate);
    return () => window.removeEventListener('storage', onCatalogUpdate);
  }, []);
  const favorite = useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean }) =>
      api('/pos/products/' + id + '/favorite', { favorite: value }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pos-products'] });
    },
  });
  const history = useQuery({
    queryKey: ['pos-sales', context.device!.id, context.operator!.id],
    queryFn: () => api<Receipt[]>('/pos/sales'),
  });
  useEffect(() => {
    if (catalog.data && page > 1 && (page - 1) * 20 >= catalog.data.total)
      setPage(Math.max(1, Math.ceil(catalog.data.total / 20)));
  }, [catalog.data, page]);
  const [message, setMessage] = useState('');
  const [scanError, setScanError] = useState('');
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
      void scanSound.current.resume().catch(() => {});
    } catch {
      // Checkout still works if this device has no audio output.
    }
  }
  async function playScanSound(success = true) {
    prepareScanSound();
    const audio = scanSound.current;
    if (!audio) return;
    try {
      if (audio.state === 'suspended') await audio.resume();
    } catch {
      return;
    }
    const start = audio.currentTime;
    for (let index = 0; index < (success ? 1 : 2); index++) {
      const from = start + index * 0.14;
      const oscillator = audio.createOscillator();
      const volume = audio.createGain();
      oscillator.type = 'square';
      oscillator.frequency.value = success ? 1200 : 360;
      volume.gain.setValueAtTime(0.0001, from);
      volume.gain.exponentialRampToValueAtTime(success ? 0.035 : 0.025, from + 0.005);
      volume.gain.setValueAtTime(success ? 0.035 : 0.025, from + 0.075);
      volume.gain.exponentialRampToValueAtTime(0.0001, from + 0.095);
      oscillator.connect(volume).connect(audio.destination);
      oscillator.start(from);
      oscillator.stop(from + 0.1);
    }
  }

  const [modal, setModal] = useState<
    'payment' | 'start' | 'close' | 'cash' | 'held' | 'history' | null
  >(null);
  const scaleProfile = useQuery({
    queryKey: ['pos-barcode-settings'],
    queryFn: () => api<{ scaleBarcode: ScaleBarcodeSettings }>('/pos/barcode-settings'),
  });
  const [weighted, setWeighted] = useState<PosProduct | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const scan = useRef<HTMLInputElement>(null);
  const productScroll = useRef<HTMLDivElement>(null);
  const [method, setMethod] = useState<'cash' | 'card'>('cash');
  const [tendered, setTendered] = useState('');
  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(draft));
      setStorageError(null);
    } catch {
      setStorageError(
        new Error('This tab cannot save your cart. Keep it open until the sale is confirmed.'),
      );
    }
  }, [draft, storageKey]);
  const lock = useMutation({
    mutationFn: () => api('/pos/lock', {}),
    onSuccess: () => {
      queryClient.removeQueries({
        predicate: (q) => q.queryKey[0] === 'pos-products' || q.queryKey[0] === 'pos-sales',
      });
      void posRefresh();
    },
  });
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void api('/pos/lock', {}).finally(() => posRefresh());
      }, 5 * 60_000);
    };
    reset();
    window.addEventListener('pointerdown', reset);
    window.addEventListener('keydown', reset);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointerdown', reset);
      window.removeEventListener('keydown', reset);
    };
  }, []);
  const totals = draft.lines.reduce(
    (s, l) => {
      const a = calculatePricedLine(
        l.product.price,
        l.product.regularPrice,
        l.quantity,
        l.product.taxRate,
        draft.pending?.discountPercent ?? '0',
      );
      return {
        subtotal: s.subtotal + toScaled(a.gross, 2),
        discount: s.discount + toScaled(a.discount, 2),
        tax: s.tax + toScaled(a.tax, 2),
        total: s.total + toScaled(a.total, 2),
      };
    },
    { subtotal: 0n, discount: 0n, tax: 0n, total: 0n },
  );
  const currency = context.store!.currency;
  const total = fromScaled(totals.total, 2);
  const needsApproval =
    toScaled(draft.pending?.discountPercent ?? '0', 2) > 1000n &&
    !context.operator!.permissions.includes('discount.approve');
  const checkout = useMutation({
    mutationFn: (body: z.infer<typeof saleSchema>) => api<Receipt>('/pos/sales', body),
    onSuccess: (r) => {
      setReceipt(r);
      setDraft(fresh());
      setModal(null);
      setTendered('');
      void posRefresh();
    },
    onError: (error) => {
      if (error instanceof ApiError && [400, 409].includes(error.status))
        setDraft((d) => ({
          ...d,
          discount: '0',
          pending: undefined,
          requestId: crypto.randomUUID(),
        }));
    },
  });
  const frozen = !!draft.pending || checkout.isPending;
  const noShift = !context.shift;
  useEffect(() => {
    if (noShift || modal || receipt || weighted || frozen) return;
    const timer = window.setTimeout(() => scan.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [noShift, modal, receipt, weighted, frozen]);
  function add(product: PosProduct, amount = '1') {
    if (frozen) return false;
    if (noShift) {
      setWeighted(null);
      setMessage('Start your shift before adding items to the cart.');
      return false;
    }
    if (!hasStock(product, amount)) return false;
    setMessage('');
    setScanError('');
    const current = draftRef.current;
    const index = current.lines.findIndex(
      (l) => (l.product.markdownUnitId ?? l.product.id) === (product.markdownUnitId ?? product.id),
    );
    if (product.markdownUnitId && index >= 0) {
      rejectScan('This markdown label is already in the cart.');
      return false;
    }
    const next =
      index >= 0
        ? {
            ...current,
            lines: current.lines.map((l, i) =>
              i === index
                ? { ...l, quantity: fromScaled(toScaled(l.quantity, 3) + toScaled(amount, 3), 3) }
                : l,
            ),
          }
        : (() => {
            const { image: _image, source: _source, ...cartProduct } = product;
            return {
              ...current,
              lines: [...current.lines, { product: cartProduct, quantity: amount }],
            };
          })();
    draftRef.current = next;
    setDraft(next);
    setSearch('');
    setWeighted(null);
    setTimeout(() => scan.current?.focus(), 0);
    return true;
  }
  function choose(p: PosProduct) {
    if (frozen) return;
    if (noShift) {
      setMessage('Start your shift before adding items to the cart.');
      return;
    }
    if (['piece', 'pack', 'box'].includes(p.unit)) add(p);
    else setWeighted(p);
  }
  function rejectScan(error: string) {
    setMessage('');
    setScanError(error);
    void playScanSound(false);
  }
  function hasStock(product: PosProduct, amount: string) {
    const remaining = toScaled(product.stock, 3);
    if (remaining <= 0n) {
      rejectScan(t('Out of stock: {value0}. The item was not added.', { value0: product.name }));
      return false;
    }
    const inCart =
      draftRef.current.lines.find(
        (line) =>
          (line.product.markdownUnitId ?? line.product.id) ===
          (product.markdownUnitId ?? product.id),
      )?.quantity ?? '0';
    if (toScaled(inCart, 3) + toScaled(amount, 3) > remaining) {
      rejectScan(t('Not enough stock for {value0}.', { value0: product.name }));
      return false;
    }
    return true;
  }
  async function scanCode(term: string) {
    setSearch('');
    setScanError('');
    if (!term) return;
    if (noShift) {
      rejectScan('Start your shift before adding items to the cart.');
      return;
    }
    if (frozen) return;
    if (scaleProfile.isPending || scaleProfile.error) {
      rejectScan('Store barcode settings are unavailable. Retry when connected.');
      return;
    }
    try {
      const decoded =
        term.length > 8 &&
        scaleProfile.data?.scaleBarcode &&
        decodeScaleBarcode(term, scaleProfile.data.scaleBarcode);
      if (decoded) {
        const matching = await api<PosProduct[]>(
          '/pos/products?plu=' + encodeURIComponent(decoded.productCode),
        );
        if (matching.length !== 1) {
          if (!matching.length) {
            const status = await api<{ unavailable: boolean }>(
              '/pos/product-availability?plu=' + encodeURIComponent(decoded.productCode),
            );
            if (status.unavailable) {
              rejectScan('This product is unavailable for sale. Ask a manager to activate it.');
              return;
            }
          }
          rejectScan('Scale product code is missing or ambiguous. Check the product PLU.');
          return;
        }
        if (matching[0].unit !== 'kilogram') {
          rejectScan('Scale labels require a product sold by kilogram.');
          return;
        }
        const amount = decoded.quantity ?? scalePriceQuantity(decoded.price!, matching[0].price);
        if (toScaled(amount, 3) > 999999999999n) {
          rejectScan('Scale quantity is too large.');
          return;
        }
        if (add(matching[0], amount)) void playScanSound();
        return;
      }
    } catch (error) {
      rejectScan(error instanceof Error ? error.message : 'Invalid scale barcode.');
      return;
    }
    let exact: PosProduct[];
    try {
      exact = await api<PosProduct[]>('/pos/products?code=' + encodeURIComponent(term));
    } catch (error) {
      rejectScan(error instanceof Error ? error.message : 'Could not load product.');
      return;
    }
    if (exact.length === 1) {
      if (['piece', 'pack', 'box'].includes(exact[0].unit)) {
        if (add(exact[0])) void playScanSound();
      } else {
        if (!hasStock(exact[0], '0.001')) return;
        choose(exact[0]);
        void playScanSound();
      }
    } else if (exact.length > 1)
      rejectScan('This code matches multiple products. Select the correct product below.');
    else {
      try {
        const status = await api<{ unavailable: boolean }>(
          '/pos/product-availability?code=' + encodeURIComponent(term),
        );
        rejectScan(
          status.unavailable
            ? 'This product is unavailable for sale. Ask a manager to activate it.'
            : 'Barcode not registered. Search by product name or ask a manager to add it.',
        );
      } catch (error) {
        rejectScan(
          error instanceof Error ? error.message : 'Could not check product availability.',
        );
      }
    }
  }
  function scanItem(e: FormEvent) {
    e.preventDefault();
    prepareScanSound();
    // A hardware scanner can submit before React has rendered its last input change.
    // Read the submitted field itself so the final barcode digit is never dropped.
    void scanCode(scan.current?.value.trim() ?? '');
  }
  function submitPayment(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const payload = draft.pending ?? {
      requestId: draft.requestId,
      shiftId: context.shift!.id,
      lines: draft.lines.map((l) => ({
        productId: l.product.id,
        quantity: l.quantity,
        expectedPrice: l.product.price,
        expectedTaxRate: l.product.taxRate,
        ...(l.product.markdownUnitId ? { markdownUnitId: l.product.markdownUnitId } : {}),
      })),
      discountPercent: '0',
      payment: { method, tendered: method === 'card' ? total : tendered },
    };
    const parsed = saleSchema.safeParse({ ...payload, approval: approvalFrom(data) });
    if (!parsed.success) {
      setMessage(parsed.error.issues.map((i) => i.message).join('. '));
      return;
    }
    const { approval, ...safe } = parsed.data;
    const pending = { ...draft, pending: safe };
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(pending));
    } catch {
      setStorageError(
        new Error('Enable browser storage before submitting payment so retries can be recovered.'),
      );
      return;
    }
    setDraft(pending);
    checkout.mutate(parsed.data);
  }
  function hold() {
    if (frozen || !draft.lines.length || held.length >= 10) return;
    const next = [...held, draft];
    try {
      sessionStorage.setItem(`${storageKey}:held`, JSON.stringify(next));
      setHeld(next);
      setDraft(fresh());
      setMessage('Cart held on this tab.');
    } catch {
      setStorageError(new Error('Could not hold this cart. Browser storage is unavailable.'));
    }
  }
  function resume(index: number) {
    if (draft.lines.length) {
      setMessage('Finish, hold, or clear the current cart before resuming another.');
      return;
    }
    const next = held.filter((_, i) => i !== index);
    try {
      sessionStorage.setItem(`${storageKey}:held`, JSON.stringify(next));
      setHeld(next);
      setDraft(held[index]);
      setMessage('');
      setModal(null);
    } catch {
      setStorageError(new Error('Could not restore the held cart.'));
    }
  }
  const visible = catalog.data?.products ?? [];
  const categories = catalog.data?.categories ?? [];
  useEffect(() => {
    productScroll.current?.scrollTo({ top: 0 });
  }, [search, page, category, favorites, popular]);
  return (
    <div className="pos-shell">
      <header className="pos-topbar">
        <div className="pos-brand">
          <ShoppingBag size={23} />
          <strong>{t('eliza.')}</strong>
          <span className="pos-divider" />
          <div>
            <strong>{context.device!.name}</strong>
            <small>{context.store!.name}</small>
          </div>
        </div>
        <div className="pos-operator">
          <UserRound size={17} />
          <span>{context.operator!.name}</span>
          <span className={`badge badge-${context.shift ? 'green' : 'gray'}`}>
            {context.shift ? t('Shift open') : t('No open shift')}
          </span>
          <Button variant="outline" onClick={() => lock.mutate()} disabled={lock.isPending}>
            <LockKeyhole size={15} />
            {t('Lock ')}
          </Button>
        </div>
      </header>
      <div className="pos-body">
        <section className="pos-catalog">
          <div className="pos-heading">
            <div>
              <div className="eyebrow">{t('A GOOD DAY IN STORE')}</div>
              <h1>{t('Checkout')}</h1>
            </div>
            <Button
              variant="ghost"
              onClick={() => {
                void catalog.refetch();
                void scaleProfile.refetch();
                setMessage(
                  'Catalog refreshed. Existing cart prices stay unchanged; remove and re-add a line to use its new price.',
                );
              }}
            >
              <RefreshCw size={15} />
              {t('Refresh products ')}
            </Button>
          </div>
          {!context.shift && (
            <div className="pos-start-notice">
              <div>
                <strong>{t('Let’s start your shift.')}</strong>
                <p>{t('Count your opening float before taking the first sale.')}</p>
              </div>
              <Button onClick={() => setModal('start')}>
                {t('Start shift ')}
                <ArrowRight size={16} />
              </Button>
            </div>
          )}
          <form className="pos-search" onSubmit={scanItem}>
            <Barcode size={22} />
            <input
              ref={scan}
              aria-label={t('Scan or search products')}
              placeholder={
                noShift
                  ? t('Start your shift to begin selling…')
                  : t('Scan a barcode, enter a PLU, or search products…')
              }
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
                setMessage('');
                setScanError('');
              }}
              disabled={frozen || noShift}
            />
            <CameraBarcodeScanner
              disabled={frozen || noShift}
              continuous
              onOpen={prepareScanSound}
              onScan={scanCode}
            />
            <kbd>{t('Enter')}</kbd>
          </form>
          <div className="pos-categories">
            <button
              className={!category && !favorites && !popular ? 'selected' : ''}
              onClick={() => {
                setCategory('');
                setFavorites(false);
                setPopular(false);
                setPage(1);
              }}
            >
              {t('All products')}
            </button>
            <button
              aria-pressed={favorites}
              className={favorites ? 'selected' : ''}
              onClick={() => {
                setFavorites(!favorites);
                setPage(1);
              }}
            >
              {t('Favorites')}
            </button>
            <button
              aria-pressed={popular}
              className={popular ? 'selected' : ''}
              onClick={() => {
                setPopular(!popular);
                setPage(1);
              }}
            >
              {t('Most popular')}
            </button>
            {categories.map((c) => (
              <button
                key={c}
                aria-pressed={c === category}
                className={c === category ? 'selected' : ''}
                onClick={() => {
                  setCategory(c === category ? '' : c);
                  setPage(1);
                }}
              >
                {c}
              </button>
            ))}
          </div>
          <ErrorMessage error={catalog.error ?? favorite.error ?? lock.error} />
          {scanError && (
            <p className="pos-scan-error" role="alert">
              {translateError(scanError)}
            </p>
          )}
          {message && (
            <p className="notice" role="status">
              {translateError(message)}
            </p>
          )}
          <div className="pos-product-scroll" ref={productScroll}>
            <div className="pos-product-grid">
              {visible.map((p) => (
                <div className="pos-product-card" key={p.id}>
                  <button
                    className="pos-product"
                    key={p.id}
                    onClick={() => choose(p)}
                    disabled={frozen || noShift || Number(p.stock) <= 0}
                  >
                    <span className={`product-icon color-${p.category.length % 4}`}>
                      {p.image ? (
                        <img src={p.image} alt={t('')} loading="lazy" />
                      ) : (
                        <Package size={25} />
                      )}
                    </span>
                    <small>{p.category}</small>
                    <strong>{p.name}</strong>
                    {p.priceKind === 'limited_discount' && (
                      <small className="pos-discount-price">
                        {t('Discounted label')} · {p.barcodes[0]}
                      </small>
                    )}
                    <span className="pos-product-price">
                      {formatMoney(p.price, currency)}
                      <small>/ {t(p.unit ?? '')}</small>
                    </span>
                    {p.regularPrice && (
                      <small className="pos-discount-price">
                        {t('Discount from')} <s>{formatMoney(p.regularPrice, currency)}</s>
                      </small>
                    )}
                    <span className="pos-stock">
                      {Number(p.stock)} {t(' on hand')}
                    </span>
                  </button>
                  <button
                    className="pos-favorite"
                    aria-label={t(
                      p.favorite ? 'Remove {name} from favorites' : 'Add {name} to favorites',
                      { name: p.name },
                    )}
                    aria-pressed={p.favorite}
                    disabled={favorite.isPending}
                    onClick={() => favorite.mutate({ id: p.id, value: !p.favorite })}
                  >
                    <Star size={20} fill={p.favorite ? 'currentColor' : 'none'} />
                  </button>
                </div>
              ))}
            </div>
            {catalog.isPending ? (
              <div className="empty">{t('Loading products…')}</div>
            ) : (
              !visible.length && (
                <div className="empty">
                  <Package size={32} />
                  <h3>{t('No matching products')}</h3>
                  <p className="muted">
                    {t('Try another search, or ask a manager to add products and stock. ')}
                  </p>
                </div>
              )
            )}
          </div>
          {!!catalog.data?.total && (
            <nav className="pos-pagination" aria-label={t('Product pages')}>
              <button disabled={page === 1 || catalog.isFetching} onClick={() => setPage(page - 1)}>
                {t('Previous')}
              </button>
              <span>
                {t('Page {page} of {pages}', {
                  page: String(page),
                  pages: String(Math.ceil(catalog.data.total / 20)),
                })}
              </span>
              <button
                disabled={page * 20 >= catalog.data.total || catalog.isFetching}
                onClick={() => setPage(page + 1)}
              >
                {t('Next')}
              </button>
            </nav>
          )}
        </section>
        <aside className="pos-cart">
          <div className="cart-heading">
            <h2>
              {t('Current sale ')}
              <span>{draft.lines.length}</span>
            </h2>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('Clear cart')}
              onClick={() => setConfirmClear(true)}
              disabled={frozen || !draft.lines.length}
            >
              <Trash2 size={16} />
            </Button>
          </div>
          <div className="cart-lines">
            {draft.lines.length ? (
              draft.lines.map((l) => (
                <CartLine
                  key={l.product.markdownUnitId ?? l.product.id}
                  line={l}
                  currency={currency}
                  discount={draft.pending?.discountPercent ?? '0'}
                  disabled={frozen}
                  lockedQuantity={!!l.product.markdownUnitId}
                  onChange={(value) => {
                    if (toScaled(value, 3) > toScaled(l.product.stock, 3)) {
                      rejectScan(t('Not enough stock for {value0}.', { value0: l.product.name }));
                      return false;
                    }
                    setDraft((d) => ({
                      ...d,
                      lines: d.lines.map((i) =>
                        (i.product.markdownUnitId ?? i.product.id) ===
                        (l.product.markdownUnitId ?? l.product.id)
                          ? { ...i, quantity: value }
                          : i,
                      ),
                    }));
                    return true;
                  }}
                  onRemove={() =>
                    setDraft((d) => ({
                      ...d,
                      lines: d.lines.filter(
                        (i) =>
                          (i.product.markdownUnitId ?? i.product.id) !==
                          (l.product.markdownUnitId ?? l.product.id),
                      ),
                    }))
                  }
                />
              ))
            ) : (
              <div className="cart-empty">
                <ShoppingBag size={39} />
                <h3>{t('Your next sale starts here.')}</h3>
                <p>
                  {t('Scan a barcode or tap a product ')}
                  <br />
                  {t('to add it to the cart. ')}
                </p>
              </div>
            )}
          </div>
          <div className="cart-bottom">
            <div className="cart-tools">
              <Button
                variant="outline"
                onClick={hold}
                disabled={frozen || !draft.lines.length || held.length >= 10}
              >
                <Pause size={14} />
                {t('Hold ')}
              </Button>
              <Button variant="outline" onClick={() => setModal('held')} disabled={frozen}>
                {t('Held carts (')}
                {held.length})
              </Button>
            </div>
            <dl className="cart-summary">
              <div>
                <dt>{t('Subtotal')}</dt>
                <dd>{formatMoney(fromScaled(totals.subtotal, 2), currency)}</dd>
              </div>
              {totals.discount > 0n && (
                <div>
                  <dt>{t('Discount')}</dt>
                  <dd>−{formatMoney(fromScaled(totals.discount, 2), currency)}</dd>
                </div>
              )}
              <div>
                <dt>{t('Included tax')}</dt>
                <dd>{formatMoney(fromScaled(totals.tax, 2), currency)}</dd>
              </div>
              <div className="cart-total">
                <dt>{t('Total')}</dt>
                <dd>{formatMoney(total, currency)}</dd>
              </div>
            </dl>
            <ErrorMessage error={storageError} />
            {draft.pending && (
              <p className="notice">
                {t(
                  'Payment is not yet confirmed. Retry this same request to safely recover the result. ',
                )}
              </p>
            )}
            <Button
              className="full pay-button"
              disabled={!context.shift || !draft.lines.length || checkout.isPending}
              onClick={() => {
                setMessage('');
                setMethod(draft.pending?.payment.method ?? 'cash');
                setTendered(draft.pending?.payment.tendered ?? '');
                setModal('payment');
              }}
            >
              <Banknote size={18} />
              {draft.pending ? t('Recover payment') : t('Take payment')}
              <ArrowRight size={18} />
            </Button>
            <p className="cart-footnote">{t('Prices include each product’s configured tax.')}</p>
          </div>
        </aside>
      </div>
      <footer className="pos-footer">
        <div>
          <span className="status-dot" />
          {t('Online checkout · drafts saved on this tab ')}
        </div>
        <div>
          <ReceiptSearch context={context} />
          <Button variant="ghost" size="sm" onClick={() => setModal('history')}>
            <Clock3 size={14} />
            {t('Recent receipts ')}
          </Button>
          {context.shift && context.operator!.permissions.includes('cash.manage') && (
            <Button variant="ghost" size="sm" onClick={() => setModal('cash')}>
              {t('Cash in / out ')}
            </Button>
          )}
          {context.shift && (
            <Button
              variant="outline"
              size="sm"
              disabled={frozen || draft.lines.length > 0 || held.length > 0}
              onClick={() => setModal('close')}
            >
              {t('Close shift ')}
            </Button>
          )}
          <a href="/" className="text-link">
            {t('Management ')}
          </a>
          <LanguageSwitcher />
        </div>
      </footer>
      <Dialog
        open={modal === 'start' || modal === 'close' || modal === 'cash'}
        onOpenChange={(v) => !v && setModal(null)}
        title={
          modal === 'start'
            ? t('Start your shift')
            : modal === 'cash'
              ? t('Cash in / cash out')
              : t('Close your shift')
        }
        description={context.device!.name}
      >
        {(modal === 'start' || modal === 'close' || modal === 'cash') && (
          <ShiftForm context={context} mode={modal} onDone={() => setModal(null)} />
        )}
      </Dialog>
      <Dialog
        open={!!weighted}
        onOpenChange={(v) => !v && setWeighted(null)}
        title={weighted ? t('Add {value0}', { value0: weighted.name }) : t('Enter quantity')}
        description={t('Enter quantity in {value0}.', {
          value0: t(weighted?.unit ?? 'the product unit'),
        })}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const value = String(new FormData(e.currentTarget).get('quantity'));
            if (!/^\d{1,9}(\.\d{1,3})?$/.test(value) || toScaled(value, 3) <= 0n) {
              setMessage('Enter a positive quantity with at most three decimal places.');
              return;
            }
            if (weighted) add(weighted, value);
          }}
        >
          <Field label={t('Quantity / weight')}>
            <input
              name="quantity"
              inputMode="decimal"
              required
              autoFocus
              placeholder={t('e.g. 1.350')}
            />
          </Field>
          <Button className="full">{t('Add to cart')}</Button>
        </form>
      </Dialog>
      <Dialog
        open={modal === 'payment'}
        onOpenChange={(v) => !v && !checkout.isPending && setModal(null)}
        title={t('Take payment')}
        description={t('Total {value0} · {value1}', {
          value0: formatMoney(total, currency),
          value1: context.operator!.name,
        })}
      >
        <form onSubmit={submitPayment}>
          <div className="payment-methods">
            <button
              type="button"
              disabled={!!draft.pending}
              className={method === 'cash' ? 'selected' : ''}
              onClick={() => setMethod('cash')}
            >
              <Banknote />
              {t('Cash ')}
            </button>
            <button
              type="button"
              disabled={!!draft.pending}
              className={method === 'card' ? 'selected' : ''}
              onClick={() => setMethod('card')}
            >
              <CreditCard />
              {t('Card ')}
            </button>
          </div>
          {method === 'cash' ? (
            <Field label={t('Cash tendered')}>
              <input
                inputMode="decimal"
                required
                value={tendered}
                disabled={!!draft.pending}
                onChange={(e) => setTendered(e.target.value)}
              />
            </Field>
          ) : (
            <label className="card-confirmation">
              <input type="checkbox" required />
              {t('The card payment has already been accepted on the external terminal. ')}
            </label>
          )}
          {method === 'cash' &&
            money.safeParse(tendered).success &&
            toScaled(tendered, 2) >= totals.total && (
              <p className="payment-change">
                {t('Change')}{' '}
                <strong>
                  {formatMoney(fromScaled(toScaled(tendered, 2) - totals.total, 2), currency)}
                </strong>
              </p>
            )}
          <ApprovalFields active={needsApproval} />
          <ErrorMessage error={checkout.error} />
          <ErrorMessage error={message || storageError} />
          <Button className="full" disabled={checkout.isPending}>
            {checkout.isPending
              ? t('Confirming sale…')
              : draft.pending
                ? t('Retry payment confirmation')
                : t('Complete sale')}
          </Button>
          <p className="muted payment-note">
            {t('Card payments are recorded here; this app does not charge a card terminal. ')}
          </p>
        </form>
      </Dialog>
      <Dialog
        open={modal === 'held'}
        onOpenChange={(v) => !v && setModal(null)}
        title={t('Held carts')}
        description={t('Held on this tab for the current cashier and shift.')}
      >
        {held.length ? (
          held.map((d, i) => (
            <div className="held-row" key={d.requestId}>
              <div>
                <strong>
                  {t('Cart ')}
                  {i + 1} · {d.lines.length} {t(' products ')}
                </strong>
                <small>{d.lines.map((l) => l.product.name).join(', ')}</small>
              </div>
              <Button variant="outline" onClick={() => resume(i)}>
                {t('Resume ')}
              </Button>
            </div>
          ))
        ) : (
          <p className="empty">{t('No held carts.')}</p>
        )}
      </Dialog>
      <Dialog
        open={modal === 'history'}
        onOpenChange={(v) => !v && setModal(null)}
        title={t('Recent receipts')}
        description={t('Your latest 20 sales on this register.')}
      >
        <ErrorMessage error={history.error} />
        {history.data?.map((r) => (
          <div className="held-row" key={r.id}>
            <div>
              <strong>{r.receiptNumber}</strong>
              <small>{formatMoney(r.total, r.currency)}</small>
            </div>
            <Button
              variant="outline"
              onClick={() => window.location.assign('/pos/receipts/' + r.id)}
            >
              {t('Open receipt ')}
            </Button>
          </div>
        ))}
      </Dialog>
      <Dialog
        open={!!receipt}
        onOpenChange={(v) => !v && setReceipt(null)}
        title={t('Sale complete')}
        description={t('Sale, payment, and inventory records have been saved.')}
      >
        {receipt && <ReceiptView receipt={receipt} />}
        <Button
          className="full no-print"
          onClick={() => {
            setReceipt(null);
            scan.current?.focus();
          }}
        >
          {t('Next customer ')}
          <ArrowRight size={16} />
        </Button>
      </Dialog>
      <Dialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title={t('Clear this cart?')}
        description={t(
          'This cancels the unfinished cart. No payment or inventory movement has been recorded.',
        )}
      >
        <div className="form-actions">
          <Button variant="outline" onClick={() => setConfirmClear(false)}>
            {t('Keep cart ')}
          </Button>
          <Button
            onClick={() => {
              setDraft(fresh());
              setConfirmClear(false);
            }}
          >
            {t('Clear cart ')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
function CartLine({
  line,
  currency,
  discount,
  disabled,
  lockedQuantity,
  onChange,
  onRemove,
}: {
  line: Line;
  currency: string;
  discount: string;
  disabled: boolean;
  lockedQuantity: boolean;
  onChange: (value: string) => boolean;
  onRemove: () => void;
}) {
  useLanguage();
  const [quantityInput, setQuantityInput] = useState(line.quantity);
  useEffect(() => setQuantityInput(line.quantity), [line.quantity]);
  return (
    <div className="cart-line">
      <div className="cart-line-top">
        <strong>{line.product.name}</strong>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('Remove {value0}', { value0: line.product.name })}
          disabled={disabled}
          onClick={onRemove}
        >
          <Trash2 size={14} />
        </Button>
      </div>
      <small>
        {formatMoney(line.product.price, currency)} / {t(line.product.unit ?? '')}
        {line.product.regularPrice && (
          <span className="pos-regular-price">
            {' '}
            · {t('Discount from')} <s>{formatMoney(line.product.regularPrice, currency)}</s>
          </span>
        )}
      </small>
      <div className="cart-line-bottom">
        <input
          aria-label={t('Quantity for {value0}', { value0: line.product.name })}
          value={quantityInput}
          inputMode="decimal"
          disabled={disabled || lockedQuantity}
          onChange={(e) => setQuantityInput(e.target.value)}
          onBlur={() => {
            if (
              !/^\d{1,9}(\.\d{1,3})?$/.test(quantityInput) ||
              toScaled(quantityInput, 3) <= 0n ||
              !onChange(quantityInput)
            )
              setQuantityInput(line.quantity);
          }}
        />
        <span>{t(line.product.unit ?? '')}</span>
        <strong>
          {formatMoney(
            calculatePricedLine(
              line.product.price,
              line.product.regularPrice,
              line.quantity,
              line.product.taxRate,
              discount,
            ).total,
            currency,
          )}
        </strong>
      </div>
    </div>
  );
}
