import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import JsBarcode from 'jsbarcode';
import { ChevronDown } from 'lucide-react';
import { createPortal } from 'react-dom';
import { type Product } from '@eliza/contracts';
import { api, refresh } from './api';
import { Button } from './components/ui/button';
import { t, translateError, useLanguage } from './i18n';
import { formatMoney } from './receipts';

type Offer = {
  id: string;
  price: string;
  regularPrice: string;
  stock: string;
  expiryDate: string | null;
  barcode: string;
  sellable: boolean;
};
type Details = {
  product: {
    id: string;
    name: string;
    unit: string;
    price: string;
    regularPrice: string | null;
    checkoutPrice: string;
    stock: string;
  };
  batches: { quantity: string; sellable: boolean }[];
  offers: Offer[];
};
type Label = {
  id: string;
  name: string;
  barcode: string;
  quantity: number;
  price: string;
  regularPrice: string;
  expiryDate: string | null;
};
type MarkdownUnit = {
  id: string;
  barcode: string;
  status: string;
  replacementForId: string | null;
  price: string;
  regularPrice: string;
  expiryDate: string | null;
  validUntil: string | null;
};

function PrintedBarcode({ code }: { code: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (ref.current)
      JsBarcode(ref.current, code, {
        format: 'EAN13',
        width: 2,
        height: 65,
        margin: 8,
        displayValue: true,
      });
  }, [code]);
  return <svg ref={ref} aria-label={t('Barcode {value0}', { value0: code })} />;
}

export function PriceActions({
  product,
  currency,
  regularPriceChanged = false,
}: {
  product: Product;
  currency?: string;
  regularPriceChanged?: boolean;
}) {
  useLanguage();
  const [expanded, setExpanded] = useState(false);
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [reason, setReason] = useState('EXPIRING_SOON');
  const [validUntil, setValidUntil] = useState('');
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [labels, setLabels] = useState<Label[]>([]);
  const [replacedLabel, setReplacedLabel] = useState(false);
  const details = useQuery({
    queryKey: ['price-actions', product.id],
    queryFn: () => api<Details>(`/products/${product.id}/pricing`),
  });
  const markdowns = useQuery({
    queryKey: ['markdown-units', product.id],
    queryFn: () => api<MarkdownUnit[]>(`/products/${product.id}/pricing/markdowns`),
  });
  const labelAction = useMutation({
    mutationFn: ({ id, kind }: { id: string; kind: 'cancel' | 'replace' }) =>
      api<{ label?: Label }>(`/products/${product.id}/pricing/markdowns/${id}/${kind}`, {}),
    onSuccess: (result, { kind }) => {
      setLabels(result.label ? [result.label] : []);
      setReplacedLabel(kind === 'replace');
      void markdowns.refetch();
      void details.refetch();
      void refresh();
    },
  });
  const action = useMutation({
    mutationFn: () =>
      api<{ labels: Label[] }>(`/products/${product.id}/pricing/limited`, {
        requestId,
        quantity: Number(quantity),
        price,
        reason,
        ...(validUntil ? { validUntilLocal: validUntil } : {}),
      }),
    onSuccess: (result) => {
      setLabels(result.labels);
      setReplacedLabel(false);
      setRequestId(crypto.randomUUID());
      setPrice('');
      void details.refetch();
      void markdowns.refetch();
      void refresh();
    },
  });
  const current = details.data?.product;
  const activeLabels = (markdowns.data ?? []).filter((unit) => unit.status === 'AVAILABLE');
  const labelHistory = (markdowns.data ?? []).filter((unit) => unit.status !== 'AVAILABLE');
  const replacementById = new Map(
    (markdowns.data ?? [])
      .filter((unit) => unit.replacementForId)
      .map((unit) => [unit.replacementForId, unit.barcode]),
  );
  const available =
    details.data?.batches.reduce(
      (sum, batch) => sum + (batch.sellable ? Math.floor(Number(batch.quantity)) : 0),
      0,
    ) ?? 0;
  const wholeUnit = !!current && ['piece', 'pack', 'box'].includes(current.unit);
  const validPrice =
    Number.isFinite(Number(price)) &&
    Number(price) >= 0 &&
    price !== '' &&
    Number(price) < Number(current?.checkoutPrice);
  const validQuantity =
    Number.isInteger(Number(quantity)) &&
    Number(quantity) >= 1 &&
    Number(quantity) <= 500 &&
    Number(quantity) <= available;
  const canApply = !!current && !regularPriceChanged && validPrice && wholeUnit && validQuantity;
  return (
    <section className="price-actions price-actions-collapsible" aria-label={t('Unit markdown')}>
      <button
        type="button"
        className="price-actions-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        <span>
          <strong>{t('Unit markdown')}</strong>
          <small>{t('Create one-use barcode labels for specific physical items.')}</small>
        </span>
        <ChevronDown size={20} aria-hidden="true" />
      </button>
      {expanded && (
        <div className="price-actions-content">
          {details.error && (
            <p className="error" role="alert">
              {translateError(String(details.error))}
            </p>
          )}
          {action.error && (
            <p className="error" role="alert">
              {translateError(String(action.error))}
            </p>
          )}
          {labelAction.error && (
            <p className="error" role="alert">
              {translateError(String(labelAction.error))}
            </p>
          )}
          {current && (
            <>
              <p className="muted">
                {t('Current checkout price')}:{' '}
                <strong>{formatMoney(current.checkoutPrice, currency)}</strong>
                {current.checkoutPrice !== current.price &&
                  ` · ${t('Regular price')}: ${formatMoney(current.price, currency)}`}
              </p>
              <label className="field">
                <span>{t('Discounted selling price')}</span>
                <input
                  inputMode="decimal"
                  type="number"
                  min="0"
                  step="0.01"
                  value={price}
                  onChange={(event) => {
                    setPrice(event.target.value);
                    setRequestId(crypto.randomUUID());
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      if (canApply && !action.isPending) action.mutate();
                    }
                  }}
                  placeholder={t('0.00')}
                />
              </label>
              <label className="field">
                <span>{t('Reason')}</span>
                <select value={reason} onChange={(e) => setReason(e.target.value)}>
                  <option value="EXPIRING_SOON">{t('Expiring soon')}</option>
                  <option value="DAMAGED_PACKAGING">{t('Damaged packaging')}</option>
                  <option value="CLEARANCE">{t('Clearance')}</option>
                  <option value="OVERSTOCK">{t('Overstock')}</option>
                  <option value="OTHER">{t('Other')}</option>
                </select>
              </label>
              <label className="field">
                <span>{t('Valid until (store time, optional)')}</span>
                <input
                  type="datetime-local"
                  value={validUntil}
                  onChange={(e) => setValidUntil(e.target.value)}
                />
              </label>
              <label className="field">
                <span>{t('Number of units')}</span>
                <input
                  type="number"
                  min="1"
                  max={Math.min(500, available) || undefined}
                  step="1"
                  value={quantity}
                  onChange={(event) => {
                    setQuantity(event.target.value);
                    setRequestId(crypto.randomUUID());
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      if (canApply && !action.isPending) action.mutate();
                    }
                  }}
                />
              </label>
              <p className="muted">
                {t(
                  'Available batches are used automatically, earliest expiry first. Print and attach every new label.',
                )}
              </p>
              {!wholeUnit && (
                <p className="notice">
                  {t('Limited labels currently support products sold as whole units.')}
                </p>
              )}
              {regularPriceChanged && (
                <p className="notice">
                  {t('Save selling price changes before applying a discount.')}
                </p>
              )}
              <Button
                type="button"
                disabled={!canApply || action.isPending}
                onClick={() => action.mutate()}
              >
                {action.isPending ? t('Saving…') : t('Create discounted labels')}
              </Button>
              {!!details.data?.offers.length && (
                <div className="price-action-existing">
                  <h4>{t('Legacy discounted label batches')}</h4>
                  <p className="muted">
                    {t(
                      'Existing shared barcodes remain valid until their stock is sold. New labels use one code per unit.',
                    )}
                  </p>
                  {details.data.offers.map((offer) => (
                    <div key={offer.id} className="cash-history-row">
                      <span>
                        {offer.stock} {t('remaining')} · {formatMoney(offer.price, currency)}
                        <small>
                          {offer.barcode}
                          {offer.expiryDate ? ` · ${t('Expires')} ${offer.expiryDate}` : ''}
                        </small>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {!!activeLabels.length && (
                <div className="price-action-existing">
                  <h4>{t('Active unit markdown labels')}</h4>
                  {activeLabels.map((unit) => (
                    <div key={unit.id} className="cash-history-row">
                      <span>
                        <strong>{unit.barcode}</strong>
                        <small>
                          {formatMoney(unit.price, currency)}
                          {unit.expiryDate ? ` · ${t('Expires')} ${unit.expiryDate}` : ''}
                        </small>
                      </span>
                      <div className="price-action-label-actions">
                        <Button
                          type="button"
                          variant="outline"
                          disabled={labelAction.isPending}
                          onClick={() => labelAction.mutate({ id: unit.id, kind: 'replace' })}
                        >
                          {t('Replace label')}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={labelAction.isPending}
                          onClick={() => labelAction.mutate({ id: unit.id, kind: 'cancel' })}
                        >
                          {t('Cancel label')}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {!!labelHistory.length && (
                <details className="price-action-history">
                  <summary>{t('Label history ({count})', { count: labelHistory.length })}</summary>
                  <div className="price-action-existing">
                    {labelHistory.map((unit) => {
                      const replacement = replacementById.get(unit.id);
                      return (
                        <div key={unit.id} className="cash-history-row">
                          <span>
                            <strong>{unit.barcode}</strong>
                            <small>
                              {unit.status === 'SOLD'
                                ? t('Sold')
                                : replacement
                                  ? t('Replaced')
                                  : t('Cancelled')}
                              {' · '}
                              {formatMoney(unit.price, currency)}
                              {replacement &&
                                ` · ${t('Replacement barcode: {code}', { code: replacement })}`}
                            </small>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </details>
              )}
            </>
          )}
          {!!labels.length && (
            <>
              <div className="notice" role="status">
                {t(
                  replacedLabel
                    ? 'Old barcode is invalid. Print and attach the replacement label.'
                    : 'New barcode labels are ready. Print and attach them to the products.',
                )}
                <div className="price-action-new-codes">
                  {labels.map((label) => (
                    <strong key={label.id}>{label.barcode}</strong>
                  ))}
                </div>
              </div>
              {createPortal(
                <div className="price-action-print-sheet">
                  {labels.flatMap((label) =>
                    Array.from({ length: label.quantity }, (_, index) => (
                      <div className="price-action-label" key={`${label.id}-${index}`}>
                        <strong>{label.name}</strong>
                        <span>
                          {t('Reduced price')} {formatMoney(label.price, currency)}
                        </span>
                        <small>
                          {t('Regular price')} {formatMoney(label.regularPrice, currency)}
                        </small>
                        {label.expiryDate && (
                          <small>
                            {t('Expires')} {label.expiryDate}
                          </small>
                        )}
                        <PrintedBarcode code={label.barcode} />
                      </div>
                    )),
                  )}
                </div>,
                document.body,
              )}
              <Button type="button" onClick={() => window.print()}>
                {t('Print {value0} labels', {
                  value0: String(labels.reduce((sum, label) => sum + label.quantity, 0)),
                })}
              </Button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
