import { test as base, expect, type Page } from '@playwright/test';
export * from '@playwright/test';
// Existing workflow tests acknowledge first-visit help through the real UI.
// Walkthrough-specific tests import Playwright directly to exercise the tour.
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addLocatorHandler(page.locator('[data-onboarding-dialog][open]'), async (dialog) => {
      await dialog.locator('.page-tour-skip').click();
    });
    await use(page);
  },
});

// Workflows for optional tools explicitly enable the store-wide mode.
export async function enableAdvancedFeatures(page: Page) {
  const profile = await (await page.request.get('/api/store-profile')).json();
  const saved = await page.request.post('/api/store-profile', {
    headers: { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' },
    data: { ...profile, advancedFeaturesEnabled: true },
  });
  expect(saved.ok()).toBe(true);
}
