import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E configuration for AmmaWallet admin UI.
 *
 * Prerequisites:
 *   1. Backend running at http://localhost:3001 (against test DB)
 *   2. Frontend dev server at http://localhost:5173
 *   3. Test admin seeded: admin@test.com / TestPassword12!
 *
 * Run: npx playwright test
 * Run with UI: npx playwright test --ui
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // Admin tests share session state
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 30000,

  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Do not store sensitive data in traces
    actionTimeout: 10000,
  },

  projects: [
    {
      name: "desktop-chrome",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] },
    },
  ],
});
