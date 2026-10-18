import { onboardingProgressSchema, type OnboardingProgress } from '@eliza/contracts';
export type SavedTour = OnboardingProgress & { pending: boolean };
export type TourCache = Record<string, SavedTour>;
const memory = new Map<string, TourCache>();
const volatile = new Set<string>();
export function tourStorageKey(storeId: string, employeeId: string) {
  return `eliza:onboarding:${storeId}:${employeeId}`;
}
export const progressId = (value: Pick<OnboardingProgress, 'pageId' | 'version'>) =>
  `${value.pageId}:${value.version}`;
export function readTours(key: string): TourCache {
  if (volatile.has(key)) return memory.get(key) ?? {};
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '{}');
    const valid: TourCache = {};
    if (parsed && typeof parsed === 'object')
      for (const value of Object.values(parsed)) {
        const result = onboardingProgressSchema.safeParse(value);
        if (result.success)
          valid[progressId(result.data)] = {
            ...result.data,
            pending: (value as SavedTour).pending === true,
          };
      }
    memory.set(key, valid);
    return valid;
  } catch {
    return memory.get(key) ?? {};
  }
}
export function saveTour(key: string, progress: OnboardingProgress, pending: boolean) {
  const cache = { ...readTours(key), [progressId(progress)]: { ...progress, pending } };
  memory.set(key, cache);
  try {
    localStorage.setItem(key, JSON.stringify(cache));
  } catch {
    volatile.add(key);
    /* Keep progress in this session if browser storage is unavailable. */
  }
  return cache;
}
