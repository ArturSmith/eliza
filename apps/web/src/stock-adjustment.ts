import { fromScaled, quantity, toScaled, type AdjustmentInput } from '@eliza/contracts';

export type StockDirection = 'signed' | 'add' | 'remove';
export const stockReasonLabels: Record<AdjustmentInput['reason'], string> = {
  opening_balance: 'Opening stock',
  received: 'Goods received (manual)',
  count_correction: 'Count correction',
  damaged: 'Damaged goods',
  expired: 'Expired goods',
  lost: 'Lost goods',
  internal_use: 'Internal use',
  other: 'Other',
};
export function stockReasons(direction: StockDirection): AdjustmentInput['reason'][] {
  return direction === 'add'
    ? ['received', 'opening_balance', 'other']
    : direction === 'remove'
      ? ['damaged', 'expired', 'lost', 'internal_use', 'other']
      : [
          'opening_balance',
          'received',
          'count_correction',
          'damaged',
          'expired',
          'lost',
          'internal_use',
          'other',
        ];
}
/** Directed operations accept a positive magnitude and apply the sign exactly once. */
export function stockQuantity(value: string, direction: StockDirection) {
  const parsed = quantity.safeParse(value.trim().replace(',', '.'));
  if (!parsed.success) throw new Error('Use a quantity with at most three decimal places');
  if (direction === 'signed') return parsed.data;
  const amount = toScaled(parsed.data, 3);
  if (amount <= 0n) throw new Error('Enter a quantity greater than zero.');
  return fromScaled(direction === 'remove' ? -amount : amount, 3);
}
export type StockAdjustmentResult = Pick<
  AdjustmentInput,
  'productId' | 'quantity' | 'reason' | 'notes'
> & { balance: string };
