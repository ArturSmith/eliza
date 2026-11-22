import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import {
  receiptInputSchema,
  calculatePurchaseLine,
  toScaled,
  fromScaled,
  type Permission,
} from '@eliza/contracts';
import { audit, type Actor } from './operations.js';
import { hash } from './security.js';
export function wholeQuantity(unit: string, quantity: string) {
  if (['piece', 'pack', 'box'].includes(unit) && toScaled(quantity, 3) % 1000n !== 0n)
    throw new BadRequestException('This product requires a whole-number quantity.');
}
export async function finalizeUnpricedOrder(c: PoolClient, id: string, store: string) {
  await c.query(
    `UPDATE purchases p SET subtotal=g.subtotal,tax=g.tax,total=g.total
      FROM (SELECT purchase_id,sum(subtotal) AS subtotal,sum(tax) AS tax,sum(total) AS total
            FROM goods_receipts WHERE purchase_id=$1 AND store_id=$2 GROUP BY purchase_id) g
      WHERE p.id=$1 AND p.store_id=$2 AND p.status IN ('received','closed') AND g.purchase_id=p.id
        AND EXISTS(SELECT 1 FROM purchase_lines l WHERE l.purchase_id=p.id AND l.store_id=p.store_id AND l.unit_cost IS NULL)`,
    [id, store],
  );
}
export async function receivePurchase(
  c: PoolClient,
  actor: Actor & { permissions: Permission[] },
  id: string,
  b: z.infer<typeof receiptInputSchema>,
) {
  const store = actor.storeId;
  const p = (
    await c.query('SELECT * FROM purchases WHERE id=$1 AND store_id=$2 FOR UPDATE', [id, store])
  ).rows[0];
  if (!p) throw new NotFoundException('Order not found.');
  if (p.version !== b.version)
    throw new ConflictException('Order changed. Refresh before continuing.');
  if (!['ordered', 'partially_received'].includes(p.status))
    throw new ConflictException('Only placed orders can be received.');
  if (
    (b.paymentStatus !== undefined || b.paymentDueDate !== undefined) &&
    !actor.permissions.includes('purchases.write')
  )
    throw new ForbiddenException('You cannot update payment status.');
  const orderLines = (
    await c.query('SELECT * FROM purchase_lines WHERE purchase_id=$1 ORDER BY product_id', [id])
  ).rows;
  const received = [];
  let subtotal = 0n,
    tax = 0n;
  for (const line of orderLines) {
    const entry = b.lines.find((l) => l.purchaseLineId === line.id);
    if (!entry) continue;
    const product = (
      await c.query(
        'SELECT * FROM products WHERE id=$1 AND store_id=$2 AND base_product_id IS NULL FOR UPDATE',
        [line.product_id, store],
      )
    ).rows[0];
    if (!product?.active)
      throw new BadRequestException('Activate the product before receiving it.');
    wholeQuantity(line.unit, entry.quantity);
    const expiryBatches = entry.expiryBatches ?? [
      { quantity: entry.quantity, expiryDate: entry.expiryDate ?? null },
    ];
    for (const batch of expiryBatches) wholeQuantity(line.unit, batch.quantity);
    if (
      toScaled(entry.quantity, 3) + toScaled(line.received_quantity, 3) >
      toScaled(line.ordered_quantity, 3)
    )
      throw new BadRequestException('Delivery exceeds the remaining order quantity.');
    const cost = entry.unitCost ?? line.unit_cost;
    if (cost === null)
      throw new BadRequestException('Enter the actual purchase cost for every received product.');
    const taxRate = entry.taxRate ?? line.tax_rate;
    if (
      toScaled(taxRate, 2) !== toScaled(line.tax_rate, 2) &&
      !actor.permissions.includes('purchases.cost')
    )
      throw new ForbiddenException('You cannot change receiving costs.');
    if (entry.sellingPrice !== undefined) {
      if (!actor.permissions.includes('catalog.write'))
        throw new BadRequestException('You cannot change selling prices.');
      if (
        entry.expectedSellingPrice === undefined ||
        (entry.expectedSellingPrice == null || product.price == null
          ? entry.expectedSellingPrice !== product.price
          : toScaled(entry.expectedSellingPrice, 2) !== toScaled(product.price, 2))
      )
        throw new ConflictException(
          'The selling price changed. Refresh the order and review the current price.',
        );
    }
    if (cost !== line.unit_cost && !actor.permissions.includes('purchases.cost'))
      throw new BadRequestException('You cannot change receiving costs.');
    const totals = calculatePurchaseLine(cost, entry.quantity, taxRate);
    subtotal += toScaled(totals.subtotal, 2);
    tax += toScaled(totals.tax, 2);
    received.push({ line, entry, cost, taxRate, totals, product, expiryBatches });
  }
  if (received.length !== b.lines.length)
    throw new BadRequestException('Delivery contains a line outside this order.');
  if (subtotal + tax > 99999999999n) throw new BadRequestException('Delivery total is too large.');
  const receipt = (
    await c.query(
      `INSERT INTO goods_receipts(store_id,purchase_id,number,delivery_reference,notes,employee_id,device_id,subtotal,tax,total) VALUES($1,$2,'GR-'||lpad(nextval('goods_receipt_number_sequence')::text,6,'0'),$3,$4,$5,$6,$7,$8,$9) RETURNING id,number`,
      [
        store,
        id,
        b.deliveryReference,
        b.notes,
        actor.employeeId,
        actor.deviceId,
        fromScaled(subtotal, 2),
        fromScaled(tax, 2),
        fromScaled(subtotal + tax, 2),
      ],
    )
  ).rows[0];
  for (const { line, entry, cost, taxRate, totals, product, expiryBatches } of received) {
    const receiptLine = (
      await c.query(
        'INSERT INTO goods_receipt_lines(store_id,receipt_id,purchase_line_id,product_id,product_name,sku,unit,quantity,unit_cost,tax_rate,subtotal,tax,total,expiry_date,expiry_batches) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id',
        [
          store,
          receipt.id,
          line.id,
          product.id,
          line.product_name,
          line.sku,
          line.unit,
          entry.quantity,
          cost,
          taxRate,
          totals.subtotal,
          totals.tax,
          totals.total,
          expiryBatches.every(
            (b) => (b.expiryDate ?? null) === (expiryBatches[0].expiryDate ?? null),
          )
            ? (expiryBatches[0].expiryDate ?? null)
            : null,
          JSON.stringify(
            expiryBatches.map((b) => ({
              quantity: b.quantity,
              expiryDate: b.expiryDate ?? null,
            })),
          ),
        ],
      )
    ).rows[0];
    for (const batch of expiryBatches)
      await c.query(
        "INSERT INTO stock_batches(store_id,product_id,receipt_line_id,expiry_date,quantity,unit_cost,cost_source) VALUES($1,$2,$3,$4,$5,$6,'receipt')",
        [store, product.id, receiptLine.id, batch.expiryDate ?? null, batch.quantity, cost],
      );
    const balance = fromScaled(toScaled(product.stock, 3) + toScaled(entry.quantity, 3), 3);
    await c.query(
      "UPDATE products SET stock=$2,cost=$3,price=COALESCE($4,price),regular_price=CASE WHEN $4::numeric IS NULL THEN regular_price ELSE NULL END,price_kind=CASE WHEN $4::numeric IS NULL THEN price_kind ELSE 'standard' END WHERE id=$1",
      [product.id, balance, cost, entry.sellingPrice ?? null],
    );
    await c.query('UPDATE purchase_lines SET received_quantity=received_quantity+$2 WHERE id=$1', [
      line.id,
      entry.quantity,
    ]);
    await c.query(
      "INSERT INTO movements(store_id,product_id,employee_id,device_id,quantity,balance,reason,notes,request_id,request_hash,purchase_id,goods_receipt_id) VALUES($1,$2,$3,$4,$5,$6,'received',$7,$8,$9,$10,$11)",
      [
        store,
        product.id,
        actor.employeeId,
        actor.deviceId,
        entry.quantity,
        balance,
        receipt.number + ' ' + b.deliveryReference,
        randomUUID(),
        hash(JSON.stringify(entry)),
        id,
        receipt.id,
      ],
    );
  }
  await c.query(
    "UPDATE purchases SET version=version+1,status=CASE WHEN EXISTS(SELECT 1 FROM purchase_lines WHERE purchase_id=$1 AND received_quantity<ordered_quantity) THEN 'partially_received' ELSE 'received' END WHERE id=$1",
    [id],
  );
  await finalizeUnpricedOrder(c, id, store);
  if (b.paymentStatus !== undefined) {
    const current = (
      await c.query(
        'SELECT total,payment_status,payment_due_date,paid_at FROM purchases WHERE id=$1 AND store_id=$2',
        [id, store],
      )
    ).rows[0];
    if (b.paymentStatus === 'paid' && current.total === null)
      throw new BadRequestException('Complete delivery costs before marking this order paid.');
    await c.query(
      "UPDATE purchases SET payment_status=$2,payment_due_date=$3,paid_at=CASE WHEN $2='paid' THEN COALESCE(paid_at,now()) ELSE NULL END WHERE id=$1 AND store_id=$4",
      [id, b.paymentStatus, b.paymentDueDate || null, store],
    );
    await audit(
      c,
      { storeId: store, employeeId: actor.employeeId, deviceId: actor.deviceId },
      'Purchase payment updated',
      id,
      {
        before: {
          status: current.payment_status,
          dueDate: current.payment_due_date,
          paidAt: current.paid_at,
        },
        after: { status: b.paymentStatus, dueDate: b.paymentDueDate || null },
      },
    );
  }
  await audit(
    c,
    { storeId: store, employeeId: actor.employeeId, deviceId: actor.deviceId },
    'Purchase received',
    id,
    {
      receiptId: receipt.id,
      number: receipt.number,
      lines: received.map(({ line, entry, cost, product, expiryBatches }) => ({
        productId: product.id,
        quantity: entry.quantity,
        previousCost: product.cost,
        cost,
        orderedCost: line.unit_cost,
        expiryBatches,
        previousSellingPrice: product.price,
        sellingPrice: entry.sellingPrice ?? product.price,
      })),
    },
  );
  return { purchaseId: id, receiptId: receipt.id, receiptNumber: receipt.number };
}
