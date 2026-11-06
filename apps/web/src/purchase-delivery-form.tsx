import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  calculatePurchaseLine,
  fromScaled,
  productSchema,
  receiptInputSchema,
  toScaled,
  type SupplierProduct,
} from '@eliza/contracts';
import { api, ApiError, refresh, useProducts, useSession } from './api';
import { Button } from './components/ui/button';
import { ErrorMessage, Field } from './forms';
import { formatMoney } from './receipts';
import { formatQuantity } from './quantity-format';
import { productPriceMargin } from './product-price-margin';
import { getLocale, t, useLanguage } from './i18n';
import type { Order } from './purchasing';

type ExpiryBatch = { quantity: string; expiryDate: string };
function margin(
  cost: string | null | undefined,
  price: string | null | undefined,
  taxRate: string,
) {
  const parsedCost = productSchema.shape.cost.safeParse(cost);
  const parsedPrice = productSchema.shape.price.safeParse(price);
  const parsedTax = productSchema.shape.taxRate.safeParse(taxRate);
  if (!parsedCost.success || !parsedPrice.success || !parsedTax.success) return null;
  return productPriceMargin({
    cost: parsedCost.data,
    price: parsedPrice.data,
    taxRate: parsedTax.data,
  });
}

export function PurchaseDeliveryForm({ order, done }: { order: Order; done: () => void }) {
  useLanguage();
  const products = useProducts();
  const session = useSession().data!;
  const currency = session.store.currency;
  const canCost = session.user.permissions.includes('purchases.cost');
  const canPrice = session.user.permissions.includes('catalog.write');
  const canPay = session.user.permissions.includes('purchases.write');
  const history = useQuery({
    queryKey: ['supplier-catalog', order.supplier_id],
    queryFn: () => api<SupplierProduct[]>(`/suppliers/${order.supplier_id}/products`),
    enabled: canCost && session.user.permissions.includes('suppliers.read'),
  });
  const [costs, setCosts] = useState<Record<string, string>>({});
  const [taxes, setTaxes] = useState<Record<string, string>>({});
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [batches, setBatches] = useState<Record<string, ExpiryBatch[]>>({});
  const [reference, setReference] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<'paid' | 'unpaid'>(
    order.payment_status === 'paid' ? 'paid' : 'unpaid',
  );
  const [dueDate, setDueDate] = useState(order.payment_due_date ?? '');
  const [payload, setPayload] = useState<unknown>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const outstanding = order.lines.filter(
    (l) => toScaled(l.ordered_quantity, 3) > toScaled(l.received_quantity, 3),
  );
  const rows = (id: string) => batches[id] ?? [{ quantity: '0', expiryDate: '' }];
  const cost = (line: Order['lines'][number]) => costs[line.id] ?? line.unit_cost ?? '';
  const tax = (line: Order['lines'][number]) => taxes[line.id] ?? line.tax_rate;
  function quantity(id: string) {
    try {
      return fromScaled(
        rows(id).reduce((sum, b) => sum + toScaled(b.quantity || '0', 3), 0n),
        3,
      );
    } catch {
      return '';
    }
  }
  function updateBatch(id: string, index: number, key: keyof ExpiryBatch, value: string) {
    setError(undefined);
    setBatches((before) => ({
      ...before,
      [id]: rows(id).map((batch, i) => (i === index ? { ...batch, [key]: value } : batch)),
    }));
  }
  const selected = outstanding.filter((l) =>
    rows(l.id).some((b) => b.quantity.trim() !== '' && Number(b.quantity) !== 0),
  );
  const complete = outstanding.every((l) => {
    try {
      return (
        toScaled(quantity(l.id), 3) ===
        toScaled(l.ordered_quantity, 3) - toScaled(l.received_quantity, 3)
      );
    } catch {
      return false;
    }
  });
  const amounts = selected.map((l) => {
    if (
      !/^\d{1,9}(?:\.\d{1,2})?$/.test(cost(l)) ||
      !/^\d+(?:\.\d{1,3})?$/.test(quantity(l.id)) ||
      Number(quantity(l.id)) <= 0 ||
      !productSchema.shape.taxRate.safeParse(tax(l)).success
    )
      return null;
    return calculatePurchaseLine(cost(l), quantity(l.id), tax(l));
  });
  const total =
    amounts.length && amounts.every(Boolean)
      ? fromScaled(
          amounts.reduce((sum, item) => sum + toScaled(item!.total, 2), 0n),
          2,
        )
      : null;
  async function submit() {
    const body = payload ?? {
      requestId: crypto.randomUUID(),
      version: order.version,
      deliveryReference: reference,
      ...(canPay ? { paymentStatus, paymentDueDate: dueDate } : {}),
      lines: selected.map((l) => ({
        purchaseLineId: l.id,
        quantity: quantity(l.id),
        expiryBatches: rows(l.id).map((b) => ({
          quantity: b.quantity,
          expiryDate: b.expiryDate || null,
        })),
        ...(canCost ? { unitCost: cost(l), taxRate: tax(l) } : {}),
        ...(canPrice && prices[l.id]
          ? {
              sellingPrice: prices[l.id],
              expectedSellingPrice: products.data?.find((p) => p.id === l.product_id)?.price,
            }
          : {}),
      })),
    };
    if (!receiptInputSchema.safeParse(body).success) {
      setError(t('Check delivered quantities, actual costs, tax and expiry dates.'));
      return;
    }
    if (canPay && paymentStatus === 'paid' && order.total === null && !complete) {
      setError(
        t(
          'Mark the whole order paid after all goods are delivered, or close the undelivered remainder first.',
        ),
      );
      return;
    }
    setError(undefined);
    setPayload(body);
    setPending(true);
    try {
      await api('/purchases/' + order.id + '/receipts', body);
      await refresh();
      done();
    } catch (failure) {
      setError(failure);
      if (failure instanceof ApiError && failure.status >= 400 && failure.status < 500)
        setPayload(undefined);
    } finally {
      setPending(false);
    }
  }
  return (
    <form
      className="purchase-delivery-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <fieldset disabled={!!payload || pending}>
        <Field label={t('Delivery reference (optional)')}>
          <input value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <ErrorMessage error={products.error ?? history.error} />
        {outstanding.map((l) => {
          const product = products.data?.find((p) => p.id === l.product_id);
          const previous = history.data?.find((p) => p.productId === l.product_id);
          const currentPrice = product?.price ?? null;
          const previousMargin = margin(
            previous?.lastPaidCost,
            currentPrice,
            product?.taxRate ?? '0',
          );
          const newMargin = margin(cost(l), prices[l.id] || currentPrice, product?.taxRate ?? '0');
          const currentPriceMargin = margin(cost(l), currentPrice, product?.taxRate ?? '0');
          const change =
            previousMargin && newMargin
              ? fromScaled(toScaled(newMargin.percent, 2) - toScaled(previousMargin.percent, 2), 2)
              : null;
          const receiving = Number(quantity(l.id)) > 0;
          return (
            <section key={l.id} className="delivery-product-card" aria-label={l.product_name}>
              <header className="delivery-product-header">
                <div>
                  <h3>{l.product_name}</h3>
                  <small className="muted">{l.sku}</small>
                </div>
                <span className="muted">
                  {formatQuantity(
                    fromScaled(
                      toScaled(l.ordered_quantity, 3) - toScaled(l.received_quantity, 3),
                      3,
                    ),
                  )}{' '}
                  {t(l.unit)} {t('remaining')}
                </span>
              </header>
              <div className="delivery-expiry-batches">
                {rows(l.id).map((batch, index) => (
                  <div className="delivery-expiry-batch" key={index}>
                    <Field label={t('Quantity')}>
                      <input
                        inputMode="decimal"
                        value={batch.quantity}
                        onChange={(e) => updateBatch(l.id, index, 'quantity', e.target.value)}
                      />
                    </Field>
                    <Field label={t('Expiry date (optional)')}>
                      <input
                        type="date"
                        value={batch.expiryDate}
                        onChange={(e) => updateBatch(l.id, index, 'expiryDate', e.target.value)}
                      />
                    </Field>
                    {rows(l.id).length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        aria-label={t('Remove expiry batch {number}', { number: index + 1 })}
                        onClick={() =>
                          setBatches((before) => ({
                            ...before,
                            [l.id]: rows(l.id).filter((_, i) => i !== index),
                          }))
                        }
                      >
                        {t('Remove batch')}
                      </Button>
                    )}
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  disabled={rows(l.id).length >= 50}
                  onClick={() =>
                    setBatches((before) => ({
                      ...before,
                      [l.id]: [...rows(l.id), { quantity: '0', expiryDate: '' }],
                    }))
                  }
                >
                  {t('Add expiry batch')}
                </Button>
              </div>
              <dl className="delivery-price-facts">
                {canCost && (
                  <div>
                    <dt>{t('Last purchase price from this supplier')}</dt>
                    <dd>
                      {formatMoney(previous?.lastPaidCost, currency)}
                      {previous?.lastDeliveredAt && (
                        <small>
                          {new Date(previous.lastDeliveredAt).toLocaleDateString(getLocale(), {
                            timeZone: session.store.timezone,
                          })}
                        </small>
                      )}
                    </dd>
                  </div>
                )}
                <div>
                  <dt>{t('Current selling price')}</dt>
                  <dd>
                    {formatMoney(currentPrice, currency)}
                    <small>{t('Including tax')}</small>
                  </dd>
                </div>
              </dl>
              <div className="delivery-cost-fields">
                <Field
                  label={t('Unit cost excl. tax')}
                  hint={t('Enter the actual invoice cost for this delivery.')}
                >
                  <input
                    inputMode="decimal"
                    required={receiving}
                    disabled={!canCost}
                    value={cost(l)}
                    onChange={(e) => setCosts((before) => ({ ...before, [l.id]: e.target.value }))}
                  />
                </Field>
                <Field label={t('Purchase tax %')}>
                  <input
                    inputMode="decimal"
                    required={receiving}
                    disabled={!canCost}
                    value={tax(l)}
                    onChange={(e) => setTaxes((before) => ({ ...before, [l.id]: e.target.value }))}
                  />
                </Field>
                {canPrice && (
                  <Field
                    label={t('New selling price incl. tax (optional)')}
                    hint={t('Leave blank to keep the current selling price.')}
                  >
                    <input
                      inputMode="decimal"
                      value={prices[l.id] ?? ''}
                      onChange={(e) =>
                        setPrices((before) => ({ ...before, [l.id]: e.target.value }))
                      }
                    />
                  </Field>
                )}
              </div>
              {canCost && previous?.lastPaidCost != null && (
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() =>
                    setCosts((before) => ({ ...before, [l.id]: previous.lastPaidCost! }))
                  }
                >
                  {t('Use last purchase cost')}
                </Button>
              )}
              {!canCost && l.unit_cost === null && (
                <p className="notice">
                  {t('A manager with purchase-cost access must enter delivery costs.')}
                </p>
              )}
              {canCost && (
                <div className="delivery-margin-preview" aria-live="polite">
                  <dl className="delivery-price-facts">
                    <div>
                      <dt>{t('Margin with previous purchase cost')}</dt>
                      <dd>{previousMargin ? formatQuantity(previousMargin.percent) + '%' : '—'}</dd>
                    </div>
                    <div>
                      <dt>{t('Margin at current selling price')}</dt>
                      <dd>
                        {currentPriceMargin
                          ? formatQuantity(currentPriceMargin.percent) + '%'
                          : '—'}
                      </dd>
                    </div>
                    <div>
                      <dt>{t('Margin after price change')}</dt>
                      <dd>
                        {newMargin ? formatQuantity(newMargin.percent) + '%' : '—'}
                        {change !== null && (
                          <small>
                            {t('Change: {value} percentage points', {
                              value: (Number(change) > 0 ? '+' : '') + formatQuantity(change),
                            })}
                          </small>
                        )}
                      </dd>
                    </div>
                  </dl>
                  <p className="muted">
                    {t(
                      'Margin preview uses this batch cost and the selling price excluding included tax. Previous batches and past sales keep their costs.',
                    )}
                  </p>
                </div>
              )}
              {canPrice && prices[l.id] && receiving && (
                <label className="delivery-price-confirmation">
                  <input key={prices[l.id] + '-' + currentPrice} type="checkbox" required />
                  <span>
                    {t('Apply this selling price to all stock of ')}
                    {l.product_name}
                    {t(
                      ', including older items. Purchase costs stay unchanged for each batch. Update the shelf label. ',
                    )}
                  </span>
                </label>
              )}
            </section>
          );
        })}
        {canPay && (
          <section className="delivery-payment-section">
            <h3>{t('Purchase payment')}</h3>
            <div className="delivery-cost-fields">
              <Field label={t('Payment status')}>
                <select
                  value={paymentStatus}
                  onChange={(e) => setPaymentStatus(e.target.value as 'paid' | 'unpaid')}
                >
                  <option value="unpaid">{t('Unpaid')}</option>
                  <option value="paid" disabled={order.total === null && !complete}>
                    {t('Paid')}
                  </option>
                </select>
              </Field>
              <Field label={t('Payment due date')}>
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </Field>
            </div>
            <p className="muted">
              {t(
                'Payment status applies to the whole order. Mark paid only after the supplier has been paid in full.',
              )}
            </p>
          </section>
        )}
      </fieldset>
      <ErrorMessage error={error} />
      <div className="delivery-submit">
        <strong>
          {t('Delivery total')}: {formatMoney(total, currency)}
        </strong>
        <Button disabled={pending || (!canCost && selected.some((l) => l.unit_cost === null))}>
          {payload ? t('Retry same delivery') : t('Accept delivery')}
        </Button>
      </div>
      {!!payload && !pending && (
        <p className="muted">
          {t(
            'The delivery details are locked for a safe retry. Refresh the order before starting a different delivery. ',
          )}
        </p>
      )}
    </form>
  );
}
