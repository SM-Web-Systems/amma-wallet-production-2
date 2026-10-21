# Phase 5.3.2 — Implementation Plan

## Overview

Three coordinated changes address both findings:

1. **Request generation counter** in `AdminTenantDetail.tsx` — fixes P532-01
2. **Session-aware 401 handling** in `AdminTenantDetail.tsx` — fixes P532-02 (auth)
3. **Conditional financial persistence** in `credit-op-storage.ts` — fixes P532-02 (financial)

## Change 1: Request Generation Counter

### File: `AdminTenantDetail.tsx`

#### Add generation ref (after line 77)

```typescript
const generationRef = useRef(0);
```

#### Modify existing id-tracking effect (line 78)

```typescript
useEffect(() => {
  idRef.current = id;
  generationRef.current += 1;
}, [id]);
```

#### Add navigation state reset effect

Reset loading indicators when tenant changes to prevent stale indicators:

```typescript
useEffect(() => {
  // Reset loading states that may be orphaned by navigation
  setReconciling(false);
  setSuspendBusy(false);
  setLoadingOlder(false);
  setOlderError(null);
  setSuspendError(null);
}, [id]);
```

This can be merged into the existing credit-op restoration effect on `[id]`.

#### Modify each async function

For each of `load`, `handlePostCredit`, `handleCheckStatus`, `loadOlderEvents`, `submitStatusAction`:

1. Capture generation at start: `const gen = generationRef.current;`
2. Replace all `idRef.current !== id` checks with `gen !== generationRef.current`
3. Replace all `idRef.current === id` checks with `gen === generationRef.current`

## Change 2: Session-Aware 401 Handling

### File: `AdminTenantDetail.tsx`

#### Modify `logout` to accept optional token check

Rather than modifying `logout()` itself (which is also used by the UI button), create a helper:

```typescript
const safeLogout = (capturedToken: string | null) => {
  const currentToken = sessionStorage.getItem("aw_admin_token");
  if (currentToken && currentToken === capturedToken) {
    logout();
  }
};
```

#### Modify each async function

At the start, capture the token:

```typescript
const capturedToken = sessionStorage.getItem("aw_admin_token");
```

Replace `logout()` calls in 401 handlers:

```typescript
// Before:
if (res.status === 401) { logout(); return; }

// After:
if (res.status === 401) { safeLogout(capturedToken); return; }
```

#### Move 401 check after staleness check in financial handlers

For `handlePostCredit` and `handleCheckStatus`, the 401 check must come AFTER the generation staleness check:

```typescript
const res = await adminFetch(...);
if (gen !== generationRef.current) {
  // Stale — but for financial ops, still persist result
  if (res.status === 401) {
    // Stale 401 on financial POST: preserve as UNKNOWN
    safeSaveCreditOp({ ...submittingOp, state: "UNKNOWN" });
  }
  return;
}
if (res.status === 401) { safeLogout(capturedToken); return; }
```

For non-financial handlers (`load`, `loadOlderEvents`, `submitStatusAction`), stale responses are simply discarded:

```typescript
const res = await adminFetch(...);
if (gen !== generationRef.current) return;
if (res.status === 401) { safeLogout(capturedToken); return; }
```

## Change 3: Conditional Financial Persistence

### File: `credit-op-storage.ts`

#### Add `statePrecedence` function

```typescript
function statePrecedence(state: string): number {
  switch (state) {
    case "COMMITTED": return 5;
    case "REJECTED": return 4;
    case "UNKNOWN": return 3;
    case "SUBMITTING": return 2;
    case "CONFIRMED": return 1;
    default: return 0;
  }
}
```

#### Add `safeSaveCreditOp` function

```typescript
export function safeSaveCreditOp(op: CreditOperation): boolean {
  const existing = loadCreditOp(op.adminId, op.tenantId);
  if (!existing) {
    saveCreditOp(op);
    return true;
  }
  const existingPrec = statePrecedence(existing.state);
  const incomingPrec = statePrecedence(op.state);
  if (existing.key !== op.key) {
    if (existingPrec >= 4) return false;
    saveCreditOp(op);
    return true;
  }
  if (incomingPrec >= existingPrec) {
    saveCreditOp(op);
    return true;
  }
  return false;
}
```

### File: `AdminTenantDetail.tsx`

#### Import `safeSaveCreditOp`

Add to import from `credit-op-storage`.

#### Replace `saveCreditOp` with `safeSaveCreditOp` in async handlers

In `handlePostCredit`:
- Line 306: `safeSaveCreditOp(rejectedOp)` 
- Line 311: `safeSaveCreditOp(unknownOp)`
- Line 324: `safeSaveCreditOp(committedOp)` — committed should always win
- Line 331: `safeSaveCreditOp(unknownOp)`

In `handleCheckStatus`:
- Line 380: `safeSaveCreditOp(committedOp)`

Keep `saveCreditOp` (unconditional) in `updateCreditOp()` — user-initiated synchronous transitions.

#### Conditional React state update based on persistence result

For committed results, only update React state if persistence succeeded:

```typescript
const saved = safeSaveCreditOp(committedOp);
if (gen === generationRef.current && saved) {
  setCreditOp(committedOp);
  load();
}
```

For non-terminal results (UNKNOWN, REJECTED), update React state based on generation, not persistence:

```typescript
safeSaveCreditOp(unknownOp);
if (gen === generationRef.current) setCreditOp(unknownOp);
```

## Files Changed

| File | Changes |
|------|---------|
| `packages/web-app/src/lib/credit-op-storage.ts` | Add `statePrecedence`, `safeSaveCreditOp` |
| `packages/web-app/src/pages/AdminTenantDetail.tsx` | Add `generationRef`, `safeLogout`; modify 5 async functions; add navigation state resets |
| `packages/web-app/src/pages/AdminTenantDetail.test.tsx` | Add P532 regression tests |

## Unchanged

- `admin-api.ts` — no changes
- `msw-server.ts` — may add handlers for new test scenarios
- Backend — no changes
- Credit operation data model — no new fields
- `saveCreditOp`, `loadCreditOp`, `clearCreditOp` — retained as-is
- `updateCreditOp`, `discardCreditOp` — retained as-is (synchronous user actions)

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Generation counter overflow | JavaScript numbers are safe up to 2^53. Not a practical risk. |
| Token comparison timing | Synchronous comparison — no TOCTOU within single-threaded JS |
| Conditional persistence rejects valid write | Only rejects downgrades; precedence is well-defined |
| Existing tests break | Generation counter is strictly more conservative — existing guards are subset |
