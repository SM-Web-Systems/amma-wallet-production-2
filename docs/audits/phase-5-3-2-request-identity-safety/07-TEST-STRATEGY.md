# Phase 5.3.2 — Test Strategy

## Approach

TDD: Write failing regression tests against the Phase 5.3.1 baseline first, then implement fixes to make them pass.

## Test Infrastructure

- **Vitest** — test runner
- **React Testing Library** — component rendering
- **MSW** — mock HTTP handlers with deferred responses
- **createMemoryRouter + RouterProvider** — same-component navigation (no unmount)
- **Controlled deferred promises** — deterministic ordering of async responses
- **No arbitrary sleeps** — all timing controlled via deferred resolution

## Deferred Promise Pattern

```typescript
function createDeferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}
```

## P532-01 Tests — Request Identity and Stale Response Reuse

### T01: A->B->A stale load() response discarded
- Start on Tenant A, hold billing response A1
- Navigate A -> B -> A
- New request A2 resolves first
- Release A1
- Assert: A2's data displayed, A1's data not applied

### T02: Two overlapping requests for same tenant resolve out of order
- Start on Tenant A, hold first load response
- Trigger manual refresh (second load)
- Second resolves first
- Release first
- Assert: second's data displayed

### T03: Stale paginated events not appended after A->B->A
- Start on Tenant A, trigger Load Older, hold response
- Navigate A -> B -> A
- Release stale pagination response
- Assert: stale events not appended to new view

### T04: Stale suspension status not applied after A->B->A
- Start on Tenant A, trigger suspend, hold response
- Navigate A -> B -> A
- Release stale suspend response
- Assert: tenant A's current view not corrupted

### T05: Different admin sessions viewing same tenant remain isolated
- Admin A starts request for Tenant 1
- Admin B logs in (different session)
- Admin A's response arrives
- Assert: Admin B's view is not affected by Admin A's response

### T06: Existing A->B protection still works
- Verify existing test "stale load() response is discarded after tenant navigation" still passes

## P532-02 Tests — Authentication and Financial Safety

### T07: Stale 401 does not log out newer session
- Admin A starts a billing load
- Admin A logs out, Admin B logs in
- Admin A's request returns 401
- Assert: Admin B's token still in sessionStorage, no redirect

### T08: Stale 401 on credit POST does not log out newer session
- Admin A starts credit POST
- Admin B logs in
- Admin A's POST returns 401
- Assert: Admin B's session preserved

### T09: Delayed reconciliation COMMITTED saved under correct operation
- Start reconciliation for op X on Tenant A
- Navigate to Tenant B
- Reconciliation returns COMMITTED
- Assert: sessionStorage for Tenant A has COMMITTED with correct key

### T10: Active tenant UI unchanged after stale committed response
- Same as T09 but assert Tenant B's UI shows no committed banner

### T11: Late UNKNOWN cannot overwrite stored COMMITTED
- Operation reaches COMMITTED in storage
- Late response tries to write UNKNOWN
- Assert: storage still shows COMMITTED

### T12: Response for older UUID cannot overwrite newer UUID
- Operation X (COMMITTED) in storage
- Late response for operation Y tries to write
- Assert: operation X preserved

### T13: Stale response cannot mutate another admin's credit record
- Admin A has UNKNOWN op in storage
- Admin B's response arrives
- Assert: Admin A's storage unchanged

### T14: Tenant navigation resets reconciling indicator
- Start reconciliation on Tenant A
- Navigate to Tenant B
- Assert: reconciling is false on Tenant B

### T15: Tenant navigation resets loading indicators
- Start on Tenant A with loading in progress
- Navigate to Tenant B
- Assert: no stale loading indicators on Tenant B

### T16: Reload/return restores correct financial operation
- UNKNOWN op for Tenant A in storage
- Navigate to B, then back to A
- Assert: UNKNOWN op correctly restored

### T17: not_found still leaves operation UNKNOWN with same key
- Existing test — verify it still passes with new implementation

### T18: Stale 401 on financial POST preserves operation as UNKNOWN
- Credit POST in-flight
- Navigate away (stale)
- Response is 401
- Assert: operation preserved as UNKNOWN in storage (not lost)

## Test Design Requirements

- All navigation tests use `createMemoryRouter` + `RouterProvider` (same component instance)
- Assert observable UI results AND sessionStorage records
- Track relevant requests via MSW to verify no unintended POST calls
- Tests invoke component handlers through UI interaction, not direct function calls
- At least T01 must fail against baseline and pass after fix
- Financial state precedence tested through controlled ordering

## Baseline Failure Verification

Tests T01 and T11 are specifically designed to fail against the Phase 5.3.1 baseline:
- T01 fails because `idRef.current === id` passes after A->B->A
- T11 fails because `saveCreditOp` has no state precedence check
