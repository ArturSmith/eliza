export const advancedFeatures = [
  { path: '/action-center', label: 'Action Center' },
  { path: '/replenishment', label: 'Replenishment' },
  { path: '/digital-purchases', label: 'Digital purchases' },
] as const;

export function isFeatureVisible(path: string, enabled: boolean) {
  return (
    enabled ||
    !advancedFeatures.some(
      (feature) => path === feature.path || path.startsWith(feature.path + '/'),
    )
  );
}
