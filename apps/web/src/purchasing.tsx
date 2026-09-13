import { countText, t, useLanguage, getLocale } from './i18n';
import { useState, type ReactNode } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import {
  supplierSchema,
  fromScaled,
  toScaled,
  type Supplier,
  type Product,
} from '@eliza/contracts';
import { api, ApiError, refresh, useProducts, useSession } from './api';
import { Field, ErrorMessage, ProductForm, SearchSelect } from './forms';
import { Button } from './components/ui/button';
import { Dialog } from './components/ui/dialog';
import { formatMoney } from './receipts';
type Order = {
  close_reason: string;
  closed_at: string | null;
  closed_by_name: string | null;
  payment_status: 'unrecorded' | 'unpaid' | 'paid';
  payment_due_date: string | null;
  paid_at: string | null;
  payment_overdue: boolean;
  supplier_id: string;
  supplier_reference: string;
  expected_date: string | null;
  id: string;
  number: string;
  status: string;
  version: number;
  total: string;
  supplierName: string;
  notes: string;
  lines: Line[];
  receipts: {
    id: string;
    number: string;
    delivery_reference: string;
    actor: string;
    device: string;
    total: string;
    lines: Line[];
  }[];
};
type Line = {
  product_id: string;
  id: string;
  product_name: string;
  sku: string;
  unit: string;
  ordered_quantity: string;
  received_quantity: string;
  quantity: string;
  unit_cost: string;
  proposed_selling_price?: string | null;
  tax_rate: string;
  total: string;
};
function CostComparison({
  cost,
  previous,
  price,
}: {
  cost: string;
  previous?: string | null;
  price?: string;
}) {
  useLanguage();
  const currency = useSession().data?.store.currency ?? 'NOK';
  const valid = /^\d{1,9}(\.\d{1,2})?$/.test(cost);
  const changed = previous != null && valid && Number(cost) !== Number(previous);
  return (
    <div className="muted" aria-live="polite">
      {changed && (
        <p className="purchase-cost-change">
          <strong>
            {t('Unit cost ')}
            {Number(cost) > Number(previous) ? t('increased') : t('decreased')}:
          </strong>{' '}
          {formatMoney(previous!, currency)} {t(' to ')}
          {formatMoney(cost, currency)}
          {Number(previous) > 0 &&
            ' (' + (((Number(cost) - Number(previous)) / Number(previous)) * 100).toFixed(1) + '%)'}
          {t('. Costs exclude tax. ')}
        </p>
      )}
      {price !== undefined && (
        <p>
          {t('Current selling price: ')}
          {formatMoney(price, currency)} {t(' including tax.')}
        </p>
      )}
    </div>
  );
}
function SupplierSummary({ supplier }: { supplier: Supplier }) {
  useLanguage();
  const details: [string, string][] = [
    ['Code', supplier.code],
    ['Contact', supplier.contactName],
    ['Email', supplier.email],
    ['Phone', supplier.phone],
    ['Address', supplier.address],
    ['Company number', supplier.companyNumber],
    ['Payment terms', supplier.paymentTerms],
  ];
  const shown = details.filter(([, value]) => value);
  return (
    <div className="supplier-summary">
      <div className="supplier-summary-head">
        <strong>{supplier.name}</strong>
        {!supplier.active && <span className="supplier-summary-flag">{t('Inactive')}</span>}
      </div>
      {shown.length ? (
        <dl>
          {shown.map(([label, value]) => (
            <div key={label}>
              <dt>{t(label)}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="muted">{t('No contact details recorded for this supplier.')}</p>
      )}
      {supplier.notes && <p className="supplier-summary-notes">{supplier.notes}</p>}
    </div>
  );
}
function Heading({
  title,
  description,
  className = '',
  action,
}: {
  title: string;
  description: string;
  className?: string;
  action?: ReactNode;
}) {
  useLanguage();
  return (
    <div className={'page-heading ' + className}>
      <div>
        <div className="eyebrow">{t('PURCHASING')}</div>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
      </div>
      {action}
    </div>
  );
}
export function SuppliersPage() {
  useLanguage();
  const q = useQuery({ queryKey: ['suppliers'], queryFn: () => api<Supplier[]>('/suppliers') });
  const [editing, setEditing] = useState<Supplier | null | undefined>();
  const [search, setSearch] = useState('');
  const rows = (q.data ?? []).filter((s) =>
    [s.name, s.code, s.contactName, s.email, s.phone].some((v) =>
      (v ?? '').toLowerCase().includes(search.trim().toLowerCase()),
    ),
  );
  return (
    <>
      <Heading
        title={t('Suppliers')}
        description={t('Supplier contacts and ordering details.')}
        action={<Button onClick={() => setEditing(null)}>Add supplier</Button>}
      />
      <section className="panel">
        <div className="table-toolbar">
          <div className="search-box">
            <Search size={18} />
            <input
              aria-label={t('Search suppliers')}
              placeholder={t('Search name, code, contact, email, or phone…')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <span className="muted">{countText('suppliers', rows.length)}</span>
        </div>
        <ErrorMessage error={q.error} />
        {q.isPending ? (
          <p className="panel-padding">{t('Loading suppliers…')}</p>
        ) : rows.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t('Supplier')}</th>
                  <th>{t('Contact')}</th>
                  <th>{t('Terms')}</th>
                  <th>{t('Status')}</th>
                  <th className="table-actions-column">{t('Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <strong>{s.name}</strong>
                      <small>{s.code}</small>
                    </td>
                    <td>
                      {s.contactName || '—'}
                      {(s.email || s.phone) && (
                        <small>{[s.email, s.phone].filter(Boolean).join(' · ')}</small>
                      )}
                    </td>
                    <td>{s.paymentTerms || '—'}</td>
                    <td>
                      <span className={`badge badge-${s.active ? 'green' : 'gray'}`}>
                        {s.active ? t('Active') : t('Inactive')}
                      </span>
                    </td>
                    <td className="table-actions-column">
                      <Button variant="ghost" onClick={() => setEditing(s)}>
                        {t('Edit ')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="panel-padding">
            {q.data?.length
              ? t('No suppliers match “{value0}”.', { value0: search.trim() })
              : t('Add your first supplier to start purchasing.')}
          </p>
        )}
      </section>
      <Dialog
        open={editing !== undefined}
        onOpenChange={(v) => !v && setEditing(undefined)}
        title={editing ? t('Edit supplier') : t('Add supplier')}
        description={t('Keep supplier details available for your team.')}
      >
        {editing !== undefined && (
          <SupplierForm
            key={editing?.id ?? 'new'}
            supplier={editing}
            done={() => setEditing(undefined)}
          />
        )}
      </Dialog>
    </>
  );
}
function SupplierForm({
  supplier,
  done,
  onCreated,
}: {
  supplier: Supplier | null;
  done: () => void;
  onCreated?: (supplier: Supplier) => void;
}) {
  useLanguage();
  const [value, setValue] = useState(
    supplier ?? {
      ...supplierSchema.parse({ code: 'NEW', name: 'New supplier' }),
      code: '',
      name: '',
      active: true,
    },
  );
  const [requestId] = useState(() => crypto.randomUUID());
  const mutation = useMutation({
    mutationFn: () => api<Supplier>('/suppliers', { ...value, requestId }),
    onSuccess: (saved) => {
      onCreated?.(saved);
      void refresh();
      done();
    },
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
    >
      <div className="form-grid">
        {(
          [
            'code',
            'name',
            'contactName',
            'email',
            'phone',
            'address',
            'companyNumber',
            'paymentTerms',
            'notes',
          ] as const
        ).map((key) => (
          <Field
            key={key}
            label={t(
              {
                code: 'Supplier code',
                name: 'Supplier name',
                contactName: 'Contact name',
                companyNumber: 'Company number',
                paymentTerms: 'Payment terms',
                email: 'Email',
                phone: 'Phone',
                address: 'Address',
                notes: 'Notes',
              }[key],
            )}
          >
            <input
              required={key === 'code' || key === 'name'}
              type={key === 'email' ? 'email' : 'text'}
              value={value[key]}
              onChange={(e) => setValue({ ...value, [key]: e.target.value })}
            />
          </Field>
        ))}
      </div>
      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={value.active}
          onChange={(e) => setValue({ ...value, active: e.target.checked })}
        />
        {t('Active supplier ')}
      </label>
      <ErrorMessage error={mutation.error} />
      <div className="form-actions">
        <Button disabled={mutation.isPending}>
          {mutation.isPending ? t('Saving…') : t('Save supplier')}
        </Button>
      </div>
    </form>
  );
}
const statusTone: Record<string, string> = {
  draft: 'gray',
  ordered: 'amber',
  partially_received: 'amber',
  received: 'green',
  cancelled: 'gray',
  closed: 'gray',
};
export function PurchasesPage() {
  useLanguage();
  const q = useQuery({ queryKey: ['purchases'], queryFn: () => api<Order[]>('/purchases') });
  const currency = useSession().data?.store.currency ?? 'NOK';
  const [selected, setSelected] = useState<string | undefined>(
    () => new URLSearchParams(window.location.search).get('order') ?? undefined,
  );
  const [create, setCreate] = useState(false);
  const [filter, setFilter] = useState('all');
  const [paymentFilter, setPaymentFilter] = useState('all');
  const [search, setSearch] = useState('');
  const terms = search.trim().toLowerCase();
  const rows = (q.data ?? []).filter(
    (p) =>
      (filter === 'all' || p.status === filter) &&
      (paymentFilter === 'all' ||
        (paymentFilter === 'overdue' ? p.payment_overdue : p.payment_status === paymentFilter)) &&
      [p.number, p.supplierName, p.supplier_reference].some((v) =>
        (v ?? '').toLowerCase().includes(terms),
      ),
  );
  return (
    <>
      <Heading
        title={t('Purchase orders')}
        className="purchases-heading"
        description={t(
          'Order stock, then record each delivery when it arrives. Costs exclude tax.',
        )}
        action={<Button onClick={() => setCreate(true)}>New purchase order</Button>}
      />
      <section className="panel">
        <div className="table-toolbar">
          <div className="search-box">
            <Search size={18} />
            <input
              aria-label={t('Search purchase orders')}
              placeholder={t('Search order number, supplier, or reference…')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            aria-label={t('Filter order status')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            {[
              'all',
              'draft',
              'ordered',
              'partially_received',
              'received',
              'closed',
              'cancelled',
            ].map((s) => (
              <option key={s} value={s}>
                {s === 'all' ? t('All statuses') : t(s)}
              </option>
            ))}
          </select>
          <select
            aria-label={t('Payment status')}
            value={paymentFilter}
            onChange={(e) => setPaymentFilter(e.target.value)}
          >
            <option value="all">{t('All payments')}</option>
            <option value="unpaid">{t('Unpaid')}</option>
            <option value="paid">{t('Paid')}</option>
            <option value="overdue">{t('Overdue')}</option>
            <option value="unrecorded">{t('Payment not recorded')}</option>
          </select>
          <span className="muted">{countText('orders', rows.length)}</span>
        </div>
        <ErrorMessage error={q.error} />
        {q.isPending ? (
          <p className="panel-padding">{t('Loading orders…')}</p>
        ) : rows.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t('Order')}</th>
                  <th>{t('Supplier')}</th>
                  <th>{t('Status')}</th>
                  <th>{t('Payment status')}</th>
                  <th className="table-number-column">{t('Total incl. tax')}</th>
                  <th className="table-actions-column">{t('Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.number}</strong>
                      {p.supplier_reference && <small>{p.supplier_reference}</small>}
                    </td>
                    <td>{p.supplierName}</td>
                    <td>
                      <span className={`badge badge-${statusTone[p.status] ?? 'gray'}`}>
                        {t(p.status)}
                      </span>
                    </td>
                    <td>
                      <PaymentBadge order={p} />
                      {p.payment_due_date && (
                        <small>
                          {t('Payment due date')}: {p.payment_due_date}
                        </small>
                      )}
                    </td>
                    <td className="table-number-column">{formatMoney(p.total, currency)}</td>
                    <td className="table-actions-column">
                      <Button variant="ghost" onClick={() => setSelected(p.id)}>
                        {t('View ')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="panel-padding">
            {q.data?.length
              ? t('No orders match this search or filter.')
              : t('No purchase orders yet.')}
          </p>
        )}
      </section>
      {selected && <OrderDetail id={selected} close={() => setSelected(undefined)} />}
      <Dialog
        open={create}
        onOpenChange={setCreate}
        title={t('New purchase order')}
        description={t(
          'Save a draft before placing your order. Stock changes only when you receive a delivery.',
        )}
      >
        {create && (
          <DraftForm
            done={(id) => {
              setCreate(false);
              setSelected(id);
            }}
          />
        )}
      </Dialog>
    </>
  );
}
function DraftForm({ done, order }: { done: (id: string) => void; order?: Order }) {
  useLanguage();
  const suppliers = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api<Supplier[]>('/suppliers'),
  });
  const products = useProducts();
  const currency = useSession().data?.store.currency ?? 'NOK';
  const [supplierId, setSupplier] = useState(order?.supplier_id ?? '');
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [addingProduct, setAddingProduct] = useState<number | null>(null);
  const [scanLine, setScanLine] = useState<number | null>(null);
  const [barcode, setBarcode] = useState('');
  const [scanError, setScanError] = useState('');
  const [createdProducts, setCreatedProducts] = useState<Product[]>([]);
  const [createdSuppliers, setCreatedSuppliers] = useState<Supplier[]>([]);
  const availableProducts = [
    ...(products.data ?? []),
    ...createdProducts.filter((p) => !products.data?.some((item) => item.id === p.id)),
  ];
  const availableSuppliers = [
    ...(suppliers.data ?? []),
    ...createdSuppliers.filter((s) => !suppliers.data?.some((item) => item.id === s.id)),
  ];
  const selectedSupplier = availableSuppliers.find((s) => s.id === supplierId);
  const [reference, setReference] = useState(order?.supplier_reference ?? '');
  const [expectedDate, setDate] = useState(order?.expected_date?.slice(0, 10) ?? '');
  const [notes, setNotes] = useState(order?.notes ?? '');
  const [lines, setLines] = useState(
    order?.lines.map((l) => ({
      productId: l.product_id,
      quantity: l.ordered_quantity,
      unitCost: l.unit_cost,
      taxRate: l.tax_rate,
      sellingPrice:
        l.proposed_selling_price ?? products.data?.find((p) => p.id === l.product_id)?.price ?? '',
    })) ?? [{ productId: '', quantity: '1', unitCost: '0', taxRate: '0', sellingPrice: '' }],
  );
  function selectProduct(index: number, product: Product) {
    setLines((current) =>
      current.map((line, i) =>
        i === index
          ? {
              ...line,
              productId: product.id,
              unitCost: product.cost ?? '0',
              sellingPrice: product.price,
            }
          : line,
      ),
    );
  }
  const [activeIndex, setActiveIndex] = useState(lines.length - 1);
  const [lineError, setLineError] = useState('');
  const decimal = /^\d{1,9}(\.\d{1,3})?$/;
  function lineComplete(line: (typeof lines)[number]) {
    return (
      !!line.productId &&
      decimal.test(line.quantity.trim()) &&
      Number(line.quantity) > 0 &&
      decimal.test(line.unitCost.trim()) &&
      decimal.test(line.taxRate.trim())
    );
  }
  function nextProduct() {
    const current = lines[activeIndex];
    if (!current || !lineComplete(current)) {
      setLineError('Choose a product and enter a valid quantity, unit cost, and tax rate first.');
      return;
    }
    setLineError('');
    setLines([
      ...lines,
      { productId: '', quantity: '1', unitCost: '0', taxRate: '0', sellingPrice: '' },
    ]);
    setActiveIndex(lines.length);
  }
  function removeLine(index: number) {
    setLines(lines.filter((_, i) => i !== index));
    setActiveIndex((current) => {
      if (index === current) return -1;
      return index < current ? current - 1 : current;
    });
  }
  const [requestId] = useState(() => crypto.randomUUID());
  const mutation = useMutation({
    mutationFn: () =>
      api<Order>('/purchases', {
        requestId,
        id: order?.id,
        version: order?.version,
        supplierId,
        supplierReference: reference,
        expectedDate,
        notes,
        lines: lines
          .filter((line) => line.productId)
          .map((line) => ({ ...line, sellingPrice: line.sellingPrice || undefined })),
      }),
    onSuccess: (p) => {
      void refresh();
      done(p.id);
    },
  });
  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!lines.some((line) => line.productId)) {
            setLineError('Add at least one product to this order.');
            return;
          }
          setLineError('');
          mutation.mutate();
        }}
      >
        <SearchSelect
          label={t('Supplier')}
          placeholder={t('Select a supplier')}
          value={
            selectedSupplier && { title: selectedSupplier.name, subtitle: selectedSupplier.code }
          }
          options={(availableSuppliers ?? [])
            .filter((s) => s.active)
            .map((s) => ({
              id: s.id,
              title: s.name,
              subtitle: [s.code, s.contactName, s.phone].filter(Boolean).join(' · '),
              keywords: [s.name, s.code, s.contactName, s.email, s.phone, s.companyNumber],
            }))}
          createLabel={t('Add new supplier')}
          onCreate={() => setAddingSupplier(true)}
          onSelect={setSupplier}
        />
        {selectedSupplier && <SupplierSummary supplier={selectedSupplier} />}
        <Field label={t('Supplier reference')}>
          <input value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <Field label={t('Expected delivery')}>
          <input type="date" value={expectedDate} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {lines.map((line, index) => {
          const product = availableProducts.find((p) => p.id === line.productId);
          if (index !== activeIndex)
            return (
              <div key={index} className="purchase-line-summary">
                <div className="purchase-line-summary-text">
                  <strong>{product ? product.name : t('Product not selected')}</strong>
                  <span className="muted">
                    {product
                      ? t('{value0} {value1} · {value2} {value3}', {
                          value0: line.quantity,
                          value1: t(product.unit),
                          value2: formatMoney(line.unitCost || '0', currency),
                          value3: t('excl. tax'),
                        })
                      : t('Incomplete line')}
                  </span>
                </div>
                <div className="purchase-line-summary-actions">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setLineError('');
                      setActiveIndex(index);
                    }}
                  >
                    {t('Edit ')}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => removeLine(index)}>
                    {t('Remove ')}
                  </Button>
                </div>
              </div>
            );
          return (
            <fieldset key={index} className="purchase-line">
              <div className="purchase-product-picker">
                <SearchSelect
                  label={t('Product')}
                  placeholder={t('Select a product')}
                  value={
                    product && {
                      title: product.name,
                      subtitle: `${product.sku} (${t(product.unit)})`,
                    }
                  }
                  options={availableProducts
                    .filter((p) => p.active)
                    .map((p) => ({
                      id: p.id,
                      title: p.name,
                      subtitle: `${p.sku} · ${t(p.unit ?? '')}`,
                      keywords: [p.name, p.sku, p.plu ?? '', ...p.barcodes],
                    }))}
                  createLabel={t('Create new product')}
                  onCreate={() => setAddingProduct(index)}
                  onSelect={(id) => {
                    const selected = availableProducts.find((p) => p.id === id);
                    if (selected) selectProduct(index, selected);
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setBarcode('');
                    setScanError('');
                    setScanLine(index);
                  }}
                >
                  {t('Scan barcode ')}
                </Button>
              </div>
              <Field label={t('Quantity')}>
                <input
                  required
                  inputMode="decimal"
                  value={line.quantity}
                  onChange={(e) =>
                    setLines(
                      lines.map((l, i) => (i === index ? { ...l, quantity: e.target.value } : l)),
                    )
                  }
                />
              </Field>
              <Field label={t('Unit cost excl. tax')}>
                <input
                  required
                  inputMode="decimal"
                  value={line.unitCost}
                  onChange={(e) =>
                    setLines(
                      lines.map((l, i) => (i === index ? { ...l, unitCost: e.target.value } : l)),
                    )
                  }
                />
              </Field>
              {line.productId && (
                <CostComparison
                  cost={line.unitCost}
                  previous={product?.cost}
                  price={product?.price}
                />
              )}
              <Field
                label={t('Proposed selling price incl. tax (optional)')}
                hint={t(
                  'Leave blank to keep the current selling price. Confirm any proposed price when receiving the delivery. Saving this order does not change checkout prices.',
                )}
              >
                <input
                  inputMode="decimal"
                  value={line.sellingPrice}
                  onChange={(e) =>
                    setLines(
                      lines.map((l, i) =>
                        i === index ? { ...l, sellingPrice: e.target.value } : l,
                      ),
                    )
                  }
                />
              </Field>
              <Field label={t('Purchase tax %')}>
                <input
                  required
                  inputMode="decimal"
                  value={line.taxRate}
                  onChange={(e) =>
                    setLines(
                      lines.map((l, i) => (i === index ? { ...l, taxRate: e.target.value } : l)),
                    )
                  }
                />
              </Field>
              {lines.length > 1 && (
                <Button type="button" variant="ghost" onClick={() => removeLine(index)}>
                  {t('Remove line ')}
                </Button>
              )}
            </fieldset>
          );
        })}
        {lineError && <p className="field-error">{lineError}</p>}
        <div className="purchase-line-controls">
          {activeIndex === -1 ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setLineError('');
                setLines([
                  ...lines,
                  { productId: '', quantity: '1', unitCost: '0', taxRate: '0', sellingPrice: '' },
                ]);
                setActiveIndex(lines.length);
              }}
            >
              {t('Add product ')}
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={nextProduct}>
              {t('Next product ')}
            </Button>
          )}
        </div>
        <Field label={t('Order notes')}>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <ErrorMessage error={mutation.error} />
        <div className="form-actions">
          <Button disabled={mutation.isPending}>
            {mutation.isPending ? t('Saving…') : t('Save draft')}
          </Button>
        </div>
      </form>
      <Dialog
        elevated
        open={addingSupplier}
        onOpenChange={setAddingSupplier}
        title={t('Add supplier')}
        description={t('Keep supplier details available for your team.')}
      >
        {addingSupplier && (
          <SupplierForm
            supplier={null}
            done={() => setAddingSupplier(false)}
            onCreated={(supplier) => {
              setCreatedSuppliers((current) => [...current, supplier]);
              setSupplier(supplier.id);
            }}
          />
        )}
      </Dialog>
      <Dialog
        elevated
        open={addingProduct !== null}
        onOpenChange={(open) => {
          if (!open) setAddingProduct(null);
        }}
        title={t('Add a product')}
        description={t('Start with the basics. Receive stock through this purchase order.')}
      >
        {addingProduct !== null && (
          <ProductForm
            onDone={() => setAddingProduct(null)}
            onCreated={(product) => {
              setCreatedProducts((current) => [...current, product]);
              selectProduct(addingProduct, product);
            }}
          />
        )}
      </Dialog>
      <Dialog
        open={scanLine !== null}
        onOpenChange={(open) => {
          if (!open) setScanLine(null);
        }}
        title={t('Scan barcode')}
        description={t('Scan with your barcode reader, or type the barcode and press Enter.')}
      >
        {scanLine !== null && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const product = availableProducts.find(
                (p) => p.active && p.barcodes.includes(barcode.trim()),
              );
              if (!product) {
                setScanError(
                  'No active product matches this barcode. Check the barcode or create a new product.',
                );
                return;
              }
              selectProduct(scanLine, product);
              setScanLine(null);
            }}
          >
            <Field label={t('Barcode')}>
              <input
                autoFocus
                required
                value={barcode}
                onChange={(e) => {
                  setBarcode(e.target.value);
                  setScanError('');
                }}
              />
            </Field>
            <ErrorMessage error={scanError} />
            <Button type="submit" disabled={products.isPending}>
              {t('Find product ')}
            </Button>
          </form>
        )}
      </Dialog>
    </>
  );
}

function PaymentBadge({ order }: { order: Order }) {
  useLanguage();
  const label =
    order.payment_status === 'paid'
      ? 'Paid'
      : order.payment_overdue
        ? 'Overdue'
        : order.payment_status === 'unpaid'
          ? 'Unpaid'
          : 'Payment not recorded';
  return (
    <span
      className={
        'badge badge-' +
        (order.payment_status === 'paid' ? 'green' : order.payment_overdue ? 'amber' : 'gray')
      }
    >
      {t(label)}
    </span>
  );
}
function PurchasePayment({ order }: { order: Order }) {
  useLanguage();
  const session = useSession().data;
  const canWrite = session?.user.permissions.includes('purchases.write');
  const editable = canWrite && order.status !== 'cancelled';
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<'paid' | 'unpaid'>(
    order.payment_status === 'paid' ? 'paid' : 'unpaid',
  );
  const [dueDate, setDueDate] = useState(order.payment_due_date ?? '');
  const [pending, setPending] = useState<{
    requestId: string;
    version: number;
    status: 'paid' | 'unpaid';
    dueDate: string;
  }>();
  const mutation = useMutation({
    mutationFn: (body: NonNullable<typeof pending>) =>
      api('/purchases/' + order.id + '/payment', body),
    onSuccess: () => {
      setPending(undefined);
      setOpen(false);
      void refresh();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500)
        setPending(undefined);
    },
  });
  return (
    <div className="order-detail-section order-payment">
      <div className="order-payment-head">
        <div className="order-payment-title">
          <h3>{t('Purchase payment')}</h3>
          <PaymentBadge order={order} />
        </div>
        {editable && (
          <Button variant="outline" onClick={() => setOpen(true)}>
            {t('Update payment')}
          </Button>
        )}
      </div>
      <dl className="order-payment-facts">
        <div>
          <dt>{t('Payment due date')}</dt>
          <dd>{order.payment_due_date || t('Not set')}</dd>
        </div>
        <div>
          <dt>{t('Marked paid at')}</dt>
          <dd>
            {order.paid_at
              ? new Date(order.paid_at).toLocaleString(getLocale(), {
                  timeZone: session?.store.timezone,
                })
              : '—'}
          </dd>
        </div>
      </dl>
      <p className="muted order-payment-note">
        {t(
          'Payment is tracked separately from delivery. Mark paid only after the supplier has been paid in full.',
        )}
      </p>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v) setOpen(false);
        }}
        title={t('Update payment')}
        description={t(
          'Payment is tracked separately from delivery. Mark paid only after the supplier has been paid in full.',
        )}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const body = pending ?? {
              requestId: crypto.randomUUID(),
              version: order.version,
              status,
              dueDate,
            };
            setPending(body);
            mutation.mutate(body);
          }}
        >
          <fieldset disabled={mutation.isPending || !!pending}>
            <Field label={t('Payment status')}>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as 'paid' | 'unpaid')}
              >
                <option value="unpaid">{t('Unpaid')}</option>
                <option value="paid">{t('Paid')}</option>
              </select>
            </Field>
            <Field
              label={t('Payment due date')}
              hint={t(
                'Optional. Unpaid orders become overdue after this date in the store timezone.',
              )}
            >
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
          </fieldset>
          <ErrorMessage error={mutation.error} />
          <div className="form-actions">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('Cancel')}
            </Button>
            <Button disabled={mutation.isPending}>
              {mutation.isPending
                ? t('Saving…')
                : pending
                  ? t('Retry same change')
                  : t('Save payment status')}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

function OrderDetail({ id, close }: { id: string; close: () => void }) {
  useLanguage();
  const q = useQuery({ queryKey: ['purchase', id], queryFn: () => api<Order>('/purchases/' + id) });
  const [receiving, setReceiving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState('');
  const [cancel, setCancel] = useState(false);
  const currency = useSession().data!.store.currency;
  const status = useMutation({
    mutationFn: (next: string) =>
      api('/purchases/' + id + '/status', {
        requestId: crypto.randomUUID(),
        version: q.data!.version,
        status: next,
        reason,
      }),
    onSuccess: () => {
      setCancel(false);
      void refresh();
    },
  });
  const p = q.data;
  return (
    <section className="panel order-detail">
      <div className="order-detail-head">
        <div className="order-detail-title">
          <div className="order-detail-number">
            <h2>{p ? p.number : t('Order')}</h2>
            {p && (
              <span className={`badge badge-${statusTone[p.status] ?? 'gray'}`}>{t(p.status)}</span>
            )}
          </div>
          {p && (
            <p className="muted">
              {p.supplierName}
              {p.supplier_reference
                ? t(' · {value0}', { value0: p.supplier_reference })
                : ''} · {formatMoney(p.total, currency)} {t(' incl. tax ')}
            </p>
          )}
        </div>
        <Button variant="ghost" onClick={close}>
          <X size={16} />
          {t('Close ')}
        </Button>
      </div>
      {q.error && (
        <div className="panel-padding">
          <ErrorMessage error={q.error} />
        </div>
      )}
      {p && (
        <>
          {p.notes && <p className="order-detail-notes">{p.notes}</p>}
          {p.status === 'closed' && (
            <div className="order-detail-notes">
              <strong>{t('Remaining quantities closed')}</strong>
              <p>{p.close_reason}</p>
              <p className="muted">
                {p.closed_by_name} ·{' '}
                {p.closed_at ? new Date(p.closed_at).toLocaleString(getLocale()) : ''}
              </p>
              <p className="muted">
                {t(
                  'Original order totals are retained. Stock, deliveries and payment status are unchanged.',
                )}
              </p>
            </div>
          )}
          <PurchasePayment key={p.id + ':' + p.version} order={p} />
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t('Product')}</th>
                  <th className="table-number-column">{t('Ordered')}</th>
                  <th className="table-number-column">{t('Received')}</th>
                  {p.status === 'closed' && (
                    <th className="table-number-column">{t('Closed quantity')}</th>
                  )}
                  <th className="table-number-column">{t('Cost excl. tax')}</th>
                  <th className="table-number-column">{t('Tax %')}</th>
                </tr>
              </thead>
              <tbody>
                {p.lines.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <strong>{l.product_name}</strong>
                      <small>{l.sku}</small>
                    </td>
                    <td className="table-number-column">
                      {Number(l.ordered_quantity)} {t(l.unit ?? '')}
                    </td>
                    <td className="table-number-column">
                      {Number(l.received_quantity)} {t(l.unit ?? '')}
                    </td>
                    {p.status === 'closed' && (
                      <td className="table-number-column">
                        {Number(
                          fromScaled(
                            toScaled(l.ordered_quantity, 3) - toScaled(l.received_quantity, 3),
                            3,
                          ),
                        )}{' '}
                        {t(l.unit ?? '')}
                      </td>
                    )}
                    <td className="table-number-column">{formatMoney(l.unit_cost, currency)}</td>
                    <td className="table-number-column">{Number(l.tax_rate)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="order-detail-actions">
            {p.status === 'draft' && (
              <Button disabled={status.isPending} onClick={() => status.mutate('ordered')}>
                {status.isPending ? t('Placing…') : t('Place order')}
              </Button>
            )}
            {['ordered', 'partially_received'].includes(p.status) && (
              <Button onClick={() => setReceiving(true)}>{t('Receive delivery')}</Button>
            )}
            {p.status === 'partially_received' && (
              <CloseRemainder key={p.id + ':' + p.version} order={p} />
            )}
            {p.status === 'draft' && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                {t('Edit draft ')}
              </Button>
            )}
            {['draft', 'ordered'].includes(p.status) && (
              <Button variant="ghost" onClick={() => setCancel(true)}>
                {t('Cancel order ')}
              </Button>
            )}
          </div>
          {status.error && (
            <div className="panel-padding">
              <ErrorMessage error={status.error} />
            </div>
          )}
          <div className="order-detail-section">
            <h3>{t('Delivery history')}</h3>
            {p.receipts.length ? (
              <div className="delivery-list">
                {p.receipts.map((r) => (
                  <details key={r.id} className="delivery-entry">
                    <summary>
                      <span className="delivery-entry-summary">
                        <strong>{r.number}</strong>
                        <small>{r.delivery_reference || t('No delivery reference')}</small>
                      </span>
                      <span className="delivery-entry-total">{formatMoney(r.total, currency)}</span>
                    </summary>
                    <div className="delivery-entry-body">
                      <p className="muted">
                        {t('Received by ')}
                        {r.actor} {t(' on ')}
                        {r.device}
                      </p>
                      <ul>
                        {r.lines.map((l) => (
                          <li key={l.id}>
                            <span>{l.product_name}</span>
                            <span className="muted">
                              {Number(l.quantity)} {t(l.unit ?? '')} ×{' '}
                              {formatMoney(l.unit_cost, currency)} {t('excl. tax ')}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </details>
                ))}
              </div>
            ) : (
              <p className="muted">{t('No deliveries recorded yet.')}</p>
            )}
          </div>
          <Dialog
            open={cancel}
            onOpenChange={setCancel}
            title={t('Cancel this order')}
            description={t(
              'Cancelling is permanent and does not change stock. Partly received orders cannot be cancelled.',
            )}
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                status.mutate('cancelled');
              }}
            >
              <Field label={t('Cancellation reason')}>
                <input
                  autoFocus
                  required
                  maxLength={300}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
              <ErrorMessage error={status.error} />
              <div className="form-actions">
                <Button type="button" variant="outline" onClick={() => setCancel(false)}>
                  {t('Keep order ')}
                </Button>
                <Button disabled={status.isPending}>
                  {status.isPending ? t('Cancelling…') : t('Confirm cancellation')}
                </Button>
              </div>
            </form>
          </Dialog>
          <Dialog
            open={editing}
            onOpenChange={setEditing}
            title={t('Edit purchase draft')}
            description={t('Only drafts can be edited.')}
          >
            {editing && <DraftForm order={p} done={() => setEditing(false)} />}
          </Dialog>
          <Dialog
            open={receiving}
            onOpenChange={setReceiving}
            title={t('Receive delivery')}
            description={t('Enter only quantities delivered now. Leave other lines at zero.')}
          >
            {receiving && <ReceiveForm order={p} done={() => setReceiving(false)} />}
          </Dialog>
        </>
      )}
    </section>
  );
}
function ReceiveForm({ order, done }: { order: Order; done: () => void }) {
  useLanguage();
  const products = useProducts();
  const session = useSession();
  const canPrice = session.data?.user.permissions.includes('catalog.write');
  const canCost = session.data?.user.permissions.includes('purchases.cost');
  const [costs, setCosts] = useState<Record<string, string>>({});
  const [prices, setPrices] = useState<Record<string, string>>(
    Object.fromEntries(order.lines.map((l) => [l.id, l.proposed_selling_price ?? ''])),
  );
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reference, setReference] = useState('');
  const [payload, setPayload] = useState<unknown>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  async function submit() {
    const body = payload ?? {
      requestId: crypto.randomUUID(),
      version: order.version,
      deliveryReference: reference,
      lines: order.lines
        .filter((l) => Number(quantities[l.id] ?? 0) > 0)
        .map((l) => ({
          purchaseLineId: l.id,
          quantity: quantities[l.id],
          unitCost: canCost ? (costs[l.id] ?? l.unit_cost) : undefined,
          sellingPrice: canPrice && prices[l.id] ? prices[l.id] : undefined,
          expectedSellingPrice:
            canPrice && prices[l.id]
              ? products.data?.find((p) => p.id === l.product_id)?.price
              : undefined,
        })),
    };
    setPayload(body);
    setPending(true);
    try {
      await api('/purchases/' + order.id + '/receipts', body);
      void refresh();
      done();
    } catch (e) {
      setError(e);
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) setPayload(undefined);
    } finally {
      setPending(false);
    }
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <fieldset disabled={!!payload}>
        <Field label={t('Delivery reference')}>
          <input value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        {order.lines
          .filter((l) => toScaled(l.ordered_quantity, 3) > toScaled(l.received_quantity, 3))
          .map((l) => (
            <div key={l.id}>
              <Field
                label={t('{value0} — {value1} {value2} remaining', {
                  value0: l.product_name,
                  value1: fromScaled(
                    toScaled(l.ordered_quantity, 3) - toScaled(l.received_quantity, 3),
                    3,
                  ),
                  value2: t(l.unit ?? ''),
                })}
              >
                <input
                  inputMode="decimal"
                  value={quantities[l.id] ?? '0'}
                  onChange={(e) => setQuantities({ ...quantities, [l.id]: e.target.value })}
                />
              </Field>
              <Field label={t('Unit cost excl. tax for ') + l.product_name}>
                <input
                  inputMode="decimal"
                  required
                  disabled={!canCost}
                  value={costs[l.id] ?? l.unit_cost}
                  onChange={(e) => setCosts({ ...costs, [l.id]: e.target.value })}
                />
              </Field>
              <CostComparison
                cost={costs[l.id] ?? l.unit_cost}
                previous={products.data?.find((p) => p.id === l.product_id)?.cost}
                price={products.data?.find((p) => p.id === l.product_id)?.price}
              />
              {canPrice && (
                <Field
                  label={t('New selling price incl. tax for ') + l.product_name + t(' (optional)')}
                >
                  <input
                    inputMode="decimal"
                    value={prices[l.id] ?? ''}
                    onChange={(e) => setPrices({ ...prices, [l.id]: e.target.value })}
                  />
                </Field>
              )}
              {canPrice && prices[l.id] && Number(quantities[l.id] ?? 0) > 0 && (
                <label className="delivery-price-confirmation">
                  <input
                    key={
                      prices[l.id] + '-' + products.data?.find((p) => p.id === l.product_id)?.price
                    }
                    type="checkbox"
                    required
                  />
                  <span>
                    {t('Apply this selling price to all stock of ')}
                    {l.product_name}
                    {t(', including older items. Update the shelf label. ')}
                  </span>
                </label>
              )}
            </div>
          ))}
      </fieldset>
      <ErrorMessage error={error} />
      <div className="delivery-submit">
        <Button disabled={pending}>
          {payload ? t('Retry same delivery') : t('Record delivery')}
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

function CloseRemainder({ order }: { order: Order }) {
  useLanguage();
  const allowed = useSession().data!.user.permissions.includes('purchases.write');
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [command, setCommand] = useState<{ requestId: string; version: number; reason: string }>();
  const mutation = useMutation({
    mutationFn: (body: { requestId: string; version: number; reason: string }) =>
      api('/purchases/' + order.id + '/close-remainder', body),
    onSuccess: () => {
      setOpen(false);
      void refresh();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500)
        setCommand(undefined);
    },
  });
  if (!allowed) return null;
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        {t('Close remaining quantities')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!mutation.isPending) setOpen(value);
        }}
        title={t('Close remaining quantities')}
        description={t(
          'Close all undelivered quantities permanently. Recorded deliveries, stock and payment status will not change.',
        )}
      >
        <ul>
          {order.lines
            .filter(
              (line) => toScaled(line.ordered_quantity, 3) > toScaled(line.received_quantity, 3),
            )
            .map((line) => (
              <li key={line.id}>
                {line.product_name}:{' '}
                {Number(
                  fromScaled(
                    toScaled(line.ordered_quantity, 3) - toScaled(line.received_quantity, 3),
                    3,
                  ),
                )}{' '}
                {t(line.unit ?? '')}
              </li>
            ))}
        </ul>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const body = command ?? {
              requestId: crypto.randomUUID(),
              version: order.version,
              reason: reason.trim(),
            };
            setCommand(body);
            mutation.mutate(body);
          }}
        >
          <Field label={t('Closure reason')}>
            <textarea
              required
              maxLength={500}
              value={reason}
              disabled={!!command}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <ErrorMessage error={mutation.error} />
          <div className="form-actions">
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => setOpen(false)}
            >
              {t('Keep order ')}
            </Button>
            <Button disabled={mutation.isPending || !reason.trim()}>
              {command && !mutation.isPending ? t('Retry same change') : t('Confirm closure')}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
