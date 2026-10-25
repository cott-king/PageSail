import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against a production build.
 *  - Default: builds and serves dist/ with `vite preview` (test-only, never for public serving).
 *  - PAGESAIL_BASE_URL=http://127.0.0.1:8080 npm run test:e2e  → tests an already running
 *    deployment, e.g. the Nginx container from compose.yaml.
 */
const external = process.env.PAGESAIL_BASE_URL;
const baseURL = external ?? 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL,
    acceptDownloads: true,
    trace: 'retain-on-failure',
    locale: 'zh-CN',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 960 } },
      testIgnore: /mobile\.spec\.ts/,
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
      testMatch: /mobile\.spec\.ts/,
    },
  ],
  webServer: external
    ? undefined
    : {
        command: 'npx vite build && npx vite preview --port 4173 --strictPort',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
      },
});
