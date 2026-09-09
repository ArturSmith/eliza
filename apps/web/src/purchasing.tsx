import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  supplierSchema,
  fromScaled,
  toScaled,
  type Supplier,
  type Product,
} from '@eliza/contracts';
import { api, ApiError, refresh, useProducts, useSession } from './api';
import { Field, ErrorMessage, ProductForm } from './forms';
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
function Heading({
  title,
  description,
  className = '',
}: {
  title: string;
  description: string;
  className?: string;
}) {
  return (
    <div className={'page-heading ' + className}>
      <div>
        <div className="eyebrow">PURCHASING</div>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
      </div>
    </div>
  );
}
export function SuppliersPage() {
  const q = useQuery({ queryKey: ['suppliers'], queryFn: () => api<Supplier[]>('/suppliers') });
  const [editing, setEditing] = useState<Supplier | null | undefined>();
  const [search, setSearch] = useState('');
  return (
    <>
      <Heading title="Suppliers" description="Supplier contacts and ordering details." />
      <Button onClick={() => setEditing(null)}>Add supplier</Button>
      <Field label="Search suppliers">
        <input value={search} onChange={(e) => setSearch(e.target.value)} />
      </Field>
      <ErrorMessage error={q.error} />
      <section className="panel table-scroll">
        <table>
          <thead>
            <tr>
              <th>Supplier</th>
              <th>Contact</th>
              <th>Terms</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {q.data
              ?.filter((s) => (s.name + s.code).toLowerCase().includes(search.toLowerCase()))
              .map((s) => (
                <tr key={s.id}>
                  <td>
                    <strong>{s.name}</strong>
                    <small>{s.code}</small>
                  </td>
                  <td>
                    {s.contactName}
                    <small>
                      {s.email} {s.phone}
                    </small>
                  </td>
                  <td>{s.paymentTerms || '—'}</td>
                  <td>{s.active ? 'Active' : 'Inactive'}</td>
                  <td>
                    <Button variant="ghost" onClick={() => setEditing(s)}>
                      Edit supplier
                    </Button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {q.isPending ? (
          <p className="panel-padding">Loading suppliers…</p>
        ) : (
          !q.data?.length && (
            <p className="panel-padding">Add your first supplier to start purchasing.</p>
          )
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
      <label>
        <input
          type="checkbox"
          checked={value.active}
          onChange={(e) => setValue({ ...value, active: e.target.checked })}
        />{' '}
        Active supplier
      </label>
      <ErrorMessage error={mutation.error} />
      <Button disabled={mutation.isPending}>Save supplier</Button>
    </form>
  );
}
export function PurchasesPage() {
  const q = useQuery({ queryKey: ['purchases'], queryFn: () => api<Order[]>('/purchases') });
  const [selected, setSelected] = useState<string>();
  const [create, setCreate] = useState(false);
  const [filter, setFilter] = useState('all');
  return (
    <>
      <Heading
        title="Purchase orders"
        className="purchases-heading"
        description="Order stock, then record each delivery when it arrives. Costs exclude tax."
      />
      <Button className="purchase-create-button" onClick={() => setCreate(true)}>
        New purchase order
      </Button>
      <Field label="Order status">
        <select
          className="purchase-status-select"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          {['all', 'draft', 'ordered', 'partially_received', 'received', 'cancelled'].map((s) => (
            <option key={s} value={s}>
              {s.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
      </Field>
      <ErrorMessage error={q.error} />
      <section className="panel table-scroll">
        <table>
          <thead>
            <tr>
              <th>Order</th>
              <th>Supplier</th>
              <th>Status</th>
              <th>Total incl. tax</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {q.data
              ?.filter((p) => filter === 'all' || p.status === filter)
              .map((p) => (
                <tr key={p.id}>
                  <td>{p.number}</td>
                  <td>{p.supplierName}</td>
                  <td>{p.status.replaceAll('_', ' ')}</td>
                  <td>{p.total}</td>
                  <td>
                    <Button variant="ghost" onClick={() => setSelected(p.id)}>
                      View order
                    </Button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {q.isPending ? (
          <p className="panel-padding">Loading orders…</p>
        ) : (
          !q.data?.length && <p className="panel-padding">No purchase orders yet.</p>
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
        lines: lines.map((line) => ({ ...line, sellingPrice: line.sellingPrice || undefined })),
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
          mutation.mutate();
        }}
      >
        <Field label="Supplier">
          <select
            required
            value={supplierId}
            onChange={(e) => {
              if (e.target.value === '__new') setAddingSupplier(true);
              else setSupplier(e.target.value);
            }}
          >
            <option value="" hidden disabled />
            <option value="__new">Add new supplier</option>
            {availableSuppliers
              ?.filter((s) => s.active)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Supplier reference">
          <input value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <Field label="Expected delivery">
          <input type="date" value={expectedDate} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {lines.map((line, index) => (
          <fieldset key={index}>
            <legend>Order line {index + 1}</legend>
            <div className="purchase-product-picker">
              <Field label="Product">
                <select
                  required
                  value={line.productId}
                  onChange={(e) => {
                    if (e.target.value === '__new') setAddingProduct(index);
                    else {
                      const product = availableProducts.find((p) => p.id === e.target.value);
                      if (product) selectProduct(index, product);
                    }
                  }}
                >
                  <option value="" hidden disabled />
                  <option value="__new">Create new product</option>
                  {availableProducts
                    ?.filter((p) => p.active)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {p.sku} ({p.unit})
                      </option>
                    ))}
                </select>
              </Field>
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
            {(['quantity', 'unitCost', 'sellingPrice', 'taxRate'] as const).map((key) => (
              <Field
                key={key}
                label={
                  {
                    quantity: 'Quantity',
                    unitCost: 'Unit cost excl. tax',
                    sellingPrice: 'Proposed selling price incl. tax (optional)',
                    taxRate: 'Purchase tax %',
                  }[key]
                }
              >
                <input
                  required={key !== 'sellingPrice'}
                  inputMode="decimal"
                  value={line[key]}
                  onChange={(e) =>
                    setLines(
                      lines.map((l, i) => (i === index ? { ...l, [key]: e.target.value } : l)),
                    )
                  }
                />
              </Field>
            ))}
            {line.productId && (
              <>
                <CostComparison
                  cost={line.unitCost}
                  previous={availableProducts.find((p) => p.id === line.productId)?.cost}
                  price={availableProducts.find((p) => p.id === line.productId)?.price}
                />
                <p className="muted">
                  Leave blank to keep the current selling price. Confirm any proposed price when
                  receiving the delivery. Saving this order does not change checkout prices.
                </p>
              </>
            )}
            {lines.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setLines(lines.filter((_, i) => i !== index))}
              >
                Remove line
              </Button>
            )}
          </fieldset>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            setLines([
              ...lines,
              { productId: '', quantity: '1', unitCost: '0', taxRate: '0', sellingPrice: '' },
            ])
          }
        >
          Add line
        </Button>
        <Field label="Order notes">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <ErrorMessage error={mutation.error} />
        <Button disabled={mutation.isPending}>Save draft</Button>
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
