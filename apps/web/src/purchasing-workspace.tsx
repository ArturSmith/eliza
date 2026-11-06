import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Mail, MapPin, Phone, Plus, Search, Truck } from 'lucide-react';
import type { Supplier } from '@eliza/contracts';
import { api, refresh, useSession } from './api';
import { Button } from './components/ui/button';
import { Dialog } from './components/ui/dialog';
import { ErrorMessage } from './forms';
import { SupplierCatalog } from './supplier-products';
import {
  DraftForm,
  Heading,
  OrderDetail,
  PurchaseHistory,
  SupplierForm,
  type Order,
  type PurchaseAction,
} from './purchasing';
import { countText, t, useLanguage } from './i18n';
import { SupplierAddProduct } from './supplier-add-product';
import './purchasing-workspace.css';

function useSuppliers(enabled = true) {
  return useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api<Supplier[]>('/suppliers'),
    enabled,
  });
}
function Back({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="text-link purchasing-back">
      <ArrowLeft size={16} />
      {children}
    </Link>
  );
}
function Restricted() {
  return <p className="notice">{t('Access restricted')}</p>;
}

/** Resolve existing AI and shopping-list links before showing the supplier directory. */
export function PurchasingEntry() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.searchStr);
  const order = params.get('order');
  const document = params.has('document');
  useEffect(() => {
    if (order) void navigate({ to: '/purchases/$id', params: { id: order }, replace: true });
    else if (document)
      void navigate({ to: '/purchases/new', search: { document: true }, replace: true });
  }, [order, document, navigate]);
  if (order || document) return <p role="status">{t('Loading…')}</p>;
  return <PurchasingPage />;
}
export function SuppliersRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    void navigate({ to: '/purchases', replace: true });
  }, [navigate]);
  return null;
}

export function PurchasingPage() {
  useLanguage();
  const session = useSession().data!;
  const canRead = session.user.permissions.includes('suppliers.read');
  const canManage = session.user.permissions.includes('suppliers.manage');
  const canReadPurchases = session.user.permissions.includes('purchases.read');
  const suppliers = useSuppliers(canRead);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [tag, setTag] = useState('');
  const tags = [...new Set((suppliers.data ?? []).flatMap((s) => s.tags ?? []))].sort((a, b) =>
    a.localeCompare(b),
  );
  const rows = (suppliers.data ?? []).filter(
    (supplier) =>
      (status === 'all' || supplier.active === (status === 'active')) &&
      (!tag || supplier.tags?.includes(tag)) &&
      [
        supplier.name,
        supplier.code,
        supplier.contactName,
        supplier.contactPhone,
        supplier.email,
        supplier.phone,
        supplier.whatsappPhone,
        ...(supplier.tags ?? []),
      ].some((value) => value?.toLowerCase().includes(search.trim().toLowerCase())),
  );
  return (
    <div className="purchasing-workspace">
      <Heading
        title={t('Suppliers & purchases')}
        description={t('Choose a supplier to browse products, review purchases or place an order.')}
        action={
          <div className="purchase-heading-actions">
            {canManage && canRead && (
              <Link to="/suppliers/new" className="button button-primary">
                <Plus size={17} />
                {t('Add supplier')}
              </Link>
            )}
            {canReadPurchases && (
              <Link to="/purchases/history" className="button button-outline">
                {t('All purchase orders')}
              </Link>
            )}
          </div>
        }
      />
      {!canRead ? (
        canReadPurchases ? (
          <PurchaseHistory />
        ) : (
          <Restricted />
        )
      ) : (
        <>
          <section className="panel supplier-directory-filters" aria-label={t('Supplier filters')}>
            <div className="search-box">
              <Search size={18} />
              <input
                aria-label={t('Search suppliers')}
                placeholder={t('Search name, code, tag, contact, email, or phone…')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select
              aria-label={t('Supplier status')}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="all">{t('All statuses')}</option>
              <option value="active">{t('Active')}</option>
              <option value="inactive">{t('Inactive')}</option>
            </select>
            <select
              aria-label={t('Supplier tag')}
              value={tag}
              onChange={(e) => setTag(e.target.value)}
            >
              <option value="">{t('All tags')}</option>
              {tags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
            {(search || status !== 'all' || tag) && (
              <Button
                variant="ghost"
                onClick={() => {
                  setSearch('');
                  setStatus('all');
                  setTag('');
                }}
              >
                {t('Clear filters')}
              </Button>
            )}
          </section>
          <ErrorMessage error={suppliers.error} />
          {suppliers.isPending ? (
            <p role="status">{t('Loading suppliers…')}</p>
          ) : (
            !suppliers.error && (
              <>
                <p className="muted supplier-directory-count">
                  {countText('suppliers', rows.length)}
                </p>
                {rows.length ? (
                  <div className="supplier-card-grid">
                    {rows.map((supplier) => (
                      <Link
                        key={supplier.id}
                        to="/suppliers/$id"
                        params={{ id: supplier.id }}
                        className="supplier-directory-card"
                        aria-label={t('Open supplier {name}', { name: supplier.name })}
                      >
                        <div className="supplier-card-top">
                          <span className="supplier-card-avatar">
                            <Truck size={26} />
                          </span>
                          <span className={`badge badge-${supplier.active ? 'green' : 'gray'}`}>
                            {t(supplier.active ? 'Active' : 'Inactive')}
                          </span>
                        </div>
                        <div>
                          <h2>{supplier.name}</h2>
                          <small className="muted">{supplier.code}</small>
                        </div>
                        <div className="supplier-card-contact">
                          {supplier.contactName && <strong>{supplier.contactName}</strong>}
                          {(supplier.contactPhone || supplier.phone) && (
                            <span>
                              <Phone size={15} />
                              {supplier.contactPhone || supplier.phone}
                            </span>
                          )}
                          {supplier.email && (
                            <span>
                              <Mail size={15} />
                              {supplier.email}
                            </span>
                          )}
                          {supplier.address && (
                            <span>
                              <MapPin size={15} />
                              {supplier.address}
                            </span>
                          )}
                          {!supplier.contactName &&
                            !supplier.phone &&
                            !supplier.contactPhone &&
                            !supplier.email &&
                            !supplier.address && (
                              <span className="muted">
                                {t('No contact details recorded for this supplier.')}
                              </span>
                            )}
                        </div>
                        {!!supplier.tags?.length && (
                          <div className="supplier-tags">
                            {supplier.tags.map((tag) => (
                              <span className="badge badge-gray" key={tag}>
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                        <span className="supplier-card-open">
                          {t('Products and orders')}
                          <ArrowRight size={17} />
                        </span>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <section className="panel purchasing-empty">
                    <Truck size={32} />
                    <h2>
                      {t(
                        suppliers.data?.length
                          ? 'No suppliers match this filter.'
                          : 'Add your first supplier to start purchasing.',
                      )}
                    </h2>
                    {canManage && !suppliers.data?.length && (
                      <Link to="/suppliers/new" className="button button-primary">
                        {t('Add supplier')}
                      </Link>
                    )}
                  </section>
                )}
              </>
            )
          )}
        </>
      )}
    </div>
  );
}

function SupplierFacts({ supplier }: { supplier: Supplier }) {
  const details = [
    ['Supplier code', supplier.code],
    ['Company number', supplier.companyNumber],
    ['Sales representative', supplier.contactName],
    ['Representative phone', supplier.contactPhone],
    ['Supplier phone', supplier.phone],
    ['WhatsApp number', supplier.whatsappPhone],
    ['Email', supplier.email],
    ['Address', supplier.address],
  ];
  return (
    <div className="supplier-profile-summary">
      <section className="panel purchasing-form-panel">
        <h2>{t('Contact details')}</h2>
        <dl className="supplier-profile-facts">
          {details
            .filter(([, value]) => value)
            .map(([label, value]) => (
              <div key={label}>
                <dt>{t(label)}</dt>
                <dd>{value}</dd>
              </div>
            ))}
        </dl>
      </section>
      <section className="panel purchasing-form-panel">
        <h2>{t('Ordering details')}</h2>
        <dl className="supplier-profile-facts">
          <div>
            <dt>{t('Payment terms')}</dt>
            <dd>{supplier.paymentTerms || '—'}</dd>
          </div>
          <div>
            <dt>{t('Status')}</dt>
            <dd>
              <span className={`badge badge-${supplier.active ? 'green' : 'gray'}`}>
                {t(supplier.active ? 'Active' : 'Inactive')}
              </span>
            </dd>
          </div>
        </dl>
        {!!supplier.tags?.length && (
          <div className="supplier-tags">
            {supplier.tags.map((tag) => (
              <span className="badge badge-gray" key={tag}>
                {tag}
              </span>
            ))}
          </div>
        )}
        {supplier.notes && (
          <div className="supplier-profile-notes">
            <h3>{t('Notes')}</h3>
            <p>{supplier.notes}</p>
          </div>
        )}
      </section>
    </div>
  );
}

export function SupplierDetailsPage() {
  useLanguage();
  const { id } = useParams({ strict: false });
  const navigate = useNavigate();
  const session = useSession().data!;
  const canRead = session.user.permissions.includes('suppliers.read');
  const canManage = session.user.permissions.includes('suppliers.manage');
  const canReadPurchases = session.user.permissions.includes('purchases.read');
  const canOrder = canReadPurchases && session.user.permissions.includes('purchases.write');
  const canReceive = canReadPurchases && session.user.permissions.includes('purchases.receive');
  const q = useSuppliers(canRead);
  const supplier = q.data?.find((s) => s.id === id);
  const [tab, setTab] = useState(() =>
    new URLSearchParams(window.location.search).get('tab') === 'history' ? 'history' : 'products',
  );
  const [purchaseStage, setPurchaseStage] = useState(() => {
    const stage = new URLSearchParams(window.location.search).get('stage');
    return stage && ['draft', 'active', 'delivered', 'cancelled'].includes(stage)
      ? stage
      : 'active';
  });
  const [deleting, setDeleting] = useState(false);
  const remove = useMutation({
    mutationFn: () => api(`/suppliers/${id}`, undefined, 'DELETE'),
    onSuccess: () => {
      void refresh();
      void navigate({ to: '/purchases' });
    },
  });
  if (!canRead) return <Restricted />;
  if (q.isPending) return <p role="status">{t('Loading suppliers…')}</p>;
  if (q.error) return <ErrorMessage error={q.error} />;
  if (!supplier)
    return (
      <div className="purchasing-workspace">
        <Back to="/purchases">{t('Back to suppliers')}</Back>
        <p className="notice">{t('Supplier not found.')}</p>
      </div>
    );
  return (
    <div className="purchasing-workspace supplier-details-page">
      <Back to="/purchases">{t('Back to suppliers')}</Back>
      <Heading
        title={supplier.name}
        description={supplier.code}
        action={
          <div className="purchase-heading-actions">
            {canOrder && supplier.active && (
              <Link
                to="/suppliers/$id/order"
                params={{ id: supplier.id }}
                className="button button-primary"
              >
                <Plus size={17} />
                {t('Create order')}
              </Link>
            )}
            {canReceive && (
              <Button
                variant="outline"
                onClick={() => {
                  setPurchaseStage('active');
                  setTab('history');
                }}
              >
                {t('Accept delivery')}
              </Button>
            )}
            {canManage && (
              <Link
                to="/suppliers/$id/edit"
                params={{ id: supplier.id }}
                className="button button-outline"
              >
                {t('Edit supplier')}
              </Link>
            )}
          </div>
        }
      />
      <SupplierFacts supplier={supplier} />
      <div className="supplier-detail-tabs" role="tablist" aria-label={t('Supplier workspace')}>
        <button
          type="button"
          id="supplier-products-tab"
          role="tab"
          aria-selected={tab === 'products'}
          aria-controls="supplier-products-panel"
          onClick={() => setTab('products')}
        >
          {t('Products from this supplier')}
        </button>
        {canReadPurchases && (
          <button
            type="button"
            id="supplier-history-tab"
            role="tab"
            aria-selected={tab === 'history'}
            aria-controls="supplier-history-panel"
            onClick={() => setTab('history')}
          >
            {t('Purchases')}
          </button>
        )}
      </div>
      {tab === 'history' && canReadPurchases ? (
        <section id="supplier-history-panel" role="tabpanel" aria-labelledby="supplier-history-tab">
          <PurchaseHistory
            key={supplier.id + purchaseStage}
            supplierId={supplier.id}
            embedded
            initialStage={purchaseStage}
          />
        </section>
      ) : (
        <section
          id="supplier-products-panel"
          role="tabpanel"
          aria-labelledby="supplier-products-tab"
        >
          <SupplierCatalog key={supplier.id} supplierId={supplier.id} />
        </section>
      )}
      {canManage && (
        <div className="supplier-profile-footer">
          <Button variant="ghost" onClick={() => setDeleting(true)}>
            {t('Delete supplier')}
          </Button>
        </div>
      )}
      <Dialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('Delete supplier')}
        description={t(
          'Delete {value0}? This is permanent. Suppliers used by purchases, offers or shopping lists cannot be deleted.',
          { value0: supplier.name },
        )}
      >
        <ErrorMessage error={remove.error} />
        <div className="form-actions">
          <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
            {t('Delete supplier')}
          </Button>
          <Button variant="outline" disabled={remove.isPending} onClick={() => setDeleting(false)}>
            {t('Cancel')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

export function SupplierEditorPage({ create = false }: { create?: boolean }) {
  useLanguage();
  const { id } = useParams({ strict: false });
  const navigate = useNavigate();
  const session = useSession().data!;
  const allowed =
    session.user.permissions.includes('suppliers.manage') &&
    session.user.permissions.includes('suppliers.read');
  const q = useSuppliers(allowed);
  const supplier = create ? null : q.data?.find((s) => s.id === id);
  const back = () => {
    void navigate(create ? { to: '/purchases' } : { to: '/suppliers/$id', params: { id: id! } });
  };
  if (!allowed) return <Restricted />;
  if (q.isPending) return <p role="status">{t('Loading suppliers…')}</p>;
  if (q.error) return <ErrorMessage error={q.error} />;
  if (!create && !supplier) return <p className="notice">{t('Supplier not found.')}</p>;
  return (
    <div className="purchasing-workspace supplier-editor-page">
      <Button variant="ghost" className="purchasing-back" onClick={back}>
        <ArrowLeft size={16} />
        {t(create ? 'Back to suppliers' : 'Back to supplier')}
      </Button>
      <Heading
        title={t(create ? 'Add supplier' : 'Edit supplier')}
        description={t('Keep supplier details available for your team.')}
      />
      <SupplierForm
        key={supplier?.id ?? 'new'}
        supplier={supplier ?? null}
        done={() => {}}
        onCancel={back}
        onCreated={(saved) => {
          void navigate({ to: '/suppliers/$id', params: { id: saved.id } });
        }}
      />
    </div>
  );
}

// Preserve old price-editor URLs without exposing a manual price editor.
export function SupplierOfferPage({ edit = false }: { edit?: boolean }) {
  return edit ? <LegacySupplierPriceRedirect /> : <SupplierAddProductPage />;
}

function LegacySupplierPriceRedirect() {
  const { id } = useParams({ strict: false });
  const navigate = useNavigate();
  useEffect(() => {
    void navigate({ to: '/suppliers/$id', params: { id: id! }, replace: true });
  }, [id, navigate]);
  return null;
}

function SupplierAddProductPage() {
  useLanguage();
  const { id } = useParams({ strict: false });
  const navigate = useNavigate();
  const session = useSession().data!;
  const allowed =
    session.user.permissions.includes('suppliers.manage') &&
    session.user.permissions.includes('suppliers.read');
  const suppliers = useSuppliers(allowed);
  const supplier = suppliers.data?.find((s) => s.id === id);
  const back = () => {
    void navigate({ to: '/suppliers/$id', params: { id: id! } });
  };
  if (!allowed) return <Restricted />;
  if (suppliers.isPending) return <p role="status">{t('Loading…')}</p>;
  if (suppliers.error) return <ErrorMessage error={suppliers.error} />;
  if (!supplier) return <p className="notice">{t('Supplier product not found.')}</p>;
  return (
    <div className="purchasing-workspace">
      <Button variant="ghost" className="purchasing-back" onClick={back}>
        <ArrowLeft size={16} />
        {t('Back to supplier')}
      </Button>
      <Heading title={t('Add product')} description={supplier.name} />
      <SupplierAddProduct key={supplier.id} supplier={supplier} onDone={back} />
    </div>
  );
}

export function NewPurchasePage() {
  useLanguage();
  const { id } = useParams({ strict: false });
  const location = useLocation();
  const fromDocument = new URLSearchParams(location.searchStr).has('document');
  const navigate = useNavigate();
  const session = useSession().data!;
  const allowed =
    session.user.permissions.includes('purchases.write') &&
    session.user.permissions.includes('purchases.read');
  const q = useSuppliers(allowed && session.user.permissions.includes('suppliers.read'));
  const supplier = q.data?.find((s) => s.id === id);
  const back = () => {
    void navigate(id ? { to: '/suppliers/$id', params: { id } } : { to: '/purchases' });
  };
  if (!allowed || !session.user.permissions.includes('suppliers.read')) return <Restricted />;
  if (q.isPending) return <p role="status">{t('Loading suppliers…')}</p>;
  if (q.error) return <ErrorMessage error={q.error} />;
  if (id && (!supplier || !supplier.active))
    return <p className="notice">{t('Choose an active supplier before creating an order.')}</p>;
  return (
    <div className="purchasing-workspace new-purchase-page">
      <Button variant="ghost" className="purchasing-back" onClick={back}>
        <ArrowLeft size={16} />
        {t(id ? 'Back to supplier' : 'Back to suppliers')}
      </Button>
      <Heading
        title={t('New purchase order')}
        description={
          supplier?.name ??
          t(
            'Save a draft before placing your order. Stock changes only when you receive a delivery.',
          )
        }
      />
      <DraftForm
        key={id ?? 'new'}
        fixedSupplierId={id}
        fromDocument={fromDocument}
        onCancel={back}
        done={(orderId) => {
          void navigate({ to: '/purchases/$id', params: { id: orderId } });
        }}
      />
    </div>
  );
}

export function PurchaseHistoryPage() {
  useLanguage();
  if (!useSession().data!.user.permissions.includes('purchases.read')) return <Restricted />;
  return (
    <div className="purchasing-workspace">
      <Back to="/purchases">{t('Back to suppliers')}</Back>
      <PurchaseHistory />
    </div>
  );
}
const actionText: Record<PurchaseAction, [string, string]> = {
  edit: ['Edit purchase draft', 'Only drafts can be edited.'],
  receive: ['Accept delivery', 'Enter only quantities delivered now. Leave other lines at zero.'],
  payment: [
    'Update payment',
    'Payment is tracked separately from delivery. Mark paid only after the supplier has been paid in full.',
  ],
  close: [
    'Close remaining quantities',
    'Close all undelivered quantities permanently. Recorded deliveries, stock and payment status will not change.',
  ],
  cancel: [
    'Cancel this order',
    'Cancelling is permanent and does not change stock. Partly received orders cannot be cancelled.',
  ],
  whatsapp: [
    'Send purchase order via WhatsApp',
    'Review the recipient and message before opening WhatsApp.',
  ],
};
export function PurchaseDetailsPage({ action }: { action?: PurchaseAction }) {
  useLanguage();
  const { id } = useParams({ strict: false });
  const navigate = useNavigate();
  const allowed = useSession().data!.user.permissions.includes('purchases.read');
  const q = useQuery({
    queryKey: ['purchase', id],
    queryFn: () => api<Order>(`/purchases/${id}`),
    enabled: allowed && !!id,
  });
  const supplierAccess = useSession().data!.user.permissions.includes('suppliers.read');
  const close = () => {
    void navigate(
      action
        ? { to: '/purchases/$id', params: { id: id! } }
        : supplierAccess && q.data
          ? {
              to: '/suppliers/$id',
              params: { id: q.data.supplier_id },
              search: {
                tab: 'history',
                stage:
                  q.data.status === 'draft'
                    ? 'draft'
                    : ['received', 'closed'].includes(q.data.status)
                      ? 'delivered'
                      : q.data.status === 'cancelled'
                        ? 'cancelled'
                        : 'active',
              },
            }
          : { to: '/purchases/history' },
    );
  };
  if (!allowed) return <Restricted />;
  return (
    <div className="purchasing-workspace purchase-details-page">
      <Button variant="ghost" className="purchasing-back" onClick={close}>
        <ArrowLeft size={16} />
        {t(action ? 'Back to order' : supplierAccess ? 'Back to supplier' : 'All purchase orders')}
      </Button>
      {action && (
        <Heading title={t(actionText[action][0])} description={t(actionText[action][1])} />
      )}
      <OrderDetail key={id + ':' + (action ?? 'details')} id={id!} close={close} action={action} />
    </div>
  );
}
