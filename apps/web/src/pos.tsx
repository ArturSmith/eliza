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
} from 'lucide-react';
import {
  calculateLine,
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
import { api, ApiError, queryClient } from './api';
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
    taxRate: money,
    category: z.string(),
    stock: quantity,
    plu: z.string(),
    barcodes: z.array(z.string()),
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
    return parsed.success ? parsed.data : fresh();
  } catch {
    return fresh();
  }
}
function approvalFields() {
  return (
    <div className="approval-fields">
      <div className="notice">
        Manager approval keeps this sale assigned to the current cashier.
      </div>
      <Field label="Manager employee code">
        <input name="employeeCode" autoComplete="off" required />
      </Field>
      <Field label="Manager PIN">
        <input
          name="pin"
          type="password"
          inputMode="numeric"
          pattern="[0-9]{6}"
          required
          maxLength={6}
          autoComplete="off"
        />
      </Field>
    </div>
  );
}
function approvalFrom(data: FormData) {
  return data.get('employeeCode')
    ? { employeeCode: String(data.get('employeeCode')), pin: String(data.get('pin')) }
    : undefined;
}
export function PosPage() {
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
  if (context.isPending) return <div className="loading">Opening register…</div>;
  if (context.error)
    return (
      <div className="connection-error">
        <ErrorMessage error={context.error} />
        <Button onClick={() => void context.refetch()}>Try again</Button>
        <a href="/">Back to management</a>
      </div>
    );
  if (!value?.registered)
    return (
      <div className="register-welcome">
        <a className="text-link" href="/">
          <ArrowLeft size={16} />
          Back to management
        </a>
        <div className="icon-tile">
          <Monitor size={26} />
        </div>
        <div className="eyebrow">CHECKOUT STARTS HERE</div>
        <h1>Give this register a name.</h1>
        <p className="muted">
          Sign in to management as the owner first, then enroll this browser. Set employee PINs in
          Team before starting.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            enroll.mutate({ name: new FormData(e.currentTarget).get('name') });
          }}
        >
          <Field label="Register name">
            <input name="name" required placeholder="e.g. Checkout 01" maxLength={120} />
          </Field>
          <ErrorMessage error={enroll.error} />
          <Button disabled={enroll.isPending} className="full">
            Enroll this register
            <ArrowRight size={16} />
          </Button>
        </form>
        <p className="muted">Enrollment ends the management session on this browser.</p>
      </div>
    );
  if (value.blocked)
    return (
      <div className="connection-error">
        <LockKeyhole size={35} />
        <h1>This register is blocked</h1>
        <p>Ask the owner to reactivate it from Devices.</p>
        <a href="/">Management sign in</a>
        <Button onClick={() => void context.refetch()}>Check again</Button>
      </div>
    );
  if (!value.operator)
    return (
      <div className="pin-screen">
        <div className="pin-brand">
          <ShoppingBag size={26} />
          eliza.
        </div>
        <div className="pin-card">
          <span className="icon-tile">
            <LockKeyhole size={25} />
          </span>
          <div className="eyebrow">
            {value.store?.name} · {value.device?.name}
          </div>
          <h1>Ready for your shift?</h1>
          <p className="muted">Use your employee code and six-digit PIN to unlock this register.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              login.mutate({ employeeCode: data.get('employeeCode'), pin: data.get('pin') });
            }}
          >
            <Field label="Employee code">
              <select name="employeeCode" required defaultValue="">
                <option value="" disabled>
                  Select your name
                </option>
                {value.employees?.map((e) => (
                  <option key={e.employeeCode} value={e.employeeCode}>
                    {e.name} · {e.employeeCode}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Register PIN">
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
              Unlock register
              <ArrowRight size={16} />
            </Button>
          </form>
          {!value.employees?.length && (
            <p className="notice">
              No employees have a PIN yet. Set one in Team using management login.
            </p>
          )}
          <a href="/" className="text-link">
            Management sign in
          </a>
        </div>
        <p className="muted">Your held cart stays on this tab while the register is locked.</p>
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
    <form onSubmit={submit}>
      {mode === 'start' ? (
        <Field
          label="Opening cash"
          hint="Count the cash already in the drawer before taking sales."
        >
          <input name="openingCash" inputMode="decimal" required defaultValue="0.00" />
        </Field>
      ) : mode === 'cash' ? (
        <>
          <Field label="Direction">
            <select name="direction">
              <option value="in">Cash in</option>
              <option value="out">Cash out / safe drop</option>
            </select>
          </Field>
          <Field label="Amount">
            <input name="amount" inputMode="decimal" required />
          </Field>
          <Field label="Reason">
            <input name="reason" required maxLength={300} />
          </Field>
        </>
      ) : (
        <>
          <p className="notice">
            Expected drawer cash:{' '}
            <strong>{formatMoney(context.shift!.expectedCash, context.store!.currency)}</strong>
          </p>
          <Field label="Counted cash">
            <input
              name="countedCash"
              inputMode="decimal"
              value={counted}
              onChange={(e) => setCounted(e.target.value)}
              required
            />
          </Field>
          <Field label="Closing notes">
            <textarea name="notes" maxLength={500} rows={2} />
          </Field>
          {needsApproval && approvalFields()}
          <p className="muted">
            Closing makes this shift’s totals permanent. Finish or hold your cart before closing.
          </p>
        </>
      )}
      <ErrorMessage error={mutation.error} />
      <div className="form-actions">
        <Button variant="outline" type="button" onClick={onDone}>
          Cancel
        </Button>
        <Button disabled={mutation.isPending}>
          {mutation.isPending
            ? 'Saving…'
            : mode === 'start'
              ? 'Start shift'
              : mode === 'cash'
                ? 'Record cash movement'
                : 'Close shift'}
        </Button>
      </div>
    </form>
  );
}
function RegisterWorkspace({ context }: { context: PosContext }) {
  const storageKey = `eliza-cart:${context.store!.id}:${context.device!.id}:${context.operator!.id}:${context.shift?.id ?? 'unopened'}`;
  const [draft, setDraft] = useState(() => loadDraft(storageKey));
  const [storageError, setStorageError] = useState<unknown>(null);
  const [held, setHeld] = useState<Draft[]>(() => {
    try {
      return z
        .array(draftSchema)
        .max(10)
        .parse(JSON.parse(sessionStorage.getItem(`${storageKey}:held`) ?? '[]'));
    } catch {
      return [];
    }
  });
  const catalog = useQuery({
    queryKey: ['pos-products', context.store!.id, context.operator!.id],
    queryFn: () => api<PosProduct[]>('/pos/products'),
    staleTime: 0,
  });
  const history = useQuery({
    queryKey: ['pos-sales', context.device!.id, context.operator!.id],
    queryFn: () => api<Receipt[]>('/pos/sales'),
  });
  const [search, setSearch] = useState(''),
    [category, setCategory] = useState('All products');
  const [message, setMessage] = useState('');
  const [modal, setModal] = useState<
    'payment' | 'start' | 'close' | 'cash' | 'held' | 'history' | null
  >(null);
  const [weighted, setWeighted] = useState<PosProduct | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [isReprint, setReprint] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const scan = useRef<HTMLInputElement>(null);
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
      const a = calculateLine(l.product.price, l.quantity, l.product.taxRate, draft.discount);
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
    toScaled(draft.discount, 2) > 1000n &&
    !context.operator!.permissions.includes('discount.approve');
  const checkout = useMutation({
    mutationFn: (body: z.infer<typeof saleSchema>) => api<Receipt>('/pos/sales', body),
    onSuccess: (r) => {
      setReceipt(r);
      setReprint(false);
      setDraft(fresh());
      setModal(null);
      setTendered('');
      void posRefresh();
    },
    onError: (error) => {
      if (error instanceof ApiError && [400, 409].includes(error.status))
        setDraft((d) => ({ ...d, pending: undefined, requestId: crypto.randomUUID() }));
    },
  });
  const frozen = !!draft.pending || checkout.isPending;
  function add(product: PosProduct, amount = '1') {
    if (frozen) return;
    setMessage('');
    setDraft((d) => {
      const index = d.lines.findIndex((l) => l.product.id === product.id);
      if (index >= 0) {
        const lines = d.lines.map((l, i) =>
          i === index
            ? { ...l, quantity: fromScaled(toScaled(l.quantity, 3) + toScaled(amount, 3), 3) }
            : l,
        );
        return { ...d, lines };
      }
      const { image: _image, ...cartProduct } = product;
      return { ...d, lines: [...d.lines, { product: cartProduct, quantity: amount }] };
    });
    setSearch('');
    setWeighted(null);
    setTimeout(() => scan.current?.focus(), 0);
  }
  function choose(p: PosProduct) {
    if (frozen) return;
    if (['piece', 'pack', 'box'].includes(p.unit)) add(p);
    else setWeighted(p);
  }
  function scanItem(e: FormEvent) {
    e.preventDefault();
    const term = search.trim();
    const exact =
      catalog.data?.filter((p) => p.barcodes.includes(term) || p.sku === term || p.plu === term) ??
      [];
    if (exact.length === 1) choose(exact[0]);
    else if (exact.length > 1)
      setMessage('This code matches multiple products. Select the correct product below.');
    else setMessage('Barcode not registered. Search by product name or ask a manager to add it.');
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
      })),
      discountPercent: draft.discount,
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
  const visible = (catalog.data ?? []).filter(
    (p) =>
      (category === 'All products' || p.category === category) &&
      (!search ||
        [p.name, p.sku, p.plu, ...p.barcodes].some((v) =>
          v.toLowerCase().includes(search.toLowerCase()),
        )),
  );
  const categories = ['All products', ...new Set(catalog.data?.map((p) => p.category))];
  return (
    <div className="pos-shell">
      <header className="pos-topbar">
        <div className="pos-brand">
          <ShoppingBag size={23} />
          <strong>eliza.</strong>
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
            {context.shift ? 'Shift open' : 'No open shift'}
          </span>
          <Button variant="outline" onClick={() => lock.mutate()} disabled={lock.isPending}>
            <LockKeyhole size={15} />
            Lock
          </Button>
        </div>
      </header>
      <div className="pos-body">
        <section className="pos-catalog">
          <div className="pos-heading">
            <div>
              <div className="eyebrow">A GOOD DAY IN STORE</div>
              <h1>Checkout</h1>
            </div>
            <Button
              variant="ghost"
              onClick={() => {
                void catalog.refetch();
                setMessage(
                  'Catalog refreshed. Existing cart prices stay unchanged; remove and re-add a line to use its new price.',
                );
              }}
            >
              <RefreshCw size={15} />
              Refresh products
            </Button>
          </div>
          {!context.shift && (
            <div className="pos-start-notice">
              <div>
                <strong>Let’s start your shift.</strong>
                <p>Count your opening float before taking the first sale.</p>
              </div>
              <Button onClick={() => setModal('start')}>
                Start shift
                <ArrowRight size={16} />
              </Button>
            </div>
          )}
          <form className="pos-search" onSubmit={scanItem}>
            <Barcode size={22} />
            <input
              ref={scan}
              autoFocus
              aria-label="Scan or search products"
              placeholder="Scan a barcode, enter a PLU, or search products…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setMessage('');
              }}
              disabled={frozen}
            />
            <kbd>Enter</kbd>
          </form>
          <div className="pos-categories">
            {categories.map((c) => (
              <button
                key={c}
                className={c === category ? 'selected' : ''}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>
          <ErrorMessage error={catalog.error ?? lock.error} />
          {message && (
            <p className="notice" role="status">
              {message}
            </p>
          )}
          <div className="pos-product-grid">
            {visible.map((p) => (
              <button
                className="pos-product"
                key={p.id}
                onClick={() => choose(p)}
                disabled={frozen || Number(p.stock) <= 0}
              >
                <span className={`product-icon color-${p.category.length % 4}`}>
                  {p.image ? <img src={p.image} alt="" loading="lazy" /> : <Package size={25} />}
                </span>
                <small>{p.category}</small>
                <strong>{p.name}</strong>
                <span className="pos-product-price">
                  {formatMoney(p.price, currency)}
                  <small>/ {p.unit}</small>
                </span>
                <span className="pos-stock">{Number(p.stock)} on hand</span>
              </button>
            ))}
          </div>
          {catalog.isPending ? (
            <div className="empty">Loading products…</div>
          ) : (
            !visible.length && (
              <div className="empty">
                <Package size={32} />
                <h3>No matching products</h3>
                <p className="muted">
                  Try another search, or ask a manager to add products and stock.
                </p>
              </div>
            )
          )}
        </section>
        <aside className="pos-cart">
          <div className="cart-heading">
            <h2>
              Current sale <span>{draft.lines.length}</span>
            </h2>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Clear cart"
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
                  key={l.product.id}
                  line={l}
                  currency={currency}
                  discount={draft.discount}
                  disabled={frozen}
                  onChange={(value) =>
                    setDraft((d) => ({
                      ...d,
                      lines: d.lines.map((i) =>
                        i.product.id === l.product.id ? { ...i, quantity: value } : i,
                      ),
                    }))
                  }
                  onRemove={() =>
                    setDraft((d) => ({
                      ...d,
                      lines: d.lines.filter((i) => i.product.id !== l.product.id),
                    }))
                  }
                />
              ))
            ) : (
              <div className="cart-empty">
                <ShoppingBag size={39} />
                <h3>Your next sale starts here.</h3>
                <p>
                  Scan a barcode or tap a product
                  <br />
                  to add it to the cart.
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
                Hold
              </Button>
              <Button variant="outline" onClick={() => setModal('held')} disabled={frozen}>
                Held carts ({held.length})
              </Button>
            </div>
            <Field label="Sale discount (%)">
              <input
                inputMode="decimal"
                value={draft.discount}
                disabled={frozen}
                onChange={(e) => {
                  const value = e.target.value || '0';
                  if (money.safeParse(value).success && toScaled(value, 2) <= 10000n)
                    setDraft((d) => ({ ...d, discount: value }));
                }}
              />
            </Field>
            <dl className="cart-summary">
              <div>
                <dt>Subtotal</dt>
                <dd>{formatMoney(fromScaled(totals.subtotal, 2), currency)}</dd>
              </div>
              <div>
                <dt>Discount</dt>
                <dd>−{formatMoney(fromScaled(totals.discount, 2), currency)}</dd>
              </div>
              <div>
                <dt>Included tax</dt>
                <dd>{formatMoney(fromScaled(totals.tax, 2), currency)}</dd>
              </div>
              <div className="cart-total">
                <dt>Total</dt>
                <dd>{formatMoney(total, currency)}</dd>
              </div>
            </dl>
            <ErrorMessage error={storageError} />
            {draft.pending && (
              <p className="notice">
                Payment is not yet confirmed. Retry this same request to safely recover the result.
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
              {draft.pending ? 'Recover payment' : 'Take payment'}
              <ArrowRight size={18} />
            </Button>
            <p className="cart-footnote">Prices include each product’s configured tax.</p>
          </div>
        </aside>
      </div>
      <ReceiptSearch context={context} />
      <footer className="pos-footer">
        <div>
          <span className="status-dot" />
          Online checkout · drafts saved on this tab
        </div>
        <div>
          <Button variant="ghost" size="sm" onClick={() => setModal('history')}>
            <Clock3 size={14} />
            Recent receipts
          </Button>
          {context.shift && context.operator!.permissions.includes('cash.manage') && (
            <Button variant="ghost" size="sm" onClick={() => setModal('cash')}>
              Cash in / out
            </Button>
          )}
          {context.shift && (
            <Button
              variant="outline"
              size="sm"
              disabled={frozen || draft.lines.length > 0 || held.length > 0}
              onClick={() => setModal('close')}
            >
              Close shift
            </Button>
          )}
          <a href="/" className="text-link">
            Management
          </a>
        </div>
      </footer>
      <Dialog
        open={modal === 'start' || modal === 'close' || modal === 'cash'}
        onOpenChange={(v) => !v && setModal(null)}
        title={
          modal === 'start'
            ? 'Start your shift'
            : modal === 'cash'
              ? 'Cash in / cash out'
              : 'Close your shift'
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
        title={weighted ? `Add ${weighted.name}` : 'Enter quantity'}
        description={`Enter quantity in ${weighted?.unit ?? 'the product unit'}.`}
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
          <Field label="Quantity / weight">
            <input
              name="quantity"
              inputMode="decimal"
              required
              autoFocus
              placeholder="e.g. 1.350"
            />
          </Field>
          <Button className="full">Add to cart</Button>
        </form>
      </Dialog>
      <Dialog
        open={modal === 'payment'}
        onOpenChange={(v) => !v && !checkout.isPending && setModal(null)}
        title="Take payment"
        description={`Total ${formatMoney(total, currency)} · ${context.operator!.name}`}
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
              Cash
            </button>
            <button
              type="button"
              disabled={!!draft.pending}
              className={method === 'card' ? 'selected' : ''}
              onClick={() => setMethod('card')}
            >
              <CreditCard />
              Card
            </button>
          </div>
          {method === 'cash' ? (
            <Field label="Cash tendered">
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
              The card payment has already been accepted on the external terminal.
            </label>
          )}
          {method === 'cash' &&
            money.safeParse(tendered).success &&
            toScaled(tendered, 2) >= totals.total && (
              <p className="payment-change">
                Change{' '}
                <strong>
                  {formatMoney(fromScaled(toScaled(tendered, 2) - totals.total, 2), currency)}
                </strong>
              </p>
            )}
          {needsApproval && approvalFields()}
          <ErrorMessage error={checkout.error} />
          <ErrorMessage error={message || storageError} />
          <Button className="full" disabled={checkout.isPending}>
            {checkout.isPending
              ? 'Confirming sale…'
              : draft.pending
                ? 'Retry payment confirmation'
                : 'Complete sale'}
          </Button>
          <p className="muted payment-note">
            Card payments are recorded here; this app does not charge a card terminal.
          </p>
        </form>
      </Dialog>
      <Dialog
        open={modal === 'held'}
        onOpenChange={(v) => !v && setModal(null)}
        title="Held carts"
        description="Held on this tab for the current cashier and shift."
      >
        {held.length ? (
          held.map((d, i) => (
            <div className="held-row" key={d.requestId}>
              <div>
                <strong>
                  Cart {i + 1} · {d.lines.length} products
                </strong>
                <small>{d.lines.map((l) => l.product.name).join(', ')}</small>
              </div>
              <Button variant="outline" onClick={() => resume(i)}>
                Resume
              </Button>
            </div>
          ))
        ) : (
          <p className="empty">No held carts.</p>
        )}
      </Dialog>
      <Dialog
        open={modal === 'history'}
        onOpenChange={(v) => !v && setModal(null)}
        title="Recent receipts"
        description="Your latest 20 sales on this register."
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
              onClick={() => {
                void api<Receipt>(`/pos/sales/${r.id}/reprint`, {})
                  .then((value) => {
                    setReceipt(value);
                    setReprint(true);
                    setModal(null);
                  })
                  .catch((e) => setMessage(e.message));
              }}
            >
              Reprint
            </Button>
          </div>
        ))}
      </Dialog>
      <Dialog
        open={!!receipt}
        onOpenChange={(v) => !v && setReceipt(null)}
        title="Sale complete"
        description="Sale, payment, and inventory records have been saved."
      >
        {receipt && <ReceiptView receipt={receipt} reprint={isReprint} />}
        <Button
          className="full no-print"
          onClick={() => {
            setReceipt(null);
            scan.current?.focus();
          }}
        >
          Next customer
          <ArrowRight size={16} />
        </Button>
      </Dialog>
      <Dialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear this cart?"
        description="This cancels the unfinished cart. No payment or inventory movement has been recorded."
      >
        <div className="form-actions">
          <Button variant="outline" onClick={() => setConfirmClear(false)}>
            Keep cart
          </Button>
          <Button
            onClick={() => {
              setDraft(fresh());
              setConfirmClear(false);
            }}
          >
            Clear cart
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
  onChange,
  onRemove,
}: {
  line: Line;
  currency: string;
  discount: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onRemove: () => void;
}) {
  const [quantityInput, setQuantityInput] = useState(line.quantity);
  useEffect(() => setQuantityInput(line.quantity), [line.quantity]);
  return (
    <div className="cart-line">
      <div className="cart-line-top">
        <strong>{line.product.name}</strong>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Remove ${line.product.name}`}
          disabled={disabled}
          onClick={onRemove}
        >
          <Trash2 size={14} />
        </Button>
      </div>
      <small>
        {formatMoney(line.product.price, currency)} / {line.product.unit}
      </small>
      <div className="cart-line-bottom">
        <input
          aria-label={`Quantity for ${line.product.name}`}
          value={quantityInput}
          inputMode="decimal"
          disabled={disabled}
          onChange={(e) => setQuantityInput(e.target.value)}
          onBlur={() => {
            if (/^\d{1,9}(\.\d{1,3})?$/.test(quantityInput) && toScaled(quantityInput, 3) > 0n)
              onChange(quantityInput);
            else setQuantityInput(line.quantity);
          }}
        />
        <span>{line.product.unit}</span>
        <strong>
          {formatMoney(
            calculateLine(line.product.price, line.quantity, line.product.taxRate, discount).total,
            currency,
          )}
        </strong>
      </div>
    </div>
  );
}
