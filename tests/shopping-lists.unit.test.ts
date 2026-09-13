import { describe, expect, it } from 'vitest';
import {
  initialReorderTarget,
  suggestedOrderQuantity,
  shoppingListSaveSchema,
} from '../packages/contracts/src/index';
describe('reorder planning', () => {
  it('subtracts both incoming stock and existing drafts and never suggests negatives', () => {
    expect(suggestedOrderQuantity('20', '4', '3', '4', 'piece')).toBe('9.000');
    expect(suggestedOrderQuantity('10', '4', '8', '1', 'piece')).toBe('0.000');
    expect(suggestedOrderQuantity('1.250', '0.125', '0.250', '0.100', 'kilogram')).toBe('0.775');
  });
  it('rounds discrete products upward and keeps target separate from minimum stock', () => {
    expect(suggestedOrderQuantity('2.3', '0', '0', '0', 'piece')).toBe('3.000');
    expect(initialReorderTarget('0', 'piece')).toBe('1.000');
    expect(initialReorderTarget('5', 'piece')).toBe('10.000');
  });
  it('reports invalid quantities as validation errors instead of throwing', () => {
    const body = {
      requestId: crypto.randomUUID(),
      version: 1,
      name: 'List',
      lines: [
        {
          productId: crypto.randomUUID(),
          supplierId: null,
          target: 'abc',
          quantity: '-1',
          unitCost: '1',
          taxRate: '0',
        },
      ],
    };
    expect(shoppingListSaveSchema.safeParse(body).success).toBe(false);
  });
});
