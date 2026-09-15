import { describe, it, expect } from 'vitest';
import {
  storeToday,
  addDays,
  daysBetween,
  weekday,
  startOfWeek,
  startOfMonth,
  endOfMonth,
  periodRange,
  comparisons,
  percentChange,
  pointChange,
  grossMargin,
  averageBasket,
  ratio,
  addMoney,
  multiplyMoney,
  averageMoney,
  tone,
  dailyVelocity,
  daysOfStock,
  classifyProduct,
  buildInsights,
  whatChanged,
  ownerSummary,
  sortInsights,
  defaultThresholds,
  type InsightFacts,
} from '../packages/contracts/src/index';

describe('business day handling', () => {
  it('uses the store timezone rather than UTC midnight', () => {
    // 22:30 in Oslo on 14 March is already 21:30 UTC; in Auckland it is the 15th.
    const evening = new Date('2026-03-14T21:30:00Z');
    expect(storeToday(evening, 'Europe/Oslo')).toBe('2026-03-14');
    expect(storeToday(evening, 'Pacific/Auckland')).toBe('2026-03-15');
  });
  it('keeps a late-night sale inside the opening business day', () => {
    const afterMidnightUtc = new Date('2026-03-15T00:30:00Z');
    expect(storeToday(afterMidnightUtc, 'America/New_York')).toBe('2026-03-14');
  });
  it('walks dates across a daylight saving boundary', () => {
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
    expect(daysBetween('2026-03-01', '2026-03-31')).toBe(31);
  });
  it('derives week and month boundaries', () => {
    expect(weekday('2026-09-14')).toBe(1);
    expect(startOfWeek('2026-09-17')).toBe('2026-09-14');
    expect(startOfMonth('2026-09-17')).toBe('2026-09-01');
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
    expect(endOfMonth('2024-02-10')).toBe('2024-02-29');
  });
});

describe('period comparisons', () => {
  it('compares today against yesterday and the same weekday', () => {
    const range = periodRange('today', '2026-09-15');
    expect(range).toEqual({ from: '2026-09-15', to: '2026-09-15' });
    const [yesterday, sameWeekday] = comparisons('today', range);
    expect(yesterday.range).toEqual({ from: '2026-09-14', to: '2026-09-14' });
    expect(sameWeekday.range).toEqual({ from: '2026-09-08', to: '2026-09-08' });
    expect(weekday('2026-09-08')).toBe(weekday('2026-09-15'));
  });
  it('compares a part week against the same number of earlier days', () => {
    const range = periodRange('week', '2026-09-17');
    expect(range).toEqual({ from: '2026-09-14', to: '2026-09-17' });
    const [previous] = comparisons('week', range);
    expect(daysBetween(previous.range.from, previous.range.to)).toBe(4);
    expect(previous.range).toEqual({ from: '2026-09-10', to: '2026-09-13' });
  });
  it('offers a year-over-year month comparison', () => {
    const range = periodRange('month', '2026-09-15');
    const lastYear = comparisons('month', range).find((c) => c.key === 'lastYear')!;
    expect(lastYear.range.from).toBe('2025-09-01');
    expect(daysBetween(lastYear.range.from, lastYear.range.to)).toBe(15);
  });
});

describe('core metrics', () => {
  it('computes margin, basket and ratios', () => {
    expect(grossMargin(260000, 1000000)).toBeCloseTo(26, 10);
    expect(averageBasket(1000, 4)).toBe(250);
    expect(ratio(50, 200)).toBe(25);
  });
  it('reports unavailable instead of dividing by zero', () => {
    expect(averageBasket(0, 0)).toBeNull();
    expect(grossMargin(100, 0)).toBeNull();
    expect(percentChange(100, 0)).toBeNull();
    expect(ratio(5, 0)).toBeNull();
    expect(grossMargin(null, 1000)).toBeNull();
  });
  it('uses percentage points for margin and percent for money', () => {
    expect(percentChange(1080000, 1000000)).toBeCloseTo(8, 10);
    expect(pointChange(25, 26)).toBeCloseTo(-1, 10);
    expect(pointChange(25, null)).toBeNull();
  });
  it('handles a refund-only period without inventing growth', () => {
    expect(percentChange(-500, 0)).toBeNull();
    expect(grossMargin(-500, 0)).toBeNull();
  });
  it('keeps money arithmetic exact', () => {
    expect(addMoney('0.10', '0.20')).toBe('0.30');
    expect(multiplyMoney('1.15', '3')).toBe('3.45');
    expect(averageMoney('100.00', 7)).toBe('14.28');
  });
});

describe('semantic direction', () => {
  it('does not colour a number merely because it grew', () => {
    expect(tone('revenue', 5)).toBe('good');
    expect(tone('waste', 5)).toBe('bad');
    expect(tone('refunds', -5)).toBe('good');
    expect(tone('inventoryValue', 5)).toBe('neutral');
    expect(tone('revenue', null)).toBe('neutral');
  });
});

describe('velocity and dead stock', () => {
  it('estimates days of stock remaining', () => {
    const velocity = dailyVelocity('238', 7);
    expect(velocity).toBeCloseTo(34, 10);
    expect(daysOfStock('120', velocity)).toBeCloseTo(3.529, 3);
  });
  it('returns unavailable when a product never sold', () => {
    expect(daysOfStock('120', 0)).toBeNull();
    expect(daysOfStock('120', null)).toBeNull();
    expect(dailyVelocity('10', 0)).toBeNull();
  });
  it('classifies the portfolio', () => {
    const base = { revenue: '1000', grossProfit: '300', stock: '50', historyDays: 90 };
    expect(
      classifyProduct({ ...base, units: '900', margin: 30, daysSinceLastSale: 1 }),
    ).toBe('star');
    expect(
      classifyProduct({ ...base, units: '900', margin: 5, daysSinceLastSale: 1 }),
    ).toBe('traffic');
    expect(classifyProduct({ ...base, units: '9', margin: 40, daysSinceLastSale: 3 })).toBe(
      'hidden',
    );
    expect(classifyProduct({ ...base, units: '9', margin: 5, daysSinceLastSale: 3 })).toBe('slow');
    expect(classifyProduct({ ...base, units: '0', margin: 5, daysSinceLastSale: 80 })).toBe('dead');
    expect(classifyProduct({ ...base, units: '0', margin: 5, daysSinceLastSale: null })).toBe(
      'dead',
    );
  });
  it('refuses to classify a store without enough history', () => {
    expect(
      classifyProduct({
        units: '900',
        revenue: '1000',
        grossProfit: '300',
        margin: 30,
        stock: '50',
        daysSinceLastSale: 1,
        historyDays: 5,
      }),
    ).toBe('unclassified');
  });
  it('never calls a product with no stock dead', () => {
    expect(
      classifyProduct({
        units: '0',
        revenue: '0',
        grossProfit: '0',
        margin: null,
        stock: '0',
        daysSinceLastSale: 400,
        historyDays: 120,
      }),
    ).not.toBe('dead');
  });
  it('respects configured thresholds', () => {
    const input = {
      units: '900',
      revenue: '1000',
      grossProfit: '300',
      margin: 30,
      stock: '50',
      daysSinceLastSale: 45,
      historyDays: 90,
    };
    expect(classifyProduct(input, { ...defaultThresholds, deadDays: 30 })).toBe('dead');
    expect(classifyProduct(input, defaultThresholds)).toBe('star');
  });
});

const emptyFacts: InsightFacts = {
  currency: 'NOK',
  historyDays: 120,
  revenue: '0',
  previousRevenue: null,
  grossMargin: null,
  previousGrossMargin: null,
  outOfStock: [],
  lowStock: [],
  runningOut: [],
  deadStock: { count: 0, value: '0', days: 60 },
  costIncreases: [],
  negativeMargin: [],
  refundRate: null,
  baselineRefundRate: null,
  refundOutliers: [],
  discountValue: '0',
  baselineDiscountValue: null,
  wasteValue: '0',
  baselineWasteValue: null,
  cashDifferences: [],
  longOpenShifts: [],
  missingCost: 0,
  uncountedProducts: 0,
};

describe('insight engine', () => {
  it('produces nothing for a healthy store', () => {
    expect(buildInsights(emptyFacts)).toEqual([]);
  });
  it('raises out of stock to critical when the products actually sell', () => {
    const insights = buildInsights({
      ...emptyFacts,
      outOfStock: [
        { id: 'a', label: 'Milk 1L', weeklyUnits: '238', weeklyRevenue: '4200.00' },
        { id: 'b', label: 'Obscure jam', weeklyUnits: '0', weeklyRevenue: '0' },
      ],
    });
    const alert = insights.find((i) => i.id === 'out-of-stock')!;
    expect(alert.severity).toBe('critical');
    expect(alert.impact).toEqual({
      amount: '4200.00',
      label: 'Weekly sales affected',
      estimate: true,
    });
  });
  it('keeps out of stock low when nothing sold', () => {
    const insights = buildInsights({
      ...emptyFacts,
      outOfStock: [{ id: 'b', label: 'Obscure jam', weeklyUnits: '0', weeklyRevenue: '0' }],
    });
    const alert = insights.find((i) => i.id === 'out-of-stock')!;
    expect(alert.severity).toBe('attention');
    expect(alert.impact).toBeUndefined();
  });
  it('detects margin protection and prices the weekly exposure', () => {
    const insights = buildInsights({
      ...emptyFacts,
      costIncreases: [
        {
          id: 'a',
          label: 'Milk 1L',
          previousCost: '10.00',
          currentCost: '11.00',
          percent: 10,
          priceUnchanged: true,
          weeklyUnits: '200',
        },
        {
          id: 'b',
          label: 'Butter',
          previousCost: '20.00',
          currentCost: '21.00',
          percent: 5,
          priceUnchanged: false,
          weeklyUnits: '50',
        },
      ],
    });
    const alert = insights.find((i) => i.id === 'margin-protection')!;
    expect(alert.severity).toBe('important');
    expect(alert.detail).toContain('1 still have unchanged retail prices');
    // Only the unchanged-price product counts: 1.00 extra cost x 200 units.
    expect(alert.impact?.amount).toBe('200.00');
  });
  it('stays informational when retail prices already moved', () => {
    const insights = buildInsights({
      ...emptyFacts,
      costIncreases: [
        {
          id: 'b',
          label: 'Butter',
          previousCost: '20.00',
          currentCost: '21.00',
          percent: 5,
          priceUnchanged: false,
          weeklyUnits: '50',
        },
      ],
    });
    expect(insights.find((i) => i.id === 'margin-protection')!.severity).toBe('info');
  });
  it('flags an unusual refund rate without accusing anyone', () => {
    const insights = buildInsights({
      ...emptyFacts,
      refundRate: 3.8,
      baselineRefundRate: 0.9,
      refundOutliers: [
        { id: 'r4', label: 'Register 4', rate: 3.8, baseline: 0.9, kind: 'register' },
      ],
    });
    const outlier = insights.find((i) => i.id === 'refund-outlier-r4')!;
    expect(outlier.title).toContain('Unusual refund activity');
    expect(outlier.detail).not.toMatch(/theft|fraud|steal/i);
  });
  it('ignores a refund rate that is high but within normal variation', () => {
    const insights = buildInsights({ ...emptyFacts, refundRate: 1.2, baselineRefundRate: 0.9 });
    expect(insights.find((i) => i.id === 'refund-rate')).toBeUndefined();
  });
  it('flags cash differences in both directions', () => {
    const insights = buildInsights({
      ...emptyFacts,
      cashDifferences: [
        { id: 's1', label: 'Register 3', difference: '-420.00' },
        { id: 's2', label: 'Register 1', difference: '15.00' },
      ],
    });
    const alert = insights.find((i) => i.id === 'cash-difference')!;
    expect(alert.title).toContain('1 shifts');
  });
  it('reports dead stock with the cash tied up', () => {
    const insights = buildInsights({
      ...emptyFacts,
      deadStock: { count: 218, value: '187000.00', days: 60 },
    });
    const alert = insights.find((i) => i.id === 'dead-stock')!;
    expect(alert.title).toContain('218 products have not sold in 60 days');
    expect(alert.impact?.amount).toBe('187000.00');
  });
  it('surfaces data gaps that block profit reporting', () => {
    const insights = buildInsights({ ...emptyFacts, missingCost: 126, uncountedProducts: 84 });
    expect(insights.find((i) => i.id === 'missing-cost')!.title).toContain('126 products');
    expect(insights.find((i) => i.id === 'uncounted')!.severity).toBe('info');
  });
  it('orders the most serious findings first', () => {
    const sorted = sortInsights([
      { id: 'a', type: 'x', severity: 'info', title: '', detail: '' },
      { id: 'b', type: 'x', severity: 'critical', title: '', detail: '' },
      { id: 'c', type: 'x', severity: 'attention', title: '', detail: '' },
    ]);
    expect(sorted.map((i) => i.severity)).toEqual(['critical', 'attention', 'info']);
  });
});

describe('what changed', () => {
  it('lists only measured movements', () => {
    const lines = whatChanged({
      revenueChange: 7.2,
      grossProfitChange: 4.1,
      marginPointChange: -0.8,
      categories: [
        { label: 'Drinks', change: 18, revenue: '1000' },
        { label: 'Produce', change: 11, revenue: '900' },
        { label: 'Meat', change: -9, revenue: '800' },
        { label: 'Bakery', change: 1, revenue: '700' },
      ],
      costIncreaseCount: 36,
      discountChange: 14,
      wasteChange: -8,
      refundChange: 1,
    });
    const labels = lines.map((l) => l.label);
    expect(labels).toContain('Drinks revenue');
    expect(labels).not.toContain('Bakery revenue');
    expect(labels).toContain('Purchase costs increased on 36 products');
    expect(labels).not.toContain('Refunds');
  });
});

describe('owner summary', () => {
  it('states margin movement in points and names only verified drivers', () => {
    const text = ownerSummary({
      period: 'week',
      revenueChange: 7.2,
      grossProfitChange: 4.1,
      marginPointChange: -0.8,
      drivers: ['supplier cost increases', 'higher discounting'],
      wasteChange: -8,
    });
    expect(text).toContain('Sales increased 7.2% this week');
    expect(text).toContain('gross profit increased 4.1%');
    expect(text).toContain('decreased 0.8 percentage points');
    expect(text).toContain('supplier cost increases and higher discounting');
    expect(text).toContain('Waste improved by 8%');
  });
  it('declines to invent a cause when none was measured', () => {
    const text = ownerSummary({
      period: 'week',
      revenueChange: 7.2,
      grossProfitChange: 4.1,
      marginPointChange: -0.8,
      drivers: [],
      wasteChange: null,
    });
    expect(text).toContain('Review the margin drivers below');
    expect(text).not.toContain('associated with');
  });
  it('says so when there is no comparable history', () => {
    const text = ownerSummary({
      period: 'week',
      revenueChange: null,
      grossProfitChange: null,
      marginPointChange: null,
      drivers: [],
      wasteChange: null,
    });
    expect(text).toContain('Not enough comparable history');
  });
});

describe('the specified end-to-end week', () => {
  // Previous: sales 1,000,000 / COGS 740,000. Current: sales 1,080,000 / COGS 810,000.
  const previous = { revenue: 1000000, cogs: 740000 };
  const current = { revenue: 1080000, cogs: 810000 };
  const previousProfit = previous.revenue - previous.cogs;
  const currentProfit = current.revenue - current.cogs;
  it('reports sales up 8%, profit up 3.85% and margin down a full point', () => {
    expect(previousProfit).toBe(260000);
    expect(currentProfit).toBe(270000);
    expect(percentChange(current.revenue, previous.revenue)).toBeCloseTo(8, 10);
    expect(percentChange(currentProfit, previousProfit)).toBeCloseTo(3.846, 3);
    const previousMargin = grossMargin(previousProfit, previous.revenue)!;
    const currentMargin = grossMargin(currentProfit, current.revenue)!;
    expect(previousMargin).toBeCloseTo(26, 10);
    expect(currentMargin).toBeCloseTo(25, 10);
    expect(pointChange(currentMargin, previousMargin)).toBeCloseTo(-1, 10);
  });
  it('does not claim across-the-board improvement', () => {
    const currentMargin = grossMargin(currentProfit, current.revenue)!;
    const previousMargin = grossMargin(previousProfit, previous.revenue)!;
    const text = ownerSummary({
      period: 'week',
      revenueChange: percentChange(current.revenue, previous.revenue),
      grossProfitChange: percentChange(currentProfit, previousProfit),
      marginPointChange: pointChange(currentMargin, previousMargin),
      drivers: [],
      wasteChange: null,
    });
    expect(text).toContain('decreased 1.0 percentage points');
    expect(tone('grossMargin', -1)).toBe('bad');
  });
});
