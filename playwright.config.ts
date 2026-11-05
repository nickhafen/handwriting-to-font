import { defineConfig } from '@playwright/test'

const PORT = 5174

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}/handwriting-to-font/`,
    // Locally, use the installed Chrome instead of downloading Playwright's Chromium.
    // CI runs `npx playwright install chromium` and uses that.
    channel: process.env.CI ? undefined : 'chrome',
  },
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/handwriting-to-font/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
