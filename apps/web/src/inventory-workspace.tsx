import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  History,
  PackageMinus,
  PackagePlus,
} from 'lucide-react';
import { useProducts, useSession } from './api';
import { AdjustmentForm, ErrorMessage } from './forms';
import { Button } from './components/ui/button';
import { formatQuantity } from './quantity-format';
import { stockReasonLabels, type StockAdjustmentResult } from './stock-adjustment';
import { t, useLanguage } from './i18n';
import './inventory-workspace.css';

export function InventoryPage() {
  useLanguage();
  const session = useSession().data!;
  const canAdjust = session.user.permissions.includes('inventory.adjust');
  const actions = [
    {
      to: '/inventory/add',
      title: 'Add stock',
      description: 'Add a quantity of a product to the store.',
      cta: 'Add',
      icon: PackagePlus,
      tone: 'add',
      allowed: canAdjust,
    },
    {
      to: '/inventory/remove',
      title: 'Remove stock',
      description: 'Write off expired, damaged or lost goods.',
      cta: 'Remove from stock',
      icon: PackageMinus,
      tone: 'remove',
      allowed: canAdjust,
    },
    {
      to: '/stock-counts',
      title: 'Stock count',
      description: 'Count products and correct discrepancies.',
      cta: 'Start',
      icon: ClipboardCheck,
      tone: 'count',
      allowed: true,
    },
    {
      to: '/inventory/history',
      title: 'Movement history',
      description: 'View all receipts, sales and stock write-offs.',
      cta: 'Open',
      icon: History,
      tone: 'history',
      allowed: true,
    },
  ] as const;
  return (
    <div className="inventory-workspace">
      <div className="page-heading">
        <div>
          <div className="eyebrow">{t('EVERY CHANGE ACCOUNTED FOR')}</div>
          <h1>{t('Inventory')}</h1>
          <p className="muted">{t('Choose what you want to do with stock.')}</p>
        </div>
      </div>
      <div className="inventory-actions">
        {actions.map(({ to, title, description, cta, icon: Icon, tone, allowed }) => {
          const content = (
            <>
              <span className={`inventory-action-icon inventory-action-icon-${tone}`}>
                <Icon size={28} strokeWidth={1.8} />
              </span>
              <h2>{t(title)}</h2>
              <p>{t(description)}</p>
              {to === '/stock-counts' && !session.store.advancedFeaturesEnabled && (
                <small className="inventory-action-note">
                  {t('Available when advanced features are enabled.')}
                </small>
              )}
              <span className="inventory-action-cta">
                {allowed ? (
                  <>
                    {t(cta)} <ArrowRight size={17} />
                  </>
                ) : (
                  t('Access restricted')
                )}
              </span>
            </>
          );
          return allowed ? (
            <Link key={to} to={to} className="inventory-action-card">
              {content}
            </Link>
          ) : (
            <div
              key={to}
              className="inventory-action-card inventory-action-disabled"
              aria-disabled="true"
            >
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function InventoryAdjustmentPage({ direction }: { direction: 'add' | 'remove' }) {
  useLanguage();
  const navigate = useNavigate();
  const session = useSession().data!;
  const products = useProducts();
  const [result, setResult] = useState<StockAdjustmentResult>();
  const [attempt, setAttempt] = useState(0);
  const canAdjust = session.user.permissions.includes('inventory.adjust');
  const product = products.data?.find((p) => p.id === result?.productId);
  return (
    <div className="inventory-workspace">
      <Link to="/inventory" className="text-link inventory-back">
        <ArrowLeft size={16} />
        {t('Back to inventory')}
      </Link>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{t('Inventory')}</div>
          <h1>{direction === 'add' ? t('Add stock') : t('Remove stock')}</h1>
          <p className="muted">
            {t('Select the product, quantity and reason for this operation.')}
          </p>
        </div>
      </div>
      {!canAdjust ? (
        <p className="notice">{t('Access restricted')}</p>
      ) : products.error ? (
        <ErrorMessage error={products.error} />
      ) : products.isPending ? (
        <p role="status">{t('Loading…')}</p>
      ) : result ? (
        <section
          className="panel inventory-operation-panel"
          aria-label={t('Stock operation recorded')}
        >
          <CheckCircle2 size={30} className="inventory-operation-success" />
          <h2>{t('Stock operation recorded')}</h2>
          <dl className="inventory-operation-result">
            <div>
              <dt>{t('Product')}</dt>
              <dd>{product?.name ?? '—'}</dd>
            </div>
            <div>
              <dt>{t('Stock change')}</dt>
              <dd>
                {formatQuantity(result.quantity)} {t(product?.unit ?? '')}
              </dd>
            </div>
            <div>
              <dt>{t('Reason')}</dt>
              <dd>{t(stockReasonLabels[result.reason])}</dd>
            </div>
            <div>
              <dt>{t('Balance after')}</dt>
              <dd>
                {formatQuantity(result.balance)} {t(product?.unit ?? '')}
              </dd>
            </div>
          </dl>
          <div className="inventory-operation-actions">
            <Button
              onClick={() => {
                setResult(undefined);
                setAttempt((value) => value + 1);
              }}
            >
              {t('Record another operation')}
            </Button>
            <Link to="/inventory/history" className="button button-outline">
              {t('Movement history')}
            </Link>
            <Link to="/inventory" className="text-link">
              {t('Back to inventory')}
            </Link>
          </div>
        </section>
      ) : (
        <section className="panel inventory-operation-panel">
          <AdjustmentForm
            key={direction + attempt}
            products={products.data ?? []}
            direction={direction}
            onRecorded={setResult}
            onDone={() => void navigate({ to: '/inventory' })}
          />
        </section>
      )}
    </div>
  );
}
