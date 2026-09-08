import { useState, type ReactNode } from 'react';
import { Link, Outlet, useLocation } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Activity,
  Clock3,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Boxes,
  Check,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Monitor,
  Package,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Store,
  Users,
  X,
  Pencil,
  AlertTriangle,
  Menu,
} from 'lucide-react';
import type { Product, Permission, Device, Session } from '@eliza/contracts';
import { toScaled, fromScaled } from '@eliza/contracts';
import {
  api,
  ApiError,
  queryClient,
  refresh,
  useSession,
  useProducts,
  useMovements,
  useAudit,
  useDevices,
} from './api';
import { AuthForm, AddProduct, ProductForm, AdjustmentForm, ErrorMessage, Field } from './forms';
import { Button } from './components/ui/button';
import { Dialog } from './components/ui/dialog';
const nav = [
  { to: '/purchases', label: 'Purchases', icon: ClipboardList, permission: 'purchases.read' },
  { to: '/suppliers', label: 'Suppliers', icon: Store, permission: 'suppliers.read' },
  { to: '/pos', label: 'Checkout', icon: Monitor, permission: 'pos.access' },
  { to: '/sales', label: 'Sales', icon: ClipboardList, permission: 'sales.read' },
  { to: '/shifts', label: 'Shifts', icon: Clock3, permission: 'sales.read' },
  { to: '/', label: 'Overview', icon: LayoutDashboard, permission: 'catalog.read' },
  { to: '/products', label: 'Products', icon: Package, permission: 'catalog.read' },
  { to: '/inventory', label: 'Inventory', icon: Boxes, permission: 'inventory.read' },
  { to: '/stock-counts', label: 'Stock counts', icon: ClipboardList, permission: 'inventory.read' },
  { to: '/team', label: 'Team', icon: Users, permission: 'team.read' },
  { to: '/devices', label: 'Devices', icon: Monitor, permission: 'devices.manage' },
  { to: '/audit', label: 'Activity log', icon: ClipboardList, permission: 'audit.read' },
  { to: '/settings', label: 'Store settings', icon: Settings, permission: 'settings.manage' },
] as const;
function money(value: string | number, currency = 'NOK') {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(Number(value));
}
function date(
  value: string,
  zone = queryClient.getQueryData<Session>(['session'])?.store.timezone ?? 'UTC',
) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: zone,
  }).format(new Date(value));
}
function useCan(permission: Permission) {
  return useSession().data?.user.permissions.includes(permission) ?? false;
}
function Badge({
  children,
  tone = 'green',
}: {
  children: ReactNode;
  tone?: 'green' | 'amber' | 'gray';
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
      </div>
      {action}
    </div>
  );
}
function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="icon-tile">
        <Package size={27} />
      </span>
      <h3>{title}</h3>
      <p className="muted">{description}</p>
      {action}
    </div>
  );
}
function Loading() {
  return (
    <div className="loading">
      <span className="loading-dot" />
      Loading your store…
    </div>
  );
}
export function Shell() {
  const status = useQuery({
    queryKey: ['setup'],
    queryFn: () => api<{ needsSetup: boolean }>('/auth/status'),
  });
  const session = useSession();
  const [mobile, setMobile] = useState(false);
  const location = useLocation();
  const logout = useMutation({
    mutationFn: () => api('/auth/logout', {}),
    onSuccess: () => {
      queryClient.clear();
      window.location.assign('/');
    },
  });
  if (status.isPending || session.isPending) return <Loading />;
  if (status.error)
    return (
      <div className="connection-error">
        <Store size={40} />
        <h1>Your store is temporarily unavailable</h1>
        <ErrorMessage error={status.error} />
        <Button onClick={() => void refresh()}>Try again</Button>
      </div>
    );
  if (status.data?.needsSetup) return <AuthForm setup />;
  if (session.error instanceof ApiError && session.error.status === 401)
    return <AuthForm setup={false} />;
  if (!session.data) {
    if (session.error instanceof ApiError && session.error.status === 401)
      return <AuthForm setup={false} />;
    return (
      <div className="connection-error">
        <ErrorMessage error={session.error} />
        <Button onClick={() => void refresh()}>Try again</Button>
      </div>
    );
  }
  const { user, store } = session.data;
  const current = nav.find((n) => n.to === location.pathname);
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobile ? 'mobile-open' : ''}`}>
        <button
          className="mobile-close"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        >
          <X size={18} />
        </button>
        <Link to="/" className="brand">
          <span className="brand-mark">
            <Store size={21} />
          </span>
          eliza<span className="brand-period">.</span>
        </Link>
        <div className="store-switch">
          <span className="store-avatar">{store.name.slice(0, 1)}</span>
          <div>
            <strong>{store.name}</strong>
            <small>Store workspace</small>
          </div>
          <ShieldCheck size={17} />
        </div>
        <span className="nav-caption">WORKSPACE</span>
        <nav>
          {nav
            .filter((n) => user.permissions.includes(n.permission))
            .map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                activeOptions={{ exact: true }}
                activeProps={{ className: 'nav-link active' }}
                className="nav-link"
                onClick={() => setMobile(false)}
              >
                <Icon size={19} />
                {label}
                {to === location.pathname && <span className="nav-dot" />}
              </Link>
            ))}
        </nav>
        <div className="sidebar-note">
          <span className="note-icon">
            <Store size={19} />
          </span>
          <strong>Your store, taking shape.</strong>
          <p>Build your catalog and get your opening stock in order.</p>
          <Link to="/inventory">
            Go to inventory <ArrowRight size={14} />
          </Link>
        </div>
        <div className="sidebar-bottom">
          <span className="status-dot" />
          Local workspace <span>v0.1</span>
        </div>
      </aside>
      {mobile && (
        <button
          aria-label="Dismiss navigation"
          className="mobile-backdrop"
          onClick={() => setMobile(false)}
        />
      )}
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-toggle"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu />
            </button>
            <Store size={16} />
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{current?.label ?? 'Page'}</strong>
          </div>
          <div className="topbar-right">
            <span className="local-badge">
              <span className="status-dot" />
              Local server
            </span>
            <span className="topbar-divider" />
            <span className="user-avatar">
              {user.name
                .split(' ')
                .map((n) => n[0])
                .slice(0, 2)
                .join('')}
            </span>
            <div className="user-info">
              <strong>{user.name}</strong>
              <small>{user.role}</small>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Sign out"
              title="Sign out"
              disabled={logout.isPending}
              onClick={() => logout.mutate()}
            >
              <LogOut size={17} />
            </Button>
          </div>
        </header>
        <main>
          <ErrorMessage error={logout.error} />
          {current && !user.permissions.includes(current.permission) ? (
            <Empty
              title="Access restricted"
              description="Ask your store owner for access to this area."
            />
          ) : (
            <Outlet />
          )}
        </main>
        <footer>
          Made for the everyday business of running a store.<span>Eliza · Local edition</span>
        </footer>
      </div>
    </div>
  );
}
export function Overview() {
  const session = useSession().data!;
  const products = useProducts();
  const canAdjust = useCan('inventory.adjust');
  const canWrite = useCan('catalog.write');
  const canAudit = useCan('audit.read');
  const [adjust, setAdjust] = useState(false);
  if (products.isPending) return <Loading />;
  if (products.error) return <ErrorMessage error={products.error} />;
  const list = products.data ?? [];
  const active = list.filter((p) => p.active);
  const low = active.filter((p) => toScaled(p.stock, 3) <= toScaled(p.minStock, 3));
  const total = active.reduce(
    (sum, p) => sum + toScaled(p.cost ?? '0', 2) * toScaled(p.stock, 3),
    0n,
  );
  const inventoryValue = fromScaled((total + 500n) / 1000n, 2);
  return (
    <>
      <PageHeading
        eyebrow="YOUR STORE AT A GLANCE"
        title={`Good to see you, ${session.user.name.split(' ')[0]}.`}
        description="A clear picture of what’s in store today."
        action={
          <span className="date-pill">
            {new Intl.DateTimeFormat('en-GB', {
              weekday: 'short',
              day: 'numeric',
              month: 'long',
              timeZone: session.store.timezone,
            }).format(new Date())}
          </span>
        }
      />
      <section className="welcome-banner">
        <div>
          <Badge>LET’S GET YOU READY</Badge>
          <h2>
            Good days start with
            <br />a well-stocked store.
          </h2>
          <p>
            Bring your products together and keep every
            <br className="desktop-br" /> stock change accounted for.
          </p>
          <div className="banner-actions">
            {canWrite && <AddProduct />}
            <Button variant="ghost" asChild>
              <Link to="/inventory">
                View inventory <ArrowRight size={16} />
              </Link>
            </Button>
          </div>
        </div>
        <div className="banner-art" aria-hidden="true">
          <div className="art-circle" />
          <div className="art-card art-back">
            <Boxes size={24} />
            <span>Everything in its place</span>
            <i />
            <i />
            <i />
          </div>
          <div className="art-card art-front">
            <span className="art-check">
              <Check size={19} />
            </span>
            <strong>Ready for a fresh start</strong>
            <span>One product at a time.</span>
            <div className="art-lines">
              <i />
              <i />
            </div>
          </div>
          <div className="floating-plus">+</div>
        </div>
      </section>
      <div className="metrics">
        <Metric
          label="Active products"
          value={String(active.length)}
          sub="In your store catalog"
          icon={<Package />}
        />
        <Metric
          label="Inventory value"
          value={
            session.user.permissions.includes('costs.read')
              ? money(inventoryValue, session.store.currency)
              : 'Restricted'
          }
          sub="Current stock × purchase cost"
          icon={<Boxes />}
        />
        <Metric
          label="Low-stock products"
          value={String(low.length)}
          sub="At or below their threshold"
          icon={<AlertTriangle />}
          amber={low.length > 0}
        />
        <Metric
          label="Categories"
          value={String(new Set(active.map((p) => p.category)).size)}
          sub="Keeping your shelves organized"
          icon={<ClipboardList />}
        />
      </div>
      <div className="overview-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Needs a little attention</h2>
              <p className="muted">Keep your essentials on the shelf.</p>
            </div>
            <Link to="/inventory" className="text-link">
              View inventory <ArrowRight size={15} />
            </Link>
          </div>
          {low.length ? (
            <div className="attention-list">
              {low.slice(0, 5).map((p) => (
                <div className="attention-row" key={p.id}>
                  <ProductIcon category={p.category} />
                  <div>
                    <strong>{p.name}</strong>
                    <small>
                      {p.sku} · {p.category}
                    </small>
                  </div>
                  <Badge tone={Number(p.stock) === 0 ? 'gray' : 'amber'}>
                    {Number(p.stock) === 0 ? 'Out of stock' : `${Number(p.stock)} left`}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <Empty
              title={list.length ? 'Your stock looks good' : 'A fresh start for your shelves'}
              description={
                list.length
                  ? 'No products are at or below their low-stock threshold.'
                  : 'Add your first products and their opening stock to see what needs attention.'
              }
            />
          )}
        </section>
        <section className="panel getting-started">
          <div className="panel-heading">
            <div>
              <h2>Your store checklist</h2>
              <p className="muted">A few small steps. A solid foundation.</p>
            </div>
            <span className="progress-count">
              {1 + (list.length ? 1 : 0) + (list.some((p) => Number(p.stock) > 0) ? 1 : 0)}/3
            </span>
          </div>
          <Checklist done title="Create your store" description="Your workspace is ready." />
          <Checklist
            done={list.length > 0}
            title="Build your product catalog"
            description="Names, prices, barcodes, and PLUs."
            to="/products"
          />
          <Checklist
            done={list.some((p) => Number(p.stock) > 0)}
            title="Record opening stock"
            description="Start with an accurate count."
            to="/inventory"
          />
          {canAdjust && (
            <Button
              variant="outline"
              className="full"
              onClick={() => setAdjust(true)}
              disabled={!active.length}
            >
              <Plus size={16} />
              Record stock
            </Button>
          )}
          <div className="next-note">
            <CircleHelp size={17} />
            <p>
              Set employee PINs in Team, then open Checkout to enroll a register and start a shift.
            </p>
          </div>
        </section>
      </div>
      {canAudit && <RecentActivity />}
      <Dialog
        open={adjust}
        onOpenChange={setAdjust}
        title="Record a stock adjustment"
        description="Keep stock accurate with a traceable change."
      >
        <AdjustmentForm products={list} onDone={() => setAdjust(false)} />
      </Dialog>
    </>
  );
}
function Metric({
  label,
  value,
  sub,
  icon,
  amber = false,
}: {
  label: string;
  value: string;
  sub: string;
  icon: ReactNode;
  amber?: boolean;
}) {
  return (
    <section className="metric">
      <div>
        <span>{label}</span>
        <span className={`metric-icon ${amber ? 'amber' : ''}`}>{icon}</span>
      </div>
      <strong>{value}</strong>
      <small>{sub}</small>
    </section>
  );
}
function Checklist({
  done,
  title,
  description,
  to,
}: {
  done: boolean;
  title: string;
  description: string;
  to?: '/products' | '/inventory';
}) {
  return (
    <div className="checklist-row">
      <span className={`check-circle ${done ? 'done' : ''}`}>
        {done ? <Check size={14} /> : null}
      </span>
      <div>
        <strong>{title}</strong>
        <small>{description}</small>
      </div>
      {to && (
        <Link to={to} aria-label={title}>
          <ChevronRight size={17} />
        </Link>
      )}
    </div>
  );
}
function ProductIcon({ category }: { category: string }) {
  return (
    <span className={`product-icon color-${category.length % 4}`}>
      <Package size={20} />
    </span>
  );
}
function RecentActivity() {
  const query = useAudit();
  return (
    <section className="panel recent-panel">
      <div className="panel-heading">
        <div>
          <h2>Recent activity</h2>
          <p className="muted">The story behind every change.</p>
        </div>
        <Link to="/audit" className="text-link">
          View activity <ArrowRight size={15} />
        </Link>
      </div>
      <ErrorMessage error={query.error} />
      {query.data?.slice(0, 4).map((a) => (
        <div className="activity-row" key={a.id}>
          <span className="activity-icon">
            <Activity size={17} />
          </span>
          <div>
            <strong>{a.action}</strong>
            <small>
              {a.actor} · {a.device}
            </small>
          </div>
          <time>{date(a.createdAt)}</time>
        </div>
      ))}
      {query.data?.length === 0 && (
        <p className="muted panel-padding">Your store’s activity will appear here as you work.</p>
      )}
    </section>
  );
}
export function ProductsPage() {
  const query = useProducts();
  const session = useSession().data!;
  const canWrite = useCan('catalog.write');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All categories');
  const [edit, setEdit] = useState<Product | null>(null);
  const [status, setStatus] = useState<Product | null>(null);
  const mutation = useMutation({
    mutationFn: (p: Product) => api(`/products/${p.id}/status`, { active: !p.active }, 'PATCH'),
    onSuccess: () => {
      void refresh();
      setStatus(null);
    },
  });
  const rows = (query.data ?? []).filter(
    (p) =>
      (category === 'All categories' || p.category === category) &&
      [p.name, p.sku, p.plu, ...p.barcodes].some((v) =>
        v.toLowerCase().includes(search.toLowerCase()),
      ),
  );
  return (
    <>
      <PageHeading
        eyebrow="YOUR CATALOG"
        title="Products"
        description="Every item has a place. With or without a barcode."
        action={canWrite && <AddProduct />}
      />
      <section className="panel">
        <div className="table-toolbar">
          <div className="search-box">
            <Search size={18} />
            <input
              aria-label="Search products"
              placeholder="Search name, barcode, SKU, or PLU…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            aria-label="Filter category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option>All categories</option>
            {[...new Set(query.data?.map((p) => p.category))].sort().map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <span className="muted">{rows.length} products</span>
        </div>
        <ErrorMessage error={query.error} />
        {query.isPending ? (
          <Loading />
        ) : rows.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Price</th>
                  <th>On hand</th>
                  <th>Barcode / PLU</th>
                  <th>Status</th>
                  {canWrite && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div className="product-cell">
                        <ProductIcon category={p.category} />
                        <div>
                          <strong>{p.name}</strong>
                          <small>{p.sku}</small>
                        </div>
                      </div>
                    </td>
                    <td>{p.category}</td>
                    <td className="numeric">
                      {money(p.price, session.store.currency)}
                      <small>per {p.unit}</small>
                    </td>
                    <td className="numeric">
                      {Number(p.stock)}
                      <small>{p.unit}</small>
                    </td>
                    <td className="code-cell">
                      {p.barcodes[0] ?? (p.plu ? `PLU ${p.plu}` : 'No barcode')}
                      {p.barcodes.length > 1 && <small>+{p.barcodes.length - 1} more</small>}
                    </td>
                    <td>
                      <Badge tone={p.active ? 'green' : 'gray'}>
                        {p.active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    {canWrite && (
                      <td>
                        <div className="row-actions">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Edit ${p.name}`}
                            onClick={() => setEdit(p)}
                          >
                            <Pencil size={15} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              mutation.reset();
                              setStatus(p);
                            }}
                          >
                            {p.active ? 'Deactivate' : 'Activate'}
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !query.error && (
            <Empty
              title={query.data?.length ? 'No matching products' : 'Your first product starts here'}
              description={
                query.data?.length
                  ? 'Try a different name, barcode, or category.'
                  : 'Add an item with a name, price, and SKU. A barcode is optional.'
              }
              action={canWrite && !query.data?.length ? <AddProduct /> : undefined}
            />
          )
        )}
      </section>
      <Dialog
        open={!!edit}
        onOpenChange={(v) => !v && setEdit(null)}
        title="Edit product"
        description="Price and barcode changes are recorded in your activity log."
      >
        {edit && <ProductForm key={edit.id} initial={edit} onDone={() => setEdit(null)} />}
      </Dialog>
      <Dialog
        open={!!status}
        onOpenChange={(v) => !v && setStatus(null)}
        title={status?.active ? 'Deactivate product?' : 'Activate product?'}
        description={
          status?.active
            ? 'The product remains in your records and stock history. It will be unavailable for new stock adjustments.'
            : 'The product will be available for stock adjustments again.'
        }
      >
        <p className="confirm-name">{status?.name}</p>
        <ErrorMessage error={mutation.error} />
        <div className="form-actions">
          <Button variant="outline" onClick={() => setStatus(null)}>
            Cancel
          </Button>
          <Button disabled={mutation.isPending} onClick={() => status && mutation.mutate(status)}>
            {mutation.isPending ? 'Saving…' : 'Confirm'}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
export function InventoryPage() {
  const products = useProducts();
  const movements = useMovements();
  const [open, setOpen] = useState(false);
  return (
    <>
      <PageHeading
        eyebrow="EVERY CHANGE ACCOUNTED FOR"
        title="Inventory"
        description="A permanent record of what comes in and what goes out."
        action={
          useCan('inventory.adjust') && (
            <Button onClick={() => setOpen(true)} disabled={!products.data?.some((p) => p.active)}>
              <Plus size={17} />
              Adjust stock
            </Button>
          )
        }
      />
      <div className="notice inventory-notice">
        <ShieldCheck size={20} />
        <div>
          <strong>Stock changes have a history.</strong>
          <span>Every adjustment records the person, device, reason, and resulting balance.</span>
        </div>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Stock movements</h2>
            <p className="muted">Most recent 100 movements, across your store.</p>
          </div>
          <Badge tone="gray">{movements.data?.length ?? 0} records</Badge>
        </div>
        <ErrorMessage error={products.error ?? movements.error} />
        {movements.isPending ? (
          <Loading />
        ) : movements.data?.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Change</th>
                  <th>Balance after</th>
                  <th>Reason</th>
                  <th>Recorded by</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {movements.data.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <strong>{m.productName}</strong>
                      <small>{m.sku}</small>
                    </td>
                    <td>
                      <span
                        className={`quantity-change ${Number(m.quantity) > 0 ? 'positive' : 'negative'}`}
                      >
                        {Number(m.quantity) > 0 ? (
                          <ArrowDownLeft size={15} />
                        ) : (
                          <ArrowUpRight size={15} />
                        )}{' '}
                        {Number(m.quantity) > 0 ? '+' : ''}
                        {Number(m.quantity)}
                      </span>
                    </td>
                    <td>{Number(m.balance)}</td>
                    <td className="reason">
                      {m.reason.replaceAll('_', ' ')}
                      {m.notes && <small>{m.notes}</small>}
                    </td>
                    <td>
                      {m.actor}
                      <small>{m.device}</small>
                    </td>
                    <td>{date(m.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !movements.error && (
            <Empty
              title="Start with what’s on your shelves"
              description="Add your products, then record an opening balance. Every future change will build on this history."
            />
          )
        )}
      </section>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Record a stock adjustment"
        description="A positive quantity adds stock. A negative quantity removes it."
      >
        <AdjustmentForm products={products.data ?? []} onDone={() => setOpen(false)} />
      </Dialog>
    </>
  );
}
export function AuditPage() {
  const query = useAudit();
  return (
    <>
      <PageHeading
        eyebrow="TRACEABILITY"
        title="Activity log"
        description="Who changed what, when, and from which device. Latest 100 events."
      />
      <section className="panel">
        <ErrorMessage error={query.error} />
        {query.isPending ? (
          <Loading />
        ) : query.data?.length ? (
          <div className="audit-list">
            {query.data.map((a) => (
              <div className="audit-row" key={a.id}>
                <span className="activity-icon">
                  <Activity size={18} />
                </span>
                <div>
                  <strong>{a.action}</strong>
                  <p className="muted">
                    {a.actor} · {a.device} · {date(a.createdAt)}
                  </p>
                  <details>
                    <summary>View recorded details</summary>
                    <pre>{JSON.stringify(a.details, null, 2)}</pre>
                  </details>
                </div>
              </div>
            ))}
          </div>
        ) : (
          !query.error && (
            <Empty
              title="Your store history starts here"
              description="Product changes, inventory adjustments, and device events appear automatically."
            />
          )
        )}
      </section>
    </>
  );
}
export function DevicesPage() {
  const query = useDevices();
  const session = useSession().data!;
  const [edit, setEdit] = useState<Device | null>(null);
  const mutation = useMutation({
    mutationFn: (body: { id: string; name: string; active: boolean }) =>
      api(`/devices/${body.id}`, { name: body.name, active: body.active }, 'PATCH'),
    onSuccess: () => {
      void refresh();
      setEdit(null);
    },
  });
  return (
    <>
      <PageHeading
        eyebrow="TRUSTED ACCESS"
        title="Devices"
        description="Management browsers are registered when an owner signs in."
      />
      <ErrorMessage error={query.error} />
      <div className="device-grid">
        {query.data?.map((d) => (
          <section className="panel device-card" key={d.id}>
            <div className="device-card-top">
              <span className="icon-tile">
                <Monitor size={24} />
              </span>
              <Badge tone={d.active ? 'green' : 'gray'}>
                {d.active ? 'Registered' : 'Blocked'}
              </Badge>
            </div>
            <h2>{d.name}</h2>
            <p className="muted">
              {d.type === 'management' ? 'Management browser' : d.type}
              {d.id === session.device.id ? ' · This device' : ''}
            </p>
            <small>Added {date(d.createdAt)}</small>
            <Button
              variant="outline"
              onClick={() => {
                mutation.reset();
                setEdit(d);
              }}
            >
              Manage device
            </Button>
          </section>
        ))}
      </div>
      <Dialog
        open={!!edit}
        onOpenChange={(v) => !v && setEdit(null)}
        title="Manage device"
        description="Blocked devices lose access immediately. Blocking this browser will also sign you out."
      >
        {edit && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate(edit);
            }}
          >
            <Field label="Device name">
              <input
                value={edit.name}
                required
                maxLength={120}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })}
              />
            </Field>
            <Field label="Access">
              <select
                value={String(edit.active)}
                onChange={(e) => setEdit({ ...edit, active: e.target.value === 'true' })}
              >
                <option value="true">Registered</option>
                <option value="false">Blocked</option>
              </select>
            </Field>
            <ErrorMessage error={mutation.error} />
            <div className="form-actions">
              <Button variant="outline" type="button" onClick={() => setEdit(null)}>
                Cancel
              </Button>
              <Button disabled={mutation.isPending}>Save device</Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
export function SettingsPage() {
  const { store, user } = useSession().data!;
  return (
    <>
      <PageHeading
        eyebrow="STORE FOUNDATION"
        title="Store settings"
        description="The store details you established during setup."
      />
      <section className="panel settings-panel">
        <div className="panel-heading">
          <div>
            <h2>Store profile</h2>
            <p className="muted">Current configuration</p>
          </div>
          <Store size={23} />
        </div>
        <dl>
          <div>
            <dt>Store name</dt>
            <dd>{store.name}</dd>
          </div>
          <div>
            <dt>Currency</dt>
            <dd>{store.currency}</dd>
          </div>
          <div>
            <dt>Time zone</dt>
            <dd>{store.timezone}</dd>
          </div>
          <div>
            <dt>Owner</dt>
            <dd>{user.name}</dd>
          </div>
          <div>
            <dt>Data storage</dt>
            <dd>Local PostgreSQL</dd>
          </div>
        </dl>
      </section>
      <p className="muted footnote">
        Tax rules, receipt settings, and configuration editing will be added before checkout is
        enabled.
      </p>
    </>
  );
}
