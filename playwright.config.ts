import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node scripts/e2e-server.mjs',
      url: 'http://127.0.0.1:3002/api/health',
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: 'pnpm --filter @eliza/web exec vite --host 127.0.0.1 --port 5174',
      url: 'http://localhost:5174',
      env: { ELIZA_API_TARGET: 'http://127.0.0.1:3002' },
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
});
