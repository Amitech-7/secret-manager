import { defineConfig } from '@playwright/test'

const API_PORT = 8787
const WEB_PORT = 5173
// Only for locked-down containers where Playwright cannot download its own browser.
const chromium = process.env.E2E_CHROMIUM_PATH

export default defineConfig({
  testDir: './tests',
  // Argon2id at production strength runs in the browser, so allow generous time.
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: chromium
      ? {
          executablePath: chromium,
          args: ['--no-sandbox', '--disable-gpu', '--no-zygote', '--single-process'],
        }
      : {},
  },
  webServer: [
    {
      command: 'pnpm exec tsx server.ts',
      url: `http://localhost:${API_PORT}/api/v1/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // Vite proxies /api to the server above. Any non-empty key enables the captcha widget;
      // the tests replace Cloudflare's script with a stub.
      command: `pnpm --dir ../web exec vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { VITE_TURNSTILE_SITE_KEY: 'e2e-test-key' },
    },
  ],
})
