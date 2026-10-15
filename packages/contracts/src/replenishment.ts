import { fromScaled, toScaled } from './index.js';

export type DemandStatus = 'insufficient_history' | 'no_sales' | 'slow' | 'selling';
export type ReplenishmentStatus =
  'insufficient_history' | 'no_demand' | 'needs_review' | 'order_now' | 'order_later' | 'covered';
export type ReplenishmentInput = {
  today: string;
  unit: string;
  sold: string;
  observedDays: number;
  available: string;
  incoming: { quantity: string; date: string }[];
  uncertainIncoming: string;
  leadDays: number | null;
  packSize: string;
  minimumOrder: string;
  reviewDays: number;
  safetyDays: number;
  stockReconciled: boolean;
  stockLots?: { quantity: string; expiry: string | null }[];
};
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
const addDays = (date: string, days: number) =>
  new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
const ceil = (n: bigint, d: bigint) => (n + d - 1n) / d;

/** A transparent sales-based planning estimate, never a prediction of unconstrained demand. */
export function planReplenishment(input: ReplenishmentInput) {
  const sold = toScaled(input.sold, 3),
    available = toScaled(input.available, 3);
  const warnings: string[] = [];
  let demandStatus: DemandStatus =
    input.observedDays < 14 ? 'insufficient_history' : sold === 0n ? 'no_sales' : 'selling';
  const denominator = BigInt(Math.max(1, input.observedDays));
  const dailySales = input.observedDays
    ? fromScaled(((sold * 1000n) / denominator + 500n) / 1000n, 3)
    : null;
  const daysOfStock = sold > 0n ? Number((available * denominator * 10n) / sold) / 10 : null;
  if (demandStatus === 'selling' && daysOfStock !== null && daysOfStock > 60) demandStatus = 'slow';
  const base = { demandStatus, dailySales, daysOfStock, warnings };
  const result = (
    status: ReplenishmentStatus,
    quantity: string | null = null,
    orderBy: string | null = null,
    targetStock: string | null = null,
  ) => ({ ...base, status, quantity, orderBy, targetStock });
  if (input.observedDays < 14) return result('insufficient_history');
  if (!input.stockReconciled) {
    warnings.push('stock_mismatch');
    return result('needs_review');
  }
  if (sold === 0n) {
    if (available === 0n) {
      warnings.push('out_of_stock');
      return result('needs_review');
    }
    return result('no_demand', '0.000');
  }
  if (input.leadDays === null) warnings.push('missing_lead_time');
  else if (!Number.isInteger(input.leadDays) || input.leadDays < 0 || input.leadDays > 365)
    warnings.push('invalid_lead_time');
  if (toScaled(input.uncertainIncoming, 3) > 0n) warnings.push('uncertain_incoming');
  const whole = ['piece', 'pack', 'box'].includes(input.unit);
  const pack = toScaled(input.packSize, 3);
  if (pack <= 0n || (whole && pack % 1000n !== 0n)) warnings.push('invalid_pack_size');
  if (warnings.length) return result('needs_review');
  const lead = input.leadDays!;
  const horizon = lead + input.reviewDays + input.safetyDays;
  const target = ceil(sold * BigInt(horizon), denominator);
  const dated = input.incoming.filter((i) => daysBetween(input.today, i.date) >= 0);
  const timely = dated
    .filter((i) => daysBetween(input.today, i.date) <= horizon)
    .reduce((sum, i) => sum + toScaled(i.quantity, 3), 0n);
  const lots = (input.stockLots ?? [{ quantity: input.available, expiry: null }]).map((l) => ({
    balance: toScaled(l.quantity, 3) * denominator,
    expiry: l.expiry,
  }));
  if (lots.some((l) => l.expiry !== null && daysBetween(input.today, l.expiry) <= horizon))
    warnings.push('upcoming_expiry');
  let shortageDay: number | null = null;
  let expiringWaste = 0n;
  for (let day = 0; day <= Math.max(horizon, 365); day++) {
    for (const lot of lots)
      if (lot.expiry !== null && daysBetween(input.today, lot.expiry) <= day) {
        if (day < horizon) expiringWaste += lot.balance;
        lot.balance = 0n;
      }
    for (const incoming of dated)
      if (daysBetween(input.today, incoming.date) === day)
        lots.push({ balance: toScaled(incoming.quantity, 3) * denominator, expiry: null });
    let remaining = sold;
    lots.sort((a, b) =>
      a.expiry === b.expiry
        ? 0
        : a.expiry === null
          ? 1
          : b.expiry === null
            ? -1
            : a.expiry.localeCompare(b.expiry),
    );
    for (const lot of lots) {
      const take = lot.balance < remaining ? lot.balance : remaining;
      lot.balance -= take;
      remaining -= take;
      if (remaining === 0n) break;
    }
    if (remaining > 0n && shortageDay === null) shortageDay = day;
    if (day >= horizon && shortageDay !== null) break;
  }
  const effectiveTarget = target + ceil(expiringWaste, denominator);
  const shortage = effectiveTarget > available + timely ? effectiveTarget - available - timely : 0n;
  let quantity = shortage;
  if (quantity > 0n) {
    const minimum = toScaled(input.minimumOrder, 3);
    if (quantity < minimum) quantity = minimum;
    quantity = ceil(quantity, pack) * pack;
    if (whole) quantity = ceil(quantity, 1000n) * 1000n;
  }
  const dueIn = shortageDay === null ? null : Math.max(0, shortageDay - lead - input.safetyDays);
  const orderBy = dueIn === null ? null : addDays(input.today, dueIn);
  // A known arrival can still leave an earlier supply gap. Surface that gap even
  // when horizon totals suggest no additional stock is needed; avoid double ordering.
  if (shortageDay !== null && shortageDay < lead && quantity > 0n) warnings.push('arrival_gap');
  if (quantity === 0n && shortageDay !== null && shortageDay < horizon) {
    warnings.push('arrival_gap');
    return result('needs_review', null, orderBy, fromScaled(effectiveTarget, 3));
  }
  if (quantity === 0n) return result('covered', '0.000', orderBy, fromScaled(effectiveTarget, 3));
  return result(
    dueIn === 0 ? 'order_now' : 'order_later',
    fromScaled(quantity, 3),
    orderBy,
    fromScaled(effectiveTarget, 3),
  );
}
