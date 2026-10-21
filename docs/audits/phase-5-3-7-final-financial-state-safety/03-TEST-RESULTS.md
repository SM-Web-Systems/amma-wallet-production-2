# Phase 5.3.7 — Test Results

## Summary

| Suite | Tests | Status |
|-------|-------|--------|
| Frontend (web-app) | 245 | PASS |
| Backend | 592 | PASS |
| TypeScript (--noEmit) | — | PASS |
| **Total** | **837** | **ALL PASS** |

## P537-04: Discriminated conflict evidence results (8 tests)

File: `src/lib/credit-op-storage.test.ts`

| Test | Description | Status |
|------|-------------|--------|
| R04-S01 | Successful write returns `{ kind: "written" }` | PASS |
| R04-S02 | Altered amount returns `{ kind: "identity_conflict" }` | PASS |
| R04-S03 | Altered notes returns `{ kind: "identity_conflict" }` | PASS |
| R04-S04 | Conflicting committedEventIds returns `{ kind: "identity_conflict" }` | PASS |
| R04-S05 | Duplicate compatible COMMITTED is idempotent (`written`) | PASS |
| R04-S06 | COMMITTED->UNKNOWN returns `{ kind: "existing_protected" }` | PASS |
| R04-S07 | Storage failure returns `{ kind: "storage_failed" }` | PASS |
| R04-S08 | existing_protected distinguishable from identity_conflict | PASS |

## P537-01: Storage failure does not replace wrong active UUID (2 tests)

File: `src/pages/AdminTenantDetail.test.tsx`

| Test | Description | Status |
|------|-------------|--------|
| R01-A | Storage failure does not put UUID-A into React while UUID-B is stored | PASS |
| R01-B | No second credit POST after storage failure | PASS |

## P537-02: UUID-bound acknowledge/discard (4 tests)

File: `src/pages/AdminTenantDetail.test.tsx`

| Test | Description | Status |
|------|-------------|--------|
| R02-A | discardCreditOp without key does not set false IDLE | PASS |
| R02-B | handleDiscardConfirmed does not clear a different UUID | PASS |
| R02-C | Matching acknowledge succeeds normally | PASS |
| R02-D | Matching discard succeeds normally | PASS |

## P537-03: Session recovery after stale response (3 tests)

File: `src/pages/AdminTenantDetail.test.tsx`

| Test | Description | Status |
|------|-------------|--------|
| R03-A | Page does not remain stuck on loading after session replacement | PASS |
| R03-B | S2 fresh response renders actual billing data | PASS |
| R03-C | Loading indicators remain consistent | PASS |
| R03-D | Stale request A cannot corrupt in-flight request B's loading or error state | PASS |

## Concurrency preflight (added during push handoff)

The P537-03 `finally` block was refined to add a `superseded` check:
when a newer `load()` has already started (`seq !== loadSeqRef`), a stale
request's `finally` block does nothing — the newer request owns loading/error.
Without this guard, `setLoading(false)` could prematurely clear loading
while a newer request is in-flight.

Test R03-D covers the full sequence: initial load → Refresh (A) → session change →
A finishes stale → Refresh (B) → B renders fresh data with no residual errors.

## Regression impact

- 1 existing test updated: `P533-02-B` — previously expected permanent loading state
  on admin identity change; now correctly expects `setLoading(false)` + "Session changed" error.
- All P534/P536 tests updated to expect discriminated return types instead of booleans.
- Zero unrelated regressions.
