import { addDays, type DateRange } from './analytics.js';
import type { planReplenishment } from './replenishment.js';

export const actionQuestions = [
  ['order', 'What, how much and when should we order?'],
  ['expiry', 'What will we not sell in time?'],
  ['overstock', 'What should we avoid ordering for now?'],
  ['costs', 'Did the latest delivery cost more? Which supplier did we buy from at a better price?'],
  ['demand', 'What is selling better or worse?'],
  ['assortment', 'Which products really benefit the shop?'],
] as const;
export type ActionQuestionPeriod = 'today' | 'week' | 'month';
/** Full, equally long windows; today uses the same store-local clock time a week ago. */
export function actionQuestionRanges(period: ActionQuestionPeriod, today: string) {
  const days = period === 'week' ? 7 : 28;
  const current: DateRange =
    period === 'today'
      ? { from: today, to: today }
      : { from: addDays(today, -days), to: addDays(today, -1) };
  const shift = period === 'today' ? 7 : days;
  return {
    current,
    previous: { from: addDays(current.from, -shift), to: addDays(current.to, -shift) },
  };
}
export type ActionPlanRow = ReturnType<typeof planReplenishment> & {
  productId: string;
  name: string;
  volume?: string;
  sku: string;
  unit: string;
  available: string;
  incoming: string;
  sold: string;
  observedDays: number;
  supplierId: string | null;
  supplierName: string | null;
  leadDays: number | null;
};
export type ActionQuestionReport = {
  today: string;
  timezone: string;
  currency: string;
  generatedAt: string;
  period: ActionQuestionPeriod;
  range: DateRange;
  comparison: DateRange;
  planning: {
    allowed: boolean;
    total: number;
    orderNow: number;
    needsReview: number;
    insufficientHistory: number;
    truncated: boolean;
    rows: ActionPlanRow[];
  };
  expiry: {
    allowed: boolean;
    total: number;
    unknownProducts: number;
    rows: {
      id: string;
      productId: string;
      name: string;
      volume: string;
      unit: string;
      quantity: string;
      expiryDate: string;
      supplierName: string | null;
      expired: boolean;
    }[];
  };
  overstock: { allowed: boolean; total: number; truncated: boolean; rows: ActionPlanRow[] };
  costs: {
    allowed: boolean;
    total: number;
    rows: {
      productId: string;
      name: string;
      volume: string;
      unit: string;
      supplierName: string;
      paidAt: string;
      cost: string;
      previousCost: string | null;
      change: string | null;
      alternativeSupplier: string | null;
      alternativeCost: string | null;
      alternativeDate: string | null;
    }[];
  };
  demand: {
    allowed: boolean;
    receipts: number;
    previousReceipts: number;
    rows: {
      productId: string;
      name: string;
      volume: string;
      unit: string;
      quantity: string;
      previousQuantity: string;
      change: string;
    }[];
  };
  assortment: {
    allowed: boolean;
    incomplete: number;
    rows: {
      productId: string;
      name: string;
      volume?: string;
      unit: string;
      quantity: string;
      grossProfit: string;
      revenue: string;
    }[];
  };
};
