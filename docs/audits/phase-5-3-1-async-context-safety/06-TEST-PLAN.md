# 06 — Test Plan

## Test Infrastructure

### Deferred Promise Utility

All P53-R01 tests require precise control over when API responses resolve. We use a deferred promise pattern:

```typescript
function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
```

### Same-Component Navigation Helper

Tests render a MemoryRouter with multiple routes and use programmatic navigation (via a test wrapper or Link clicks) to change the `id` param WITHOUT unmounting the component:

```typescript
function renderWithNavigation(initialTenantId: string) {
  // Render with a navigator component that allows programmatic route changes
  return render(
    <MemoryRouter initialEntries={[`/admin/tenants/${initialTenantId}`]}>
      <Routes>
        <Route path="/admin/tenants/:id" element={<AdminTenantDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}
```

Since `useNavigate` is mocked, we need an alternative for same-component navigation. The approach is to use a `NavigateHelper` component inside the MemoryRouter that exposes route changes, or to use `MemoryRouter`'s programmatic API.

## P53-R01 Tests (Same-Component Navigation Races)

### R01-T01: Stale load() response discarded after tenant navigation

**Setup:** Render tenant A. Install deferred MSW handler for `/tenants/A/billing`.
**Action:** Trigger `load()` for tenant A. Navigate to tenant B. Resolve deferred (tenant A data).
**Assert:** Display shows tenant B's data, NOT tenant A's.

### R01-T02: Stale handlePostCredit response does not show COMMITTED banner on wrong tenant

**Setup:** Render tenant A. Start credit, enter amount, confirm. Install deferred handler for POST `/tenants/A/credit`.
**Action:** Submit credit. Navigate to tenant B. Resolve deferred (200 OK committed).
**Assert:** Tenant B does NOT show "Credit posted successfully" banner. Storage for tenant A correctly contains COMMITTED state.

### R01-T03: Stale handleCheckStatus response does not show reconciliation result on wrong tenant

**Setup:** Render tenant A. Pre-seed UNKNOWN op for tenant A in sessionStorage. Install deferred handler for GET `/tenants/A/credit-status`.
**Action:** Click "Check credit status". Navigate to tenant B. Resolve deferred (committed).
**Assert:** Tenant B does NOT show "Credit posted successfully". Storage for tenant A updated to COMMITTED.

### R01-T04: Storage is always updated even when React state is discarded

**Setup:** Same as R01-T02.
**Action:** Submit credit for tenant A. Navigate to tenant B. Resolve deferred (200 OK).
**Assert:** `sessionStorage` contains COMMITTED op for tenant A at correct key. React state for tenant B is clean.

### R01-T05: Stale load() from handlePostCredit success does not overwrite tenant B's data

**Setup:** Render tenant A. Install deferred handler for POST `/tenants/A/credit` that returns 200.
**Action:** Submit credit. Navigate to tenant B (which loads successfully). Resolve deferred for credit POST.
**Assert:** `data.tenantName` displayed is tenant B's name, not tenant A's.

### R01-T06: Navigation back to tenant A after stale response shows correct restored state

**Setup:** Render tenant A. Start credit. Navigate to tenant B. Stale response arrives. Navigate back to tenant A.
**Assert:** Tenant A shows correct state restored from sessionStorage.

## P53-R02 Tests (Same-Component Navigation Pattern Verification)

### R02-T01: Same-component navigation changes id without unmounting

**Setup:** Render tenant A. Verify "ACME Corp" displayed. Navigate to tenant B.
**Assert:** "Beta Inc" displayed. Component was NOT unmounted (verify via ref or spy).

### R02-T02: useEffect([id]) clears creditOp on same-component navigation

**Setup:** Render tenant A. Pre-seed UNKNOWN op for tenant A in storage. Verify UNKNOWN banner shows. Navigate to tenant B.
**Assert:** UNKNOWN banner is NOT visible on tenant B.

## Pre-Fix Verification

Before implementing the fix, at minimum R01-T01, R01-T02, and R01-T03 must FAIL against the baseline code, demonstrating the defect exists. These tests detect the stale state write that currently has no guard.

## Existing Tests

All 35 existing tests (22 original + 13 from Phase 5.3) must continue to pass. No existing test should be modified.
