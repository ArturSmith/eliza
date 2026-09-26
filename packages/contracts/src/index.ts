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
  'analytics.view',
  'analytics.margin',
  'expenses.read',
  'expenses.manage',
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
  currency: z.enum(['NOK', 'EUR', 'USD', 'GBP', 'SEK', 'DKK', 'RUB']),
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
  device: { id: string; name: string; type: 'management' | 'pos' | 'price_tags' };
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
export type Device = {
  id: string;
  name: string;
  type: 'management' | 'pos' | 'price_tags';
  active: boolean;
  createdAt: string;
};
export type Employee = {
  id: string;
  name: string;
  email: string;
  role: string;
  roleId: string;
  employeeCode: string;
  hasPin: boolean;
  roleIds: string[];
  roles: string[];
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
  roleIds: z.array(z.uuid()).min(1).optional(),
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
  contactPhone: z.string().trim().max(40).default(''),
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
  documentDate: optionalDate.default(''),
  buyerName: z.string().trim().max(200).default(''),
  buyerDetails: z.string().trim().max(500).default(''),
  driverName: z.string().trim().max(200).default(''),
  driverPhone: z.string().trim().max(40).default(''),
  goodsNumber: z.string().trim().max(120).default(''),
  buyerTaxNumber: z.string().trim().max(120).default(''),
  grossWeight: z.string().trim().max(80).default(''),
  documentVat: z.string().trim().max(80).default(''),
  returnAmount: z.string().trim().max(80).default(''),
  documentComment: z.string().trim().max(1000).default(''),
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
        expiryDate: z.iso.date().nullable().optional(),
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

// A supplier's quoted offer for a product. Costs exclude tax, matching purchase_lines.
export const supplierProductSchema = z.object({
  supplierId: z.uuid(),
  productId: z.uuid(),
  supplierSku: z.string().trim().max(60).default(''),
  packSize: positiveQuantity.default('1'),
  packCost: money,
  leadTimeDays: z.number().int().min(0).max(365).nullable().default(null),
  minimumOrder: z.union([positiveQuantity, z.null()]).default(null),
  notes: z.string().trim().max(500).default(''),
  active: z.boolean().default(true),
});
export type SupplierProductInput = z.infer<typeof supplierProductSchema>;
export type SupplierProduct = {
  id: string;
  supplierId: string;
  supplierName: string;
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  supplierSku: string;
  packSize: string;
  packCost: string;
  unitCost: string;
  leadTimeDays: number | null;
  minimumOrder: string | null;
  notes: string;
  active: boolean;
  version: number;
  lastPaidCost: string | null;
  lastDeliveredAt: string | null;
  deliveries: number;
};

/**
 * Cost of one selling unit, derived from a pack price.
 *
 * Comparing pack prices directly would rank suppliers wrongly whenever their
 * pack sizes differ: a 250.00 case of 12 is cheaper per jar than a 22.00 single,
 * even though 250 > 22. Every supplier comparison must rank on this value.
 */
export function unitCost(packCost: string, packSize: string): string | null {
  const cost = toScaled(packCost, 2);
  const size = toScaled(packSize, 3);
  if (size <= 0n) return null;
  // Scale to four decimals so small-unit items (grams, millilitres) do not
  // collapse to zero. Rounding must happen at the final scale, so the half
  // adjustment is applied in one division rather than two.
  return fromScaled((cost * 100000n + size / 2n) / size, 4);
}

/**
 * Ranks supplier offers for one product, cheapest first.
 *
 * Offers whose unit cost cannot be determined are returned last and flagged
 * rather than treated as free, so an incomplete row can never win a comparison.
 */
export function compareOffers<T extends { packCost: string; packSize: string; active: boolean }>(
  offers: T[],
): (T & { unitCost: string | null; cheapest: boolean; premiumPercent: number | null })[] {
  const priced = offers.map((offer) => ({
    ...offer,
    unitCost: unitCost(offer.packCost, offer.packSize),
  }));
  const comparable = priced.filter((o) => o.active && o.unitCost !== null);
  comparable.sort((a, b) => Number(toScaled(a.unitCost!, 4) - toScaled(b.unitCost!, 4)));
  const best = comparable.length ? toScaled(comparable[0].unitCost!, 4) : null;
  return priced
    .map((offer) => {
      const value = offer.unitCost === null ? null : toScaled(offer.unitCost, 4);
      return {
        ...offer,
        cheapest: best !== null && value !== null && value === best && offer.active,
        premiumPercent:
          best === null || value === null || best === 0n
            ? null
            : Number(((value - best) * 10000n) / best) / 100,
      };
    })
    .sort((a, b) => {
      if (a.unitCost === null || !a.active) return 1;
      if (b.unitCost === null || !b.active) return -1;
      return Number(toScaled(a.unitCost, 4) - toScaled(b.unitCost, 4));
    });
}
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
    expiryDate?: string | null;
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

const nonnegativeQuantity = quantity.refine(
  (value) => isQuantity(value) && toScaled(value, 3) >= 0n,
  'Quantity cannot be negative',
);
export const shoppingListCreateSchema = z.object({
  requestId: z.uuid(),
  name: short,
  notes: z.string().trim().max(1000).default(''),
});
export const shoppingListSaveSchema = shoppingListCreateSchema.extend({
  sections: z
    .array(z.object({ id: z.uuid(), name: z.string().trim().min(1).max(120) }))
    .max(100)
    .refine((rows) => new Set(rows.map((row) => row.id)).size === rows.length, 'Duplicate sections')
    .default([]),
  version: z.number().int().positive(),
  lines: z
    .array(
      z
        .object({
          sectionId: z.uuid().nullable().default(null),
          productId: z.uuid().nullable().default(null),
          label: z.string().trim().max(120).default(''),
          target: nonnegativeQuantity,
          quantity: nonnegativeQuantity,
          supplierId: z.uuid().nullable(),
          unitCost: money,
          taxRate: purchaseTax,
          notes: z.string().trim().max(300).default(''),
        })
        .refine(
          (line) => (line.productId !== null) !== (line.label !== ''),
          'Give either a catalogue product or a free-text item name.',
        )
        .refine(
          (line) => line.productId !== null || line.supplierId === null,
          'Free-text items cannot be assigned to a supplier.',
        ),
    )
    .max(500)
    .refine((lines) => {
      const ids = lines.map((line) => line.productId).filter((id) => id !== null);
      return new Set(ids).size === ids.length;
    }, 'Combine duplicate products into one line'),
});
export const shoppingListConvertSchema = z.object({
  requestId: z.uuid(),
  version: z.number().int().positive(),
  lineIds: z
    .array(z.uuid())
    .min(1)
    .max(500)
    .refine((ids) => new Set(ids).size === ids.length),
});
export function suggestedOrderQuantity(
  target: string,
  stock: string,
  incoming: string,
  drafts: string,
  unit: string,
) {
  let amount =
    toScaled(target, 3) - toScaled(stock, 3) - toScaled(incoming, 3) - toScaled(drafts, 3);
  if (amount < 0n) amount = 0n;
  if (['piece', 'pack', 'box'].includes(unit)) amount = ((amount + 999n) / 1000n) * 1000n;
  return fromScaled(amount, 3);
}
export function initialReorderTarget(minimum: string, unit: string) {
  const doubled = toScaled(minimum, 3) * 2n;
  return suggestedOrderQuantity(
    fromScaled(doubled > 1000n ? doubled : 1000n, 3),
    '0',
    '0',
    '0',
    unit,
  );
}
export type ShoppingListLine = {
  sectionId?: string | null;
  id: string;
  productId: string | null;
  label: string;
  name: string;
  sku: string;
  unit: string;
  active: boolean;
  stock: string;
  minStock: string;
  incoming: string;
  drafts: string;
  target: string;
  quantity: string;
  unitCost: string;
  taxRate: string;
  notes: string;
  supplierId: string | null;
  supplierName: string | null;
  supplierActive: boolean | null;
  purchaseId: string | null;
  purchaseNumber: string | null;
  purchaseStatus: string | null;
};
export type ShoppingList = {
  sections: { id: string; name: string }[];
  id: string;
  name: string;
  notes: string;
  version: number;
  createdAt: string;
  lines: ShoppingListLine[];
};
export type ShoppingListSummary = Omit<ShoppingList, 'lines'> & {
  productCount: number;
  convertedCount: number;
};

export const tagDesignSchema = z.object({
  regularWidthMm: z.number().int().min(45).max(120),
  regularHeightMm: z.number().int().min(35).max(90),
  weightWidthMm: z.number().int().min(70).max(120),
  weightHeightMm: z.number().int().min(45).max(100),
  gapMm: z.number().int().min(0).max(12),
  nameFontPt: z.number().int().min(9).max(18),
  priceFontPt: z.number().int().min(14).max(32),
  showStoreName: z.boolean(),
  showSku: z.boolean(),
  showUnit: z.boolean(),
  showBarcodeNumber: z.boolean(),
  showWeightUnitPrice: z.boolean(),
  showPackagePrice: z.boolean(),
});
export type TagDesign = z.infer<typeof tagDesignSchema>;

export const scaleBarcodeSchema = z
  .object({
    enabled: z.boolean(),
    prefix: z.string().regex(/^2[0-9]$/),
    productDigits: z.number().int().min(1).max(8),
    mode: z.enum(['weight', 'price']),
    decimals: z.number().int().min(0).max(3),
  })
  .refine(
    (value) => value.mode !== 'price' || value.decimals === 2,
    'Price labels must use two decimal places.',
  );
export type ScaleBarcodeSettings = z.infer<typeof scaleBarcodeSchema>;
export function decodeScaleBarcode(
  code: string,
  settings: ScaleBarcodeSettings,
): { productCode: string; quantity?: string; price?: string } | null {
  if (!settings.enabled || !code.startsWith(settings.prefix) || !/^\d+$/.test(code)) return null;
  if (!/^\d{13}$/.test(code)) throw new Error('Scale barcode must contain 13 digits.');
  const sum = [...code.slice(0, 12)].reduce(
    (sum, digit, index) => sum + Number(digit) * (index % 2 ? 3 : 1),
    0,
  );
  if ((10 - (sum % 10)) % 10 !== Number(code[12]))
    throw new Error('Scale barcode checksum is invalid.');
  const productCode = code.slice(2, 2 + settings.productDigits);
  const raw = BigInt(code.slice(2 + settings.productDigits, 12));
  if (raw === 0n) throw new Error('Scale label quantity or price must be greater than zero.');
  if (settings.mode === 'price') return { productCode, price: fromScaled(raw, 2) };
  return { productCode, quantity: fromScaled(raw * 10n ** BigInt(3 - settings.decimals), 3) };
}
/** Build an in-store weight label using the same format the register decodes. */
export function encodeScaleBarcode(
  productCode: string,
  quantity: string,
  settings: ScaleBarcodeSettings,
): string {
  const profile = scaleBarcodeSchema.parse(settings);
  if (!profile.enabled || profile.mode !== 'weight')
    throw new Error('Enable weight barcodes in store settings first.');
  if (!/^\d+$/.test(productCode)) throw new Error('Product PLU must contain only digits.');
  const normalizedCode = BigInt(productCode).toString();
  if (normalizedCode.length > profile.productDigits)
    throw new Error('Product PLU does not fit the configured barcode length.');
  const grams = toScaled(quantity, 3);
  if (grams <= 0n) throw new Error('Weight must be greater than zero.');
  const unit = 10n ** BigInt(3 - profile.decimals);
  if (grams % unit !== 0n)
    throw new Error('Weight has more decimal places than the barcode settings allow.');
  const valueDigits = 10 - profile.productDigits;
  const encodedWeight = grams / unit;
  if (encodedWeight >= 10n ** BigInt(valueDigits))
    throw new Error('Weight does not fit the configured barcode length.');
  const body =
    profile.prefix +
    normalizedCode.padStart(profile.productDigits, '0') +
    encodedWeight.toString().padStart(valueDigits, '0');
  const sum = [...body].reduce(
    (total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1),
    0,
  );
  return body + ((10 - (sum % 10)) % 10);
}

export function scalePriceQuantity(price: string, unitPrice: string): string {
  const cents = toScaled(price, 2),
    perKg = toScaled(unitPrice, 2);
  if (perKg <= 0n) throw new Error('Set a positive selling price before scanning a price label.');
  const grams = (cents * 1000n + perKg / 2n) / perKg;
  if (grams <= 0n || (grams * perKg + 500n) / 1000n !== cents)
    throw new Error(
      'Scale price cannot be matched to the current selling price. Weigh the product and enter its weight.',
    );
  return fromScaled(grams, 3);
}

export function productSku(name: string, plu: string): string {
  const suffix = plu ? '-' + plu : '';
  const stem = name.trim().replace(/\s+/gu, '-');
  return stem.slice(0, 120 - suffix.length) + suffix;
}
export * from './analytics.js';
export * from './extraction.js';
export * from './scanned-document.js';

/** Markup is added once to cost; the result is already VAT-inclusive. */
export const defaultMarkupSchema = z
  .string()
  .regex(/^\d{1,4}(\.\d{1,2})?$/, 'Use a markup between 0 and 1000 with at most two decimal places')
  .refine(
    (value) => Number(value) <= 1000,
    'Use a markup between 0 and 1000 with at most two decimal places',
  );

export function suggestSellingPrice(cost: string, markup: string): string {
  if (!money.safeParse(cost).success || !defaultMarkupSchema.safeParse(markup).success) return '';
  const cents = (toScaled(cost, 2) * (10000n + toScaled(markup, 2)) + 5000n) / 10000n;
  const result = fromScaled(cents, 2);
  return money.safeParse(result).success ? result : '';
}

export const expenseSchema = z.object({
  date: z.iso.date(),
  description: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(100),
  amount: money.refine((value) => Number(value) > 0, 'Amount must be greater than zero'),
  paymentMethod: z.enum(['cash', 'card', 'bank', 'other']),
  payee: z.string().trim().max(200).default(''),
  reference: z.string().trim().max(200).default(''),
  notes: z.string().trim().max(2000).default(''),
});
export type ExpenseInput = z.infer<typeof expenseSchema>;
export type Expense = ExpenseInput & { id: string; version: number; createdAt: string };
