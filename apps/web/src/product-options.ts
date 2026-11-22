import { useQuery } from '@tanstack/react-query';
import { api, useSession } from './api';
export function uniqueProductTerms(values: (string | null | undefined)[]) {
  const terms = new Map<string, string>();
  for (const value of values) {
    const term = value?.trim();
    if (term && !terms.has(term.toLowerCase())) terms.set(term.toLowerCase(), term);
  }
  return [...terms.values()].sort((a, b) => a.localeCompare(b));
}
export function useProductOptions(enabled = true) {
  const session = useSession().data;
  const query = useQuery({
    queryKey: ['product-options', session?.store.id],
    queryFn: () => api<{ brands: string[]; categories: string[] }>('/products/options'),
    enabled: enabled && !!session?.user.permissions.includes('catalog.read'),
  });
  return {
    ...query,
    brands: uniqueProductTerms(query.data?.brands ?? []),
    categories: uniqueProductTerms(query.data?.categories ?? []),
  };
}
