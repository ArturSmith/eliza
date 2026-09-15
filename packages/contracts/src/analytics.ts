import { toScaled, fromScaled } from './index.js';

/** Analytics period selector. */
export type Period = 'today' | 'week' | 'month' | 'custom';
export type DateRange = { from: string; to: string };
export type Severity = 'info' | 'attention' | 'important' | 'critical';

const DAY = 86400000;
const iso = (time: number) => new Date(time).toISOString().slice(0, 10);
const parseDay = (day: string) => Date.parse(day + 'T00:00:00Z');

/** Calendar date in the store timezone, so a business day never depends on UTC midnight. */
export function storeToday(now: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Hour (00-23) in the store timezone. */
export function storeHour(now: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hour12: false,
  }).format(now);
}

export function addDays(day: string, amount: number) {
  return iso(parseDay(day) + amount * DAY);
}

export function daysBetween(from: string, to: string) {
  return Math.round((parseDay(to) - parseDay(from)) / DAY) + 1;
}

/** ISO weekday, 1 = Monday. */
export function weekday(day: string) {
  return ((new Date(parseDay(day)).getUTCDay() + 6) % 7) + 1;
}

export function startOfWeek(day: string) {
  return addDays(day, -(weekday(day) - 1));
}

export function startOfMonth(day: string) {
  return day.slice(0, 8) + '01';
}

export function endOfMonth(day: string) {
  const date = new Date(parseDay(startOfMonth(day)));
  date.setUTCMonth(date.getUTCMonth() + 1);
  return iso(date.getTime() - DAY);
}

/** The range a period covers, ending today because future days hold no sales. */
export function periodRange(period: Period, today: string): DateRange {
  if (period === 'today') return { from: today, to: today };
  if (period === 'week') return { from: startOfWeek(today), to: today };
  return { from: startOfMonth(today), to: today };
}

export type Comparison = {
  key: string;
  label: string;
  range: DateRange;
  /** True when the comparison window is shorter than the current one. */
  partial?: boolean;
};

/**
 * Comparable baselines for a period. A part-day today is compared against the same
 * elapsed part of earlier days, never against those days in full.
 */
export function comparisons(period: Period, range: DateRange): Comparison[] {
  const length = daysBetween(range.from, range.to);
  if (period === 'today') {
    const previous = addDays(range.from, -1);
    const lastWeek = addDays(range.from, -7);
    return [
      { key: 'yesterday', label: 'Yesterday', range: { from: previous, to: previous } },
      {
        key: 'sameWeekday',
        label: 'Same weekday last week',
        range: { from: lastWeek, to: lastWeek },
      },
      {
        key: 'weekdayAverage',
        label: 'Average of the last 4 same weekdays',
        range: { from: addDays(range.from, -28), to: addDays(range.from, -1) },
      },
    ];
  }
  const previousTo = addDays(range.from, -1);
  const previous = {
    key: 'previous',
    label: period === 'week' ? 'Previous week' : 'Previous month',
    range: { from: addDays(previousTo, -(length - 1)), to: previousTo },
  };
  if (period === 'week')
    return [
      previous,
      {
        key: 'fourWeekAverage',
        label: '4-week average',
        range: { from: addDays(range.from, -28), to: previousTo },
      },
    ];
  const lastYearFrom = shiftYear(range.from, -1);
  return [
    previous,
    {
      key: 'lastYear',
      label: 'Same month last year',
      range: { from: lastYearFrom, to: addDays(lastYearFrom, length - 1) },
    },
  ];
}

export function shiftYear(day: string, amount: number) {
  const date = new Date(parseDay(day));
  date.setUTCFullYear(date.getUTCFullYear() + amount);
  return iso(date.getTime());
}

/**
 * Relative change. Returns null when there is no baseline, because "up 100%" from
 * nothing is not a meaningful statement.
 */
export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** Margins are compared in percentage points, never as a percentage of a percentage. */
export function pointChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  return current - previous;
}

export function grossMargin(grossProfit: number | null, revenue: number): number | null {
  if (grossProfit === null || revenue <= 0) return null;
  return (grossProfit / revenue) * 100;
}

export function averageBasket(revenue: number, transactions: number): number | null {
  if (transactions <= 0) return null;
  return revenue / transactions;
}

export function ratio(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return (part / whole) * 100;
}

/** Money-safe division used for per-day averages of monetary totals. */
export function averageMoney(total: string, divisor: number) {
  if (divisor <= 0) return '0';
  return fromScaled(toScaled(total, 2) / BigInt(Math.round(divisor)), 2);
}

export function addMoney(...values: string[]) {
  let sum = 0n;
  for (const value of values) sum += toScaled(value, 2);
  return fromScaled(sum, 2);
}

export function multiplyMoney(value: string, factor: string) {
  return fromScaled((toScaled(value, 2) * toScaled(factor, 3)) / 1000n, 2);
}

/**
 * Whether a metric increasing is good, bad, or neither. Used so the UI never colours
 * a number green purely because it grew.
 */
export type Direction = 'up-good' | 'up-bad' | 'neutral';
export const metricDirection: Record<string, Direction> = {
  revenue: 'up-good',
  grossProfit: 'up-good',
  grossMargin: 'up-good',
  transactions: 'up-good',
  averageBasket: 'up-good',
  units: 'up-good',
  refunds: 'up-bad',
  refundRate: 'up-bad',
  discounts: 'up-bad',
  discountRate: 'up-bad',
  waste: 'up-bad',
  wasteRate: 'up-bad',
  purchaseCost: 'up-bad',
  cashDifference: 'neutral',
  inventoryValue: 'neutral',
  purchases: 'neutral',
};

export function tone(metric: string, change: number | null) {
  if (change === null || change === 0) return 'neutral';
  const direction = metricDirection[metric] ?? 'neutral';
  if (direction === 'neutral') return 'neutral';
  const positive = direction === 'up-good' ? change > 0 : change < 0;
  return positive ? 'good' : 'bad';
}

/** Sales velocity and cover, used for both run-out warnings and dead-stock detection. */
export function dailyVelocity(units: string, days: number): number | null {
  if (days <= 0) return null;
  return Number(units) / days;
}

export function daysOfStock(stock: string, velocity: number | null): number | null {
  if (velocity === null || velocity <= 0) return null;
  return Number(stock) / velocity;
}

export type PortfolioClass = 'star' | 'traffic' | 'hidden' | 'slow' | 'dead' | 'unclassified';
export type PortfolioInput = {
  units: string;
  revenue: string;
  grossProfit: string | null;
  margin: number | null;
  stock: string;
  daysSinceLastSale: number | null;
  historyDays: number;
};
export type PortfolioThresholds = {
  /** Units per day at or above which a product counts as fast moving. */
  fastVelocity: number;
  /** Margin percentage at or above which a product counts as high margin. */
  strongMargin: number;
  /** Days without a sale before stock counts as dead. */
  deadDays: number;
  /** Minimum history required before classifying at all. */
  minimumHistoryDays: number;
};
export const defaultThresholds: PortfolioThresholds = {
  fastVelocity: 1,
  strongMargin: 25,
  deadDays: 60,
  minimumHistoryDays: 30,
};

/**
 * Portfolio bucket for one product. Returns `unclassified` rather than guessing when
 * the store has not traded long enough or cost data is missing.
 */
export function classifyProduct(
  input: PortfolioInput,
  thresholds: PortfolioThresholds = defaultThresholds,
): PortfolioClass {
  if (input.historyDays < thresholds.minimumHistoryDays) return 'unclassified';
  const hasStock = toScaled(input.stock, 3) > 0n;
  if (
    hasStock &&
    (input.daysSinceLastSale === null || input.daysSinceLastSale >= thresholds.deadDays)
  )
    return 'dead';
  const velocity = dailyVelocity(input.units, input.historyDays);
  if (velocity === null) return 'unclassified';
  const fast = velocity >= thresholds.fastVelocity;
  if (input.margin === null) return fast ? 'traffic' : 'slow';
  const strong = input.margin >= thresholds.strongMargin;
  if (fast && strong) return 'star';
  if (fast) return 'traffic';
  if (strong) return 'hidden';
  return hasStock ? 'slow' : 'unclassified';
}

export type Insight = {
  id: string;
  type: string;
  severity: Severity;
  title: string;
  detail: string;
  /** Monetary consequence. `estimate` drives the "estimated" wording in the UI. */
  impact?: { amount: string; label: string; estimate: boolean };
  entities?: { id: string; label: string; note?: string }[];
  action?: { label: string; to: string; search?: Record<string, string> };
  metric?: { current: number; baseline: number; change: number; threshold: number };
};

const order: Record<Severity, number> = { critical: 0, important: 1, attention: 2, info: 3 };
export function sortInsights(insights: Insight[]) {
  return [...insights].sort((a, b) => order[a.severity] - order[b.severity]);
}

export type InsightFacts = {
  currency: string;
  /** Days of sales history the store has, used to suppress premature conclusions. */
  historyDays: number;
  revenue: string;
  previousRevenue: string | null;
  grossMargin: number | null;
  previousGrossMargin: number | null;
  outOfStock: { id: string; label: string; weeklyUnits: string; weeklyRevenue: string }[];
  lowStock: { id: string; label: string; stock: string; minStock: string }[];
  runningOut: { id: string; label: string; days: number }[];
  deadStock: { count: number; value: string; days: number };
  costIncreases: {
    id: string;
    label: string;
    previousCost: string;
    currentCost: string;
    percent: number;
    priceUnchanged: boolean;
    weeklyUnits: string;
  }[];
  negativeMargin: { id: string; label: string; margin: number }[];
  refundRate: number | null;
  baselineRefundRate: number | null;
  refundOutliers: { id: string; label: string; rate: number; baseline: number; kind: string }[];
  discountValue: string;
  baselineDiscountValue: string | null;
  wasteValue: string;
  baselineWasteValue: string | null;
  cashDifferences: { id: string; label: string; difference: string }[];
  longOpenShifts: { id: string; label: string; hours: number }[];
  missingCost: number;
  uncountedProducts: number;
};

/** Configurable trigger points, kept in one place so thresholds are auditable. */
export const insightThresholds = {
  costIncreasePercent: 3,
  refundRateMultiplier: 2,
  refundRateFloor: 2,
  discountIncreasePercent: 25,
  wasteIncreasePercent: 25,
  cashDifference: '100',
  shiftHours: 14,
  runningOutDays: 3,
  marginDropPoints: 1,
};

/**
 * Deterministic rules over measured facts. Every insight is derived from a computed
 * difference, so nothing here is speculative.
 */
export function buildInsights(facts: InsightFacts): Insight[] {
  const found: Insight[] = [];
  const money = (value: string) => value;

  if (facts.outOfStock.length) {
    const revenue = addMoney(...facts.outOfStock.map((p) => p.weeklyRevenue));
    const notable = facts.outOfStock.filter((p) => toScaled(p.weeklyRevenue, 2) > 0n);
    found.push({
      id: 'out-of-stock',
      type: 'inventory',
      severity: notable.length ? 'critical' : 'attention',
      title: `${facts.outOfStock.length} products are out of stock`,
      detail: notable.length
        ? `${notable.length} of them sold in the last 7 days.`
        : 'None of them sold in the last 7 days.',
      impact: notable.length
        ? { amount: money(revenue), label: 'Weekly sales affected', estimate: true }
        : undefined,
      entities: facts.outOfStock.slice(0, 5).map((p) => ({ id: p.id, label: p.label })),
      action: { label: 'View products', to: '/products', search: { stock: 'out' } },
    });
  }

  if (facts.runningOut.length)
    found.push({
      id: 'running-out',
      type: 'inventory',
      severity: 'important',
      title: `${facts.runningOut.length} products run out within ${insightThresholds.runningOutDays} days`,
      detail: 'Based on recent sales velocity and current stock.',
      entities: facts.runningOut
        .slice(0, 5)
        .map((p) => ({ id: p.id, label: p.label, note: `${p.days.toFixed(1)} days left` })),
      action: { label: 'View products', to: '/products', search: { stock: 'low' } },
    });
  else if (facts.lowStock.length)
    found.push({
      id: 'low-stock',
      type: 'inventory',
      severity: 'attention',
      title: `${facts.lowStock.length} products are below minimum stock`,
      detail: 'Reorder before they run out.',
      entities: facts.lowStock.slice(0, 5).map((p) => ({ id: p.id, label: p.label })),
      action: { label: 'View products', to: '/products', search: { stock: 'low' } },
    });

  const unchanged = facts.costIncreases.filter((p) => p.priceUnchanged);
  if (facts.costIncreases.length) {
    const impact = addMoney(
      ...unchanged.map((p) =>
        multiplyMoney(
          fromScaled(toScaled(p.currentCost, 2) - toScaled(p.previousCost, 2), 2),
          p.weeklyUnits,
        ),
      ),
    );
    found.push({
      id: 'margin-protection',
      type: 'margin',
      severity: unchanged.length ? 'important' : 'info',
      title: `Purchase cost increased on ${facts.costIncreases.length} products`,
      detail: unchanged.length
        ? `${unchanged.length} still have unchanged retail prices.`
        : 'Retail prices have already been reviewed.',
      impact: unchanged.length
        ? { amount: money(impact), label: 'Weekly gross profit at risk', estimate: true }
        : undefined,
      entities: facts.costIncreases
        .slice(0, 5)
        .map((p) => ({ id: p.id, label: p.label, note: `+${p.percent.toFixed(1)}%` })),
      action: { label: 'Review products', to: '/products' },
    });
  }

  if (facts.negativeMargin.length)
    found.push({
      id: 'negative-margin',
      type: 'margin',
      severity: 'important',
      title: `${facts.negativeMargin.length} products sell below cost`,
      detail: 'Selling price does not cover the recorded purchase cost.',
      entities: facts.negativeMargin
        .slice(0, 5)
        .map((p) => ({ id: p.id, label: p.label, note: `${p.margin.toFixed(1)}%` })),
      action: { label: 'Review products', to: '/products' },
    });

  if (
    facts.refundRate !== null &&
    facts.baselineRefundRate !== null &&
    facts.refundRate >= insightThresholds.refundRateFloor &&
    facts.refundRate >= facts.baselineRefundRate * insightThresholds.refundRateMultiplier
  )
    found.push({
      id: 'refund-rate',
      type: 'refunds',
      severity: 'important',
      title: `Refund rate is ${facts.refundRate.toFixed(1)}% of sales`,
      detail: `The usual rate is ${facts.baselineRefundRate.toFixed(1)}%.`,
      metric: {
        current: facts.refundRate,
        baseline: facts.baselineRefundRate,
        change: facts.refundRate - facts.baselineRefundRate,
        threshold: insightThresholds.refundRateMultiplier,
      },
      action: { label: 'View refunds', to: '/refunds' },
    });

  for (const outlier of facts.refundOutliers.slice(0, 3))
    found.push({
      id: 'refund-outlier-' + outlier.id,
      type: 'refunds',
      severity: 'attention',
      title: `Unusual refund activity on ${outlier.label}`,
      detail: `Refund rate ${outlier.rate.toFixed(1)}% against a store average of ${outlier.baseline.toFixed(1)}%. Worth reviewing the transactions.`,
      metric: {
        current: outlier.rate,
        baseline: outlier.baseline,
        change: outlier.rate - outlier.baseline,
        threshold: insightThresholds.refundRateMultiplier,
      },
      action: { label: 'View refunds', to: '/refunds' },
    });

  const discountChange = percentChange(
    Number(facts.discountValue),
    Number(facts.baselineDiscountValue ?? 0),
  );
  if (
    facts.baselineDiscountValue !== null &&
    discountChange !== null &&
    discountChange >= insightThresholds.discountIncreasePercent
  )
    found.push({
      id: 'discounts',
      type: 'discounts',
      severity: 'attention',
      title: `Discount value is ${discountChange.toFixed(0)}% above normal`,
      detail: 'Compared with the recent average for the same length of time.',
      impact: { amount: money(facts.discountValue), label: 'Discounts given', estimate: false },
      action: { label: 'View sales', to: '/sales' },
    });

  const wasteChange = percentChange(Number(facts.wasteValue), Number(facts.baselineWasteValue ?? 0));
  if (
    facts.baselineWasteValue !== null &&
    wasteChange !== null &&
    wasteChange >= insightThresholds.wasteIncreasePercent
  )
    found.push({
      id: 'waste',
      type: 'waste',
      severity: 'important',
      title: `Waste is ${wasteChange.toFixed(0)}% above normal`,
      detail: 'Damaged, expired and internal-use stock removals.',
      impact: { amount: money(facts.wasteValue), label: 'Stock cost lost', estimate: false },
      action: { label: 'View inventory', to: '/inventory' },
    });

  const cash = facts.cashDifferences.filter(
    (s) =>
      (s.difference.startsWith('-') ? toScaled(s.difference.slice(1), 2) : toScaled(s.difference, 2)) >=
      toScaled(insightThresholds.cashDifference, 2),
  );
  if (cash.length)
    found.push({
      id: 'cash-difference',
      type: 'shifts',
      severity: 'important',
      title: `${cash.length} shifts closed with a cash difference`,
      detail: 'Counted cash did not match the expected drawer total.',
      entities: cash.slice(0, 5).map((s) => ({ id: s.id, label: s.label, note: s.difference })),
      action: { label: 'View shifts', to: '/shifts' },
    });

  if (facts.longOpenShifts.length)
    found.push({
      id: 'open-shifts',
      type: 'shifts',
      severity: 'attention',
      title: `${facts.longOpenShifts.length} shifts have been open over ${insightThresholds.shiftHours} hours`,
      detail: 'Long-running shifts usually mean a register was never closed.',
      entities: facts.longOpenShifts
        .slice(0, 5)
        .map((s) => ({ id: s.id, label: s.label, note: `${s.hours.toFixed(0)}h` })),
      action: { label: 'View shifts', to: '/shifts' },
    });

  if (facts.deadStock.count)
    found.push({
      id: 'dead-stock',
      type: 'inventory',
      severity: 'attention',
      title: `${facts.deadStock.count} products have not sold in ${facts.deadStock.days} days`,
      detail: 'Stock is on the shelf but not moving.',
      impact: { amount: money(facts.deadStock.value), label: 'Inventory cost tied up', estimate: false },
      action: { label: 'View products', to: '/products' },
    });

  if (facts.missingCost)
    found.push({
      id: 'missing-cost',
      type: 'data',
      severity: 'attention',
      title: `${facts.missingCost} products are missing a purchase cost`,
      detail: 'Profit and inventory value cannot be calculated for these products.',
      action: { label: 'Review products', to: '/products' },
    });

  if (facts.uncountedProducts)
    found.push({
      id: 'uncounted',
      type: 'data',
      severity: 'info',
      title: `${facts.uncountedProducts} products have no opening stock count`,
      detail: 'Stock on hand for these products has never been verified.',
      action: { label: 'Stock counts', to: '/stock-counts' },
    });

  return sortInsights(found);
}

export type ChangeLine = { label: string; change: number | null; metric: string; detail?: string };

/**
 * The "what changed" narrative. Only differences that were actually measured are
 * listed; nothing is inferred beyond the arithmetic.
 */
export function whatChanged(input: {
  revenueChange: number | null;
  grossProfitChange: number | null;
  marginPointChange: number | null;
  categories: { label: string; change: number | null; revenue: string }[];
  costIncreaseCount: number;
  discountChange: number | null;
  wasteChange: number | null;
  refundChange: number | null;
}): ChangeLine[] {
  const lines: ChangeLine[] = [];
  const moving = input.categories
    .filter((c) => c.change !== null && Math.abs(c.change) >= 5)
    .sort((a, b) => Math.abs(b.change!) - Math.abs(a.change!))
    .slice(0, 4);
  for (const category of moving)
    lines.push({ label: `${category.label} revenue`, change: category.change, metric: 'revenue' });
  if (input.costIncreaseCount)
    lines.push({
      label: `Purchase costs increased on ${input.costIncreaseCount} products`,
      change: null,
      metric: 'purchaseCost',
    });
  if (input.discountChange !== null && Math.abs(input.discountChange) >= 5)
    lines.push({ label: 'Discount value', change: input.discountChange, metric: 'discounts' });
  if (input.wasteChange !== null && Math.abs(input.wasteChange) >= 5)
    lines.push({ label: 'Waste', change: input.wasteChange, metric: 'waste' });
  if (input.refundChange !== null && Math.abs(input.refundChange) >= 5)
    lines.push({ label: 'Refunds', change: input.refundChange, metric: 'refunds' });
  return lines;
}

const pct = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
const pts = (value: number) =>
  `${value >= 0 ? 'increased' : 'decreased'} ${Math.abs(value).toFixed(1)} percentage points`;

/**
 * Plain-language summary. Attribution is only asserted when a driver was measured,
 * otherwise the reader is pointed at the detail instead of being given a guess.
 */
export function ownerSummary(input: {
  period: Period;
  revenueChange: number | null;
  grossProfitChange: number | null;
  marginPointChange: number | null;
  drivers: string[];
  wasteChange: number | null;
}) {
  const window = input.period === 'week' ? 'this week' : 'this month';
  if (input.revenueChange === null)
    return `Not enough comparable history yet to describe how ${window} compares.`;
  const parts = [
    `Sales ${input.revenueChange >= 0 ? 'increased' : 'decreased'} ${Math.abs(input.revenueChange).toFixed(1)}% ${window}`,
  ];
  if (input.grossProfitChange !== null)
    parts.push(
      `gross profit ${input.grossProfitChange >= 0 ? 'increased' : 'decreased'} ${Math.abs(input.grossProfitChange).toFixed(1)}%`,
    );
  let text = parts.join(' while ') + '.';
  if (input.marginPointChange !== null && Math.abs(input.marginPointChange) >= 0.1) {
    text += ` Gross margin ${pts(input.marginPointChange)}`;
    text += input.drivers.length
      ? `, associated with ${joinList(input.drivers)}.`
      : '. Review the margin drivers below.';
  }
  if (input.wasteChange !== null && Math.abs(input.wasteChange) >= 5)
    text += ` Waste ${input.wasteChange < 0 ? 'improved' : 'worsened'} by ${Math.abs(input.wasteChange).toFixed(0)}%.`;
  return text;
}

function joinList(values: string[]) {
  if (values.length === 1) return values[0];
  return values.slice(0, -1).join(', ') + ' and ' + values[values.length - 1];
}

export { pct as formatPercent };
