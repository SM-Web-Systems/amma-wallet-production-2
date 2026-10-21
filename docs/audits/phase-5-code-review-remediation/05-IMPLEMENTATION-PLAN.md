# 05-IMPLEMENTATION-PLAN: Phase 5 Remediation Implementation

**Date:** 2026-10-20

---

## Batch A — P0: Financial Integrity & DB Safety

### A1/FI-04: Integration Test Database Safety
- **Approach:** Fail-closed validation — URL parsing + runtime identity check
- **Files modified:** `db-harness.ts` (added `parseTestDbUrl`, `validateTestDatabaseUrl`, `verifyConnectedDatabase`, `ensureVerifiedTestDb`)
- **Files created:** `db-safety.test.ts` (18 tests)
- **Key decisions:** Runtime check uses `SELECT current_database()` only (not `inet_server_port()` which returns container-internal port through Docker). URL-level port check already validates the host port.

### A2/FI-01: Idempotency Key Migration
- **Approach:** Expand-then-deploy — nullable column + CONCURRENTLY unique index
- **Files created:** `migrations/001_add_idempotency_key.sql`, `migration-idempotency.test.ts` (9 tests)
- **Key decisions:** Partial unique index (`WHERE idempotency_key IS NOT NULL`) excludes historical events. `IF NOT EXISTS` makes migration idempotent.

### A3/FI-02: Concurrent Idempotency Recovery
- **Approach:** Catch PostgreSQL 23505 in route handler, re-read committed event outside failed tx
- **Files modified:** `admin.ts` (catch block in credit POST handler)
- **Files created:** `concurrent-idempotency.test.ts` (6 tests with dual connection pools)
- **Key decisions:** Accept both resolution paths — either both succeed (one marked duplicate) or one fails with 23505 (loser is caught and recovered).

### A4/FI-03: Frontend Idempotency Key Lifecycle
- **Approach:** Generate key once at confirmation, reuse on retry, clear on success or input change
- **Files modified:** `AdminTenantDetail.tsx` (added `pendingCreditKey` state)
- **Key decisions:** Key cleared on amount/type changes to allow fresh operations after user edits.

### A5/FI-05: Bundle Fingerprint Expansion
- **Approach:** JOIN to `tenant_bundle_purchases` via `bundlePurchaseId` FK
- **Files modified:** `billing.service.ts`, `admin.ts`
- **Key decisions:** `bundleSlugSnapshot` and `paymentReference` live in `tenant_bundle_purchases`, not `billing_events`. The fingerprint comparison JOINs through the FK rather than duplicating columns.

## Batch B — P1: Frontend & Monetary

### B1/FI-06: Exact XLM Precision
- **Approach:** String-through pipeline — no `parseFloat`/`Number()` in the credit path
- **Files modified:** `admin.ts` (schema + handler), `AdminTenantDetail.tsx` (validation + send)
- **Key decisions:** Fastify schema changed from `type: "number"` to `type: "string"` with regex pattern. Backend pads to 7 decimals via string split/pad. The billing service's `toStroops()` bigint arithmetic was already safe.

### B2/UI-01: Remove bundle_purchase from Credit Form
- **Approach:** Remove dropdown option until bundle catalog selector is built
- **Files modified:** `AdminTenantDetail.tsx`
- **Key decisions:** Simplest safe fix — can't submit what you can't select.

## Batch C — P2: Security & Test Infrastructure

### C1/SEC-01: Tenant-Scoped RBAC
- **Approach:** Investigation only — no code changes
- **Outcome:** Table exists, enforcement missing. BLOCKED pending product decision. See `04-SECURITY-REMEDIATION.md`.

### C3/TEST-02: Vitest/Playwright Separation
- **Approach:** Add `exclude: ["e2e/**"]` to `vitest.config.ts`
- **Files modified:** `packages/web-app/vitest.config.ts`
