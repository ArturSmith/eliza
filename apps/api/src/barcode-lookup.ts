import { BadRequestException, HttpException } from '@nestjs/common';
import type { Database } from './database.js';
export type Suggestion = {
  barcode: string;
  name: string;
  brand: string;
  quantity: string;
  category: string;
  image: string;
};
const cache = new Map<string, { until: number; value: Suggestion | null }>();
export function validBarcode(value: string) {
  if (!/^(?:\d{8}|\d{12,14})$/.test(value)) return false;
  const digits = [...value].map(Number),
    check = digits.pop();
  return (
    (10 - (digits.reverse().reduce((sum, digit, i) => sum + digit * (i % 2 ? 1 : 3), 0) % 10)) %
      10 ===
    check
  );
}
async function bounded(response: Response, limit: number) {
  if (!response.ok || !response.body) throw new Error('Provider unavailable');
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error('Response too large');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}
export async function lookupBarcode(
  barcode: string,
  database: Database,
): Promise<Suggestion | null> {
  if (!validBarcode(barcode))
    throw new BadRequestException('Enter a valid EAN or UPC barcode (8, 12, 13, or 14 digits).');
  const cached = cache.get(barcode);
  if (cached && cached.until > Date.now()) return cached.value;
  const budget = await database.pool.query(
    "INSERT INTO auth_attempts(key,count,expires_at) VALUES('open-food-facts',1,now()+interval '1 minute') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN auth_attempts.expires_at < now() THEN 1 ELSE auth_attempts.count+1 END, expires_at=CASE WHEN auth_attempts.expires_at < now() THEN now()+interval '1 minute' ELSE auth_attempts.expires_at END RETURNING count",
  );
  if (budget.rows[0].count > 12)
    throw new HttpException(
      'Lookup is busy. Try again in a minute or enter the product manually.',
      429,
    );
  const staging = process.env.OFF_ENV === 'staging';
  const headers: Record<string, string> = {
    'User-Agent':
      'Eliza/1.0 (' +
      (process.env.OFF_CONTACT ?? process.env.APP_ORIGIN ?? 'local store application') +
      ')',
  };
  if (staging) headers.Authorization = 'Basic ' + Buffer.from('off:off').toString('base64');
  try {
    const response = await fetch(
      'https://world.openfoodfacts.' +
        (staging ? 'net' : 'org') +
        '/api/v3/product/' +
        barcode +
        '?fields=product_name,product_name_en,brands,quantity,categories,image_front_small_url',
      { headers, signal: AbortSignal.timeout(7000), redirect: 'error' },
    );
    const data =
      response.status === 404 ? {} : JSON.parse((await bounded(response, 200000)).toString());
    const p = data.product;
    let result: Suggestion | null = null;
    const text = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 120) : '');
    if (p && typeof p === 'object') {
      result = {
        barcode,
        name: text(p.product_name || p.product_name_en),
        brand: text(p.brands),
        quantity: text(p.quantity),
        category: text(typeof p.categories === 'string' ? p.categories.split(',').pop() : ''),
        image: '',
      };
      try {
        const url = new URL(p.image_front_small_url);
        if (
          url.protocol === 'https:' &&
          url.hostname === 'images.openfoodfacts.org' &&
          !url.port &&
          !url.username &&
          !url.password &&
          url.pathname.startsWith('/images/products/')
        ) {
          const photo = await fetch(url, { signal: AbortSignal.timeout(4000), redirect: 'error' });
          if (photo.headers.get('content-type')?.split(';')[0] === 'image/jpeg') {
            const bytes = await bounded(photo, 350000);
            if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
              result.image = 'data:image/jpeg;base64,' + bytes.toString('base64');
          }
        }
      } catch {
        /* Text import remains available when the photo cannot be loaded. */
      }
    }
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(barcode, { until: Date.now() + (result ? 3600000 : 300000), value: result });
    return result;
  } catch {
    throw new HttpException(
      'Open Food Facts is unavailable. Try again later or enter the product manually.',
      503,
    );
  }
}
