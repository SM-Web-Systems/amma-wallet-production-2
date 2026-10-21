# 09 — Test Results

## Execution Date: 2026-10-20

## Frontend Unit/Component Tests

**Command:** `cd packages/web-app && npx vitest run`

| Metric | Result |
|--------|--------|
| Test files | 13 passed (13) |
| Tests | 127 passed (127) |
| Duration | ~13s |
| Exit code | 0 |

### Breakdown

| File | Tests | Status |
|------|-------|--------|
| AdminTenantDetail.test.tsx | 35 (22 existing + 13 new) | PASS |
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

### New P53-01 Tests (7)

| Test | Status |
|------|--------|
| not_found keeps op in UNKNOWN state | PASS |
| Preserves original UUID after not_found | PASS |
| Retry after not_found uses original UUID | PASS |
| committed resolves to COMMITTED | PASS |
| Network error on status check stays UNKNOWN | PASS |
| Reload preserves UNKNOWN op in sessionStorage | PASS |
| Reconciliation does not send POST | PASS |

### New P53-02 Tests (6)

| Test | Status |
|------|--------|
| Navigating to different tenant clears stale op | PASS |
| Blocks credit submission for wrong tenant | PASS |
| Blocks reconciliation against wrong tenant | PASS |
| Navigating back restores correct op | PASS |
| Admin B cannot see admin A's op | PASS |
| Missing admin identity blocks financial actions | PASS |

### Pre-fix regression verification

All 3 P53-01 tests FAILED against baseline code (confirmed the defect exists):
- `not_found keeps op in UNKNOWN state` — FAILED (transitioned to REJECTED)
- `Preserves original UUID after not_found` — FAILED (op rejected, key display changed)
- `Retry after not_found uses original UUID` — FAILED (REJECTED state, no retry available)

## Backend Unit Tests

**Command:** `cd packages/backend && npx vitest run`

| Metric | Result |
|--------|--------|
| Test files | 82 passed (82) |
| Tests | 592 passed (592) |
| Duration | ~13s |
| Exit code | 0 |

## TypeScript Checks

**Command:** `cd packages/web-app && npx tsc -b --noEmit`

| Check | Result |
|-------|--------|
| Frontend TypeScript | PASS (clean) |

Note: Pre-existing baseline had a `verbatimModuleSyntax` error on `CreditOperation` import. Fixed by using `type` import keyword.

## Frontend Production Build

**Command:** `cd packages/web-app && npx vite build`

| Check | Result |
|-------|--------|
| Build | PASS (1.63s) |

Note: Pre-existing baseline build failed due to same `CreditOperation` import issue. Fixed alongside P53 changes.

## Tests NOT Executed

| Test | Reason |
|------|--------|
| Backend integration tests | Require PostgreSQL test database provisioning — not safe to run without verified disposable DB |
| E2E tests (Playwright) | Require running dev server and browser — environment not configured |
| Lint checks | Not executed (no lint configuration issues expected from the minimal changes) |

## Summary

- **Passing tests:** 719 (127 frontend + 592 backend)
- **New tests added:** 13 (7 P53-01 + 6 P53-02)
- **Existing baseline failures fixed:** 1 (verbatimModuleSyntax import)
- **Newly introduced failures:** 0
- **Tests not executed:** Backend integration, E2E, lint
