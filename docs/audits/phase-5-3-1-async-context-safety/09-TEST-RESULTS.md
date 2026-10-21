# 09 — Test Results

## Execution Date: 2026-10-20

## Frontend Unit/Component Tests

**Command:** `cd packages/web-app && npx vitest run`

| Metric | Result |
|--------|--------|
| Test files | 13 passed (13) |
| Tests | 133 passed (133) |
| Duration | ~13s |
| Exit code | 0 |

### Breakdown

| File | Tests | Status |
|------|-------|--------|
| AdminTenantDetail.test.tsx | 41 (35 P53 + 6 new) | PASS |
| credit-op-storage.test.ts | 19 | PASS |
| AdminConsole.test.tsx | 11 | PASS |
| AdminAdmins.test.tsx | 14 | PASS |
| AdminLogin.test.tsx | 6 | PASS |
| admin-api.test.ts | 6 | PASS |
| hd-wallet.test.ts | 5 | PASS |
| api.test.ts | 2 | PASS |
| Swap.test.ts | 3 | PASS |
| Send.test.ts | 2 | PASS |
| wallet-persist.test.ts | 1 | PASS |
| wallet-hd-client.test.ts | 5 | PASS |
| wallet-mnemonic.test.ts | 2 | PASS |

### New P53-R01 Tests (4)

| Test | Status |
|------|--------|
| stale load() response is discarded after tenant navigation | PASS |
| stale handlePostCredit response does not show COMMITTED on wrong tenant | PASS |
| stale handleCheckStatus response does not show reconciliation result on wrong tenant | PASS |
| storage persists COMMITTED even when React state update is discarded | PASS |

### New P53-R02 Tests (2)

| Test | Status |
|------|--------|
| same-component navigation changes displayed tenant without unmount | PASS |
| useEffect clears creditOp on same-component navigation | PASS |

### Pre-fix Regression Verification

All 4 P53-R01 tests FAILED against baseline code (confirmed the defect exists):
- `stale load() response is discarded` — FAILED (tenant 1 data overwrote tenant 2 display)
- `stale handlePostCredit response does not show COMMITTED` — FAILED (COMMITTED banner appeared on tenant 2)
- `stale handleCheckStatus response does not show reconciliation` — FAILED (COMMITTED banner appeared on tenant 2)
- `storage persists COMMITTED even when React state is discarded` — FAILED (banner visible on wrong tenant)

Both P53-R02 tests PASSED against baseline (infrastructure verification — no defect in these tests).

## Backend Unit Tests

**Command:** `cd packages/backend && npx vitest run`

| Metric | Result |
|--------|--------|
| Test files | 82 passed (82) |
| Tests | 592 passed (592) |
| Duration | ~13s |
| Exit code | 0 |

## TypeScript Checks

| Check | Result |
|-------|--------|
| Frontend TypeScript | PASS (clean) |
| Backend TypeScript | Pre-existing errors (not related to P53-R01 changes) |

## Frontend Production Build

| Check | Result |
|-------|--------|
| Build | PASS |

## Summary

- **Passing tests:** 725 (133 frontend + 592 backend)
- **New tests added:** 6 (4 P53-R01 + 2 P53-R02)
- **Newly introduced failures:** 0
