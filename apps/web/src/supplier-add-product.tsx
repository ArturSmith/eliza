import { useId, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Package, Plus } from 'lucide-react';
import type { Product, Supplier } from '@eliza/contracts';
import { api, refresh, useSession } from './api';
import { Button } from './components/ui/button';
import { CameraBarcodeScanner } from './camera-barcode-scanner';
import { ErrorMessage, ProductForm } from './forms';
import type { Offer } from './supplier-products';
import { t, useLanguage } from './i18n';

/** Find the shared product first; supplier prices remain a separate, optional detail. */
export function SupplierAddProduct({
  supplier,
  onDone,
}: {
  supplier: Supplier;
  onDone: () => void;
}) {
  useLanguage();
  const session = useSession().data!;
  const canRead = session.user.permissions.includes('catalog.read');
  const canCreate = session.user.permissions.includes('catalog.write');
  const inputId = useId();
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const products = useQuery({
    queryKey: ['products'],
    queryFn: () => api<Product[]>('/products'),
    enabled: canRead,
    staleTime: 0,
  });
  const catalog = useQuery({
    queryKey: ['supplier-catalog', supplier.id],
    queryFn: () => api<Offer[]>(`/suppliers/${supplier.id}/products`),
    staleTime: 0,
  });
  const link = useMutation({
    mutationFn: (product: Product) =>
      api(`/suppliers/${supplier.id}/products`, {
        requestId: crypto.randomUUID(),
        productId: product.id,
      }),
    onSuccess: async () => {
      await refresh();
      onDone();
    },
  });
  const term = query.trim().toLocaleLowerCase();
  const matches = (products.data ?? []).filter((product) =>
    [product.name, product.sku, product.plu ?? '', ...product.barcodes].some((value) =>
      value.toLocaleLowerCase().includes(term),
    ),
  );
  const isLinked = (id: string) =>
    catalog.data?.some((offer) => offer.productId === id && offer.active);
  const loading = products.isPending || catalog.isPending;
  const error = products.error || catalog.error;
  const available = matches.filter((product) => product.active && !isLinked(product.id));
  if (!canRead) return <p className="notice">{t('Access restricted')}</p>;
  if (!supplier.active) return <p className="notice">{t('Choose an active supplier.')}</p>;
  if (creating)
    return (
      <section className="panel purchasing-form-panel supplier-add-product">
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setCreating(false);
            link.reset();
          }}
          disabled={link.isPending}
        >
          <ArrowLeft size={16} />
          {t('Back to product search')}
        </Button>
        <div>
          <h2>{t('Create product')}</h2>
          <p className="muted">
            {t('The new product will be added to {supplier} automatically.', {
              supplier: supplier.name,
            })}
          </p>
        </div>
        <ErrorMessage error={link.error} />
        <fieldset className="purchasing-fields-reset" disabled={link.isPending}>
          <ProductForm
            supplierId={supplier.id}
            prefill={
              /^\d{8,14}$/.test(query.trim())
                ? { barcodes: [query.trim()] }
                : { name: query.trim() }
            }
            onCreated={onDone}
            onExisting={(product) => link.mutate(product)}
            onDone={() => setCreating(false)}
          />
        </fieldset>
      </section>
    );
  return (
    <section className="panel purchasing-form-panel supplier-add-product">
      <div className="field supplier-product-search-field">
        <label htmlFor={inputId}>{t('Find a product')}</label>
        <div className="barcode-input-with-camera">
          <input
            id={inputId}
            type="search"
            autoFocus
            autoComplete="off"
            placeholder={t('Name, SKU, PLU or barcode')}
            value={query}
            disabled={link.isPending}
            onChange={(event) => {
              setQuery(event.target.value);
              link.reset();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                if (!loading && !error && !link.isPending && term && available.length === 1)
                  link.mutate(available[0]);
              }
            }}
          />
          <CameraBarcodeScanner
            disabled={link.isPending}
            onScan={(code) => {
              setQuery(code);
              link.reset();
            }}
          />
        </div>
      </div>
      <ErrorMessage error={error || link.error} />
      {loading ? (
        <p role="status">{t('Loading products…')}</p>
      ) : !error && term ? (
        matches.length ? (
          <div
            className="supplier-product-search-results"
            aria-label={t('Products')}
            aria-busy={link.isPending}
          >
            {matches.slice(0, 40).map((product) => (
              <button
                type="button"
                key={product.id}
                className="supplier-product-search-result"
                disabled={link.isPending || !product.active || isLinked(product.id)}
                onClick={() => link.mutate(product)}
                aria-label={t('Add {product} to supplier', { product: product.name })}
              >
                <span className="supplier-product-search-photo">
                  {product.image ? (
                    <img src={product.image} alt="" />
                  ) : (
                    <Package size={25} aria-hidden="true" />
                  )}
                </span>
                <span className="supplier-product-search-info">
                  <strong>{product.name}</strong>
                  <small>{[product.sku, ...product.barcodes].filter(Boolean).join(' · ')}</small>
                  {isLinked(product.id) ? (
                    <small>{t('Already added to this supplier')}</small>
                  ) : !product.active ? (
                    <small>{t('Inactive product')}</small>
                  ) : null}
                </span>
                {!isLinked(product.id) && product.active && (
                  <ArrowRight size={18} aria-hidden="true" />
                )}
              </button>
            ))}
            {matches.length > 40 && (
              <p className="muted">{t('Refine your search to see more products.')}</p>
            )}
          </div>
        ) : products.isFetching ? (
          <p role="status">{t('Loading products…')}</p>
        ) : (
          <div className="supplier-product-search-empty">
            {canCreate ? (
              <Button type="button" onClick={() => setCreating(true)}>
                <Plus size={18} />
                {t('Nothing found — create new product')}
              </Button>
            ) : (
              <p>{t('No products found. Ask a manager to create the product.')}</p>
            )}
          </div>
        )
      ) : null}
    </section>
  );
}
