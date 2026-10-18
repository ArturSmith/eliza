import { afterEach, describe, it, expect, vi } from 'vitest';
import { onboardingPages } from '../packages/contracts/src/index';
import { pageTours, onboardingPage } from '../apps/web/src/onboarding/tours';
import { placeTourCard } from '../apps/web/src/onboarding/placement';
import { readTours, saveTour, tourStorageKey } from '../apps/web/src/onboarding/state';
import russian from '../apps/web/src/i18n/ru.json';
afterEach(() => vi.unstubAllGlobals());
describe('page walkthrough definitions', () => {
  it('covers operational routes and translates every explanation', () => {
    expect(Object.keys(pageTours).sort()).toEqual([...onboardingPages].sort());
    for (const tour of Object.values(pageTours))
      for (const step of tour.steps) {
        expect(step.selector).not.toBe('');
        expect(russian).toHaveProperty(step.title);
        expect(russian).toHaveProperty(step.body);
      }
    expect(onboardingPage('/')).toBe('overview');
    expect(onboardingPage('/pos/receipts/abc/refund')).toBe('refund');
    expect(onboardingPage('/sales/receipts/abc')).toBe('receipt');
    expect(onboardingPage('/unknown')).toBeNull();
  });
  it('keeps the card inside narrow and short viewports', () => {
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1440, height: 900 },
      { width: 568, height: 320 },
    ]) {
      const card = {
        width: Math.min(360, viewport.width - 24),
        height: Math.min(250, viewport.height - 24),
      };
      for (const target of [
        { left: 0, top: 0, width: 100, height: 40 },
        { left: viewport.width - 100, top: viewport.height - 40, width: 100, height: 40 },
        { left: 0, top: 0, width: viewport.width, height: viewport.height },
      ]) {
        const position = placeTourCard(target, viewport, card);
        expect(position.left).toBeGreaterThanOrEqual(12);
        expect(position.top).toBeGreaterThanOrEqual(12);
        expect(position.left + card.width).toBeLessThanOrEqual(viewport.width - 12);
        expect(position.top + card.height).toBeLessThanOrEqual(viewport.height - 12);
      }
    }
  });
  it('isolates employee/store caches and retains progress when storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    const key = tourStorageKey('store-a', 'employee-a');
    const progress = { pageId: 'products' as const, version: 1, status: 'completed' as const };
    saveTour(key, progress, true);
    expect(readTours(key)['products:1']).toMatchObject({ ...progress, pending: true });
    expect(readTours(tourStorageKey('store-b', 'employee-a'))).toEqual({});
    expect(readTours(tourStorageKey('store-a', 'employee-b'))).toEqual({});
  });
  it('retains acknowledgement if storage reads work but writes exceed quota', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    });
    const key = tourStorageKey('quota-store', 'quota-employee');
    saveTour(key, { pageId: 'inventory', version: 1, status: 'skipped' }, true);
    expect(readTours(key)['inventory:1']).toMatchObject({ status: 'skipped', pending: true });
  });
});
