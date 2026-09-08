import { QueryClient, useQuery } from '@tanstack/react-query';
import type { Session, Product, Movement, AuditEvent, Device, Employee } from '@eliza/contracts';
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 15_000 } },
});
export async function api<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Eliza-Request': '1' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection and try again.', 0);
  }
  const data = await response
    .json()
    .catch(() => ({ message: 'The server returned an unexpected response.' }));
  if (!response.ok) {
    if (path.startsWith('/pos/') && [401, 403].includes(response.status) && path !== '/pos/enter')
      void queryClient.invalidateQueries({ queryKey: ['pos-context'] });
    if (response.status === 401 && path !== '/auth/session' && path !== '/auth/login')
      void queryClient.invalidateQueries({ queryKey: ['session'] });
    throw new ApiError(data.message ?? 'Request failed.', response.status);
  }
  return data;
}
export const useSession = () =>
  useQuery({ queryKey: ['session'], queryFn: () => api<Session>('/auth/session') });
export const useProducts = () =>
  useQuery({ queryKey: ['products'], queryFn: () => api<Product[]>('/products') });
export const useMovements = () =>
  useQuery({ queryKey: ['movements'], queryFn: () => api<Movement[]>('/inventory/movements') });
export const useAudit = () =>
  useQuery({ queryKey: ['audit'], queryFn: () => api<AuditEvent[]>('/audit') });
export const useDevices = () =>
  useQuery({ queryKey: ['devices'], queryFn: () => api<Device[]>('/devices') });
export const useEmployees = () =>
  useQuery({ queryKey: ['employees'], queryFn: () => api<Employee[]>('/employees') });
export const refresh = () => queryClient.invalidateQueries();
