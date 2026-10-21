# Phase 5.3.2 — Independent Internal Code Review

## Review Date

2026-10-21

## Reviewer

Independent Claude agent (no involvement in implementation)

## Files Reviewed

1. `packages/web-app/src/lib/credit-op-storage.ts`
2. `packages/web-app/src/pages/AdminTenantDetail.tsx`
3. `packages/web-app/src/pages/AdminTenantDetail.test.tsx`

## Review Questions

| # | Question | Verdict |
|---|----------|---------|
| 1 | Can A1 overwrite A2 after A→B→A navigation? | **PASS** |
| 2 | Does request identity distinguish different admin sessions? | **PASS** |
| 3 | Can an obsolete HTTP 401 invalidate a newer session? | **PASS** |
| 4 | Can a late network error overwrite COMMITTED? | **PASS** |
| 5 | Can a previous UUID overwrite another operation's record? | **PASS** |
| 6 | Can a delayed committed result be lost? | **PASS** |
| 7 | Are credit POST results treated differently from read responses? | **PASS** |
| 8 | Can loading indicators remain stuck after navigation? | **PASS** |
| 9 | Are all relevant async UI mutations correctly guarded? | **PASS** (after fix) |
| 10 | Do tests prove the defects are fixed? | **PASS** |
| 11 | Are existing financial invariants preserved? | **PASS** |
| 12 | Has the implementation introduced unnecessary complexity? | **PASS** |

## Findings Raised

### Finding R01 — Missing generation check in `submitStatusAction` (RESOLVED)

**Severity:** Low  
**Status:** FIXED

After `const d = await res.json()` in `submitStatusAction`, no generation check was performed before `setSuspendError` or `load()`. Added `if (gen !== generationRef.current) return;` after the second await.

### Finding R02 — Vestigial `idRef` comment (RESOLVED)

**Severity:** Cosmetic  
**Status:** FIXED

The comment on `idRef` still described it as the primary staleness mechanism. Updated to clarify that `generationRef` is the authoritative staleness check and `idRef` is retained only for storage-scoping operations.

### Additional Reviewer Observations

1. **`safeLogout` edge cases verified correct:** null token handling, same-token handling, and cross-session scenarios all behave correctly.
2. **`safeSaveCreditOp` precedence confirmed correct:** COMMITTED(5) > REJECTED(4) > UNKNOWN(3) > SUBMITTING(2) > CONFIRMED(1).
3. **Test patterns verified:** Deferred-promise patterns correctly simulate race conditions with deterministic ordering.
4. **`idRef` retained but not used for staleness:** Acceptable — it provides tenant ID for storage operations and comment clarity.

## Post-Fix Verification

After addressing both findings:
- All 150 frontend tests pass
- TypeScript clean
- No new regressions

## Conclusion

All 12 review questions pass. Two low-severity findings were identified and resolved. The implementation is sound and proportionate to the problem scope.

**Note:** This internal review does not constitute authorization for merge or production deployment. An independent external review (ChatGPT) will examine the GitHub commits separately.
