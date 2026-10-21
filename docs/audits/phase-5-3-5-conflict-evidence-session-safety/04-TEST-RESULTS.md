# Phase 5.3.5 — Test Results

## Targeted Test Summary

### R01: Monotonic conflict evidence (credit-op-storage.test.ts)

| Test ID | Description | Status |
|---------|-------------|--------|
| R01-S01 | UNKNOWN → COMMITTED upgrade succeeds | PASS |
| R01-S02 | COMMITTED → UNKNOWN rejected, existing preserved | PASS |
| R01-S03 | COMMITTED → REJECTED cannot downgrade | PASS |
| R01-S04 | Duplicate COMMITTED preserves correct eventId | PASS |
| R01-S05 | COMMITTED without eventId cannot erase existing eventId | PASS |
| R01-S06 | Altered immutable financial fields cannot replace original | PASS |
| R01-S07 | Different UUIDs remain isolated in conflict evidence | PASS |
| R01-S08 | Delayed network error cannot overwrite committed conflict record | PASS |
| R01-S09 | Malformed existing record treated as overwritable | PASS |

### R02: Session identity in staleness closures (AdminTenantDetail.test.tsx)

| Test ID | Description | Status |
|---------|-------------|--------|
| R02-A | S1 COMMITTED during res.json() cannot update S2 UI | PASS |
| R02-B | Financial result persisted via conflict evidence despite UI rejection | PASS |
| R02-C | Delayed error from S1 cannot display in S2 | PASS |
| R02-D | Obsolete 401 from S1 cannot log out S2 | PASS |

### R03: Conflict evidence failure handling (AdminTenantDetail.test.tsx)

| Test ID | Description | Status |
|---------|-------------|--------|
| R03-A | Quota error triggers warning in current context | PASS |
| R03-B | Stale-context failure cannot update wrong tenant UI | PASS |

## Full Regression Results

### Frontend (packages/web-app)

```
Test Files  14 passed (14)
     Tests  207 passed (207)
  Duration  15.50s
```

All 207 tests across 14 test files pass, including:
- 52 storage-level tests (credit-op-storage.test.ts)
- 83 component-level tests (AdminTenantDetail.test.tsx)
- All prior P532, P533, P534 regression tests

### Backend (packages/backend)

```
Test Suites: 82 passed (82)
     Tests:  592 passed (592)
```

All 592 backend tests pass — confirming no cross-package regressions.

### TypeScript + Production Build

- `npx tsc --noEmit`: Clean (0 errors)
- `npx vite build`: Successful

## Baseline Failure Evidence

All R01, R02, and R03 tests were written before the implementation changes (TDD RED phase).
Tests confirmed to fail on the Phase 5.3.4 baseline (`25bd58d`) due to the defects
described in `00-BASELINE-AND-FINDINGS.md`.
