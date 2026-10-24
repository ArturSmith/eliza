import { describe, expect, it } from 'vitest';
import { canManageUnitMarkdowns, canOpenPromotions } from '../apps/web/src/promotions-access';
describe('discount workspace access', () => {
  it('retains access for employees managing markdowns without promotion permissions', () => {
    expect(canOpenPromotions(['catalog.read', 'catalog.write', 'markdowns.manage'])).toBe(true);
    expect(canManageUnitMarkdowns(['catalog.read', 'catalog.write', 'markdowns.manage'])).toBe(
      true,
    );
    expect(canOpenPromotions(['promotions.manage'])).toBe(true);
    expect(canManageUnitMarkdowns(['promotions.manage'])).toBe(false);
  });
  it('requires all existing catalogue/markdown permissions for the unit workflow', () => {
    for (const permissions of [
      [],
      ['catalog.read'],
      ['markdowns.manage'],
      ['catalog.read', 'catalog.write'],
    ] as const) {
      expect(canManageUnitMarkdowns(permissions)).toBe(false);
      expect(canOpenPromotions(permissions)).toBe(false);
    }
  });
});
