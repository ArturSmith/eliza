import { SupplierProductCard, type SupplierCatalogOffer } from './supplier-product-card';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Truck } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { SupplierProduct } from '@eliza/contracts';
import { api, useSession } from './api';
import { ErrorMessage } from './forms';
import { formatMoney } from './receipts';
import { t, useLanguage } from './i18n';

export type Offer = SupplierProduct & { cheapest: boolean; premiumPercent: number | null };

/** Supplier associations are managed from supplier pages and purchases. */
export function ProductSuppliers({ productId, unit }: { productId: string; unit: string }) {
  useLanguage();
  const currency = useSession().data!.store.currency;
  const q = useQuery({
    queryKey: ['product-suppliers', productId],
    queryFn: () => api<Offer[]>(`/products/${productId}/suppliers`),
  });
  const suppliers = [...(q.data ?? [])].sort((a, b) =>
    a.supplierName.localeCompare(b.supplierName),
  );
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>{t('Suppliers for this product')}</h2>
        <p>{t('Link products from a supplier page or when recording a purchase.')}</p>
      </div>
      <ErrorMessage error={q.error} />
      {q.isPending ? (
        <p className="panel-padding muted">{t('Loading…')}</p>
      ) : suppliers.length ? (
        <div className="product-supplier-cards">
          {suppliers.map((offer) => (
            <div key={offer.id} className="product-supplier-card">
              <Truck size={20} aria-hidden="true" />
              <div className="product-supplier-name">
                <Link to="/suppliers/$id" params={{ id: offer.supplierId }}>
                  <strong>{offer.supplierName}</strong>
                </Link>
                <small>
                  {[
                    offer.supplierSku,
                    offer.leadTimeDays === null
                      ? ''
                      : t('{value0} days', { value0: offer.leadTimeDays }),
                  ]
                    .filter(Boolean)
                    .join(' · ') || t('Lead time not specified')}
                </small>
              </div>
              <div className="product-supplier-price">
                <small>{t('Last purchase price')}</small>
                {offer.lastPaidCost == null ? (
                  <small>{t('No deliveries recorded yet.')}</small>
                ) : (
                  <>
                    <strong>{formatMoney(offer.lastPaidCost, currency)}</strong>
                    <small>
                      {t('per ')}
                      {t(unit)}
                    </small>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="panel-padding muted">{t('No suppliers linked to this product yet.')}</p>
      )}
    </section>
  );
}

/** What one supplier can supply. */
export function SupplierCatalog({ supplierId }: { supplierId: string }) {
  useLanguage();
  const session = useSession().data!;
  const currency = session.store.currency;
  const canManage = session.user.permissions.includes('suppliers.manage');
  const [search, setSearch] = useState('');
  const q = useQuery({
    queryKey: ['supplier-catalog', supplierId],
    queryFn: () => api<SupplierCatalogOffer[]>(`/suppliers/${supplierId}/products`),
  });
  const rows = (q.data ?? []).filter((o) =>
    [o.productName, o.sku, o.supplierSku].some((v) =>
      v?.toLowerCase().includes(search.trim().toLowerCase()),
    ),
  );
  return (
    <section className="panel supplier-products-panel">
      <div className="panel-heading">
        <h2>{t('Products from this supplier')}</h2>
        <p>{t('Linked products and their last recorded purchase prices.')}</p>
        {canManage && (
          <Link
            className="button button-outline"
            to="/suppliers/$id/products/new"
            params={{ id: supplierId }}
          >
            {t('Add product')}
          </Link>
        )}
      </div>
      <ErrorMessage error={q.error} />
      {q.data && q.data.length > 3 && (
        <div className="panel-padding">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('Search products…')}
            aria-label={t('Search products…')}
          />
        </div>
      )}
      {q.isPending ? (
        <p className="panel-padding muted">{t('Loading…')}</p>
      ) : rows.length ? (
        <div className="supplier-product-grid">
          {rows.map((offer) => (
            <SupplierProductCard
              key={offer.id}
              offer={offer}
              currency={currency}
              canOpen={session.user.permissions.includes('catalog.read')}
            />
          ))}
        </div>
      ) : (
        <p className="panel-padding muted">
          {q.data?.length
            ? t('No products match your search.')
            : t('No products linked to this supplier yet.')}
        </p>
      )}
    </section>
  );
}
