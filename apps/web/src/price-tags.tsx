import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { LockKeyhole, Printer } from 'lucide-react';
import { api, queryClient } from './api';
import { t, useLanguage } from './i18n';
import { Button } from './components/ui/button';
import { ErrorMessage } from './forms';
import { CameraBarcodeScanner } from './camera-barcode-scanner';
import './price-tags.css';

type Context = {
  device: { id: string; name: string };
  store: { name: string; currency: string };
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
  const lock = useMutation({
    mutationFn: () => api('/price-tags/lock', {}),
    onSuccess: () => {
      setSelected([]);
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
    [product.name, product.sku, product.barcode, product.plu].some((text) =>
      text?.toLowerCase().includes(search.toLowerCase()),
    ),
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
        <label>
          {t('Find products')}
          <span className="price-tags-search-row">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('Name, SKU, PLU or barcode')}
            />
            <CameraBarcodeScanner onScan={setSearch} />
          </span>
        </label>
      </div>
      <ErrorMessage error={products.error ?? print.error} />
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
