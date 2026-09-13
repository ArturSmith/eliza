import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  type ShoppingList,
  type ShoppingListLine,
  type ShoppingListSummary,
  type Supplier,
  shoppingListSaveSchema,
  initialReorderTarget,
  suggestedOrderQuantity,
} from '@eliza/contracts';
import { api, ApiError, queryClient, refresh, useSession } from './api';
import { Field, ErrorMessage, SearchSelect } from './forms';
import { Dialog } from './components/ui/dialog';
import { Button } from './components/ui/button';
import { t, useLanguage, getLocale } from './i18n';

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
  const [name, setName] = useState(list.name),
    [notes, setNotes] = useState(list.notes),
    [lines, setLines] = useState(list.lines);
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
      lines: outstanding.map((l) => ({
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
        {!outstanding.length && !converted.length ? (
          <p className="notice">
            {t('Nothing on this list yet. Add a product or a free-text item.')}
          </p>
        ) : (
          <ol className="shopping-lines">
            {outstanding.map((line) => (
              <li key={line.id} className="shopping-line">
                <div className="shopping-line-main">
                  <span className="shopping-line-name">{line.name}</span>
                  {!line.productId && (
                    <span className="badge badge-gray no-print">{t('Free text')}</span>
                  )}
                  {line.productId && !line.active && (
                    <span className="badge badge-gray">{t('Inactive')}</span>
                  )}
                  {line.supplierName && (
                    <span className="muted shopping-line-supplier">{line.supplierName}</span>
                  )}
                </div>
                <div className="shopping-line-side">
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
            {converted.map((line) => (
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
            />
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
                  }}
                />
              </Field>
              <Button
                type="button"
                variant="outline"
                disabled={locked || !custom.trim()}
                onClick={addCustom}
              >
                {t('Add item')}
              </Button>
            </div>
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
