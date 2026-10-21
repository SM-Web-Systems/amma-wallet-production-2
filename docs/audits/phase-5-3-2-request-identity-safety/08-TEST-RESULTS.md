# Phase 5.3.2 — Test Results

## Execution Date

2026-10-21

## TDD Red Phase (Baseline: f45a56e)

11 of 17 P532 regression tests failed against baseline as expected.

### Failed (confirming defects exist)

| Test | Finding | Failure reason |
|------|---------|----------------|
| T01 | P532-01 | A→B→A stale A1 overwrites newer A2 (idRef passes) |
| T02 | P532-01 | Overlapping loads — older overwrites newer |
| T03 | P532-01 | Stale pagination events appended after A→B→A |
| T05 | P532-01 | Admin session isolation not enforced |
| T07 | P532-02 | Stale 401 logs out newer admin session |
| T08 | P532-02 | Stale 401 on credit POST logs out newer session |
| T09 | P532-02 | Delayed reconciliation COMMITTED not persisted after nav |
| T11 | P532-02 | `safeSaveCreditOp` does not exist (import error) |
| T12 | P532-02 | `safeSaveCreditOp` does not exist (import error) |
| T15 | P532-02 | Suspend loading indicator stuck after navigation |
| T18 | P532-02 | Stale 401 on financial POST does not preserve UNKNOWN |

### Passed (already working or testing existing behavior)

| Test | Finding | Reason |
|------|---------|--------|
| T04 | P532-01 | Suspend indicator reset by re-render on nav |
| T06 | P532-01 | Existing A→B protection (idRef) still works |
| T10 | P532-02 | UI unchanged after stale committed (existing idRef guard) |
| T14 | P532-02 | Reconciling indicator reset on nav (existing clearing) |
| T16 | P532-02 | Return navigation restores operation (existing behavior) |
| T17 | P532-02 | not_found preserves UNKNOWN (existing P53-01 behavior) |

## TDD Green Phase (Post-implementation)

All 17 P532 regression tests pass.

## Full Frontend Test Suite

```
Command: npx vitest run --reporter=verbose
Working directory: packages/web-app
Exit code: 0

Test Files  13 passed (13)
      Tests  150 passed (150)
   Duration  13.92s
```

**Comparison to baseline: 133 → 150 tests (+17 new P532 tests, 0 regressions)**

## Frontend TypeScript Check

```
Command: npx tsc -b --noEmit
Working directory: packages/web-app
Exit code: 0
Errors: 0
```

## Frontend Production Build

```
Command: npx vite build
Working directory: packages/web-app
Exit code: 0
Result: ✓ built in 1.64s
```

## Backend Unit Test Suite

```
Command: npx vitest run --reporter=verbose
Working directory: packages/backend
Exit code: 0

Test Files  82 passed (82)
      Tests  592 passed (592)
   Duration  12.55s
```

**No backend changes made. Backend tests confirm no regression.**

## Backend TypeScript Check

```
Command: npx tsc --noEmit
Working directory: packages/backend
Exit code: 2
Errors: 3 (pre-existing, identical to baseline)
```

Pre-existing errors (verified present in Phase 5.3.1 baseline):
- `src/server.ts(2543)`: Cannot find name 'cleanupEmptyTrustlines'
- `src/services/billing.service.test.ts(248)`: Property 'amountXlm' type narrowing
- `src/services/billing.service.test.ts(304)`: Property 'amountXlm' type narrowing

**These are NOT introduced by Phase 5.3.2.**

## Tests Not Executed

| Suite | Reason |
|-------|--------|
| Backend integration tests | Require provisioned PostgreSQL test database |
| Browser E2E (Playwright) | Require running dev/staging services |
| Backend `vitest.integration.config.ts` | Database-dependent |

## New Regressions

None.

## Safety-Related Blockers

None.
