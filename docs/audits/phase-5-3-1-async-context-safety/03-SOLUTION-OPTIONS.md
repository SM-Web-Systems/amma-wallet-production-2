# 03 — Solution Options

## Option A: Context Ref Guard

**Mechanism:** Use a `useRef` to track the current `id`. After each `await`, check if `idRef.current` still matches the `id` captured in the closure. If not, discard the result.

```typescript
const idRef = useRef(id);
useEffect(() => { idRef.current = id; }, [id]);

// In any async function:
const res = await adminFetch(`/api/v1/internal/tenants/${id}/billing`);
if (idRef.current !== id) return; // context changed, discard
setData(json); // safe — context unchanged
```

**Pros:**
- Simple, minimal code change
- No new dependencies
- Proven React pattern for async staleness detection
- Each function can independently check staleness after each await
- Does not require refactoring function signatures

**Cons:**
- Must be manually added after EVERY `await` in EVERY async function
- Does not cancel the HTTP request (wastes bandwidth)
- Easy to miss a check in future code changes

**Risk:** LOW — purely subtractive (discards stale results instead of applying them)

---

## Option B: AbortController per Navigation

**Mechanism:** Create an `AbortController` in the `useEffect([id])` that is aborted on cleanup. Pass the signal to all `adminFetch` calls. Aborted requests throw `AbortError`, which can be caught and silently discarded.

```typescript
useEffect(() => {
  const controller = new AbortController();
  // pass controller.signal to all fetch calls initiated from this tenant context
  return () => controller.abort();
}, [id]);
```

**Pros:**
- Cancels in-flight HTTP requests (saves bandwidth, prevents server work for stale requests)
- Browser-native API
- Cleanup is automatic via useEffect return

**Cons:**
- Requires threading the AbortSignal through all async functions
- `adminFetch` needs an `options` parameter for the signal
- Handlers like `handlePostCredit` are triggered by user clicks, NOT by useEffect — they would need their own signal management
- Cannot abort requests started before the useEffect cleanup runs but whose responses arrive after
- More complex implementation — higher risk of introducing bugs

**Risk:** MEDIUM — requires changes to function signatures and `adminFetch` call sites

---

## Option C: Keyed State (Component Key Reset)

**Mechanism:** Add a `key` prop to the component based on `id`, causing React to unmount and remount on every navigation. This resets all state and cancels all in-flight renders.

```tsx
// In App.tsx routing:
<Route path="/admin/tenants/:id" element={<KeyedWrapper />} />

function KeyedWrapper() {
  const { id } = useParams();
  return <AdminTenantDetail key={id} />;
}
```

**Pros:**
- Eliminates ALL state persistence across tenant navigations
- Zero changes to async functions inside the component
- Impossible to have stale closures — old component is destroyed

**Cons:**
- Destroys ALL state on navigation, including legitimate state (scroll position, open modals, form inputs)
- Heavier on React — full unmount/mount cycle instead of re-render
- Loses the performance benefit of component reuse
- Does NOT help if the admin stays on the same tenant but other async races exist
- Changes routing layer, not the component

**Risk:** LOW implementation risk, but MEDIUM UX risk (unexpected state loss)

---

## Option D: Hybrid — Context Ref + Selective Abort

**Mechanism:** Use Option A (context ref guard) for all state writes, combined with selective AbortController for the `load()` function only (since it's automatically triggered by useEffect and is the most common source of stale responses).

**Pros:**
- Best of both worlds: immediate cancellation for auto-triggered fetches, lightweight guards for user-triggered actions
- Minimal changes to user-triggered handlers (only add ref checks)
- No changes to `adminFetch` signature needed (AbortController only for `load`)

**Cons:**
- Slightly more complex than Option A alone
- Two different patterns in the same file

---

## Recommendation: Option A (Context Ref Guard)

**Rationale:**

1. **Smallest change:** Only adds a `useRef`, a `useEffect`, and ~10 guard checks after existing `await` statements
2. **No function signature changes:** `handlePostCredit`, `handleCheckStatus`, etc. remain unchanged except for the staleness checks
3. **Consistent pattern:** Same check everywhere — easy to audit and maintain
4. **Safe for financial operations:** The ref check is purely subtractive — it can only PREVENT state writes, never cause incorrect ones
5. **Storage writes unaffected:** `saveCreditOp()` is already correctly scoped; the ref guard only protects `setCreditOp()` and display state
6. **No UX regression:** Component keeps state when staying on same tenant; only discards stale results

Option B (AbortController) is unnecessarily complex for this scenario — the HTTP requests are small and fast, and the server correctly handles them via idempotency keys. The problem is not the requests themselves but the response handling.

Option C (keyed reset) is heavy-handed and loses legitimate state.

Option D adds complexity without proportional benefit.
