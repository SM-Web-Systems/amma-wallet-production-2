# 01-FINDINGS-VERIFICATION: Independent Code Review Findings Assessment

**Date:** 2026-10-20
**Reviewed commit:** `d8b619b`

---

## Batch A — Financial Integrity and Database Safety

### FI-04 (A1): Integration Test Database Safety — CONFIRMED

**Severity:** P0 — Safety
**File:** `packages/backend/src/test-integration/db-harness.ts`
**Root cause:** `db-harness.ts` line 17-19 accepts `TEST_DATABASE_URL` or falls back to a hardcoded localhost:15432 URL. The `truncateAll()` function executes `TRUNCATE ... CASCADE` without verifying the connected database is actually a disposable test instance. If `DATABASE_URL` leaks into the integration test runner (e.g., wrong env file loaded), destructive operations could hit production.
**Evidence:** No host/port/dbname validation exists. No database identity check before TRUNCATE.
**Status:** CONFIRMED — requires remediation.

### FI-01 (A2): Database Migration Compatibility — CONFIRMED

**Severity:** P0 — Deployment blocker
**Files:** `packages/backend/src/db/schema/index.ts`, `packages/backend/src/services/billing.service.ts`
**Root cause:** The Drizzle schema defines `idempotencyKey` column and a partial unique index, but no migration script exists. The `writeBillingCredit` service reads from and writes to `idempotency_key` column — if deployed against a database without the column, queries will fail. The application must not break if the column doesn't exist yet (expand-then-deploy).
**Evidence:** `billing.service.ts:544` SELECTs `idempotencyKey`, `billing.service.ts:587` INSERTs it.
**Status:** CONFIRMED — migration script needed, not yet created.

### FI-02 (A3): Concurrent Idempotency Conflict Recovery — CONFIRMED

**Severity:** P0 — Financial integrity
**Files:** `packages/backend/src/services/billing.service.ts`, `packages/backend/src/routes/admin.ts`
**Root cause:** Under READ COMMITTED, two concurrent transactions can both pass the SELECT check at line 544-555 and both attempt INSERT. PostgreSQL's UNIQUE index will cause one to fail with a constraint violation. Currently, the route handler at `admin.ts:517-523` only catches errors with `statusCode === 409` (application-level). A PostgreSQL unique violation has a different error structure (`code: '23505'`). The losing transaction will propagate an unhandled database error to the client (500 ISE) rather than returning the idempotent duplicate response.
**Evidence:** No `catch` for PostgreSQL error code `23505` in `writeBillingCredit` or the route handler. Integration tests run sequentially — concurrent scenario untested.
**Status:** CONFIRMED — must handle UNIQUE violation gracefully.

### FI-03 (A4): Frontend Idempotency Key Lifecycle — CONFIRMED

**Severity:** P0 — Financial integrity
**File:** `packages/web-app/src/pages/AdminTenantDetail.tsx`
**Root cause:** `handlePostCredit()` at line 164 generates `crypto.randomUUID()` inside the submission function, called from the confirmation dialog. If the network request fails (timeout, connection loss), the function exits via the `catch` block at line 186. On the next retry click, `handlePostCredit()` is called again, generating a **new** UUID. The backend treats this as a new credit operation.
**Evidence:** `const idempotencyKey = crypto.randomUUID();` at line 164 — inside the function, not stored externally. After network error, the confirmation dialog is closed (`setCreditConfirmOpen(false)` at line 155), and re-clicking "Post credit" opens a new dialog which calls `handlePostCredit` again with a fresh UUID.
**Status:** CONFIRMED — key must persist across retries for the same logical operation.

### FI-05 (A5): Immutable Financial Request Fingerprint — CONFIRMED

**Severity:** P1
**File:** `packages/backend/src/services/billing.service.ts`
**Root cause:** Idempotency conflict check at line 559 compares only `eventType` and `amountXlm`. For `bundle_purchase`, two requests with the same key, same amount, same type, but different `bundleSlugSnapshot` or `paymentReference` would be treated as duplicates rather than conflicts. This could allow a bundle purchase to silently succeed with the wrong bundle identity.
**Evidence:** `existing.eventType !== eventType || existing.amountXlm !== amountXlm` — only two fields checked.
**Status:** CONFIRMED — fingerprint should include bundle identity for bundle_purchase.

---

## Batch B — Frontend and Monetary Correctness

### FI-06 (B1): XLM Precision — CONFIRMED

**Severity:** P1
**Files:** `packages/web-app/src/pages/AdminTenantDetail.tsx`, `packages/backend/src/routes/admin.ts`
**Root cause:** Frontend at line 170 uses `parseFloat(creditAmount)` before sending. Route schema at line 397 declares `amount_xlm` as `type: "number"`. The amount travels through JSON as an IEEE 754 float. While practical precision loss is negligible for amounts under 100,000 XLM with 7 decimals (within float64's 15-digit precision), the correct approach for financial amounts is to use string representation to guarantee exactness.
**Evidence:** `amount_xlm: amount` where `amount = parseFloat(creditAmount)` at line 155/170. Backend converts via `parsedAmount.toFixed(7)` at line 496.
**Status:** CONFIRMED — low risk but correctness improvement warranted.

### UI-01 (B2): Bundle Purchase Missing bundle_slug — CONFIRMED

**Severity:** P1
**File:** `packages/web-app/src/pages/AdminTenantDetail.tsx`
**Root cause:** Frontend credit form at line 658 offers `bundle_purchase` as a select option. The POST body at line 168-172 never sends `bundle_slug`. Backend at line 475-477 requires `bundle_slug` for `bundle_purchase` type and returns 400. The user would select "Bundle purchase", fill in an amount, confirm, and get an error.
**Evidence:** No bundle_slug input field or bundle catalog lookup in the component.
**Status:** CONFIRMED — either add bundle selection UI or disable the option.

---

## Batch C — Security and Test Infrastructure

### SEC-01 (C1): Tenant-Scoped RBAC — INVESTIGATION NEEDED

**Severity:** P2
**File:** `packages/backend/src/db/schema/index.ts` (line ~853)
**Observation:** `admin_tenant_assignments` table exists in the schema with (admin_id, tenant_id) pairs. No route handler references this table for access control. All admin roles currently have platform-wide read access.
**Status:** INVESTIGATION NEEDED — requires product decision. Will document alternatives and mark BLOCKED if no existing specification covers this.

### TEST-02 (C3): Vitest/Playwright Separation — CONFIRMED

**Severity:** P2
**File:** `packages/web-app/vitest.config.ts` (missing e2e exclusion)
**Root cause:** `packages/web-app` does not have its own `vitest.config.ts` with explicit exclusion of `e2e/`. The default vitest discovery picks up `e2e/admin-flows.spec.ts`, which imports from `@playwright/test` and uses async `test.describe()` — incompatible with vitest. Result: "1 failed" file in vitest output despite 93/93 tests passing.
**Status:** CONFIRMED — exclude `e2e/` from vitest in web-app.

---

## Summary

| ID | Finding | Severity | Status |
|----|---------|----------|--------|
| A1/FI-04 | Integration test DB safety | P0 | CONFIRMED |
| A2/FI-01 | Database migration missing | P0 | CONFIRMED |
| A3/FI-02 | Concurrent idempotency recovery | P0 | CONFIRMED |
| A4/FI-03 | Frontend idempotency key lifecycle | P0 | CONFIRMED |
| A5/FI-05 | Narrow idempotency fingerprint | P1 | CONFIRMED |
| B1/FI-06 | Float precision in amounts | P1 | CONFIRMED |
| B2/UI-01 | Bundle purchase missing slug | P1 | CONFIRMED |
| C1/SEC-01 | Tenant-scoped RBAC | P2 | INVESTIGATION |
| C3/TEST-02 | Vitest discovers Playwright | P2 | CONFIRMED |
