import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against running servers (pnpm dev, after pnpm db:seed):
 *   ADMIN_URL      default http://localhost:7071/admin  (or http://localhost:7070/admin when the API serves the build)
 *   STOREFRONT_URL default http://localhost:7072
 */
export default defineConfig({
  testDir: '.',
  globalSetup: './global-setup.ts',
  timeout: 60_000,
  retries: 0,
  // The servers run in dev mode and compile on demand; more parallel browsers than this make them the bottleneck.
  workers: Number(process.env.E2E_WORKERS ?? 3),
  // The test database (PGlite) answers one query at a time, so a slow request (a PDF, a report) can hold
  // others for a few seconds; assertions wait up to 10 s instead of the default 5 s.
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
  ],
});
