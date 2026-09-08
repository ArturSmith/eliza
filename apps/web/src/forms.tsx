import {
  useState,
  useId,
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type FormEvent,
  type ReactNode,
} from 'react';
import { useMutation } from '@tanstack/react-query';
import { Plus, ArrowRight, Store, PackagePlus } from 'lucide-react';
import {
  productSchema,
  setupSchema,
  adjustmentSchema,
  type Product,
  units,
} from '@eliza/contracts';
import { api, queryClient, refresh } from './api';
import { Button } from './components/ui/button';
import { Dialog } from './components/ui/dialog';
export function ErrorMessage({ error }: { error: unknown }) {
  return error ? (
    <p className="error" role="alert">
      {error instanceof Error ? error.message : String(error)}
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
  const id = useId();
  return (
    <label className="field">
      <span id={`${id}-label`}>{label}</span>
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
  const [error, setError] = useState<unknown>(null);
  const mutation = useMutation({
    mutationFn: (body: unknown) => api(`/auth/${setup ? 'setup' : 'login'}`, body),
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
          eliza<span className="brand-period">.</span>
        </div>
        <div>
          <span className="eyebrow">MADE FOR YOUR EVERYDAY</span>
          <h1>
            A little less admin.
            <br />A lot more store.
          </h1>
          <p>
            Your products, your stock, your people.
            <br />
            One clear place to bring it all together.
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
            <span className="illustration-label">Good things in store.</span>
          </div>
        </div>
        <small>Local software. Your store’s data stays with you.</small>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <div className="icon-tile">
            <Store size={25} />
          </div>
          <h2>{setup ? 'Let’s open your store' : 'Welcome back'}</h2>
          <p className="muted">
            {setup
              ? 'Create your local owner account. No external registration needed.'
              : 'Sign in to your store workspace.'}
          </p>
          <form onSubmit={submit}>
            {setup && (
              <>
                <Field label="Store name">
                  <input
                    name="storeName"
                    required
                    maxLength={120}
                    placeholder="e.g. Eliza Market"
                    autoFocus
                  />
                </Field>
                <Field label="Your name">
                  <input
                    name="ownerName"
                    autoComplete="name"
                    required
                    maxLength={120}
                    placeholder="Store owner"
                  />
                </Field>
              </>
            )}
            <Field label="Email address">
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
                placeholder="you@yourstore.com"
              />
            </Field>
            <Field
              label="Password"
              hint={
                setup
                  ? 'At least 12 characters. This account is created on your local server.'
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
                <Field label="Currency">
                  <select name="currency" defaultValue="NOK">
                    {['NOK', 'EUR', 'USD', 'GBP', 'SEK', 'DKK'].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Time zone">
                  <input name="timezone" required defaultValue="Europe/Oslo" />
                </Field>
              </div>
            )}
            <ErrorMessage error={error ?? mutation.error} />
            <Button disabled={mutation.isPending} className="full">
              {mutation.isPending ? 'Please wait…' : setup ? 'Create my store' : 'Sign in'}
              <ArrowRight size={17} />
            </Button>
          </form>
          <p className="auth-foot">
            {setup
              ? 'You can start adding products right away.'
              : 'Forgot your password? Local account recovery is not available yet.'}
          </p>
        </div>
      </section>
    </div>
  );
}
export function ProductForm({ onDone, initial }: { onDone: () => void; initial?: Product }) {
  const [error, setError] = useState<unknown>(null);
  const mutation = useMutation({
    mutationFn: (body: unknown) =>
      api(initial ? `/products/${initial.id}` : '/products', body, initial ? 'PATCH' : 'POST'),
    onSuccess: () => {
      void refresh();
      onDone();
    },
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    setError(null);
    const data = values(e);
    const result = productSchema.safeParse({
      ...data,
      barcodes: String(data.barcodes)
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean),
    });
    if (!result.success) {
      setError(result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('. '));
      return;
    }
    mutation.mutate(result.data);
  }
  return (
    <form onSubmit={submit}>
      <Field label="Product name">
        <input
          name="name"
          placeholder="e.g. Organic whole milk"
          defaultValue={initial?.name}
          required
          maxLength={120}
        />
      </Field>
      <div className="form-grid">
        <Field label="SKU">
          <input
            name="sku"
            placeholder="e.g. MILK-001"
            defaultValue={initial?.sku}
            required
            maxLength={120}
          />
        </Field>
        <Field label="Category">
          <input
            name="category"
            list="categories"
            placeholder="e.g. Dairy"
            defaultValue={initial?.category}
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
        <Field label="Selling price">
          <input
            name="price"
            inputMode="decimal"
            placeholder="0.00"
            defaultValue={initial?.price}
            required
          />
        </Field>
        <Field label="Purchase cost">
          <input
            name="cost"
            inputMode="decimal"
            placeholder="0.00"
            defaultValue={initial?.cost ?? undefined}
            required
          />
        </Field>
      </div>
      <div className="form-grid">
        <Field label="Unit">
          <select name="unit" defaultValue={initial?.unit ?? 'piece'}>
            {units.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Low-stock threshold">
          <input
            name="minStock"
            inputMode="decimal"
            defaultValue={initial?.minStock ?? '5'}
            required
          />
        </Field>
      </div>
      <Field
        label="Barcodes (optional)"
        hint="Add one per line, or separate with commas. Products can have no barcode."
      >
        <textarea
          name="barcodes"
          rows={2}
          defaultValue={initial?.barcodes.join('\n')}
          placeholder="Scan or enter a barcode"
        />
      </Field>
      <Field label="PLU / short code (optional)">
        <input name="plu" defaultValue={initial?.plu} maxLength={20} placeholder="e.g. 4011" />
      </Field>
      <ErrorMessage error={error ?? mutation.error} />
      <div className="form-actions">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button disabled={mutation.isPending}>
          <PackagePlus size={17} />
          {mutation.isPending ? 'Saving…' : initial ? 'Save changes' : 'Create product'}
        </Button>
      </div>
    </form>
  );
}
export function AddProduct() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus size={17} />
        Add product
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Add a product"
        description="Start with the basics. Record opening stock in Inventory."
      >
        <ProductForm onDone={() => setOpen(false)} />
      </Dialog>
    </>
  );
}
export function AdjustmentForm({ products, onDone }: { products: Product[]; onDone: () => void }) {
  const [error, setError] = useState<unknown>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
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
    const result = adjustmentSchema.safeParse({ ...data, requestId });
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
      <Field label="Product">
        <select name="productId" required defaultValue="">
          <option value="" disabled>
            Select a product
          </option>
          {products
            .filter((p) => p.active)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {Number(p.stock)} {p.unit} on hand
              </option>
            ))}
        </select>
      </Field>
      <Field
        label="Quantity change"
        hint="Use a positive quantity to add stock or a negative quantity to remove it."
      >
        <input name="quantity" placeholder="e.g. 24 or -2" inputMode="decimal" required />
      </Field>
      <Field label="Reason">
        <select name="reason">
          <option value="opening_balance">Opening stock</option>
          <option value="received">Goods received (manual)</option>
          <option value="count_correction">Count correction</option>
          <option value="damaged">Damaged goods</option>
          <option value="expired">Expired goods</option>
          <option value="internal_use">Internal use</option>
          <option value="other">Other</option>
        </select>
      </Field>
      <Field label="Notes">
        <textarea
          name="notes"
          rows={3}
          maxLength={500}
          placeholder="Add a reference or explain the change"
        />
      </Field>
      <div className="notice">
        This creates a permanent stock movement attributed to your account and device.
      </div>
      <ErrorMessage error={error ?? mutation.error} />
      <div className="form-actions">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button disabled={mutation.isPending}>
          {mutation.isPending ? 'Recording…' : 'Record adjustment'}
        </Button>
      </div>
    </form>
  );
}
