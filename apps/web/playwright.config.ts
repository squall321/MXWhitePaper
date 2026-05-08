import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * Playwright configuration for the MX White Paper web app.
 *
 * Targets the live Apptainer stack:
 *   - Web : http://127.0.0.1:5173
 *   - API : http://127.0.0.1:8800/api/v1
 *
 * Browsers: chromium only is required to keep CI green on Linux. Firefox
 * and WebKit are nice-to-have and can be enabled per project later.
 *
 * Viewport projects:
 *   - desktop  1440x900
 *   - tablet    768x1024
 *   - mobile    375x667
 */
const isCI = !!process.env.CI

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: '../../infra/logs/e2e-report', open: 'never' }],
  ],
  globalSetup: path.resolve(__dirname, './tests/e2e/global-setup.ts'),
  use: {
    // CORS on the API only whitelists `http://localhost:5173`. Use that
    // exact origin (NOT 127.0.0.1) so login/refresh preflight passes.
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'chromium-tablet',
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } },
    },
    {
      name: 'chromium-mobile',
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 667 } },
    },
  ],
})
