import type { Permission } from '@eliza/contracts';
export function canManageUnitMarkdowns(permissions: readonly Permission[]) {
  return (
    permissions.includes('markdowns.manage') &&
    permissions.includes('catalog.write') &&
    permissions.includes('catalog.read')
  );
}
export function canOpenPromotions(permissions: readonly Permission[]) {
  return permissions.includes('promotions.manage') || canManageUnitMarkdowns(permissions);
}
