/**
 * AmmaWallet Admin UI — Playwright E2E Tests
 *
 * These tests run against a local full-stack environment:
 *   - Frontend: Vite dev server at localhost:5173
 *   - Backend: API server at localhost:3001 (pointing to test DB)
 *   - Database: amma-db-integration-test on port 15432
 *
 * Test admin credentials (seeded via admin-bootstrap.ts):
 *   email: admin@test.com
 *   password: TestPassword12!
 *
 * Run: cd packages/web-app && npx playwright test
 *
 * NOTE: These tests require a running local stack. They are NOT run
 * as part of the standard `npm test` command.
 */

import { test, expect, type Page } from "@playwright/test";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const ADMIN_EMAIL = "admin@test.com";
const ADMIN_PASSWORD = "TestPassword12!";

async function adminLogin(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel(/email/i).fill(ADMIN_EMAIL);
  await page.getByLabel(/^password$/i).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  // Wait for redirect to dashboard
  await page.waitForURL("**/admin", { timeout: 10000 });
}

// ── 1. Admin login and logout ────────────────────────────────────────────────

test.describe("Admin login and logout", () => {
  test("displays login form", async ({ page }) => {
    await page.goto("/admin/login");
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/^password$/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in|log in/i })).toBeVisible();
  });

  test("shows error for invalid credentials", async ({ page }) => {
    await page.goto("/admin/login");
    await page.getByLabel(/email/i).fill("wrong@test.com");
    await page.getByLabel(/^password$/i).fill("wrongpassword");
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    await expect(page.getByText(/invalid|unauthorized|incorrect/i)).toBeVisible({ timeout: 5000 });
  });

  test("successful login redirects to admin dashboard", async ({ page }) => {
    await adminLogin(page);
    await expect(page).toHaveURL(/\/admin$/);
    // Dashboard should show tenant data
    await expect(page.getByText(/tenant/i)).toBeVisible({ timeout: 10000 });
  });

  test("logout clears session and redirects to login", async ({ page }) => {
    await adminLogin(page);
    await page.getByRole("button", { name: /logout|sign out/i }).click();
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});

// ── 2. Unauthorized route redirects ──────────────────────────────────────────

test.describe("Unauthorized route redirects", () => {
  test("admin dashboard redirects to login without session", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test("tenant detail redirects to login without session", async ({ page }) => {
    await page.goto("/admin/tenants/1");
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test("admin management redirects to login without session", async ({ page }) => {
    await page.goto("/admin/admins");
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});

// ── 3. Tenant dashboard loading ──────────────────────────────────────────────

test.describe("Tenant dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
  });

  test("displays tenant list", async ({ page }) => {
    await expect(page.getByText(/tenant/i)).toBeVisible();
    // Should have at least one tenant visible
    await expect(page.locator("table, [role=table], [class*=tenant]").first()).toBeVisible({ timeout: 10000 });
  });

  test("shows summary cards", async ({ page }) => {
    // Look for balance/count summary cards
    await expect(page.getByText(/total|balance|active/i).first()).toBeVisible({ timeout: 10000 });
  });
});

// ── 4. Tenant billing details ────────────────────────────────────────────────

test.describe("Tenant billing details", () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
  });

  test("navigating to tenant shows billing information", async ({ page }) => {
    // Click on first tenant row or link
    const firstTenantLink = page.locator("a[href*='/admin/tenants/']").first();
    await firstTenantLink.click();
    await page.waitForURL("**/admin/tenants/**");

    // Should show billing details
    await expect(page.getByText(/balance|billing|policy/i).first()).toBeVisible({ timeout: 10000 });
  });
});

// ── 5. Credit confirmation and submission ────────────────────────────────────

test.describe("Credit posting", () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
    // Navigate to first tenant
    const firstTenantLink = page.locator("a[href*='/admin/tenants/']").first();
    await firstTenantLink.click();
    await page.waitForURL("**/admin/tenants/**");
  });

  test("credit form requires amount", async ({ page }) => {
    // Try to submit without amount
    const postCreditBtn = page.getByRole("button", { name: /post credit/i }).first();
    await postCreditBtn.click();
    // Should show validation error
    await expect(page.getByText(/amount|required|positive/i)).toBeVisible({ timeout: 5000 });
  });

  test("credit form shows confirmation dialog", async ({ page }) => {
    // Fill in credit amount
    const amountInput = page.getByLabel(/amount/i).or(page.locator("input[type=number]")).first();
    await amountInput.fill("10");

    const postCreditBtn = page.getByRole("button", { name: /post credit/i }).first();
    await postCreditBtn.click();

    // Confirmation dialog should appear
    await expect(page.getByRole("dialog").or(page.getByText(/confirm|irreversible/i))).toBeVisible({ timeout: 5000 });
  });
});

// ── 6. Suspension and unsuspension ───────────────────────────────────────────

test.describe("Suspension", () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
    const firstTenantLink = page.locator("a[href*='/admin/tenants/']").first();
    await firstTenantLink.click();
    await page.waitForURL("**/admin/tenants/**");
  });

  test("suspend button is visible for active tenant", async ({ page }) => {
    await expect(
      page.getByRole("button", { name: /suspend/i }).first()
    ).toBeVisible({ timeout: 10000 });
  });
});

// ── 7. Role-based action restrictions ────────────────────────────────────────

test.describe("Role-based UI", () => {
  test("admin dashboard shows admin info after login", async ({ page }) => {
    await adminLogin(page);
    // Should display the logged-in admin name or role
    await expect(page.getByText(/super_admin|admin/i).first()).toBeVisible({ timeout: 10000 });
  });
});

// ── 8. Admin account management ──────────────────────────────────────────────

test.describe("Admin management", () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
  });

  test("can navigate to admin management", async ({ page }) => {
    const adminLink = page.getByRole("link", { name: /staff|admin|accounts/i }).first();
    await adminLink.click();
    await page.waitForURL("**/admin/admins");
    await expect(page.getByText(/admin|staff/i).first()).toBeVisible({ timeout: 10000 });
  });
});

// ── 9. Billing history pagination ────────────────────────────────────────────

test.describe("Billing history", () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
    const firstTenantLink = page.locator("a[href*='/admin/tenants/']").first();
    await firstTenantLink.click();
    await page.waitForURL("**/admin/tenants/**");
  });

  test("billing events section is visible", async ({ page }) => {
    await expect(
      page.getByText(/event|history|billing/i).first()
    ).toBeVisible({ timeout: 10000 });
  });
});

// ── 10. Session expiry ───────────────────────────────────────────────────────

test.describe("Session handling", () => {
  test("clearing session storage triggers login redirect on next navigation", async ({ page }) => {
    await adminLogin(page);
    // Clear session storage
    await page.evaluate(() => sessionStorage.clear());
    // Navigate
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});

// ── 11. Network errors ───────────────────────────────────────────────────────

test.describe("Network resilience", () => {
  test("login form handles network error gracefully", async ({ page }) => {
    // Block API requests
    await page.route("**/api/**", (route) => route.abort("connectionrefused"));
    await page.goto("/admin/login");
    await page.getByLabel(/email/i).fill(ADMIN_EMAIL);
    await page.getByLabel(/^password$/i).fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    // Should show network error message
    await expect(page.getByText(/network|connection|error/i)).toBeVisible({ timeout: 5000 });
    // Unblock
    await page.unrouteAll();
  });
});

// ── 12. Viewport tests ──────────────────────────────────────────────────────

test.describe("Responsive design", () => {
  test("login page is usable on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/admin/login");
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in|log in/i })).toBeVisible();
  });
});
