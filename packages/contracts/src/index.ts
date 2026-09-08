import { z } from 'zod';
export const permissions = [
  'catalog.read',
  'costs.read',
  'catalog.write',
  'inventory.read',
  'inventory.adjust',
  'audit.read',
  'team.read',
  'devices.manage',
  'settings.manage',
] as const;
export type Permission = (typeof permissions)[number];
const short = z.string().trim().min(1).max(120);
export const money = z
  .string()
  .regex(/^\d{1,9}(\.\d{1,2})?$/, 'Use a positive amount with at most two decimal places');
export const quantity = z
  .string()
  .regex(/^-?\d{1,9}(\.\d{1,3})?$/, 'Use a quantity with at most three decimal places');
export const units = [
  'piece',
  'kilogram',
  'gram',
  'liter',
  'milliliter',
  'pack',
  'box',
  'other',
] as const;
export const setupSchema = z.object({
  storeName: short,
  ownerName: short,
  email: z
    .email()
    .max(254)
    .transform((s) => s.toLowerCase()),
  password: z.string().min(12).max(128),
  currency: z.enum(['NOK', 'EUR', 'USD', 'GBP', 'SEK', 'DKK']),
  timezone: z
    .string()
    .max(80)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, 'Choose a valid time zone'),
});
export const loginSchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((s) => s.toLowerCase()),
  password: z.string().min(1).max(128),
});
export const productSchema = z.object({
  name: short,
  sku: short,
  category: short,
  unit: z.enum(units),
  price: money,
  cost: money,
  minStock: quantity.refine((v) => toScaled(v, 3) >= 0n, 'Minimum stock cannot be negative'),
  plu: z.string().trim().max(20).default(''),
  barcodes: z
    .array(z.string().trim().min(1).max(100))
    .max(20)
    .refine((v) => new Set(v).size === v.length, 'Barcodes must be unique'),
});
export const adjustmentSchema = z.object({
  productId: z.uuid(),
  quantity: quantity.refine((v) => toScaled(v, 3) !== 0n, 'Quantity cannot be zero'),
  reason: z.enum([
    'opening_balance',
    'received',
    'damaged',
    'expired',
    'count_correction',
    'internal_use',
    'other',
  ]),
  notes: z.string().trim().max(500).default(''),
  requestId: z.uuid(),
});
export const deviceSchema = z.object({
  name: short,
  type: z.enum(['management', 'pos', 'inventory']),
});
export type ProductInput = z.infer<typeof productSchema>;
export type AdjustmentInput = z.infer<typeof adjustmentSchema>;
export type Product = Omit<ProductInput, 'cost'> & {
  cost: string | null;
  id: string;
  storeId: string;
  stock: string;
  active: boolean;
  createdAt: string;
};
export type Session = {
  user: { id: string; name: string; email: string; role: string; permissions: Permission[] };
  store: { id: string; name: string; currency: string; timezone: string };
  device: { id: string; name: string };
};
export type Movement = {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  quantity: string;
  balance: string;
  reason: string;
  notes: string;
  actor: string;
  device: string;
  createdAt: string;
};
export type AuditEvent = {
  id: string;
  action: string;
  entityId: string;
  actor: string;
  device: string;
  details: unknown;
  createdAt: string;
};
export type Device = { id: string; name: string; type: string; active: boolean; createdAt: string };
export type Employee = {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  createdAt: string;
};
// Decimal strings at API boundaries; scaled integers for exact comparisons/calculations.
export function toScaled(value: string, scale: number): bigint {
  if (!/^-?\d+(\.\d+)?$/.test(value)) throw new Error('Invalid decimal');
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace('-', '').split('.');
  if (fraction.length > scale) throw new Error('Too many decimal places');
  return BigInt(whole + fraction.padEnd(scale, '0')) * (negative ? -1n : 1n);
}
export function fromScaled(value: bigint, scale: number): string {
  const sign = value < 0n ? '-' : '';
  const digits = (value < 0n ? -value : value).toString().padStart(scale + 1, '0');
  return scale ? `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}` : `${sign}${digits}`;
}
