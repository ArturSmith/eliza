import { afterEach, expect, it, vi } from 'vitest';
import { lookupBarcode, validBarcode } from '../apps/api/src/barcode-lookup';
const database = { pool: { query: vi.fn(async () => ({ rows: [{ count: 1 }] })) } } as any;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it('validates EAN and UPC without stripping leading zeros', () => {
  expect(validBarcode('3017620422003')).toBe(true);
  expect(validBarcode('012345678905')).toBe(true);
  expect(validBarcode('3017620422004')).toBe(false);
  expect(validBarcode('ABC')).toBe(false);
});
it('maps suggestions, bounds strings, caches reads and ignores untrusted image hosts', async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          product: {
            product_name: 'Food',
            brands: 'Brand',
            quantity: '500 g',
            categories: 'Foods, Spreads',
            image_front_small_url: 'http://127.0.0.1/private',
          },
        }),
      ),
  );
  vi.stubGlobal('fetch', fetcher);
  const result = await lookupBarcode('3017620422003', database);
  expect(result).toMatchObject({ name: 'Food', category: 'Spreads', quantity: '500 g', image: '' });
  expect(fetcher).toHaveBeenCalledTimes(1);
  await lookupBarcode('3017620422003', database);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('returns no match and makes service outages recoverable', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('', { status: 404 })),
  );
  expect(await lookupBarcode('012345678905', database)).toBe(null);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('', { status: 503 })),
  );
  await expect(lookupBarcode('4006381333931', database)).rejects.toThrow('unavailable');
});
it('enforces the shared provider budget', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const limited = { pool: { query: async () => ({ rows: [{ count: 13 }] }) } } as any;
  await expect(lookupBarcode('4006381333931', limited)).rejects.toThrow('busy');
  expect(fetcher).not.toHaveBeenCalled();
});
