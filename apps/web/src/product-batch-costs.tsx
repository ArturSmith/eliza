import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronDown, Truck } from 'lucide-react';
import type { Product } from '@eliza/contracts';
import { api, useSession } from './api';
import { ErrorMessage } from './forms';
import { Button } from './components/ui/button';
import { formatMoney } from './receipts';
import { formatQuantity } from './quantity-format';
import { getLocale, t, useLanguage } from './i18n';

type Batch = {
  id: string;
  quantity: string;
  unitCost: string | null;
  supplierName: string | null;
  supplierId: string | null;
  supplierCode: string | null;
  createdAt: string;
  expiryDate: string | null;
  costSource: string | null;
};
export function ProductBatchCosts({ product }: { product: Product }) {
  useLanguage();
  const session = useSession().data!;
  const [expanded, setExpanded] = useState(false);
  const headingId = useId();
  const listId = useId();
  const canReadCosts = session.user.permissions.includes('costs.read');
  const canReadSuppliers = session.user.permissions.includes('suppliers.read');
  const allowed = session.user.permissions.includes('inventory.read');
  const batches = useQuery({
    queryKey: ['stock-batches', product.id],
    queryFn: () => api<{ batches: Batch[] }>(`/inventory/products/${product.id}/batches`),
    enabled: canReadCosts && allowed,
  });
  if (!canReadCosts) return null;
  const latest = [...(batches.data?.batches ?? [])].sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || b.id.localeCompare(a.id),
  );
  const visible = expanded ? latest : latest.slice(0, 2);
  const date = (value: string) =>
    new Date(value).toLocaleDateString(getLocale(), { timeZone: session.store.timezone });
  const currency = session.store.currency;
  return (
    <section className="panel product-batch-costs" aria-labelledby={headingId}>
      <div className="panel-heading">
        <h2 id={headingId}>{t('Stock batches')}</h2>
      </div>
      <dl className="product-cost-summary">
        <div>
          <dt>{t('Stock value')}</dt>
          <dd>{formatMoney(product.stockValue, currency)}</dd>
        </div>
        <div>
          <dt>{t('Last purchase price')}</dt>
          <dd>
            {formatMoney(product.lastPurchaseCost, currency)}
            {product.lastPurchaseSupplier && <small>{product.lastPurchaseSupplier}</small>}
            {product.lastPurchaseAt && <small>{date(product.lastPurchaseAt)}</small>}
          </dd>
        </div>
      </dl>
      <ErrorMessage error={batches.error} />
      {allowed &&
        (batches.isPending ? (
          <p className="panel-padding" role="status">
            {t('Loading…')}
          </p>
        ) : latest.length ? (
          <div className="product-batch-list" id={listId}>
            {visible.map((batch) => (
              <article className="product-batch-row" key={batch.id}>
                <div className="product-batch-heading">
                  <div className="product-batch-supplier">
                    <Truck size={14} aria-hidden="true" />
                    <span>
                      <span className="sr-only">{t('Supplier')}: </span>
                      {canReadSuppliers && batch.supplierId && batch.supplierName ? (
                        <Link to="/suppliers/$id" params={{ id: batch.supplierId }}>
                          {batch.supplierName}
                        </Link>
                      ) : (
                        <strong>
                          {canReadSuppliers
                            ? batch.supplierName || t('Supplier not recorded')
                            : t('Restricted')}
                        </strong>
                      )}
                      {batch.supplierCode && <small>{batch.supplierCode}</small>}
                    </span>
                  </div>
                  <time dateTime={batch.createdAt}>{date(batch.createdAt)}</time>
                </div>
                <dl className="product-batch-facts">
                  <div>
                    <dt>{t('Quantity')}</dt>
                    <dd>
                      {formatQuantity(batch.quantity)} {t(product.unit)}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('Purchase cost')}</dt>
                    <dd>
                      {batch.unitCost === null
                        ? t('Cost is unknown')
                        : formatMoney(batch.unitCost, currency)}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('Expiry date')}</dt>
                    <dd>{batch.expiryDate ?? '—'}</dd>
                  </div>
                </dl>
                {batch.costSource === 'legacy_estimate' && (
                  <small className="product-batch-source">{t('Estimated historical cost')}</small>
                )}
              </article>
            ))}
          </div>
        ) : (
          !batches.error && (
            <p className="panel-padding muted">{t('No stock batches for this product.')}</p>
          )
        ))}
      {allowed && latest.length > 2 && (
        <div className="product-batch-expand">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={() => setExpanded((current) => !current)}
          >
            {t(expanded ? 'Show less' : 'Show all')}
            {!expanded && ` (${latest.length})`}
            <ChevronDown
              size={16}
              aria-hidden="true"
              className={expanded ? 'is-expanded' : undefined}
            />
          </Button>
        </div>
      )}
      <div className="product-batch-notes">
        {Number(product.unknownCostQuantity ?? 0) > 0 && (
          <p className="notice">
            {t(
              'Cost is unknown for {quantity} units. Stock value and profit cannot be calculated completely.',
              { quantity: formatQuantity(product.unknownCostQuantity!) },
            )}
          </p>
        )}
        <p className="product-details-hint">
          {t(
            'The average uses the remaining batches. Sale profit uses the cost saved at checkout; new deliveries do not change past sales.',
          )}
          {product.stockCostEstimated && <> {t('Includes estimated historical costs.')}</>}
        </p>
      </div>
    </section>
  );
}
