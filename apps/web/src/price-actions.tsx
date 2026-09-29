import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import JsBarcode from 'jsbarcode';
import { calculateLine, fromScaled, toScaled, type Product } from '@eliza/contracts';
import { api, refresh } from './api';
import { Button } from './components/ui/button';
import { ErrorMessage, Field } from './forms';
import { t, useLanguage } from './i18n';
import { formatMoney } from './receipts';

type Batch = {
  id: string;
  quantity: string;
  unitCost: string | null;
  expiryDate: string | null;
  costSource: string;
  sellable: boolean;
};
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
    priceKind: string;
    stock: string;
    taxRate: string;
  };
  batches: Batch[];
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

export function PriceActions({ product, currency }: { product: Product; currency: string }) {
  useLanguage();
  const [mode, setMode] = useState<'limited' | 'regular' | 'discount_all'>('limited');
  const [price, setPrice] = useState('');
  const [batchId, setBatchId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [label, setLabel] = useState<Label | null>(null);
  const details = useQuery({
    queryKey: ['price-actions', product.id],
    queryFn: () => api<Details>(`/products/${product.id}/pricing`),
  });
  const action = useMutation({
    mutationFn: () =>
      mode === 'limited'
        ? api<Label>(`/products/${product.id}/pricing/limited`, {
            requestId,
            batchId,
            quantity: Number(quantity),
            price,
          })
        : api<Label>(`/products/${product.id}/pricing`, { kind: mode, price }),
    onSuccess: (result) => {
      if (mode === 'limited') setLabel(result);
      setRequestId(crypto.randomUUID());
      setPrice('');
      void details.refetch();
      void refresh();
    },
  });
  const current = details.data?.product;
  const selected = details.data?.batches.find((b) => b.id === batchId);
  const available = Number(selected?.quantity ?? '0');
  function margin(cost: string, selling: string) {
    const amount = calculateLine(selling, '1', current?.taxRate ?? '0');
    const net = toScaled(amount.total, 2) - toScaled(amount.tax, 2);
    return net > 0n ? fromScaled(((net - toScaled(cost, 2)) * 10000n) / net, 2) + '%' : '—';
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    action.mutate();
  }
  return (
    <div className="price-actions">
      <ErrorMessage error={details.error ?? action.error} />
      {current && (
        <>
          <p>
            {t('Current checkout price')}: <strong>{formatMoney(current.price, currency)}</strong>
            {current.regularPrice && (
              <>
                {' '}
                · {t('Regular price')}: {formatMoney(current.regularPrice, currency)}
              </>
            )}
          </p>
          <div className="price-actions-tabs" role="group" aria-label={t('Price action')}>
            <Button
              type="button"
              variant={mode === 'limited' ? 'default' : 'outline'}
              onClick={() => {
                setMode('limited');
                setRequestId(crypto.randomUUID());
              }}
            >
              {t('Discount selected units')}
            </Button>
            <Button
              type="button"
              variant={mode === 'regular' ? 'default' : 'outline'}
              onClick={() => {
                setMode('regular');
                setRequestId(crypto.randomUUID());
              }}
            >
              {t('New regular price')}
            </Button>
            <Button
              type="button"
              variant={mode === 'discount_all' ? 'default' : 'outline'}
              onClick={() => {
                setMode('discount_all');
                setRequestId(crypto.randomUUID());
              }}
            >
              {t('Discount all units')}
            </Button>
          </div>
          <form onSubmit={submit}>
            {mode === 'limited' && (
              <>
                <p className="muted">
                  {t(
                    'Choose the exact stock batch and number of physical items to relabel. Each item needs its new barcode label.',
                  )}
                </p>
                {!['piece', 'pack', 'box'].includes(current.unit) && (
                  <p className="notice">
                    {t('Limited labels currently support products sold as whole units.')}
                  </p>
                )}
                <Field label={t('Stock batch')}>
                  <select
                    required
                    value={batchId}
                    onChange={(event) => {
                      setBatchId(event.target.value);
                      setRequestId(crypto.randomUUID());
                    }}
                  >
                    <option value="">{t('Choose a batch…')}</option>
                    {details.data?.batches.map((batch) => (
                      <option key={batch.id} value={batch.id} disabled={!batch.sellable}>
                        {batch.expiryDate
                          ? `${t('Expires')} ${batch.expiryDate}`
                          : t('No expiry date')}{' '}
                        · {batch.quantity} {t(current.unit)}
                        {batch.unitCost
                          ? ` · ${formatMoney(batch.unitCost, currency)} ${t('cost each')}`
                          : ''}
                        {!batch.sellable ? ` · ${t('Expired')}` : ''}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t('Number of units')}>
                  <input
                    type="number"
                    min="1"
                    max={Math.min(available, 500) || undefined}
                    step="1"
                    required
                    value={quantity}
                    onChange={(event) => {
                      setQuantity(event.target.value);
                      setRequestId(crypto.randomUUID());
                    }}
                  />
                </Field>
              </>
            )}
            <Field
              label={
                mode === 'regular' ? t('New regular selling price') : t('Discounted selling price')
              }
            >
              <input
                inputMode="decimal"
                type="number"
                min="0"
                step="0.01"
                required
                value={price}
                onChange={(event) => {
                  setPrice(event.target.value);
                  setRequestId(crypto.randomUUID());
                }}
              />
            </Field>
            {mode === 'limited' && selected?.unitCost && price && (
              <small>
                {t('Projected gross margin for this batch')}: {margin(selected.unitCost, price)}
              </small>
            )}
            {mode === 'regular' && (
              <p className="muted">
                {t(
                  'Uses the existing product barcode for all stock. Purchase costs for each batch stay unchanged. Print a new shelf tag.',
                )}
              </p>
            )}
            {mode === 'discount_all' && (
              <p className="muted">
                {t(
                  'Uses the existing barcode for all stock and shows the regular price and discount at checkout and on receipts. Print a new shelf tag.',
                )}
              </p>
            )}
            <div className="form-actions">
              <Button
                disabled={
                  action.isPending ||
                  (mode === 'limited' &&
                    (!selected || !['piece', 'pack', 'box'].includes(current.unit)))
                }
              >
                {action.isPending
                  ? t('Saving…')
                  : mode === 'limited'
                    ? t('Create discounted labels')
                    : t('Apply price')}
              </Button>
            </div>
          </form>
          {!!details.data?.offers.length && (
            <div className="price-action-existing">
              <h3>{t('Discounted label batches')}</h3>
              {details.data.offers.map((offer) => (
                <div key={offer.id} className="cash-history-row">
                  <span>
                    {offer.stock} {t('remaining')} · {formatMoney(offer.price, currency)}
                    <small>
                      {offer.barcode}
                      {offer.expiryDate ? ` · ${t('Expires')} ${offer.expiryDate}` : ''}
                    </small>
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!offer.sellable || Number(offer.stock) <= 0}
                    onClick={() =>
                      setLabel({ ...offer, name: current.name, quantity: Number(offer.stock) })
                    }
                  >
                    {t('Print labels')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {label && (
        <>
          <div className="price-action-print-sheet">
            {Array.from({ length: label.quantity }, (_, index) => (
              <div className="price-action-label" key={index}>
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
            ))}
          </div>
          <Button type="button" onClick={() => window.print()}>
            {t('Print {value0} labels', { value0: String(label.quantity) })}
          </Button>
        </>
      )}
    </div>
  );
}
