# 08 — Code Review Questions

These questions will be posed to an independent subagent reviewer after implementation:

1. **Can a stale `load()` response still overwrite the current tenant's billing data?**
   Look for: `setData()`, `setAllEvents()`, etc. called after `await` without an `idRef.current !== id` check.

2. **Can a stale `handlePostCredit` response show a COMMITTED/REJECTED/UNKNOWN banner on the wrong tenant?**
   Look for: `setCreditOp()` called after `await` without a context guard.

3. **Can a stale `handleCheckStatus` response show a reconciliation result on the wrong tenant?**
   Look for: `setCreditOp()`, `setReconcileError()` after `await` without a guard.

4. **Is `saveCreditOp()` ALWAYS called regardless of navigation?**
   The storage write must not be skipped — financial evidence must be persisted.

5. **Can `load()` be called from a stale handler after navigation?**
   Look for: `load()` called after `await` in `handlePostCredit`, `handleCheckStatus`, `submitStatusAction` without a prior context check.

6. **Is the `idRef` updated synchronously before any async callback can run?**
   Verify: `useEffect(() => { idRef.current = id; }, [id])` runs during React commit phase, before microtask queue.

7. **Are the 401/logout code paths still correct?**
   Logout is global (session invalidated) — it should NOT be guarded by the context ref.

8. **Do the new tests use same-component navigation (not unmount/remount)?**
   Verify: single MemoryRouter instance, route change via navigation helper, component NOT unmounted.

9. **Do the new tests control response timing with deferred promises?**
   Verify: MSW handlers return deferred promises; response resolved AFTER navigation.

10. **Have corrections introduced new risks?**
    Check: no new state transitions, no new write paths, no relaxed guards, no removed safety checks.
