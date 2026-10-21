# 07-TEST-STRATEGY: Phase 5 Testing Approach

**Date:** 2026-10-20

---

## Test Levels

### Unit Tests (Vitest, mocked DB)
- **Backend:** 592 tests in 82 files (was 584 at baseline)
- **Frontend:** 93 tests in 12 files (unchanged count, 1 file fixed — Playwright exclusion)
- **Coverage:** All new code paths have dedicated tests. Mocked tx objects verify DB call sequences.

### Integration Tests (Vitest + real PostgreSQL)
- **Count:** 50 tests in 4 files (was 17 at baseline)
- **Infrastructure:** Isolated test database (`stellarwallet_test`) on port 15432
- **New files:**
  - `db-safety.test.ts` (18 tests) — URL validation, production name rejection, runtime identity
  - `migration-idempotency.test.ts` (9 tests) — column, index, backward compat, duplicate rejection
  - `concurrent-idempotency.test.ts` (6 tests) — dual-connection race conditions

### E2E Tests (Playwright, separate)
- Not modified in Phase 5. Excluded from Vitest discovery (TEST-02).

## Test Design Principles

1. **Financial invariants are assertions, not mocks.** Concurrent tests use two real PostgreSQL connections to verify exactly-once credit and balance-increases-exactly-once.
2. **Fail-closed safety.** db-harness refuses to TRUNCATE unless it can verify it's connected to the test database.
3. **Precision tests prove absence of float corruption.** FI-06 test sends "0.1000001" (cannot be represented exactly as IEEE 754 float) and asserts the string arrives uncorrupted at writeBillingCredit.
4. **Both resolution paths tested.** Concurrent idempotency accepts either (a) both succeed with one duplicate, or (b) one fails with 23505.
