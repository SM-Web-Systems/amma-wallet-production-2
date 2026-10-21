# Phase 5.3.4 — Implementation Plan

## Order of operations

1. Write failing regression tests (TDD red phase)
2. Implement P534-01 (conflict evidence preservation)
3. Implement P534-02 (async context revalidation)
4. Verify all tests pass (TDD green phase)
5. Full regression suite
6. Internal code review

## File changes

### credit-op-storage.ts

1. Add `CONFLICT_PREFIX` constant.
2. Add `conflictKey()` helper.
3. Add `saveConflictEvidence()` — saves rejected COMMITTED/UNKNOWN evidence under a UUID-specific key.
4. Add `loadConflictEvidence()` — scans sessionStorage for conflict records matching (admin, tenant).
5. Add `clearConflictEvidence()` — removes a specific conflict record.

### credit-op-storage.test.ts

1. Add P534-01 tests for conflict evidence: save, load, clear, deduplication, storage failure, malformed records.

### AdminTenantDetail.tsx

1. **P534-01:** After each `safeSaveCreditOp` that returns false for COMMITTED/UNKNOWN, call `saveConflictEvidence`.
   - Stale OK path (line 370-373)
   - Stale 401 path (line 364)
   - Stale 5xx path (line 375)
   - Stale reconciliation path (line 468-474)
   - Non-stale paths (lines 394, 400, 414) — these already skip UI update, but should also save conflict evidence for COMMITTED results.

2. **P534-01 UI:** Add conflict-evidence banner in the Post Credit section. Load conflict evidence on mount/tenant change. Display when present.

3. **P534-02:** Convert `finStale` from a boolean to an `isFinStale()` closure. Add re-evaluation after `await res.json()`. Add stale-path handling (with conflict evidence) for the newly detected stale case.

### AdminTenantDetail.test.tsx

1. Fix P533-01-G test to actually exercise a delayed POST response.
2. Add P534-01 tests: conflict evidence preserved on cross-UUID rejection.
3. Add P534-02 tests: context revalidation after res.json() with delayed body.

## Commit plan

1. **Commit 1:** Failing regression tests (red phase).
2. **Commit 2:** Implementation of P534-01 and P534-02.
3. **Commit 3:** Updated specs, diagrams, and verification results.

## Risk assessment

- **Low risk:** Changes are additive (new functions, new checks). No existing behavior removed.
- **Conflict evidence:** sessionStorage only, tab-scoped, no backend dependency.
- **isFinStale():** Drop-in replacement for finStale boolean. Same logic, re-evaluated.
- **UI banner:** Informational only. No state-modifying actions.
