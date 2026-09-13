import { z } from 'zod';
export const permissions = [
  'catalog.read',
  'costs.read',
  'catalog.write',
  'inventory.read',
  'inventory.adjust',
  'counts.manage',
  'counts.finalize',
  'audit.read',
  'team.read',
  'team.manage',
  'pos.access',
  'sales.read',
  'discount.approve',
  'refund.approve',
  'shift.approve',
  'cash.manage',
  'devices.manage',
  'settings.manage',
  'suppliers.read',
  'suppliers.manage',
  'purchases.read',
  'purchases.write',
  'purchases.receive',
  'purchases.cost',
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
  description: z.string().trim().max(2000).optional(),
  source: z
    .object({
      barcode: z.string().regex(/^\d{8,14}$/),
      brand: z.string().max(120),
      quantity: z.string().max(120),
      imageImported: z.boolean(),
    })
    .nullable()
    .optional(),
  image: z
    .string()
    .max(60000)
    .refine(
      (v) => v === '' || /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(v),
      'Choose a valid product photo',
    )
    .optional(),
  name: short,
  sku: short,
  category: short,
  unit: z.enum(units),
  taxRate: money
    .refine(
      (v) => /^\d+(\.\d{1,2})?$/.test(v) && toScaled(v, 2) <= 10000n,
      'Tax rate must be between 0 and 100',
    )
    .default('0'),
  price: money,
  cost: money,
  minStock: quantity.refine(
    (v) => isQuantity(v) && toScaled(v, 3) >= 0n,
    'Minimum stock cannot be negative',
  ),
  plu: z.string().trim().max(20).default(''),
  barcodes: z
    .array(z.string().trim().min(1).max(100))
    .max(20)
    .refine((v) => new Set(v).size === v.length, 'Barcodes must be unique'),
});
export const adjustmentSchema = z.object({
  productId: z.uuid(),
  quantity: quantity.refine(
    (v) => isQuantity(v) && toScaled(v, 3) !== 0n,
    'Quantity cannot be zero',
  ),
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
  roleId: string;
  employeeCode: string;
  hasPin: boolean;
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

function isQuantity(v: string) {
  return /^-?\d{1,9}(\.\d{1,3})?$/.test(v);
}
export const cashierPermissions: Permission[] = ['catalog.read', 'pos.access'];
export const pinSchema = z.string().regex(/^\d{6}$/, 'Use exactly six digits');
export const employeeSchema = z.object({
  name: short,
  employeeCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{1,20}$/, 'Use letters, digits, or hyphens')
    .transform((v) => v.toUpperCase()),
  roleId: z.uuid(),
  email: z.union([z.email().max(254), z.literal('')]).default(''),
  password: z.union([z.string().min(12).max(128), z.literal('')]).default(''),
  pin: pinSchema,
});
export const pinLoginSchema = z.object({
  employeeCode: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .transform((v) => v.toUpperCase()),
  pin: pinSchema,
});
export const approvalSchema = pinLoginSchema;
export const startShiftSchema = z.object({ requestId: z.uuid(), openingCash: money });
export const closeShiftSchema = z.object({
  requestId: z.uuid(),
  countedCash: money,
  notes: z.string().trim().max(500).default(''),
  approval: approvalSchema.optional(),
});
export const cashSchema = z.object({
  requestId: z.uuid(),
  amount: money.refine(
    (v) => /^\d+(\.\d{1,2})?$/.test(v) && toScaled(v, 2) > 0n,
    'Amount must be positive',
  ),
  direction: z.enum(['in', 'out']),
  reason: z.string().trim().min(1).max(300),
});
export const saleSchema = z.object({
  requestId: z.uuid(),
  shiftId: z.uuid(),
  lines: z
    .array(
      z.object({
        productId: z.uuid(),
        quantity: quantity.refine(
          (v) => isQuantity(v) && toScaled(v, 3) > 0n,
          'Quantity must be positive',
        ),
        expectedPrice: money,
        expectedTaxRate: money,
      }),
    )
    .min(1)
    .max(100)
    .refine(
      (lines) => new Set(lines.map((l) => l.productId)).size === lines.length,
      'Combine duplicate products into one line',
    ),
  discountPercent: money
    .refine(
      (v) => /^\d+(\.\d{1,2})?$/.test(v) && toScaled(v, 2) <= 10000n,
      'Discount cannot exceed 100%',
    )
    .default('0'),
  payment: z.object({ method: z.enum(['cash', 'card']), tendered: money }),
  approval: approvalSchema.optional(),
});
export function calculateLine(
  price: string,
  quantity: string,
  taxRate: string,
  discountPercent = '0',
) {
  const cents = toScaled(price, 2),
    units = toScaled(quantity, 3),
    taxBps = toScaled(taxRate, 2),
    discountBps = toScaled(discountPercent, 2);
  if (
    cents < 0n ||
    units <= 0n ||
    taxBps < 0n ||
    taxBps > 10000n ||
    discountBps < 0n ||
    discountBps > 10000n
  )
    throw new Error('Invalid sale values');
  const gross = (cents * units + 500n) / 1000n;
  const discount = (gross * discountBps + 5000n) / 10000n;
  const total = gross - discount;
  const divisor = 10000n + taxBps;
  const tax = (total * taxBps + divisor / 2n) / divisor;
  return {
    gross: fromScaled(gross, 2),
    discount: fromScaled(discount, 2),
    total: fromScaled(total, 2),
    tax: fromScaled(tax, 2),
  };
}
export type Role = { id: string; name: string; permissions: Permission[] };
export type Shift = {
  id: string;
  status: 'open' | 'closed';
  employeeName: string;
  deviceName: string;
  openingCash: string;
  expectedCash: string;
  countedCash: string | null;
  difference: string | null;
  openedAt: string;
  closedAt: string | null;
  notes: string;
  cashierId: string;
};
export type PosProduct = {
  source?: ProductInput['source'];
  image?: string;
  id: string;
  name: string;
  sku: string;
  category: string;
  unit: string;
  price: string;
  taxRate: string;
  stock: string;
  plu: string;
  barcodes: string[];
};
export type PosContext = {
  registered: boolean;
  blocked?: boolean;
  device?: { id: string; name: string };
  store?: Session['store'];
  operator?: { id: string; name: string; employeeCode: string; permissions: Permission[] };
  shift?: Shift | null;
  employees?: { name: string; employeeCode: string }[];
};
export type Receipt = {
  storeAddress?: string;
  storePhone?: string;
  businessNumber?: string;
  receiptFooter?: string;
  id: string;
  receiptNumber: string;
  createdAt: string;
  storeName: string;
  currency: string;
  timezone: string;
  cashierName: string;
  deviceName: string;
  shiftId: string;
  lines: {
    productId: string;
    name: string;
    category?: string;
    sku: string;
    unit: string;
    quantity: string;
    price: string;
    taxRate: string;
    gross: string;
    discount: string;
    tax: string;
    total: string;
  }[];
  subtotal: string;
  discount: string;
  tax: string;
  total: string;
  discountPercent: string;
  payment: { method: 'cash' | 'card'; tendered: string; change: string };
  approverName: string | null;
};

// Supplier purchase costs exclude tax; selling prices use the separate inclusive-tax model.
export const supplierSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{1,30}$/, 'Use letters, digits, or hyphens for the supplier code')
    .transform((v) => v.toUpperCase()),
  name: short,
  contactName: z.string().trim().max(120).default(''),
  email: z.union([z.email().max(254), z.literal('')]).default(''),
  phone: z.string().trim().max(40).default(''),
  address: z.string().trim().max(400).default(''),
  companyNumber: z.string().trim().max(100).default(''),
  paymentTerms: z.string().trim().max(200).default(''),
  notes: z.string().trim().max(1000).default(''),
});
const positiveQuantity = quantity.refine(
  (v) => /^\d{1,9}(\.\d{1,3})?$/.test(v) && toScaled(v, 3) > 0n,
  'Quantity must be positive',
);
const purchaseTax = money.refine(
  (v) => /^\d{1,9}(\.\d{1,2})?$/.test(v) && toScaled(v, 2) <= 10000n,
  'Tax must be between 0 and 100%',
);
const optionalDate = z
  .string()
  .refine(
    (v) =>
      v === '' ||
      (/^\d{4}-\d{2}-\d{2}$/.test(v) &&
        !Number.isNaN(Date.parse(v)) &&
        new Date(v).toISOString().slice(0, 10) === v),
    'Use a valid calendar date',
  );
export const purchasePaymentSchema = z.object({
  requestId: z.uuid(),
  version: z.number().int().positive(),
  status: z.enum(['unpaid', 'paid']),
  dueDate: optionalDate.default(''),
});
export const purchaseDraftSchema = z.object({
  supplierId: z.uuid(),
  supplierReference: z.string().trim().max(120).default(''),
  expectedDate: optionalDate.default(''),
  notes: z.string().trim().max(1000).default(''),
  lines: z
    .array(
      z.object({
        productId: z.uuid(),
        quantity: positiveQuantity,
        unitCost: money,
        taxRate: purchaseTax,
        sellingPrice: money.optional(),
      }),
    )
    .min(1)
    .max(100)
    .refine(
      (lines) => new Set(lines.map((l) => l.productId)).size === lines.length,
      'Combine duplicate products into one order line',
    ),
});
export const receiptInputSchema = z.object({
  requestId: z.uuid(),
  version: z.number().int().positive(),
  deliveryReference: z.string().trim().max(120).default(''),
  notes: z.string().trim().max(1000).default(''),
  lines: z
    .array(
      z.object({
        purchaseLineId: z.uuid(),
        quantity: positiveQuantity,
        unitCost: money.optional(),
        sellingPrice: money.optional(),
        expectedSellingPrice: money.optional(),
      }),
    )
    .min(1)
    .max(100)
    .refine(
      (lines) => new Set(lines.map((l) => l.purchaseLineId)).size === lines.length,
      'Each order line can only appear once',
    ),
});
export function calculatePurchaseLine(unitCost: string, quantity: string, taxRate: string) {
  const cents = toScaled(unitCost, 2),
    qty = toScaled(quantity, 3),
    bps = toScaled(taxRate, 2);
  if (cents < 0n || qty <= 0n || bps < 0n || bps > 10000n)
    throw new Error('Invalid purchase values');
  const subtotal = (cents * qty + 500n) / 1000n;
  const tax = (subtotal * bps + 5000n) / 10000n;
  return {
    subtotal: fromScaled(subtotal, 2),
    tax: fromScaled(tax, 2),
    total: fromScaled(subtotal + tax, 2),
  };
}
export type SupplierInput = z.infer<typeof supplierSchema>;
export type Supplier = SupplierInput & {
  id: string;
  active: boolean;
  version: number;
  createdAt: string;
};
export type PurchaseDraftInput = z.infer<typeof purchaseDraftSchema>;
export type ReceiptInput = z.infer<typeof receiptInputSchema>;
export type PurchaseStatus = 'draft' | 'ordered' | 'partially_received' | 'received' | 'cancelled';
export type PurchaseSummary = {
  id: string;
  number: string;
  supplierId: string;
  supplierName: string;
  status: PurchaseStatus;
  version: number;
  expectedDate: string;
  createdAt: string;
  orderedAt: string | null;
  subtotal: string;
  tax: string;
  total: string;
  supplierReference: string;
  notes: string;
  cancelReason: string;
  lineCount: number;
  receivedQuantity: string;
  orderedQuantity: string;
};
export type PurchaseLine = {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  orderedQuantity: string;
  receivedQuantity: string;
  unitCost: string;
  taxRate: string;
  subtotal: string;
  tax: string;
  total: string;
};
export type GoodsReceipt = {
  id: string;
  number: string;
  deliveryReference: string;
  notes: string;
  createdAt: string;
  actor: string;
  device: string;
  subtotal: string;
  tax: string;
  total: string;
  lines: {
    productId: string;
    productName: string;
    sku: string;
    unit: string;
    quantity: string;
    unitCost: string;
    taxRate: string;
    subtotal: string;
    tax: string;
    total: string;
  }[];
};
export type PurchaseDetail = PurchaseSummary & {
  supplier: Supplier;
  lines: PurchaseLine[];
  receipts: GoodsReceipt[];
};
