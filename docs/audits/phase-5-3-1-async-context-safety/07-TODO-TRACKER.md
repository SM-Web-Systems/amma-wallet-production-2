# 07 — TODO Tracker

## Task Registry

| ID | Scope | Severity | Status | Description |
|----|-------|----------|--------|-------------|
| T01 | P53-R01 | HIGH | VERIFIED | Write failing same-component navigation tests with deferred promises |
| T02 | P53-R02 | MEDIUM | VERIFIED | Write same-component navigation verification tests |
| T03 | P53-R01 | HIGH | VERIFIED | Verify T01 tests FAIL against baseline (4/4 FAIL — defect demonstrated) |
| T04 | P53-R01 | HIGH | VERIFIED | Implement: add idRef + staleness guards in all async functions |
| T05 | P53-R01 | HIGH | VERIFIED | Verify T01 regression tests pass after fix (4/4 PASS) |
| T06 | P53-R02 | MEDIUM | VERIFIED | Verify T02 tests pass (2/2 PASS) |
| T07 | BOTH | — | VERIFIED | Run full frontend test suite: 133/133 pass |
| T08 | BOTH | — | VERIFIED | Run TypeScript checks: clean |
| T09 | BOTH | — | VERIFIED | Run frontend production build: success |
| T10 | BOTH | — | VERIFIED | Run backend test suite: 592/592 pass |
| T11 | BOTH | — | VERIFIED | Update specification documents |
| T12 | BOTH | — | VERIFIED | Internal code review: all 10 checks PASS |
| T13 | BOTH | — | PENDING | Create local commits |

## Verification Evidence

### T01/T02: Regression tests written
- 4 P53-R01 tests + 2 P53-R02 tests added to AdminTenantDetail.test.tsx
- Tests use `createMemoryRouter` + `RouterProvider` for same-component navigation
- Tests use deferred promises for response timing control

### T03: Pre-fix verification
- All 4 P53-R01 tests FAILED against baseline:
  - `stale load()` — tenant 1 data overwrote tenant 2
  - `stale handlePostCredit` — COMMITTED banner on wrong tenant
  - `stale handleCheckStatus` — COMMITTED banner on wrong tenant
  - `storage persists COMMITTED` — banner visible on wrong tenant

### T04: Implementation
- Added `useRef(id)` + `useEffect` sync (L77-78)
- Added staleness guards in `load()` (L128, L132, L137, L148)
- Added staleness guards in `handlePostCredit()` (L306-333) — saveCreditOp always, setCreditOp conditional
- Added staleness guards in `handleCheckStatus()` (L364-400) — stale variable pattern for financial safety
- Added staleness guards in `loadOlderEvents()` (L425, L431, L435, L445)
- Added staleness guards in `submitStatusAction()` (L466, L471, L473)

### T05/T06: Post-fix verification
- All 6 new tests PASS after fix
- All 35 existing tests continue to PASS

### T07-T10: Full regression
- Frontend: 133/133 tests pass, 0 failures
- Backend: 592/592 tests pass, 0 failures
- TypeScript: clean
- Build: success

### T12: Code review
- Independent subagent review: all 10 checks PASS
- Initial finding (unguarded `setReconcileError` after `res.json()`) addressed via `stale` variable pattern
- No new financial or authorization risks identified
