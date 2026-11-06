import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Package, Plus, Trash2, WandSparkles } from 'lucide-react';
import { purchaseDraftSchema, type Product, type Supplier } from '@eliza/contracts';
import { api, ApiError, refresh, useProducts, useSession } from './api';
import { Button } from './components/ui/button';
import { CameraBarcodeScanner } from './camera-barcode-scanner';
import { ErrorMessage, Field, ProductForm, SearchSelect } from './forms';
import { formatQuantity, quantityInputValue } from './quantity-format';
import { t, useLanguage } from './i18n';
import type { Order } from './purchasing';

type OrderProps = {
  done: (id: string) => void;
  order?: Order;
  fixedSupplierId?: string;
  onCancel?: () => void;
};

/** Planning an order never invents acquisition costs or changes selling prices. */
export function PurchaseOrderForm({ done, order, fixedSupplierId, onCancel }: OrderProps) {
  useLanguage();
  const session = useSession().data!;
  const products = useProducts();
  const suppliers = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api<Supplier[]>('/suppliers'),
  });
  const [supplierId, setSupplierId] = useState(order?.supplier_id ?? fixedSupplierId ?? '');
  const supplier = suppliers.data?.find((s) => s.id === supplierId);
  const [reference, setReference] = useState(order?.supplier_reference ?? '');
  const [date, setDate] = useState(order?.document_date?.slice(0, 10) ?? '');
  const [expectedDate, setExpectedDate] = useState(order?.expected_date?.slice(0, 10) ?? '');
  const [notes, setNotes] = useState(order?.notes ?? '');
  const [lines, setLines] = useState(
    order?.lines.map((l) => ({
      productId: l.product_id,
      quantity: quantityInputValue(l.ordered_quantity),
    })) ?? [{ productId: '', quantity: '1' }],
  );
  const [error, setError] = useState<unknown>();
  const [addingProduct, setAddingProduct] = useState<number | null>(null);
  const [createdProducts, setCreatedProducts] = useState<Product[]>([]);
  const catalog = [
    ...(products.data ?? []),
    ...createdProducts.filter((p) => !products.data?.some((item) => item.id === p.id)),
  ];
  const [command, setCommand] = useState<ReturnType<typeof body> | undefined>();
  function body(placeOrder: boolean) {
    return {
      requestId: crypto.randomUUID(),
      id: order?.id,
      version: order?.version,
      supplierId,
      supplierReference: reference,
      documentDate: date,
      expectedDate,
      notes,
      placeOrder,
      lines: lines.map((line) => ({ ...line, unitCost: null, taxRate: '0' })),
    };
  }
  const mutation = useMutation({
    mutationFn: (payload: ReturnType<typeof body>) => api<Order>('/purchases', payload),
    onSuccess: async (saved) => {
      await refresh();
      done(saved.id);
    },
    onError: (failure) => {
      if (failure instanceof ApiError && failure.status >= 400 && failure.status < 500)
        setCommand(undefined);
    },
  });
  function selectProduct(index: number, productId: string) {
    setError(undefined);
    setLines((before) => before.map((line, i) => (i === index ? { ...line, productId } : line)));
  }
  if (addingProduct !== null)
    return (
      <section className="panel purchasing-form-panel supplier-add-product purchasing-subpage">
        <Button variant="ghost" onClick={() => setAddingProduct(null)}>
          <ArrowLeft size={16} />
          {t('Back to order')}
        </Button>
        <h2>{t('Create product')}</h2>
        <ProductForm
          supplierId={supplierId || undefined}
          onDone={() => setAddingProduct(null)}
          onCreated={(product) => {
            setCreatedProducts((before) => [...before, product]);
            selectProduct(addingProduct, product.id);
            setAddingProduct(null);
          }}
          onExisting={(product) => {
            selectProduct(addingProduct, product.id);
            setAddingProduct(null);
          }}
        />
      </section>
    );
  return (
    <form
      className="purchase-draft-form quantity-order-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError(undefined);
        const placeOrder =
          (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'place';
        const payload = command ?? body(placeOrder);
        const valid = purchaseDraftSchema.safeParse(payload);
        const whole = lines.every((line) => {
          const product = catalog.find((p) => p.id === line.productId && p.active);
          return (
            product &&
            (!['piece', 'pack', 'box'].includes(product.unit) ||
              Number.isInteger(Number(line.quantity)))
          );
        });
        if (!valid.success || !whole) {
          setError(
            t('Choose products and positive quantities. Combine duplicate products into one line.'),
          );
          return;
        }
        setCommand(payload);
        mutation.mutate(payload);
      }}
    >
      <fieldset disabled={mutation.isPending || !!command}>
        <section className="panel purchasing-form-panel">
          <h2>{t('Order details')}</h2>
          {fixedSupplierId ? (
            <p className="quantity-order-supplier">
              <strong>{supplier?.name}</strong>
              <span className="muted">{supplier?.code}</span>
            </p>
          ) : (
            <SearchSelect
              label={t('Supplier')}
              placeholder={t('Select a supplier')}
              value={supplier && { title: supplier.name, subtitle: supplier.code }}
              options={(suppliers.data ?? [])
                .filter((s) => s.active)
                .map((s) => ({
                  id: s.id,
                  title: s.name,
                  subtitle: s.code,
                  keywords: [s.name, s.code],
                }))}
              onSelect={setSupplierId}
            />
          )}
          <div className="quantity-order-basics">
            <div className="purchase-reference-row">
              <div>
                <Field label={t('Supplier reference')}>
                  <input
                    maxLength={120}
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                </Field>
              </div>
              <Button
                className="purchase-reference-generate"
                variant="outline"
                type="button"
                size="icon"
                aria-label={t('Generate reference')}
                title={t('Generate reference')}
                onClick={() =>
                  setReference(
                    'REF-' + crypto.randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase(),
                  )
                }
              >
                <WandSparkles size={18} aria-hidden="true" />
              </Button>
            </div>
            <Field label={t('Document date (optional)')}>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label={t('Expected delivery')}>
              <input
                type="date"
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
              />
            </Field>
          </div>
          <p className="muted">
            {t(
              'Choose products and quantities now. Record actual costs and selling prices when accepting the delivery.',
            )}
          </p>
        </section>
        <section className="panel purchasing-form-panel quantity-order-items">
          <h2>{t('Purchase items')}</h2>
          <ErrorMessage error={products.error ?? suppliers.error} />
          {lines.map((line, index) => {
            const product = catalog.find((p) => p.id === line.productId);
            return (
              <article
                className="quantity-order-item"
                key={index}
                aria-label={t('Purchase row {number}', { number: index + 1 })}
              >
                <div className="quantity-order-product">
                  <div className="quantity-order-photo">
                    {product?.image ? (
                      <img src={product.image} alt="" />
                    ) : (
                      <Package size={28} aria-hidden="true" />
                    )}
                  </div>
                  <div className="quantity-order-product-info">
                    <SearchSelect
                      label={t('Product')}
                      placeholder={t('Select a product')}
                      value={product && { title: product.name, subtitle: product.sku }}
                      options={catalog
                        .filter((p) => p.active)
                        .map((p) => ({
                          id: p.id,
                          title: p.name,
                          subtitle: [p.sku, ...p.barcodes].join(' · '),
                          keywords: [p.name, p.sku, p.plu ?? '', ...p.barcodes],
                        }))}
                      createLabel={
                        session.user.permissions.includes('catalog.write')
                          ? t('Create new product')
                          : undefined
                      }
                      onCreate={() => setAddingProduct(index)}
                      onSelect={(id) => selectProduct(index, id)}
                    />
                    {product && (
                      <>
                        {product.description && <p>{product.description}</p>}
                        <p className="muted">
                          {[
                            product.sku,
                            product.category,
                            product.plu ? `PLU: ${product.plu}` : '',
                            ...product.barcodes,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                        <small className="muted">
                          {t('On hand')}: {formatQuantity(product.stock)} {t(product.unit)}
                        </small>
                      </>
                    )}
                  </div>
                </div>
                <div className="quantity-order-controls">
                  <Field label={t('Quantity')}>
                    <input
                      required
                      inputMode="decimal"
                      value={line.quantity}
                      onChange={(e) =>
                        setLines((before) =>
                          before.map((item, i) =>
                            i === index ? { ...item, quantity: e.target.value } : item,
                          ),
                        )
                      }
                    />
                  </Field>
                  <span className="muted">{product ? t(product.unit) : '—'}</span>
                  <CameraBarcodeScanner
                    onScan={(code) => {
                      const match = catalog.find((p) => p.active && p.barcodes.includes(code));
                      if (match) selectProduct(index, match.id);
                      else setError(t('No product matches this barcode.'));
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    type="button"
                    aria-label={t('Remove line')}
                    title={t('Remove line')}
                    onClick={() => setLines((before) => before.filter((_, i) => i !== index))}
                  >
                    <Trash2 size={18} />
                  </Button>
                </div>
              </article>
            );
          })}
          <Button
            variant="outline"
            type="button"
            disabled={lines.length >= 100}
            onClick={() => setLines((before) => [...before, { productId: '', quantity: '1' }])}
          >
            <Plus size={16} />
            {t('Add product')}
          </Button>
        </section>
        <section className="panel purchasing-form-panel">
          <Field label={t('Order notes')}>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
          </Field>
        </section>
      </fieldset>
      <ErrorMessage error={error ?? mutation.error} />
      <div className="purchasing-form-actions">
        <Button value="place" disabled={mutation.isPending}>
          {mutation.isPending ? t('Saving…') : command ? t('Retry same change') : t('Place order')}
        </Button>
        {!command && (
          <Button variant="outline" value="draft" disabled={mutation.isPending}>
            {t('Save draft')}
          </Button>
        )}
        {onCancel && (
          <Button variant="ghost" type="button" disabled={mutation.isPending} onClick={onCancel}>
            {t('Cancel')}
          </Button>
        )}
      </div>
      <p className="muted">
        {t(
          'Placing an order saves it in Eliza. Nothing is sent automatically. You can share it through WhatsApp afterwards.',
        )}
      </p>
    </form>
  );
}
