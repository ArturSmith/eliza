import { ShoppingListsPage } from './shopping-lists';
import { t, useLanguage } from './i18n';
import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import {
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  Outlet,
  useLocation,
} from '@tanstack/react-router';
import { api, queryClient } from './api';
import { Shell, Overview, ProductsPage, InventoryPage, AuditPage, DevicesPage } from './pages';
import { LanguageSwitcher } from './i18n/LanguageSwitcher';
import './styles.css';
import './pos.css';
const PosPage = lazy(() => import('./pos').then((module) => ({ default: module.PosPage })));
function CheckoutRoute() {
  useLanguage();
  return (
    <Suspense fallback={<div className="loading">Opening register…</div>}>
      <PosPage />
    </Suspense>
  );
}
import { StoreSettingsPage } from './store-settings';
import { StockCountsPage } from './stock-counts';
import { SuppliersPage, PurchasesPage } from './purchasing';
import { AiAgentPage } from './ai-agent';
import { DigitalPurchasesPage } from './digital-purchases';
import { TeamManagementPage } from './team';
import { OwnerDashboardPage } from './owner-dashboard';
import { PriceTagsPage } from './price-tags';
import { SalesPage, ShiftsPage } from './reports';
function LegacyDocumentsRedirect() {
  React.useEffect(() => {
    const oldId = new URLSearchParams(window.location.search).get('id');
    window.location.replace('/ai' + (oldId ? '?document=' + encodeURIComponent(oldId) : ''));
  }, []);
  return null;
}
function Root() {
  useLanguage();
  const location = useLocation();
  const environment = useQuery({
    queryKey: ['device-environment'],
    queryFn: () => api<{ type: string }>('/auth/device-environment'),
    enabled: location.pathname !== '/pos' && location.pathname !== '/price-tags',
  });
  React.useEffect(() => {
    if (environment.data?.type === 'pos') window.location.replace('/pos');
    if (environment.data?.type === 'price_tags') window.location.replace('/price-tags');
  }, [environment.data?.type]);
  if (
    location.pathname !== '/pos' &&
    location.pathname !== '/price-tags' &&
    (environment.isPending ||
      environment.data?.type === 'pos' ||
      environment.data?.type === 'price_tags')
  )
    return <div className="loading">{t('Loading…')}</div>;
  return (
    <>
      <LanguageSwitcher />
      {location.pathname === '/pos' || location.pathname === '/price-tags' ? <Outlet /> : <Shell />}
    </>
  );
}
const root = createRootRoute({
  component: Root,
  notFoundComponent: () => (
    <div className="empty">
      <h2>{t('Page not found')}</h2>
      <a href="/">{t('Return to overview')}</a>
    </div>
  ),
});
const routes = [
  createRoute({
    getParentRoute: () => root,
    path: '/shopping-lists',
    component: ShoppingListsPage,
  }),
  createRoute({ getParentRoute: () => root, path: '/stock-counts', component: StockCountsPage }),
  createRoute({ getParentRoute: () => root, path: '/suppliers', component: SuppliersPage }),
  createRoute({ getParentRoute: () => root, path: '/purchases', component: PurchasesPage }),
  createRoute({
    getParentRoute: () => root,
    path: '/documents',
    component: LegacyDocumentsRedirect,
  }),
  createRoute({ getParentRoute: () => root, path: '/ai', component: AiAgentPage }),
  createRoute({
    getParentRoute: () => root,
    path: '/digital-purchases',
    component: DigitalPurchasesPage,
  }),
  createRoute({ getParentRoute: () => root, path: '/pos', component: CheckoutRoute }),
  createRoute({ getParentRoute: () => root, path: '/price-tags', component: PriceTagsPage }),
  createRoute({ getParentRoute: () => root, path: '/analytics', component: OwnerDashboardPage }),
  createRoute({ getParentRoute: () => root, path: '/sales', component: SalesPage }),
  createRoute({ getParentRoute: () => root, path: '/shifts', component: ShiftsPage }),
  createRoute({ getParentRoute: () => root, path: '/', component: Overview }),
  createRoute({ getParentRoute: () => root, path: '/products', component: ProductsPage }),
  createRoute({ getParentRoute: () => root, path: '/inventory', component: InventoryPage }),
  createRoute({ getParentRoute: () => root, path: '/audit', component: AuditPage }),
  createRoute({ getParentRoute: () => root, path: '/team', component: TeamManagementPage }),
  createRoute({ getParentRoute: () => root, path: '/devices', component: DevicesPage }),
  createRoute({ getParentRoute: () => root, path: '/settings', component: StoreSettingsPage }),
];
const router = createRouter({ routeTree: root.addChildren(routes) });
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
