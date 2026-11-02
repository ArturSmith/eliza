import { calculateLine, fromScaled, toScaled, type Product } from '@eliza/contracts';

/** Catalog price preview, using the same tax rounding as checkout; not batch profitability. */
export function productPriceMargin(product: Pick<Product, 'price' | 'cost' | 'taxRate'>) {
  if (product.price == null || product.cost == null) return null;
  const line = calculateLine(product.price, '1', product.taxRate);
  const net = toScaled(line.total, 2) - toScaled(line.tax, 2);
  if (net <= 0n) return null;
  const profit = net - toScaled(product.cost, 2);
  const absolute = profit < 0n ? -profit : profit;
  const percent = ((absolute * 10000n + net / 2n) / net) * (profit < 0n ? -1n : 1n);
  return { percent: fromScaled(percent, 2), profit: fromScaled(profit, 2) };
}
