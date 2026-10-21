# 05-TEST-STRATEGY: Test Coverage Assessment & Strategy

**Date:** 2026-10-20  
**Commit:** `a65e19c`  
**Status:** Assessment of current test coverage with gap analysis

---

## 1. Current Test Suite Summary

| Metric | Value |
|--------|-------|
| Test files | 81 |
| Total tests | 566 (564 original + 2 regression) |
| Test framework | vitest 4.1.12 |
| Run time | ~12.7s |
| External dependencies | None (all mocked) |
| Database required | No |
| Pass rate | 100% |

## 2. Test File Inventory (RBAC & Billing Relevant)

### 2.1 Auto-Suspension Tests

| File | Tests | Coverage |
|------|-------|----------|
| `auto-suspension.test.ts` | 23 | enforceDebtLimit, enforceMaintGrace, recoverMaintenanceGrace, recoverDebtLimit, error handling, notifications |
| `auto-suspension-acquisition.test.ts` | 2 | Acquisition mode debt-limit interaction |
| `auto-suspension-guard.test.ts` | ? | Guard-related suspension tests |
| `auto-suspension-concurrency.test.ts` | 3 | Overlapping run prevention |

### 2.2 Billing Service Tests

| File | Tests | Coverage |
|------|-------|----------|
| `billing.service.test.ts` | ? | Stroop arithmetic, billing checks |

### 2.3 Admin Route Tests

| File | Tests | Coverage |
|------|-------|----------|
| `admin-roles-naming.test.ts` | 2 | Role naming conventions |
| Various auth tests | Multiple | JWT verification, token confusion |

### 2.4 Middleware Tests

| File | Tests | Coverage |
|------|-------|----------|
| `tenant-api-key.test.ts` | ? | API key resolution, rate limiting |

## 3. Coverage Gaps Identified

### 3.1 HIGH Priority Gaps

| Gap | Risk | Recommendation |
|-----|------|----------------|
| **No integration tests** — all tests use vitest mocks | Real DB behavior untested (constraints, triggers, concurrent access) | Add integration test suite with test database |
| **No end-to-end billing flow test** | Wallet activation → billing debit → balance update not tested as unit | Add transactional billing flow test with mock DB |
| **TOCTOU behavior untested** | `checkWalletBillingTx` FOR UPDATE lock behavior only tested via mock | Requires integration test to verify |

### 3.2 MEDIUM Priority Gaps

| Gap | Risk | Recommendation |
|-----|------|----------------|
| **Admin role escalation not tested** | platform_admin → super_admin block verified by code review only | Add test: platform_admin cannot create/deactivate super_admin |
| **Env-var API key bypass not tested** | Scope-exempt and rate-limit-exempt path | Add test: env-var key bypasses scopes |
| **Billing policy versioning untested** | Multiple isCurrent=true policies edge case | Add test: only one current policy per tenant |
| **Negative balance edge cases** | Balance at exact boundary values | Add test: balance at debt_limit boundary |

### 3.3 LOW Priority Gaps

| Gap | Risk | Recommendation |
|-----|------|----------------|
| Admin read audit logging | Not currently implemented | Add when FIND-RBAC-002 is addressed |
| Credit amount boundary | Route schema max: 100000, service: no max | Add service-level validation test |
| Multi-process concurrency | isRunning guard per-process only | Document as known limitation |

## 4. Tests Added in This Audit

### 4.1 FIND-BILL-001 Regression Tests (2 tests)

**File:** `packages/backend/src/jobs/auto-suspension.test.ts`

| Test | Purpose | Assertion |
|------|---------|-----------|
| "logs recovery without ReferenceError" | Verifies `recoverDebtLimit()` log line doesn't throw | `console.error` not called; `console.log` contains recovery message |
| "recovers ALL candidates without aborting the loop" | Verifies multiple candidates are processed | `db.update` called twice; `console.error` not called |

**TDD sequence:**
1. Tests written against unfixed code → both FAIL (confirmed undefined `threshold` crash)
2. Fix applied: replaced `${threshold}` with `${t.debtLimit}` in log message
3. Tests re-run → both PASS
4. Full suite: 566/566 pass

### 4.2 FIND-BILL-002 Verification

The `parseFloat → compareDecimalStrings` replacement is a behavioral equivalent for values within IEEE 754 precision range. Existing tests cover the affected code paths (`enforceMaintGrace`, `recoverMaintenanceGrace`, `maybeNotifyDeficit`) and continue to pass, confirming no regression.

## 5. Test Execution

```bash
# From packages/backend/
npx vitest run                              # Full suite
npx vitest run src/jobs/auto-suspension.test.ts  # Targeted
```

All tests are self-contained with no external dependencies (database, network, Stellar).

## 6. Recommended Future Test Additions

### Priority Order

1. **Integration test infrastructure** — Add a test PostgreSQL database for integration tests
2. **Billing transaction atomicity** — Test that partial failures roll back correctly
3. **Admin role guard matrix** — Parametric test covering all 14 endpoints × 4 roles
4. **API key scope enforcement** — Test each scope against relevant endpoints
5. **Auto-suspension state machine** — Test transition edges from the state diagram
6. **Concurrent billing debit** — Test FOR UPDATE lock prevents double-spend

---

## 7. Test Coverage Matrix

### Admin Endpoints × Role Guard Coverage

| Endpoint | super_admin | platform_admin | account_manager | support_agent | Tested? |
|----------|-------------|---------------|-----------------|---------------|---------|
| POST /login | N/A | N/A | N/A | N/A | Yes (auth) |
| GET /me | Allow | Allow | Allow | Allow | Partial |
| GET /tenants | Allow | Allow | Allow | Allow | No |
| GET /tenants/:id/billing | Allow | Allow | Allow | Allow | No |
| GET /tenants/:id/events | Allow | Allow | Allow | Allow | No |
| POST /tenants/:id/credit | Allow | Allow | **403** | **403** | No |
| PATCH /tenants/:id/suspend | Allow | Allow | **403** | **403** | No |
| PATCH /tenants/:id/unsuspend | Allow | Allow | **403** | **403** | No |
| PATCH /tenants/:id/billing-policy | Allow | Allow | **403** | **403** | No |
| GET /admins | Allow | Allow | Allow | Allow | No |
| POST /admins | Allow | Allow* | **403** | **403** | No |
| PATCH /admins/:id/deactivate | Allow | Allow* | **403** | **403** | No |
| PATCH /admins/:id/reactivate | Allow | Allow* | **403** | **403** | No |
| POST /admins/:id/reset-password | Allow | **403** | **403** | **403** | No |

\* platform_admin blocked from targeting super_admin accounts

**Observation:** The role guard matrix has no dedicated test coverage. All enforcement is verified by code review only. This is the single largest test coverage gap.
