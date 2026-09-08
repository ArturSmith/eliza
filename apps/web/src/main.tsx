import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { queryClient } from './api';
import {
  Shell,
  Overview,
  ProductsPage,
  InventoryPage,
  AuditPage,
  TeamPage,
  DevicesPage,
  SettingsPage,
} from './pages';
import './styles.css';
const root = createRootRoute({
  component: Shell,
  notFoundComponent: () => (
    <div className="empty">
      <h2>Page not found</h2>
      <a href="/">Return to overview</a>
    </div>
  ),
});
const routes = [
  createRoute({ getParentRoute: () => root, path: '/', component: Overview }),
  createRoute({ getParentRoute: () => root, path: '/products', component: ProductsPage }),
  createRoute({ getParentRoute: () => root, path: '/inventory', component: InventoryPage }),
  createRoute({ getParentRoute: () => root, path: '/audit', component: AuditPage }),
  createRoute({ getParentRoute: () => root, path: '/team', component: TeamPage }),
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
