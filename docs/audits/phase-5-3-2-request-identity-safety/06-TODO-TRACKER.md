# Phase 5.3.2 — TODO Tracker

## P532-01: Request Identity and Stale Response Reuse

| ID | Task | Root Cause | Files | Invariant | Change | Failing Test | Passing | Reviewer | Status |
|----|------|-----------|-------|-----------|--------|-------------|---------|----------|--------|
| 01-A | Generation counter ref | RC-01: idRef cycles back on A→B→A | AdminTenantDetail.tsx | CTX-01, CTX-05 | Added `generationRef`, increments in `[id]` effect | T01, T02 | T01, T02 pass | R: PASS | VERIFIED |
| 01-B | Guard `load()` with generation | RC-01 | AdminTenantDetail.tsx | CTX-01, CTX-04 | Replace `idRef` checks with `gen` checks | T01, T02 | pass | R: PASS | VERIFIED |
| 01-C | Guard `loadOlderEvents()` with generation | RC-01 | AdminTenantDetail.tsx | CTX-01 | Replace `idRef` checks with `gen` checks | T03 | pass | R: PASS | VERIFIED |
| 01-D | Guard `submitStatusAction()` with generation | RC-01 + R01 fix | AdminTenantDetail.tsx | CTX-01 | Replace `idRef` checks, add post-json check | T04 | pass | R: PASS | VERIFIED |
| 01-E | Guard `handlePostCredit()` with generation | RC-01 | AdminTenantDetail.tsx | CTX-01 | Replace `idRef` checks | T05 | pass | R: PASS | VERIFIED |
| 01-F | Guard `handleCheckStatus()` with generation | RC-01 | AdminTenantDetail.tsx | CTX-01 | Replace `idRef` checks | T09, T10 | pass | R: PASS | VERIFIED |

## P532-02: Safe Financial Results and Authentication Completion

| ID | Task | Root Cause | Files | Invariant | Change | Failing Test | Passing | Reviewer | Status |
|----|------|-----------|-------|-----------|--------|-------------|---------|----------|--------|
| 02-A | Session-aware logout | RC-02 | AdminTenantDetail.tsx | CTX-02 | Added `safeLogout()`, capture token at request start | T07, T08 | pass | R: PASS | VERIFIED |
| 02-B | `safeSaveCreditOp` with state precedence | RC-03 | credit-op-storage.ts | FIN-04, FIN-05 | Added `safeSaveCreditOp()`, `statePrecedence()` | T11, T12 | pass | R: PASS | VERIFIED |
| 02-C | Conditional persistence in `handlePostCredit` | RC-03, RC-05 | AdminTenantDetail.tsx | FIN-01–FIN-10 | Replace `saveCreditOp` with `safeSaveCreditOp` | T18 | pass | R: PASS | VERIFIED |
| 02-D | Conditional persistence in `handleCheckStatus` | RC-03 | AdminTenantDetail.tsx | FIN-02, FIN-04 | Replace `saveCreditOp` with `safeSaveCreditOp` | T09 | pass | R: PASS | VERIFIED |
| 02-E | Stale financial POST evidence preservation | RC-05 | AdminTenantDetail.tsx | FIN-05, FIN-08 | Stale 401 on POST → preserve UNKNOWN; stale 200 → persist COMMITTED | T18 | pass | R: PASS | VERIFIED |
| 02-F | Loading indicator reset on navigation | RC-04 | AdminTenantDetail.tsx | CTX-04 | Reset `reconciling`, `suspendBusy`, `loadingOlder` in `[id]` effect | T14, T15 | pass | R: PASS | VERIFIED |
| 02-G | Update vestigial idRef comment | R02 | AdminTenantDetail.tsx | — | Clarify generationRef is authoritative | — | — | R: PASS | VERIFIED |

## Summary

- **Total tasks:** 13
- **Verified:** 13
- **Failed:** 0
- **Blocked:** 0
