# Phase 5.3.3 — Test Strategy

## Testing framework

- Vitest (unit + component)
- React Testing Library (component rendering)
- React Router (createMemoryRouter + RouterProvider for navigation)
- MSW (network mocking)
- Controlled deferred promises (no arbitrary sleeps)

## Test structure

### P533-01 storage tests (credit-op-storage.test.ts)

Test `safeSaveCreditOp` directly for UUID identity matching:
- Different UUID vs UNKNOWN → rejected
- Different UUID vs SUBMITTING → rejected
- Different UUID vs CONFIRMED → rejected
- Same UUID upgrades → accepted
- Terminal state downgrades → rejected
- Empty slot → accepted (new record)

### P533-01 component tests (AdminTenantDetail.test.tsx)

Test React state consistency after rejected persistence:
- Set up a scenario where safeSaveCreditOp returns false
- Verify React state matches storage, not the rejected write
- Use deferred promises to control async timing

### P533-02 component tests (AdminTenantDetail.test.tsx)

Overlapping same-route requests:
- Mount component for tenant A
- Wait for initial load
- Call load() twice (via Refresh button)
- Control resolution order with deferred promises
- Assert route param never changes
- Assert component never unmounts
- Assert newer response wins

Admin switching without navigation:
- Mount as Admin A for tenant X
- Start a load request (deferred)
- Switch session to Admin B (change sessionStorage)
- Resolve Admin A's response
- Assert Admin B's view is unchanged

Financial POST + load independence:
- Start a credit POST
- Click Refresh (triggers load)
- Resolve credit POST
- Assert credit result is NOT treated as stale by load counter

## Controlled deferred promises pattern

```typescript
function createDeferred<T = void>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => { resolve = res; });
    return { promise, resolve };
}
```

## Key assertion patterns

### Same-route overlap

```typescript
// The route parameter must NOT change throughout the test
expect(router.state.location.pathname).toBe("/admin/tenants/1");
// Both requests are for the same tenant
// The older response must not overwrite newer data
```

### Admin switching

```typescript
// Change admin without navigation
sessionStorage.setItem("aw_admin_info", JSON.stringify({id: 2, ...}));
// Resolve old admin's response
// New admin's view must be unchanged
```

### React + storage consistency

```typescript
// After rejected safeSaveCreditOp, verify storage and UI match
const stored = JSON.parse(sessionStorage.getItem(key)!);
// UI should show stored.state, not the rejected state
```

## Baseline failure requirement

At least one test per finding must fail against baseline SHA `a66fb19`:
- P533-01: Test that different UUID can overwrite UNKNOWN → should FAIL (overwrite currently allowed)
- P533-02: Test that overlapping same-tenant requests are ordered → should FAIL (no per-request counter)
