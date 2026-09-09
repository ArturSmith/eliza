import { useState, type ReactNode } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Search } from 'lucide-react';
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
  const currency = useSession().data?.store.currency ?? 'NOK';
  const valid = /^\d{1,9}(\.\d{1,2})?$/.test(cost);
  const changed = previous != null && valid && Number(cost) !== Number(previous);
  return (
    <div className="muted" aria-live="polite">
      {changed && (
        <p className="purchase-cost-change">
          <strong>Unit cost {Number(cost) > Number(previous) ? 'increased' : 'decreased'}:</strong>{' '}
          {formatMoney(previous!, currency)} to {formatMoney(cost, currency)}
          {Number(previous) > 0 &&
            ' (' + (((Number(cost) - Number(previous)) / Number(previous)) * 100).toFixed(1) + '%)'}
          . Costs exclude tax.
        </p>
      )}
      {price !== undefined && (
        <p>Current selling price: {formatMoney(price, currency)} including tax.</p>
      )}
    </div>
  );
}
function SupplierSummary({ supplier }: { supplier: Supplier }) {
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
        {!supplier.active && <span className="supplier-summary-flag">Inactive</span>}
      </div>
      {shown.length ? (
        <dl>
          {shown.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="muted">No contact details recorded for this supplier.</p>
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
  return (
    <div className={'page-heading ' + className}>
      <div>
        <div className="eyebrow">PURCHASING</div>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
      </div>
      {action}
    </div>
  );
}
export function SuppliersPage() {
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
        title="Suppliers"
        description="Supplier contacts and ordering details."
        action={<Button onClick={() => setEditing(null)}>Add supplier</Button>}
      />
      <section className="panel">
        <div className="table-toolbar">
          <div className="search-box">
            <Search size={18} />
            <input
              aria-label="Search suppliers"
              placeholder="Search name, code, contact, email, or phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <span className="muted">
            {rows.length} {rows.length === 1 ? 'supplier' : 'suppliers'}
          </span>
        </div>
        <ErrorMessage error={q.error} />
        {q.isPending ? (
          <p className="panel-padding">Loading suppliers…</p>
        ) : rows.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Contact</th>
                  <th>Terms</th>
                  <th>Status</th>
                  <th className="table-actions-column">Actions</th>
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
                        {s.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="table-actions-column">
                      <Button variant="ghost" onClick={() => setEditing(s)}>
                        Edit
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
              ? `No suppliers match “${search.trim()}”.`
              : 'Add your first supplier to start purchasing.'}
          </p>
        )}
      </section>
      <Dialog
        open={editing !== undefined}
        onOpenChange={(v) => !v && setEditing(undefined)}
        title={editing ? 'Edit supplier' : 'Add supplier'}
        description="Keep supplier details available for your team."
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
            label={
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
              }[key]
            }
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
        Active supplier
      </label>
      <ErrorMessage error={mutation.error} />
      <div className="form-actions">
        <Button disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : 'Save supplier'}
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
};
export function PurchasesPage() {
  const q = useQuery({ queryKey: ['purchases'], queryFn: () => api<Order[]>('/purchases') });
  const currency = useSession().data?.store.currency ?? 'NOK';
  const [selected, setSelected] = useState<string>();
  const [create, setCreate] = useState(false);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const terms = search.trim().toLowerCase();
  const rows = (q.data ?? []).filter(
    (p) =>
      (filter === 'all' || p.status === filter) &&
      [p.number, p.supplierName, p.supplier_reference].some((v) =>
        (v ?? '').toLowerCase().includes(terms),
      ),
  );
  return (
    <>
      <Heading
        title="Purchase orders"
        className="purchases-heading"
        description="Order stock, then record each delivery when it arrives. Costs exclude tax."
        action={<Button onClick={() => setCreate(true)}>New purchase order</Button>}
      />
      <section className="panel">
        <div className="table-toolbar">
          <div className="search-box">
            <Search size={18} />
            <input
              aria-label="Search purchase orders"
              placeholder="Search order number, supplier, or reference…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            aria-label="Filter order status"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            {['all', 'draft', 'ordered', 'partially_received', 'received', 'cancelled'].map((s) => (
              <option key={s} value={s}>
                {s === 'all' ? 'All statuses' : s.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
          <span className="muted">
            {rows.length} {rows.length === 1 ? 'order' : 'orders'}
          </span>
        </div>
        <ErrorMessage error={q.error} />
        {q.isPending ? (
          <p className="panel-padding">Loading orders…</p>
        ) : rows.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Supplier</th>
                  <th>Status</th>
                  <th className="table-number-column">Total incl. tax</th>
                  <th className="table-actions-column">Actions</th>
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
                        {p.status.replaceAll('_', ' ')}
                      </span>
                    </td>
                    <td className="table-number-column">{formatMoney(p.total, currency)}</td>
                    <td className="table-actions-column">
                      <Button variant="ghost" onClick={() => setSelected(p.id)}>
                        View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="panel-padding">
            {q.data?.length ? 'No orders match this search or filter.' : 'No purchase orders yet.'}
          </p>
        )}
      </section>
      {selected && <OrderDetail id={selected} close={() => setSelected(undefined)} />}
      <Dialog
        open={create}
        onOpenChange={setCreate}
        title="New purchase order"
        description="Save a draft before placing your order. Stock changes only when you receive a delivery."
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
          label="Supplier"
          placeholder="Select a supplier"
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
          createLabel="Add new supplier"
          onCreate={() => setAddingSupplier(true)}
          onSelect={setSupplier}
        />
        {selectedSupplier && <SupplierSummary supplier={selectedSupplier} />}
        <Field label="Supplier reference">
          <input value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <Field label="Expected delivery">
          <input type="date" value={expectedDate} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {lines.map((line, index) => {
          const product = availableProducts.find((p) => p.id === line.productId);
          if (index !== activeIndex)
            return (
              <div key={index} className="purchase-line-summary">
                <div className="purchase-line-summary-text">
                  <strong>{product ? product.name : 'Product not selected'}</strong>
                  <span className="muted">
                    {product
                      ? `${line.quantity} ${product.unit} · ${formatMoney(line.unitCost || '0', currency)} excl. tax`
                      : 'Incomplete line'}
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
                    Edit
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => removeLine(index)}>
                    Remove
                  </Button>
                </div>
              </div>
            );
          return (
            <fieldset key={index} className="purchase-line">
              <div className="purchase-product-picker">
                <SearchSelect
                  label="Product"
                  placeholder="Select a product"
                  value={
                    product && { title: product.name, subtitle: `${product.sku} (${product.unit})` }
                  }
                  options={availableProducts
                    .filter((p) => p.active)
                    .map((p) => ({
                      id: p.id,
                      title: p.name,
                      subtitle: `${p.sku} · ${p.unit}`,
                      keywords: [p.name, p.sku, p.plu ?? '', ...p.barcodes],
                    }))}
                  createLabel="Create new product"
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
                  Scan barcode
                </Button>
              </div>
              <Field label="Quantity">
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
              <Field label="Unit cost excl. tax">
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
                label="Proposed selling price incl. tax (optional)"
                hint="Leave blank to keep the current selling price. Confirm any proposed price when receiving the delivery. Saving this order does not change checkout prices."
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
              <Field label="Purchase tax %">
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
                  Remove line
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
              Add product
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={nextProduct}>
              Next product
            </Button>
          )}
        </div>
        <Field label="Order notes">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <ErrorMessage error={mutation.error} />
        <div className="form-actions">
          <Button disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Save draft'}
          </Button>
        </div>
      </form>
      <Dialog
        elevated
        open={addingSupplier}
        onOpenChange={setAddingSupplier}
        title="Add supplier"
        description="Keep supplier details available for your team."
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
        title="Add a product"
        description="Start with the basics. Receive stock through this purchase order."
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
        title="Scan barcode"
        description="Scan with your barcode reader, or type the barcode and press Enter."
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
            <Field label="Barcode">
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
              Find product
            </Button>
          </form>
        )}
      </Dialog>
    </>
  );
}
function OrderDetail({ id, close }: { id: string; close: () => void }) {
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
    <section className="panel panel-padding" style={{ marginTop: 24 }}>
      <Button variant="ghost" onClick={close}>
        Close order
      </Button>
      <ErrorMessage error={q.error} />
      {p && (
        <>
          <h2>
            {p.number} · {p.supplierName}
          </h2>
          <p>
            {p.status.replaceAll('_', ' ')} · {formatMoney(p.total, currency)}
          </p>
          <p>{p.notes}</p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Ordered</th>
                  <th>Received</th>
                  <th>Cost excl. tax</th>
                  <th>Tax %</th>
                </tr>
              </thead>
              <tbody>
                {p.lines.map((l) => (
                  <tr key={l.id}>
                    <td>
                      {l.product_name}
                      <small>{l.sku}</small>
                    </td>
                    <td>
                      {l.ordered_quantity} {l.unit}
                    </td>
                    <td>{l.received_quantity}</td>
                    <td>{formatMoney(l.unit_cost, currency)}</td>
                    <td>{l.tax_rate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {p.status === 'draft' && (
            <Button variant="outline" onClick={() => setEditing(true)}>
              Edit draft
            </Button>
          )}
          {p.status === 'draft' && (
            <Button disabled={status.isPending} onClick={() => status.mutate('ordered')}>
              Place order
            </Button>
          )}
          {['ordered', 'partially_received'].includes(p.status) && (
            <Button onClick={() => setReceiving(true)}>Receive delivery</Button>
          )}
          {['draft', 'ordered'].includes(p.status) && (
            <Button variant="outline" onClick={() => setCancel(true)}>
              Cancel order
            </Button>
          )}
          {cancel && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                status.mutate('cancelled');
              }}
            >
              <Field label="Cancellation reason">
                <input required value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
              <Button disabled={status.isPending}>Confirm cancellation</Button>
            </form>
          )}
          <ErrorMessage error={status.error} />
          <h3>Delivery history</h3>
          {!p.receipts.length && <p className="muted">No deliveries recorded.</p>}
          {p.receipts.map((r) => (
            <details key={r.id}>
              <summary>
                {r.number} · {r.delivery_reference || 'No delivery reference'} ·{' '}
                {formatMoney(r.total, currency)}
              </summary>
              <p>
                Received by {r.actor} on {r.device}
              </p>
              {r.lines.map((l) => (
                <p key={l.id}>
                  {l.product_name}: {l.quantity} {l.unit} × {formatMoney(l.unit_cost, currency)}{' '}
                  excl. tax
                </p>
              ))}
            </details>
          ))}
          <Dialog
            open={editing}
            onOpenChange={setEditing}
            title="Edit purchase draft"
            description="Only drafts can be edited."
          >
            {editing && <DraftForm order={p} done={() => setEditing(false)} />}
          </Dialog>
          <Dialog
            open={receiving}
            onOpenChange={setReceiving}
            title="Receive delivery"
            description="Enter only quantities delivered now. Leave other lines at zero."
          >
            {receiving && <ReceiveForm order={p} done={() => setReceiving(false)} />}
          </Dialog>
        </>
      )}
    </section>
  );
}
function ReceiveForm({ order, done }: { order: Order; done: () => void }) {
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
        <Field label="Delivery reference">
          <input value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        {order.lines
          .filter((l) => toScaled(l.ordered_quantity, 3) > toScaled(l.received_quantity, 3))
          .map((l) => (
            <div key={l.id}>
              <Field
                label={`${l.product_name} — ${fromScaled(toScaled(l.ordered_quantity, 3) - toScaled(l.received_quantity, 3), 3)} ${l.unit} remaining`}
              >
                <input
                  inputMode="decimal"
                  value={quantities[l.id] ?? '0'}
                  onChange={(e) => setQuantities({ ...quantities, [l.id]: e.target.value })}
                />
              </Field>
              <Field label={'Unit cost excl. tax for ' + l.product_name}>
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
                <Field label={'New selling price incl. tax for ' + l.product_name + ' (optional)'}>
                  <input
                    inputMode="decimal"
                    value={prices[l.id] ?? ''}
                    onChange={(e) => setPrices({ ...prices, [l.id]: e.target.value })}
                  />
                </Field>
              )}
              {canPrice && prices[l.id] && Number(quantities[l.id] ?? 0) > 0 && (
                <label>
                  <input
                    key={
                      prices[l.id] + '-' + products.data?.find((p) => p.id === l.product_id)?.price
                    }
                    type="checkbox"
                    required
                  />
                  Apply this selling price to all stock of {l.product_name}, including older items.
                  Update the shelf label.
                </label>
              )}
            </div>
          ))}
      </fieldset>
      <ErrorMessage error={error} />
      <Button disabled={pending}>{payload ? 'Retry same delivery' : 'Record delivery'}</Button>
      {!!payload && !pending && (
        <p className="muted">
          The delivery details are locked for a safe retry. Refresh the order before starting a
          different delivery.
        </p>
      )}
    </form>
  );
}
