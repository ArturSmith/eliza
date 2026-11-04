import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { Package } from 'lucide-react';
import type { Offer } from './supplier-products';
import { formatQuantity } from './quantity-format';
import { formatMoney } from './receipts';
import { t } from './i18n';
import './supplier-product-cards.css';

export type SupplierCatalogOffer = Offer & {
  productImage: string | null;
  productDescription: string;
  productCategory: string;
  productActive: boolean;
};

export function SupplierProductCard({
  offer,
  currency,
  canOpen,
  quoteDiffers,
  action,
}: {
  offer: SupplierCatalogOffer;
  currency: string;
  canOpen: boolean;
  quoteDiffers: boolean;
  action?: ReactNode;
}) {
  const content = (
    <>
      <span className="supplier-product-photo">
        {offer.productImage ? (
          <img src={offer.productImage} alt="" loading="lazy" />
        ) : (
          <Package size={48} strokeWidth={1.2} aria-hidden="true" />
        )}
      </span>
      <div className="supplier-product-info">
        <h3>{offer.productName}</h3>
        {offer.productDescription?.trim() && (
          <p className="supplier-product-description">{offer.productDescription}</p>
        )}
        {(offer.productCategory || offer.productActive === false || !offer.active) && (
          <div className="supplier-product-tags">
            {offer.productCategory && (
              <span className="badge badge-gray">{offer.productCategory}</span>
            )}
            {offer.productActive === false && (
              <span className="badge badge-amber">{t('Inactive product')}</span>
            )}
            {!offer.active && (
              <span className="badge badge-gray">{t('Inactive supplier price')}</span>
            )}
          </div>
        )}
        <div className="supplier-product-unit-price">
          <span>{t('Unit cost excl. tax')}</span>
          <strong>
            {offer.unitCost == null ? t('No price') : formatMoney(offer.unitCost, currency)}
          </strong>
          <small>
            {t('per ')}
            {t(offer.unit)}
          </small>
        </div>
        <dl className="supplier-product-facts">
          <div>
            <dt>{t('Price per pack')}</dt>
            <dd>
              {offer.packCost === null ? t('No price') : formatMoney(offer.packCost, currency)}
              <small>
                {formatQuantity(offer.packSize)} × {t(offer.unit)}
              </small>
            </dd>
          </div>
          <div>
            <dt>{t('Last purchase price')}</dt>
            <dd>
              {offer.lastPaidCost == null
                ? t('No deliveries recorded yet.')
                : formatMoney(offer.lastPaidCost, currency)}
              {quoteDiffers && <small className="delta-bad">{t('Differs from quote')}</small>}
            </dd>
          </div>
          <div>
            <dt>{t(offer.supplierSku ? 'Supplier item code' : 'SKU')}</dt>
            <dd>{offer.supplierSku || offer.sku}</dd>
          </div>
          <div>
            <dt>{t('Lead time')}</dt>
            <dd>
              {offer.leadTimeDays === null
                ? '—'
                : t('{value0} days', { value0: offer.leadTimeDays })}
            </dd>
          </div>
          {offer.minimumOrder != null && (
            <div>
              <dt>{t('Minimum order')}</dt>
              <dd>
                {formatQuantity(offer.minimumOrder)} {t(offer.unit)}
              </dd>
            </div>
          )}
        </dl>
      </div>
    </>
  );
  return (
    <article className="supplier-product-card" aria-label={offer.productName}>
      {canOpen ? (
        <Link
          to="/products/$id"
          params={{ id: offer.productId }}
          className="supplier-product-open"
          aria-label={t('View {value0}', { value0: offer.productName })}
        >
          {content}
        </Link>
      ) : (
        <div className="supplier-product-open">{content}</div>
      )}
      {action && <div className="supplier-product-actions">{action}</div>}
    </article>
  );
}
