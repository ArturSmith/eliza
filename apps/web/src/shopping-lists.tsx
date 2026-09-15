import { useState, useRef } from 'react';
import { GripVertical } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import {
  type ShoppingList,
  type ShoppingListLine,
  type ShoppingListSummary,
  type Supplier,
  type SupplierProduct,
  shoppingListSaveSchema,
  initialReorderTarget,
  suggestedOrderQuantity,
} from '@eliza/contracts';
import { api, ApiError, queryClient, refresh, useSession } from './api';
import { Field, ErrorMessage, SearchSelect } from './forms';
import { Dialog } from './components/ui/dialog';
import { Button } from './components/ui/button';
import { formatMoney } from './receipts';
import { t, useLanguage, getLocale } from './i18n';

type Offer = SupplierProduct & { cheapest: boolean; premiumPercent: number | null };

type CatalogItem = Pick<
  ShoppingListLine,
  | 'name'
  | 'sku'
  | 'unit'
  | 'active'
  | 'stock'
  | 'minStock'
  | 'incoming'
  | 'drafts'
  | 'unitCost'
  | 'taxRate'
> & {
  productId: string;
  preferredTarget: string | null;
  preferredSupplierId: string | null;
};
export function ShoppingListsPage() {
  useLanguage();
  const session = useSession().data!;
  const canWrite = session.user.permissions.includes('purchases.write');
  const lists = useQuery({
    queryKey: ['shopping-lists'],
    queryFn: () => api<ShoppingListSummary[]>('/shopping-lists'),
  });
  const [selected, setSelected] = useState<string>();
  const [creating, setCreating] = useState(false);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{t('Stock & purchasing')}</div>
          <h1>{t('Shopping lists')}</h1>
          <p className="muted">
            {t(
              'Plan replenishment from low stock, then create purchase drafts by supplier. Latest 100 lists.',
            )}
          </p>
        </div>
        {canWrite && <Button onClick={() => setCreating(true)}>{t('New shopping list')}</Button>}
      </div>
      <p className="notice shopping-notice">
        {t('Planning does not change stock. Receive deliveries through Purchases.')}
      </p>
      <ErrorMessage error={lists.error} />
      <section className="panel table-scroll">
        <table>
          <thead>
            <tr>
              <th>{t('Shopping list')}</th>
              <th>{t('Products')}</th>
              <th>{t('Converted items')}</th>
              <th>{t('Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {lists.data?.map((list) => (
              <tr key={list.id}>
                <td>
                  <strong>{list.name}</strong>
                  <small>
                    {new Date(list.createdAt).toLocaleString(getLocale(), {
                      timeZone: session.store.timezone,
                    })}
                  </small>
                </td>
                <td>{list.productCount}</td>
                <td>{list.convertedCount}</td>
                <td>
                  <Button variant="ghost" onClick={() => setSelected(list.id)}>
                    {t('Open')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!lists.data?.length && (
          <p className="panel-padding">
            {lists.isPending
              ? t('Loading shopping lists…')
              : t('No shopping lists yet. Generate one from low stock or add products manually.')}
          </p>
        )}
      </section>
      {selected && <ShoppingDetail id={selected} onDeleted={() => setSelected(undefined)} />}
      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title={t('New shopping list')}
        description={t(
          'Includes active products at or below their low-stock threshold, up to 500 items.',
        )}
      >
        {creating && (
          <CreateShoppingList
            done={(id) => {
              setSelected(id);
              setCreating(false);
            }}
          />
        )}
      </Dialog>
    </>
  );
}
function CreateShoppingList({ done }: { done: (id: string) => void }) {
  useLanguage();
  const [name, setName] = useState(
    t('Shopping list') + ' ' + new Date().toISOString().slice(0, 10),
  );
  const [notes, setNotes] = useState('');
  const [pending, setPending] = useState<{ requestId: string; name: string; notes: string }>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  async function save() {
    const body = pending ?? { requestId: crypto.randomUUID(), name, notes };
    setPending(body);
    setBusy(true);
    setError(undefined);
    try {
      const result = await api<ShoppingList>('/shopping-lists', body);
      void refresh();
      done(result.id);
    } catch (e) {
      setError(e);
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) setPending(undefined);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <fieldset disabled={busy || !!pending}>
        <Field label={t('Shopping list name')}>
          <input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('Notes')}>
          <textarea maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </fieldset>
      <p className="muted" style={{ margin: '16px 0' }}>
        {t(
          'Initial targets are twice minimum stock, at least one selling unit. Saved targets are reused. Review targets and quantities before ordering.',
        )}
      </p>
      <ErrorMessage error={error} />
      <Button disabled={busy}>
        {busy ? t('Creating…') : pending ? t('Retry creation') : t('Generate shopping list')}
      </Button>
    </form>
  );
}
function ShoppingDetail({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  useLanguage();
  const q = useQuery({
    queryKey: ['shopping-list', id],
    queryFn: () => api<ShoppingList>('/shopping-lists/' + id),
  });
  return (
    <section className="shopping-detail">
      <ErrorMessage error={q.error} />
      {q.data ? (
        <ShoppingEditor key={id + ':' + q.data.version} list={q.data} onDeleted={onDeleted} />
      ) : (
        <p>{t('Loading shopping list…')}</p>
      )}
    </section>
  );
}
/**
 * Lets the manager choose which supplier to order a line from.
 *
 * Suppliers that list the product are offered first, cheapest per selling unit,
 * with the price last actually paid alongside the quote. Every other supplier
 * stays selectable underneath: the catalogue is a hint, not a restriction.
 */
function SupplierPicker({
  line,
  offers,
  suppliers,
  currency,
  disabled,
  onPick,
}: {
  line: ShoppingListLine;
  offers: Offer[];
  suppliers: Supplier[];
  currency: string;
  disabled: boolean;
  onPick: (supplierId: string) => void;
}) {
  useLanguage();
  const listed = new Set(offers.map((o) => o.supplierId));
  const others = suppliers.filter((s) => s.active && !listed.has(s.id));
  const price = (offer: Offer) => {
    const quote = offer.unitCost === null ? t('no price') : formatMoney(offer.unitCost, currency);
    if (offer.lastPaidCost === null) return quote;
    return `${quote} · ${t('last paid')} ${formatMoney(offer.lastPaidCost, currency)}`;
  };
  return (
    <select
      className="shopping-supplier no-print"
      aria-label={t('Supplier to order from')}
      disabled={disabled}
      value={line.supplierId ?? ''}
      onChange={(e) => onPick(e.target.value)}
    >
      <option value="">{t('Choose supplier…')}</option>
      {!!offers.length && (
        <optgroup label={t('Supplies this product')}>
          {offers.map((offer) => (
            <option key={offer.supplierId} value={offer.supplierId}>
              {offer.cheapest && offers.length > 1 ? '★ ' : ''}
              {offer.supplierName} — {price(offer)}
            </option>
          ))}
        </optgroup>
      )}
      {!!others.length && (
        <optgroup label={offers.length ? t('Other suppliers') : t('All suppliers')}>
          {others.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
function ShoppingEditor({ list, onDeleted }: { list: ShoppingList; onDeleted: () => void }) {
  useLanguage();
  const session = useSession().data!,
    canWrite = session.user.permissions.includes('purchases.write');
  const suppliers = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api<Supplier[]>('/suppliers'),
  });
  const catalog = useQuery({
    queryKey: ['shopping-products'],
    queryFn: () => api<CatalogItem[]>('/shopping-lists/products'),
  });
  // Fetched once for the whole list rather than per row.
  const offers = useQuery({
    queryKey: ['supplier-products'],
    queryFn: () => api<Offer[]>('/supplier-products'),
  });
  const offersFor = (productId: string | null) =>
    productId ? (offers.data?.filter((o) => o.productId === productId) ?? []) : [];
  const [name, setName] = useState(list.name),
    [notes, setNotes] = useState(list.notes),
    [lines, setLines] = useState(list.lines);
  const [sections, setSections] = useState(list.sections ?? []);
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const pointerDrag = useRef<{ id: string; x: number; y: number; active: boolean } | null>(null);
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [dropSection, setDropSection] = useState<string | null>(null);
  const [custom, setCustom] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const [pending, setPending] = useState<{ path: string; body: unknown }>();
  const locked = busy || !!pending || !canWrite;
  const outstanding = lines.filter((l) => !l.purchaseId),
    converted = lines.filter((l) => l.purchaseId);
  const createdAt = new Date(list.createdAt).toLocaleDateString(getLocale(), {
    timeZone: session.store.timezone,
    dateStyle: 'long',
  });
  function change(id: string, patch: Partial<ShoppingListLine>) {
    setLines((rows) => rows.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    setDirty(true);
  }
  function remove(id: string) {
    setLines((rows) => rows.filter((l) => l.id !== id));
    setDirty(true);
  }
  async function send(path: string, body: Record<string, unknown>) {
    const command = pending ?? {
      path,
      body: { ...body, requestId: crypto.randomUUID(), version: list.version },
    };
    setPending(command);
    setBusy(true);
    setError(undefined);
    try {
      const result = await api<ShoppingList>(
        '/shopping-lists/' + list.id + command.path,
        command.body,
      );
      if (command.path === '/delete') {
        queryClient.removeQueries({ queryKey: ['shopping-list', list.id], exact: true });
        void refresh();
        onDeleted();
        return;
      }
      queryClient.setQueryData(['shopping-list', list.id], result);
      void refresh();
    } catch (e) {
      setError(e);
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) setPending(undefined);
    } finally {
      setBusy(false);
    }
  }
  function save() {
    const body = {
      requestId: crypto.randomUUID(),
      version: list.version,
      name,
      notes,
      sections,
      lines: outstanding.map((l) => ({
        sectionId: l.sectionId ?? null,
        productId: l.productId,
        label: l.productId ? '' : l.name,
        target: l.target,
        quantity: l.quantity,
        unitCost: l.unitCost,
        taxRate: l.taxRate,
        supplierId: l.supplierId,
        notes: l.notes,
      })),
    };
    const parsed = shoppingListSaveSchema.safeParse(body);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('; '));
      return;
    }
    void send('', body);
  }
  function add(productId: string) {
    const p = catalog.data?.find((p) => p.productId === productId);
    if (!p) return;
    const target = p.preferredTarget ?? initialReorderTarget(p.minStock, p.unit);
    const supplier = suppliers.data?.find((s) => s.id === p.preferredSupplierId);
    setLines((rows) => [
      ...rows,
      {
        ...p,
        id: crypto.randomUUID(),
        label: '',
        target,
        quantity: suggestedOrderQuantity(target, p.stock, p.incoming, p.drafts, p.unit),
        supplierId: supplier?.active ? supplier.id : null,
        supplierName: supplier?.name ?? null,
        supplierActive: supplier?.active ?? null,
        notes: '',
        purchaseId: null,
        purchaseNumber: null,
        purchaseStatus: null,
      },
    ]);
    setDirty(true);
  }
  function addCustom() {
    const label = custom.trim();
    if (!label) return;
    setLines((rows) => [
      ...rows,
      {
        id: crypto.randomUUID(),
        productId: null,
        label,
        name: label,
        sku: '',
        unit: 'piece',
        active: true,
        stock: '0',
        minStock: '0',
        incoming: '0',
        drafts: '0',
        target: '0',
        quantity: '1',
        unitCost: '0',
        taxRate: '0',
        notes: '',
        supplierId: null,
        supplierName: null,
        supplierActive: null,
        purchaseId: null,
        purchaseNumber: null,
        purchaseStatus: null,
      },
    ]);
    setCustom('');
    setDirty(true);
  }
  return (
    <div className="panel shopping-print">
      <div className="shopping-head">
        <div className="shopping-head-text">
          <input
            className="shopping-title"
            aria-label={t('Shopping list name')}
            maxLength={120}
            disabled={locked}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
          />
          <span className="muted">{createdAt}</span>
        </div>
        <div className="shopping-head-actions no-print">
          {canWrite && (
            <Button type="button" disabled={locked || !dirty} onClick={save}>
              {dirty ? t('Save shopping list') : t('Saved')}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => window.print()}>
            {t('Print')}
          </Button>
          {canWrite && (
            <Button
              type="button"
              variant="ghost"
              disabled={busy || !!pending}
              onClick={() => setConfirmDelete(true)}
            >
              {t('Delete list')}
            </Button>
          )}
        </div>
      </div>
      <div className="panel-padding">
        <ErrorMessage error={error ?? suppliers.error ?? catalog.error} />
        {pending && !busy && (
          <div className="notice shopping-notice no-print">
            <p>{t('Confirmation is pending. Retry the same change before continuing.')}</p>
            <Button onClick={() => void send(pending.path, {})}>{t('Retry same change')}</Button>
          </div>
        )}
        {canWrite && (
          <Button
            className="no-print shopping-section-add"
            type="button"
            variant="outline"
            disabled={locked || sections.length >= 100}
            onClick={() => {
              const id = crypto.randomUUID();
              setSections((rows) => [...rows, { id, name: t('New section') }]);
              setEditingSection(id);
              setDirty(true);
            }}
          >
            {t('Add section')}
          </Button>
        )}
        {!outstanding.length && !converted.length && !sections.length ? (
          <p className="notice">
            {t('Nothing on this list yet. Add a product or a free-text item.')}
          </p>
        ) : (
          <div className="shopping-sections">
            {[{ id: '', name: t('Unsectioned') }, ...sections].map((section) => (
              <section
                key={section.id}
                data-shopping-section={section.id}
                className={
                  'shopping-section' +
                  (draggedItem ? ' shopping-drop-target' : '') +
                  (dropSection === section.id ? ' shopping-drop-active' : '')
                }
                onDragOver={(event) => {
                  if (locked || !draggedItem) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  setDropSection(section.id);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                    setDropSection(null);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (!locked && draggedItem && outstanding.some((line) => line.id === draggedItem))
                    change(draggedItem, { sectionId: section.id || null });
                  setDraggedItem(null);
                  setDropSection(null);
                }}
              >
                <div className="shopping-section-heading">
                  {section.id &&
                    (editingSection === section.id ? (
                      <input
                        autoFocus
                        className="shopping-section-title"
                        aria-label={t('Section name')}
                        maxLength={120}
                        disabled={locked}
                        value={section.name}
                        onChange={(e) => {
                          setSections((rows) =>
                            rows.map((row) =>
                              row.id === section.id ? { ...row, name: e.target.value } : row,
                            ),
                          );
                          setDirty(true);
                        }}
                        onBlur={() => {
                          setSections((rows) =>
                            rows.map((row) =>
                              row.id === section.id
                                ? { ...row, name: row.name.trim() || t('New section') }
                                : row,
                            ),
                          );
                          setEditingSection(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            e.currentTarget.blur();
                          }
                        }}
                      />
                    ) : (
                      <h3>
                        <button
                          type="button"
                          className="shopping-section-title"
                          disabled={locked}
                          onClick={() => setEditingSection(section.id)}
                        >
                          {section.name}
                        </button>
                      </h3>
                    ))}
                  {!section.id &&
                    sections.length > 0 &&
                    (draggedItem || lines.some((line) => !line.sectionId)) && (
                      <h3>{section.name}</h3>
                    )}
                  {section.id && canWrite && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="no-print"
                      disabled={locked}
                      onClick={() => {
                        setSections((rows) => rows.filter((row) => row.id !== section.id));
                        setLines((rows) =>
                          rows.map((line) =>
                            line.sectionId === section.id ? { ...line, sectionId: null } : line,
                          ),
                        );
                        setEditingSection(null);
                        setDirty(true);
                      }}
                    >
                      {t('Remove section')}
                    </Button>
                  )}
                </div>
                <ol className="shopping-lines">
                  {outstanding
                    .filter((line) => (line.sectionId ?? '') === section.id)
                    .map((line) => (
                      <li
                        key={line.id}
                        className={
                          'shopping-line' +
                          (draggedItem === line.id ? ' shopping-line-dragging' : '')
                        }
                      >
                        <div
                          className={
                            'shopping-line-main' +
                            (!locked && sections.length ? ' shopping-draggable' : '')
                          }
                          onPointerDown={(event) => {
                            if (locked || !sections.length || event.button !== 0) return;
                            pointerDrag.current = {
                              id: line.id,
                              x: event.clientX,
                              y: event.clientY,
                              active: false,
                            };
                            event.currentTarget.setPointerCapture(event.pointerId);
                          }}
                          onPointerMove={(event) => {
                            const drag = pointerDrag.current;
                            if (!drag) return;
                            if (
                              !drag.active &&
                              Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5
                            )
                              return;
                            drag.active = true;
                            setDraggedItem(drag.id);
                            const target = document
                              .elementFromPoint(event.clientX, event.clientY)
                              ?.closest<HTMLElement>('[data-shopping-section]');
                            setDropSection(target?.dataset.shoppingSection ?? null);
                            if (event.clientY < 64) window.scrollBy(0, -16);
                            else if (event.clientY > window.innerHeight - 64)
                              window.scrollBy(0, 16);
                          }}
                          onPointerUp={(event) => {
                            const drag = pointerDrag.current;
                            const target = document
                              .elementFromPoint(event.clientX, event.clientY)
                              ?.closest<HTMLElement>('[data-shopping-section]');
                            if (!locked && drag?.active && target)
                              change(drag.id, {
                                sectionId: target.dataset.shoppingSection || null,
                              });
                            pointerDrag.current = null;
                            setDraggedItem(null);
                            setDropSection(null);
                          }}
                          onPointerCancel={() => {
                            pointerDrag.current = null;
                            setDraggedItem(null);
                            setDropSection(null);
                          }}
                        >
                          {canWrite && sections.length > 0 && (
                            <span
                              className="shopping-drag-handle no-print"
                              title={t('Drag to another section')}
                            >
                              <GripVertical size={18} aria-hidden="true" />
                            </span>
                          )}
                          <span className="shopping-line-name">{line.name}</span>
                          {!line.productId && (
                            <span className="badge badge-gray no-print">{t('Free text')}</span>
                          )}
                          {line.productId && !line.active && (
                            <span className="badge badge-gray">{t('Inactive')}</span>
                          )}
                          {line.supplierName && (
                            <span className="muted shopping-line-supplier print-only">
                              {line.supplierName}
                            </span>
                          )}
                        </div>
                        <div className="shopping-line-side">
                          {canWrite && line.productId && (
                            <SupplierPicker
                              line={line}
                              offers={offersFor(line.productId)}
                              suppliers={suppliers.data ?? []}
                              currency={session.store.currency}
                              disabled={locked}
                              onPick={(supplierId) => {
                                const offer = offersFor(line.productId).find(
                                  (o) => o.supplierId === supplierId,
                                );
                                const supplier = suppliers.data?.find((s) => s.id === supplierId);
                                change(line.id, {
                                  supplierId: supplierId || null,
                                  supplierName: supplier?.name ?? null,
                                  supplierActive: supplier?.active ?? null,
                                  // Adopt the quoted price so the draft order carries
                                  // the price this supplier actually offered.
                                  ...(offer ? { unitCost: offer.unitCost ?? line.unitCost } : {}),
                                });
                              }}
                            />
                          )}
                          <input
                            className="shopping-qty"
                            aria-label={t('Quantity to buy')}
                            inputMode="decimal"
                            disabled={locked}
                            value={line.quantity}
                            onChange={(e) => change(line.id, { quantity: e.target.value })}
                          />
                          <span className="muted shopping-line-unit">{t(line.unit)}</span>
                          {canWrite && line.productId && line.supplierId && line.supplierActive && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="no-print"
                              disabled={locked || dirty || Number(line.quantity) <= 0}
                              title={dirty ? t('Save the list before ordering.') : undefined}
                              onClick={() => void send('/convert', { lineIds: [line.id] })}
                            >
                              {t('Order from supplier')}
                            </Button>
                          )}
                          {canWrite && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="no-print"
                              disabled={locked}
                              onClick={() => remove(line.id)}
                            >
                              {t('Remove')}
                            </Button>
                          )}
                        </div>
                      </li>
                    ))}
                  {converted
                    .filter((line) => (line.sectionId ?? '') === section.id)
                    .map((line) => (
                      <li key={line.id} className="shopping-line shopping-line-done">
                        <div className="shopping-line-main">
                          <span className="shopping-line-name">{line.name}</span>
                          <a className="muted" href={'/purchases?order=' + line.purchaseId}>
                            {line.purchaseNumber}
                          </a>
                        </div>
                        <div className="shopping-line-side">
                          <span>
                            {Number(line.quantity)} {t(line.unit)}
                          </span>
                          <span className="badge badge-green">{t('Ordered')}</span>
                        </div>
                      </li>
                    ))}
                </ol>
              </section>
            ))}
          </div>
        )}
        {canWrite && lines.length < 500 && (
          <div className="shopping-add no-print">
            <SearchSelect
              label={t('Add product')}
              placeholder={t('Select a product')}
              value={undefined}
              options={(catalog.data ?? [])
                .filter((p) => p.active && !lines.some((l) => l.productId === p.productId))
                .map((p) => ({
                  id: p.productId,
                  title: p.name,
                  subtitle: p.sku,
                  keywords: [p.name, p.sku],
                }))}
              onSelect={add}
              panelHeader={(close) => (
                <div className="shopping-add-custom">
                  <Field label={t('Add your own item')}>
                    <input
                      maxLength={120}
                      placeholder={t('For example: bin bags')}
                      disabled={locked}
                      value={custom}
                      onChange={(e) => setCustom(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return;
                        e.preventDefault();
                        addCustom();
                        if (custom.trim()) close();
                      }}
                    />
                  </Field>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={locked || !custom.trim()}
                    onClick={() => {
                      addCustom();
                      if (custom.trim()) close();
                    }}
                  >
                    {t('Add item')}
                  </Button>
                </div>
              )}
            />
          </div>
        )}
        {notes && <p className="shopping-list-notes">{notes}</p>}
        {canWrite && (
          <div className="no-print shopping-notes-field">
            <Field label={t('Notes')}>
              <textarea
                maxLength={1000}
                disabled={locked}
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value);
                  setDirty(true);
                }}
              />
            </Field>
          </div>
        )}
        {dirty && canWrite && (
          <p className="muted no-print">
            {t('Save your changes before ordering from a supplier.')}
          </p>
        )}
      </div>
      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('Delete list')}
        description={t('The shopping list is removed. Purchase orders already created are kept.')}
      >
        <div className="form-actions">
          <Button type="button" variant="outline" onClick={() => setConfirmDelete(false)}>
            {t('Cancel')}
          </Button>
          <Button
            type="button"
            disabled={busy}
            onClick={() => {
              setConfirmDelete(false);
              void send('/delete', {});
            }}
          >
            {t('Delete list')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
