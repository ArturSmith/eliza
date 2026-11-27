import { fromScaled, toScaled } from '@eliza/contracts';

export function normalizeCountQuantity(value: string, unit: string): string {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(normalized))
    throw new Error('Enter zero or a positive quantity with at most three decimal places.');
  const scaled = toScaled(normalized, 3);
  if (['piece', 'pack', 'box'].includes(unit) && scaled % 1000n !== 0n)
    throw new Error('This product requires a whole-number quantity.');
  return fromScaled(scaled, 3);
}
