import { Package } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { toScaled, type Product } from '@eliza/contracts';
import { formatMoney } from './receipts';
import { t } from './i18n';
import './product-catalog.css';

type Props = {
  product: Product;
  currency: string;
  onBarcode: () => void;
};

export function ProductCatalogCard({ product: p, currency, onBarcode }: Props) {
  const stock = toScaled(p.stock, 3);
  const stockTag = !p.active
    ? { label: t('Inactive'), tone: 'inactive' }
    : stock <= 0n
      ? { label: t('Out of stock'), tone: 'empty' }
      : stock <= toScaled(p.minStock, 3)
        ? { label: t('Low stock'), tone: 'low' }
        : null;
  return (
    <article className="catalog-card" aria-label={p.name}>
      <Link
        to="/products/$id"
        params={{ id: p.id }}
        className="catalog-card-open"
        aria-label={t('View {value0}', { value0: p.name })}
      >
        <span className="catalog-card-photo product-icon">
          {p.image ? (
            <img src={p.image} alt="" loading="lazy" />
          ) : (
            <Package size={48} strokeWidth={1.2} />
          )}
        </span>
        <span className="catalog-card-info">
          <span className="catalog-card-name">{p.name}</span>
          {p.description?.trim() && (
            <span className="catalog-card-description">{p.description}</span>
          )}
          {stockTag && (
            <span className={`catalog-card-tag catalog-card-tag-${stockTag.tone}`}>
              {stockTag.label}
            </span>
          )}
          <span className="catalog-card-price">
            <strong>{p.price == null ? t('Not set') : formatMoney(p.price, currency)}</strong>
            <small>
              {t('per ')}
              {t(p.unit)}
            </small>
          </span>
        </span>
      </Link>
      <div className="catalog-card-footer">
        <button type="button" className="product-barcode-link" onClick={onBarcode}>
          {p.barcodes[0] ?? t('View barcode')}
          {p.barcodes.length > 1 && <small> +{p.barcodes.length - 1}</small>}
        </button>
      </div>
    </article>
  );
}
