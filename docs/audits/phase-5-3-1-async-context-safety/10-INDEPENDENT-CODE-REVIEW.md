# 10 — Independent Code Review

## Reviewer: Independent subagent (Claude Opus)
## Date: 2026-10-20

## Review Checklist

| # | Question | Result | Evidence |
|---|----------|--------|----------|
| 1 | Can a stale `load()` response still overwrite the current tenant's billing data? | **PASS** | Guards at L128, L132, L137 after each `await`. `finally` at L148 also guarded. All 5 state writes (`setData`, `setAllEvents`, `setEventsHasMore`, `setEventsNextCursor`, `setOlderError`) protected. |
| 2 | Can a stale `handlePostCredit` response show a COMMITTED/REJECTED/UNKNOWN banner on the wrong tenant? | **PASS** | Every terminal state transition guards `setCreditOp()` behind `if (idRef.current === id)`. `saveCreditOp()` calls are unconditional (correct). `load()` at L327 is also guarded. |
| 3 | Can a stale `handleCheckStatus` response show a reconciliation result on the wrong tenant? | **PASS** | Guard after first `await` at L364. After `res.json()`, `stale` variable (L366) gates all UI state writes. `saveCreditOp` in committed branch is unconditional. `finally` block guarded. |
| 4 | Is `saveCreditOp()` ALWAYS called regardless of navigation? | **PASS** | Lines 306, 311, 324, 331 (handlePostCredit) and L377 (handleCheckStatus) — `saveCreditOp()` called before any `idRef` check in every branch. |
| 5 | Can `load()` be called from a stale handler after navigation? | **PASS** | `load()` calls at L327 and L380 are inside `if (idRef.current === id)` / `if (!stale)` guards. Defence-in-depth: `load()` also has internal guards. |
| 6 | Is the `idRef` updated synchronously before any async callback can run? | **PASS** | L77 initializes `idRef` to current `id`. L78 `useEffect` updates on `id` change. React commit phase fires before microtask queue. |
| 7 | Are the 401/logout code paths still correct? | **PASS** | In `handlePostCredit` and `handleCheckStatus`, 401 is checked BEFORE idRef guard. In `load()`, 401 is after idRef guard — correct: stale 401 should not log out (current tenant's request will independently detect expired session). |
| 8 | Do the new tests use same-component navigation? | **PASS** | `createMemoryRouter` + `RouterProvider` + `router.navigate()` — component instance is reused across route changes. No `unmount()` calls in P53-R01/R02 tests. |
| 9 | Do the new tests control response timing with deferred promises? | **PASS** | `createDeferred()` utility used in all 4 P53-R01 tests. MSW handlers await deferred promise. Response resolved AFTER navigation. |
| 10 | Have corrections introduced new risks? | **PASS** | Fixes are purely additive (ref + guards). No new state transitions, no removed safety checks, no relaxed guards. `saveCreditOp()` always executes. |

## Initial Finding (Addressed)

The initial review identified a gap: `setReconcileError()` in `handleCheckStatus` was unguarded after `await res.json()`. This was immediately addressed by introducing a `stale` variable (L366) that gates all UI state writes while preserving the unconditional `saveCreditOp()` call in the `committed` branch.

## Verdict

**All ten checks PASS.** The P53-R01 fix correctly prevents stale async responses from corrupting React state after tenant navigation without losing financial evidence.

## Limitation

This is an internal reviewer assessment. It cannot serve as production deployment approval. Independent human review is required before deployment.
