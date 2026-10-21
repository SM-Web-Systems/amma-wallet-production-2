# Phase 5.3.6 — Test Results

## Targeted Test Summary

### P536-01: Persistence outcome separation (AdminTenantDetail.test.tsx)

| Test ID | Description | Status |
|---------|-------------|--------|
| R01-A | Conflict preservation does NOT replace active React state (same route, same session) | PASS |
| R01-B | After conflict preservation, acknowledging active op preserves conflict evidence | PASS |
| R01-C | Successful same-UUID COMMITTED updates React normally | PASS |
| R01-D | Storage failure produces warning without duplicate POST | PASS |
| R01-E | Protected stronger record does not authorize weaker UI update | PASS |

### P536-02: Immutable financial identity enforcement (credit-op-storage.test.ts)

| Test ID | Description | Status |
|---------|-------------|--------|
| R02-S01 | UNKNOWN → COMMITTED with matching identity succeeds | PASS |
| R02-S02 | UNKNOWN → COMMITTED with altered amount rejected | PASS |
| R02-S03 | UNKNOWN → COMMITTED with altered notes rejected | PASS |
| R02-S04 | UNKNOWN → COMMITTED with altered createdAt rejected | PASS |
| R02-S05 | UNKNOWN → COMMITTED with altered type rejected | PASS |
| R02-S06 | Duplicate COMMITTED with identical eventId is idempotent | PASS |
| R02-S07 | Duplicate COMMITTED with different eventIds rejected | PASS |
| R02-S08 | Missing incoming eventId cannot erase existing eventId | PASS |
| R02-S09 | Existing stronger evidence unchanged after invalid identity update | PASS |
| R02-S10 | Invalid identity cannot be mistaken for successful write | PASS |

### P536-03: Read-request session freshness (AdminTenantDetail.test.tsx)

| Test ID | Description | Status |
|---------|-------------|--------|
| R03-A | S1 billing response discarded after S2 session replacement | PASS |
| R03-B | S2 fresh response populates view after session replacement | PASS |
| R03-C | S1 pagination results cannot append to S2 events | PASS |
| R03-D | Obsolete S1 401 cannot log out S2 | PASS |
| R03-E | Financial POST handling independent of read-sequence invalidation | PASS |

## Baseline RED Failures (against 9bc8f8d)

### P536-02 baseline failures (6/10 failed):
- R02-S02: UNKNOWN→COMMITTED with altered amount was accepted (amount overwritten to "999.0000000")
- R02-S03: UNKNOWN→COMMITTED with altered notes was accepted
- R02-S04: UNKNOWN→COMMITTED with altered createdAt was accepted
- R02-S05: UNKNOWN→COMMITTED with altered type was accepted
- R02-S07: COMMITTED with eventId 99 overwrote existing eventId 42
- R02-S10: COMMITTED state/amount overwrote UNKNOWN — identity bypass

### P536-01 baseline failures (2/5 failed):
- R01-A: "Credit posted successfully" appeared for UUID-A despite UUID-B in active slot
- R01-B: (original test) Storage cleared by acknowledging UUID-A (UUID-B destroyed)

### P536-03 baseline failures (3/5 failed):
- R03-A: S1 stale data "S1-Stale-Data" populated the view after session replacement
- R03-B: S1 stale data appeared despite S2 session
- R03-C: S1 pagination notes "S1-stale-pagination" appended to events

## Full Regression Results

### Frontend (packages/web-app)

```
$ cd packages/web-app && npx vitest run
Test Files  14 passed (14)
     Tests  227 passed (227)
  Duration  15.89s
```

All 227 tests across 14 test files pass, including:
- 62 storage-level tests (credit-op-storage.test.ts): +10 new P536-02
- 93+ component-level tests (AdminTenantDetail.test.tsx): +10 new P536-01/P536-03
- All prior P532–P535 regression tests

### Backend (packages/backend)

```
$ cd packages/backend && npx vitest run
Test Files  82 passed (82)
     Tests  592 passed (592)
```

All 592 backend tests pass — no cross-package regressions.

### TypeScript + Production Build

- Frontend `npx tsc --noEmit`: Clean (0 errors)
- Backend `npx tsc --noEmit`: Pre-existing errors only (unrelated to P536 changes)
- `npx vite build`: Successful
