import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  numeric,
  jsonb,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
const id = () => uuid('id').primaryKey().defaultRandom();
const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
export const organizations = pgTable('organizations', { id: id(), name: text('name').notNull() });
export const stores = pgTable('stores', {
  id: id(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id),
  name: text('name').notNull(),
  currency: text('currency').notNull(),
  timezone: text('timezone').notNull(),
});
export const roles = pgTable('roles', {
  id: id(),
  storeId: uuid('store_id')
    .notNull()
    .references(() => stores.id),
  name: text('name').notNull(),
  permissions: jsonb('permissions').$type<string[]>().notNull(),
});
export const employees = pgTable('employees', {
  id: id(),
  storeId: uuid('store_id')
    .notNull()
    .references(() => stores.id),
  roleId: uuid('role_id')
    .notNull()
    .references(() => roles.id),
  name: text('name').notNull(),
  email: text('email').unique(),
  employeeCode: text('employee_code')
    .notNull()
    .default(sql`('E-' || substring(replace(gen_random_uuid()::text,'-','') from 1 for 12))`),
  pinHash: text('pin_hash'),
  passwordHash: text('password_hash').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: created(),
});
export const devices = pgTable('devices', {
  id: id(),
  storeId: uuid('store_id')
    .notNull()
    .references(() => stores.id),
  name: text('name').notNull(),
  type: text('type').notNull().default('management'),
  tokenHash: text('token_hash').notNull().unique(),
  active: boolean('active').notNull().default(true),
  createdAt: created(),
});
export const sessions = pgTable('sessions', {
  id: id(),
  tokenHash: text('token_hash').notNull().unique(),
  employeeId: uuid('employee_id')
    .notNull()
    .references(() => employees.id),
  deviceId: uuid('device_id')
    .notNull()
    .references(() => devices.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});
export const products = pgTable(
  'products',
  {
    id: id(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id),
    name: text('name').notNull(),
    sku: text('sku').notNull(),
    category: text('category').notNull(),
    unit: text('unit').notNull(),
    taxRate: numeric('tax_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    price: numeric('price', { precision: 14, scale: 2 }).notNull(),
    cost: numeric('cost', { precision: 14, scale: 2 }).notNull(),
    minStock: numeric('min_stock', { precision: 15, scale: 3 }).notNull(),
    stock: numeric('stock', { precision: 15, scale: 3 }).notNull().default('0'),
    plu: text('plu'),
    active: boolean('active').notNull().default(true),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex('product_store_sku').on(t.storeId, t.sku),
    uniqueIndex('product_store_plu').on(t.storeId, t.plu),
  ],
);
export const barcodes = pgTable(
  'barcodes',
  {
    id: id(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    value: text('value').notNull(),
  },
  (t) => [uniqueIndex('barcode_store_value').on(t.storeId, t.value)],
);
export const movements = pgTable(
  'movements',
  {
    id: id(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id),
    quantity: numeric('quantity', { precision: 15, scale: 3 }).notNull(),
    balance: numeric('balance', { precision: 15, scale: 3 }).notNull(),
    reason: text('reason').notNull(),
    notes: text('notes').notNull(),
    requestId: uuid('request_id').notNull(),
    requestHash: text('request_hash').notNull(),
    createdAt: created(),
  },
  (t) => [uniqueIndex('movement_request').on(t.storeId, t.requestId)],
);
export const audits = pgTable('audits', {
  id: id(),
  storeId: uuid('store_id')
    .notNull()
    .references(() => stores.id),
  employeeId: uuid('employee_id')
    .notNull()
    .references(() => employees.id),
  deviceId: uuid('device_id')
    .notNull()
    .references(() => devices.id),
  action: text('action').notNull(),
  entityId: uuid('entity_id').notNull(),
  details: jsonb('details').notNull(),
  createdAt: created(),
});
