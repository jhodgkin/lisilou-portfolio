// @ts-check
const { defineConfig } = require('@playwright/test');

const BASE_URL = process.env.BASE_URL || 'http://192.168.1.192:8080';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '9yPuNfYjy5kisRKrowhmH42PTeEgH';

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  retries: 1,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
  // Expose config values to tests via env
  globalSetup: undefined,
  env: { ADMIN_SECRET, BASE_URL },
});
