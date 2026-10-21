# 06 — Implementation Plan

## Execution Order

### Step 1: Write failing regression tests (Phase E)

Before any implementation, write tests that demonstrate the existing defects.

**P53-01 tests** (in `AdminTenantDetail.test.tsx`):
- Test that `not_found` from credit-status does NOT transition to REJECTED.
- Test that the UUID is preserved after `not_found`.
- Test that retry after `not_found` uses the original UUID.

**P53-02 tests** (in `AdminTenantDetail.test.tsx`):
- Test that navigating to a different tenant clears stale creditOp.
- Test that submitting a credit for the wrong tenant is blocked.
- Test that reconciling against the wrong tenant is blocked.
- Test that navigating back restores the correct operation.

**Verification:** All P53-01 and P53-02 regression tests must FAIL against the current code (demonstrating the defect exists).

### Step 2: Implement P53-01 fix

**File:** `AdminTenantDetail.tsx`
**Function:** `handleCheckStatus`

1. Remove lines 319-325 (the `not_found` → REJECTED transition).
2. Replace with: set `reconcileError` to an informational message explaining that the credit status could not be confirmed.
3. The operation stays in UNKNOWN state. The admin can retry or check again.

**Expected test result:** P53-01 regression tests now PASS.

### Step 3: Implement P53-02 fix

**File:** `AdminTenantDetail.tsx`

1. **Fix useEffect([id]):** Add `setCreditOp(null); setCreditError(null); setReconcileError(null);` at the start of the effect, before restoration.
2. **Add identity guard to handlePostCredit:** Check `creditOp.tenantId === id` and `creditOp.adminId === getAdminInfo()?.id` before the fetch.
3. **Add identity guard to handleCheckStatus:** Same checks before the fetch.

**Expected test result:** P53-02 regression tests now PASS.

### Step 4: Run full test suite

Run all existing frontend tests to verify no regressions.

### Step 5: Update documentation

Update diagrams and specs to reflect the implemented changes.

### Step 6: Internal code review

Use a separate subagent to review the changes against the financial invariants.

## Files Modified

| File | Changes |
|------|---------|
| `packages/web-app/src/pages/AdminTenantDetail.tsx` | P53-01 fix (handleCheckStatus), P53-02 fix (useEffect + guards) |
| `packages/web-app/src/pages/AdminTenantDetail.test.tsx` | New regression tests for P53-01 and P53-02 |
| `packages/web-app/src/test/msw-server.ts` | Add credit-status handler for tests |

## Files NOT Modified

| File | Reason |
|------|--------|
| `credit-op-storage.ts` | No changes needed — storage layer is correct |
| `admin-api.ts` | No changes needed |
| `packages/backend/src/routes/admin.ts` | No backend changes required |
| `packages/backend/src/services/billing.service.ts` | No backend changes required |

## Commit Strategy

1. **Commit 1:** Regression tests for P53-01 and P53-02 (tests that fail against baseline)
2. **Commit 2:** P53-01 fix — remove unsafe `not_found` → REJECTED transition
3. **Commit 3:** P53-02 fix — clear stale state on tenant change + identity guards
4. **Commit 4:** Documentation and diagrams

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| P53-01 fix makes UNKNOWN operations unresolvable | Low | Retry with same key is safe; future Option C (server registry) can be added |
| P53-02 useEffect clearing causes flicker | Low | Clearing then restoring in the same synchronous effect should batch in React |
| Identity guards reject legitimate operations | Low | Guards check exact match on tenantId/adminId which are set at creation time |
| Existing tests break | Low | Changes are additive (new guards, removed unsafe transition) |
