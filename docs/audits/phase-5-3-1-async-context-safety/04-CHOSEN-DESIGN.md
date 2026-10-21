# 04 — Chosen Design

## Approach: Context Ref Guard (Option A)

### Core Mechanism

A single `useRef<string | undefined>` tracks the current tenant `id`. It is updated synchronously in a `useEffect([id])`. Every async function checks `idRef.current` against its captured `id` after each `await` point. If they differ, the function returns early without modifying React state.

### Implementation Plan

#### Step 1: Add the ref and sync effect

```typescript
// After useParams
const idRef = useRef(id);
useEffect(() => { idRef.current = id; }, [id]);
```

#### Step 2: Add staleness guard to `load()`

After `await adminFetch(...)` (L119) and after `await res.json()` (L126), add:
```typescript
if (idRef.current !== id) return;
```

This prevents tenant A's billing data from overwriting tenant B's display.

#### Step 3: Add staleness guard to `handlePostCredit()`

After `await adminFetch(...)` (L269) and after `await res.json()` (L279), add:
```typescript
if (idRef.current !== id) return;
```

**Critical detail:** The `saveCreditOp()` call inside `updateCreditOp()` is correctly scoped and MUST still execute — the operation result must be persisted regardless of navigation. Only `setCreditOp()` should be skipped.

This means we need a **conditional update** pattern:
```typescript
// Always persist to storage (correctly scoped)
saveCreditOp(committedOp);
// Only update React state if still on the same tenant
if (idRef.current === id) {
  setCreditOp(committedOp);
}
```

We will NOT call `load()` if context is stale — there is no point refreshing data for a tenant that is no longer displayed.

#### Step 4: Add staleness guard to `handleCheckStatus()`

Same pattern as `handlePostCredit()`:
- Always `saveCreditOp()` (persist result to correct storage key)
- Only `setCreditOp()` if context unchanged
- Only `load()` if context unchanged
- Always `setReconciling(false)` if context unchanged (UI cleanup)

#### Step 5: Add staleness guard to `loadOlderEvents()`

After `await adminFetch(...)` (L395) and `await res.json()` (L402):
```typescript
if (idRef.current !== id) return;
```

#### Step 6: Add staleness guard to `submitStatusAction()`

After `await adminFetch(...)` (L426):
```typescript
if (idRef.current !== id) return;
```

### Design Invariants

1. **Storage writes ALWAYS execute** — `saveCreditOp()` is correctly scoped and must persist regardless of navigation
2. **React state writes ONLY execute if context is current** — `setCreditOp()`, `setData()`, `setAllEvents()`, etc.
3. **The ref is updated synchronously** — `useEffect` fires synchronously during commit, before any async callbacks can run
4. **No new state transitions** — the guard only PREVENTS writes, never causes new ones
5. **No changes to `updateCreditOp` helper** — instead, inline the save+conditional-set pattern at each call site for clarity
6. **Logout handling unchanged** — 401 → `logout()` still fires regardless of context (session is invalid globally)

### Files Modified

| File | Changes |
|------|---------|
| `AdminTenantDetail.tsx` | Add `idRef`, `useEffect`, staleness guards in 5 async functions |
| `AdminTenantDetail.test.tsx` | Add same-component navigation tests with deferred promises |
| `msw-server.ts` | No changes expected |

### What This Does NOT Fix

- HTTP requests still complete on the server (bandwidth waste) — acceptable for this low-traffic admin panel
- `logout()` on 401 is not context-guarded — this is correct behavior (401 means the session is globally invalid)
- `setLoading(false)` in `finally` blocks still fires for stale requests — this is harmless (loading state is reset by the new `load()` call anyway)
