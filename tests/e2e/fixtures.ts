import { test as base } from '@playwright/test';
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
