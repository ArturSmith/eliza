import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  Outlet,
  useLocation,
} from '@tanstack/react-router';
import { queryClient } from './api';
import {
  Shell,
  Overview,
  ProductsPage,
  InventoryPage,
  AuditPage,
  DevicesPage,
  SettingsPage,
} from './pages';
import './styles.css';
import './pos.css';
const PosPage = lazy(() => import('./pos').then((module) => ({ default: module.PosPage })));
function CheckoutRoute() {
  return (
    <Suspense fallback={<div className="loading">Opening register…</div>}>
      <PosPage />
    </Suspense>
  );
}
import { TeamManagementPage } from './team';
import { SalesPage, ShiftsPage } from './reports';
function Root() {
  const location = useLocation();
  return location.pathname === '/pos' ? <Outlet /> : <Shell />;
}
const root = createRootRoute({
  component: Root,
  notFoundComponent: () => (
    <div className="empty">
      <h2>Page not found</h2>
      <a href="/">Return to overview</a>
    </div>
  ),
});
const routes = [
  createRoute({ getParentRoute: () => root, path: '/pos', component: CheckoutRoute }),
  createRoute({ getParentRoute: () => root, path: '/sales', component: SalesPage }),
  createRoute({ getParentRoute: () => root, path: '/shifts', component: ShiftsPage }),
  createRoute({ getParentRoute: () => root, path: '/', component: Overview }),
  createRoute({ getParentRoute: () => root, path: '/products', component: ProductsPage }),
  createRoute({ getParentRoute: () => root, path: '/inventory', component: InventoryPage }),
  createRoute({ getParentRoute: () => root, path: '/audit', component: AuditPage }),
  createRoute({ getParentRoute: () => root, path: '/team', component: TeamManagementPage }),
  createRoute({ getParentRoute: () => root, path: '/devices', component: DevicesPage }),
  createRoute({ getParentRoute: () => root, path: '/settings', component: SettingsPage }),
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
