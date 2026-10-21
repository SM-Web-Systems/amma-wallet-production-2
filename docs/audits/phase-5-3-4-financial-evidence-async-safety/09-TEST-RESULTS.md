# Phase 5.3.4 — Test Results

## Red phase (baseline failures)

| Test ID | Finding | Expected failure reason | Actual result | Status |
|---------|---------|----------------------|---------------|--------|
| S01-S07 | P534-01 | saveConflictEvidence/loadConflictEvidence not exported | TypeError: not a function | CONFIRMED RED (import error) |
| P534-01-A | P534-01 | loadConflictEvidence not exported | TypeError: not a function | CONFIRMED RED (import error) |
| P534-01-B | P534-01 | loadConflictEvidence not exported | TypeError: not a function | CONFIRMED RED (import error) |
| P534-01-D | P534-01 | loadConflictEvidence not exported | TypeError: not a function | CONFIRMED RED (import error) |
| P533-01-G | P534-01 | loadConflictEvidence not exported (corrected test) | TypeError: not a function | CONFIRMED RED (import error) |
| P534-02-A | P534-02 | finStale not re-evaluated, COMMITTED shown on wrong tenant | "Credit posted successfully" found on Tenant B | CONFIRMED RED |
| P534-02-B | P534-02 | finStale not re-evaluated after admin change | COMMITTED shown for wrong admin | CONFIRMED RED |
| P534-02-C | P534-02 | finStale not re-evaluated, rejection shown on wrong tenant | "Credit rejected" shown on Tenant B | CONFIRMED RED |

### Behavioral red-test proof (no import errors)

The P534-01 tests in AdminTenantDetail.test.tsx fail on baseline due to `loadConflictEvidence`
not existing (import error), not a behavioral assertion failure. To provide genuine behavioral
proof, a separate test file (`AdminTenantDetail.p534-baseline.test.tsx`) was created that imports
only baseline-available exports (`storageKey`).

| Test ID | Finding | Expected failure reason | Actual baseline result | Status |
|---------|---------|----------------------|----------------------|--------|
| P534-01-BASELINE | P534-01 | UUID-A COMMITTED evidence silently discarded when UUID-B occupies active slot | `expected false to be true` at assertion line 195 — `findCommittedEvidence(uuidA)` returns false because no sessionStorage record exists for UUID-A | **CONFIRMED BEHAVIORAL RED** |

This test scans sessionStorage directly (without importing `loadConflictEvidence`) for any record
containing UUID-A with state COMMITTED, excluding the active slot. On baseline, `safeSaveCreditOp`
rejects the write and the evidence vanishes. On P534, `safePersistWithConflict` stores it under a
conflict key.

## Green phase (post-implementation)

| Test ID | Finding | Result |
|---------|---------|--------|
| S01 | P534-01 | PASS |
| S02 | P534-01 | PASS |
| S03 | P534-01 | PASS |
| S04 | P534-01 | PASS |
| S05 | P534-01 | PASS |
| S06 | P534-01 | PASS |
| S07 | P534-01 | PASS |
| P534-01-A | P534-01 | PASS |
| P534-01-B | P534-01 | PASS |
| P534-01-C | P534-01 | PASS |
| P534-01-D | P534-01 | PASS |
| P533-01-G (corrected) | P534-01 | PASS |
| P534-02-A | P534-02 | PASS |
| P534-02-B | P534-02 | PASS |
| P534-02-C | P534-02 | PASS |
| P534-02-D | P534-02 | PASS (regression — existing behavior) |
| P534-02-E | P534-02 | PASS |
| P534-01-BASELINE | P534-01 | PASS (behavioral regression — separate file) |

## Full regression (verified 2026-10-21)

| Suite | Command | Count | Result |
|-------|---------|-------|--------|
| Frontend Vitest (full) | `npx vitest run` | 192 tests, 14 files | ALL PASS |
| Backend Vitest (unit) | `npx vitest run` | 592 tests, 82 files | ALL PASS |
| Frontend TypeScript | `npx tsc --noEmit` | — | Clean (0 errors) |
| Frontend production build | `npx vite build` | — | Successful |

## Comparison to baseline

| Metric | Baseline | Post-P534 | Delta |
|--------|----------|-----------|-------|
| Frontend tests | 175 | 192 | +17 (7 storage + 9 component + 1 behavioral baseline) |
| Backend tests | 592 | 592 | 0 |
| Frontend TypeScript errors | 0 | 0 | 0 |
| Frontend build | Pass | Pass | No change |
