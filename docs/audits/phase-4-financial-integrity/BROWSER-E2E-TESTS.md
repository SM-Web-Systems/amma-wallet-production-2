# BROWSER-E2E-TESTS: Playwright E2E Test Infrastructure

**Date:** 2026-10-20
**Branch:** `worktree-rbac-billing-audit-2026-10-20`

---

## 1. Infrastructure

| Component | Details |
|-----------|---------|
| Framework | Playwright 1.49+ |
| Config | `packages/web-app/playwright.config.ts` |
| Test file | `packages/web-app/e2e/admin-flows.spec.ts` |
| Base URL | `http://localhost:5173` (Vite dev server) |
| Backend | `http://localhost:3001` (API server against test DB) |
| Database | `amma-db-integration-test` on port 15432 |
| Runner | `npx playwright test` from `packages/web-app` |
| Parallelism | Sequential (`workers: 1`, `fullyParallel: false`) |
| Retries | 0 (strict — no flaky passes) |
| Timeout | 30s per test, 10s per action |
| Traces | `retain-on-failure` (captures network, DOM, console) |
| Screenshots | `only-on-failure` |

### Projects (Viewports)

| Project | Device | Resolution |
|---------|--------|------------|
| `desktop-chrome` | Desktop Chrome | 1280 x 720 |
| `mobile-chrome` | Pixel 5 | 393 x 851 |

Every test runs against **both** viewports, yielding 19 tests x 2 = **38 total test cases**.

## 2. Prerequisites

The Playwright tests require a running local stack:

1. **Database:** `docker run -d --name amma-db-integration-test -p 15432:5432 -e POSTGRES_DB=stellarwallet_test -e POSTGRES_USER=stellarwallet_test -e POSTGRES_PASSWORD=stellarwallet_test_pw postgres:16-alpine`
2. **Schema:** `cd packages/backend && npx drizzle-kit push` (pointing to test DB)
3. **Seed:** Admin user `admin@test.com` / `TestPassword12!` seeded via `admin-bootstrap.ts`
4. **Backend:** API server at `localhost:3001` configured against test DB
5. **Frontend:** Vite dev server at `localhost:5173`

**Note:** These tests are NOT part of `npm test`. They require explicit local stack setup.

## 3. Test Scenarios (12 Categories, 19 Tests)

### 3.1 Admin Login and Logout (4 tests)

| Test | What It Proves |
|------|----------------|
| Displays login form | Login page renders email, password, submit button |
| Shows error for invalid credentials | Invalid login returns visible error message |
| Successful login redirects to dashboard | Valid credentials → `/admin` with tenant data |
| Logout clears session and redirects | Logout button → session cleared → `/admin/login` |

### 3.2 Unauthorized Route Redirects (3 tests)

| Test | What It Proves |
|------|----------------|
| Dashboard redirects without session | `/admin` → `/admin/login` |
| Tenant detail redirects without session | `/admin/tenants/1` → `/admin/login` |
| Admin management redirects without session | `/admin/admins` → `/admin/login` |

### 3.3 Tenant Dashboard (2 tests)

| Test | What It Proves |
|------|----------------|
| Displays tenant list | Table/list with tenant data visible after login |
| Shows summary cards | Balance/count summary cards rendered |

### 3.4 Tenant Billing Details (1 test)

| Test | What It Proves |
|------|----------------|
| Navigating to tenant shows billing info | Click tenant → billing/balance/policy visible |

### 3.5 Credit Posting (2 tests)

| Test | What It Proves |
|------|----------------|
| Credit form requires amount | Submit without amount → validation error |
| Credit form shows confirmation dialog | Enter amount + submit → confirmation dialog appears |

### 3.6 Suspension (1 test)

| Test | What It Proves |
|------|----------------|
| Suspend button visible for active tenant | Suspend button rendered on tenant detail page |

### 3.7 Role-Based UI (1 test)

| Test | What It Proves |
|------|----------------|
| Dashboard shows admin info | Role/name displayed after login |

### 3.8 Admin Account Management (1 test)

| Test | What It Proves |
|------|----------------|
| Can navigate to admin management | Staff/admin link → `/admin/admins` page loads |

### 3.9 Billing History (1 test)

| Test | What It Proves |
|------|----------------|
| Billing events section visible | Event/history/billing section rendered on tenant detail |

### 3.10 Session Expiry (1 test)

| Test | What It Proves |
|------|----------------|
| Clearing session triggers login redirect | `sessionStorage.clear()` + navigate → `/admin/login` |

### 3.11 Network Resilience (1 test)

| Test | What It Proves |
|------|----------------|
| Login handles network error gracefully | Blocked API → network/error message visible |

### 3.12 Responsive Design (1 test)

| Test | What It Proves |
|------|----------------|
| Login usable on mobile viewport | 375x667 viewport → form elements visible and usable |

## 4. Test Patterns

### Authentication Fixture

```typescript
async function adminLogin(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel(/email/i).fill(ADMIN_EMAIL);
  await page.getByLabel(/^password$/i).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL("**/admin", { timeout: 10000 });
}
```

All authenticated tests use `test.beforeEach` with `adminLogin`. This ensures each test starts from a known authenticated state.

### Selectors

Tests use resilient selectors:
- `getByRole` for buttons, links, dialogs
- `getByLabel` for form inputs
- `getByText` with regex for content assertions
- `locator("a[href*='/admin/tenants/']")` for navigation

No fragile CSS class or data-testid selectors are used. This reduces maintenance burden when styling changes.

### Network Mocking

The network resilience test uses Playwright's `page.route()` to abort API requests:
```typescript
await page.route("**/api/**", (route) => route.abort("connectionrefused"));
```
This is cleaned up with `page.unrouteAll()` to prevent test pollution.

## 5. Execution Status

| Status | Details |
|--------|---------|
| Tests written | 19 tests (38 with both viewports) |
| Tests executed | **NOT YET** — requires running local stack |
| Blockers | Backend + frontend servers must be running against test DB |

### Running the Tests

```bash
# Start test database (if not already running)
docker start amma-db-integration-test

# Start backend against test DB
cd packages/backend
DATABASE_URL=postgres://stellarwallet_test:stellarwallet_test_pw@localhost:15432/stellarwallet_test \
  npx tsx src/server.ts

# Start frontend dev server
cd packages/web-app
npx vite

# Run tests
cd packages/web-app
npx playwright test
```

## 6. Vitest Isolation

The Playwright test file (`e2e/admin-flows.spec.ts`) uses `@playwright/test` imports, not vitest. When vitest runs in the `web-app` package, it detects the file but warns about async `test.describe()` (a Playwright pattern not compatible with vitest's describe). This warning is harmless — the 93 vitest component tests pass correctly. The Playwright tests are intended to be run via `npx playwright test` only.
