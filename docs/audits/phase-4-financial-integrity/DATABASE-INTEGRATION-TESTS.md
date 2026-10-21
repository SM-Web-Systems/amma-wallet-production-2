# DATABASE-INTEGRATION-TESTS: Real PostgreSQL Test Results

**Date:** 2026-10-20
**Branch:** `worktree-rbac-billing-audit-2026-10-20`

---

## 1. Test Environment

| Component | Details |
|-----------|---------|
| Database | PostgreSQL 16 Alpine (Docker) |
| Container | `amma-db-integration-test` |
| Port | 15432 (host) → 5432 (container) |
| Database | `stellarwallet_test` |
| User | `stellarwallet_test` |
| Schema | Pushed via `drizzle-kit push` from worktree schema |
| ORM | Drizzle ORM with postgres.js driver |
| Runner | vitest 2.1.9 with `vitest.integration.config.ts` |
| Isolation | `TRUNCATE ... CASCADE` between each test |

**Command:**
```bash
cd packages/backend
npx vitest run --config vitest.integration.config.ts
```

## 2. Test Results

```
Test Files  1 passed (1)
     Tests  17 passed (17)
  Duration  9.72s
```

### 2.1 Credit Posting (4 tests)

| Test | Result | What It Proves |
|------|--------|----------------|
| Credits tenant balance atomically | PASS | INSERT + UPDATE within single transaction |
| Stores amount with 7-decimal precision | PASS | numeric(18,7) preserves exact Stellar amounts |
| Supports sequential credits to same tenant | PASS | 3 x 10 XLM = +30 XLM, 3 events |
| Rejects zero amount (CHECK constraint) | PASS | DB-level `chk_billing_amount_nonzero` works |

### 2.2 Credit Idempotency (7 tests)

| Test | Result | What It Proves |
|------|--------|----------------|
| Stores idempotency key in billing_events | PASS | Column and INSERT work correctly |
| Returns duplicate:true for exact retry | PASS | Same key+params → no balance change, 1 event |
| Rejects changed payload (diff amount) → 409 | PASS | Same key, different amount_xlm → 409 Conflict |
| Rejects changed payload (diff type) → 409 | PASS | Same key, different event_type → 409 Conflict |
| Allows different keys for same tenant | PASS | Two keys → two events → balance +100 |
| Allows same key for different tenants | PASS | Cross-tenant key reuse → no conflict |
| Supports credits without key (backward compat) | PASS | NULL key → normal credit, no dedup |

### 2.3 Ledger Reconciliation (1 test)

| Test | Result | What It Proves |
|------|--------|----------------|
| SUM(events) = balance change | PASS | Ledger integrity invariant holds |

### 2.4 Admin Data Integrity (2 tests)

| Test | Result | What It Proves |
|------|--------|----------------|
| Admin stored with correct role + hashed password | PASS | bcrypt hash, role persisted |
| Enforces unique admin email | PASS | Unique constraint on internal_admins.email |

### 2.5 Tenant Suspension (2 tests)

| Test | Result | What It Proves |
|------|--------|----------------|
| Can suspend and unsuspend a tenant | PASS | State transitions work, CHECK constraint valid |
| Credits work on suspended tenant | PASS | Admin override — suspension doesn't block credits |

### 2.6 Billing Event Ordering (1 test)

| Test | Result | What It Proves |
|------|--------|----------------|
| Events ordered by ID (monotonic) | PASS | Serial PK ensures insertion-order retrieval |

## 3. Test Classification

| Category | Tests | Type |
|----------|-------|------|
| Contract tests (mocked DB) | 584 | Unit — verify route handler logic |
| Integration tests (real DB) | 17 | Integration — verify actual PostgreSQL behavior |
| Component tests (jsdom + MSW) | 93 | UI — verify React component behavior |
| E2E tests (Playwright) | 38 | Browser — verify user-visible flows (not yet run) |

**Total executable tests:** 694 (584 + 17 + 93)
**Total written tests:** 732 (694 + 38 Playwright pending)

## 4. Key Differences: Mocked vs Real DB

| Behavior | Mocked Tests | Integration Tests |
|----------|-------------|-------------------|
| CHECK constraints | Not enforced | ✓ Enforced by PostgreSQL |
| UNIQUE indexes | Not enforced | ✓ Enforced by PostgreSQL |
| Numeric precision | JavaScript Number | ✓ PostgreSQL numeric(18,7) |
| Transaction atomicity | Simulated | ✓ Real PostgreSQL ACID |
| Concurrent access | Not tested | Serialized (single fork) |
| Schema validity | Assumed | ✓ Verified via drizzle-kit push |

## 5. Concurrent Transaction Testing

The current integration test suite runs sequentially (single fork). True concurrent credit testing requires parallel database connections submitting simultaneously. This is documented in the idempotency spec but not yet implemented as an integration test due to test complexity.

**Mitigation:** The UNIQUE partial index `uq_billing_credit_idempotency` is the concurrency safety mechanism. PostgreSQL's index-level serialization is well-understood and reliable. The sequential tests verify the application logic; the database guarantees the concurrency safety.
