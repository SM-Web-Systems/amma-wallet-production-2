# Phase 5.3.2 — Request Context Specification

## Selected Design: Option A — Request Generation Counter + Session Token Capture

### Component 1: Request Generation Counter

#### Definition

```typescript
const generationRef = useRef(0);
```

Incremented on every tenant `id` change:

```typescript
useEffect(() => {
  idRef.current = id;
  generationRef.current += 1;
}, [id]);
```

#### Semantics

- Each navigation (including A -> B -> A) produces a new generation
- The generation number is monotonically increasing and never wraps back
- Each async function captures `const gen = generationRef.current` at invocation
- After each `await`, checks `gen !== generationRef.current` to detect staleness
- Replaces the existing `idRef.current !== id` check as the primary guard

#### Why Not Remove idRef?

`idRef` is retained for two reasons:
1. It captures the current tenant ID for use in financial persistence (operation scoping)
2. It provides a readable semantic (`idRef.current`) for debugging
3. Backward compatibility with existing guard patterns

However, the **generation counter** is now the authoritative staleness check. The `idRef` check becomes a secondary safety net.

### Component 2: Session Token Capture

#### Definition

At the start of each async function that may encounter 401:

```typescript
const capturedToken = sessionStorage.getItem("aw_admin_token");
```

Before calling `logout()` on 401:

```typescript
if (res.status === 401) {
  const currentToken = sessionStorage.getItem("aw_admin_token");
  if (currentToken === capturedToken) {
    logout();
  }
  return;
}
```

#### Semantics

- If the token has changed since the request started, the 401 belongs to a stale session
- A stale 401 is silently discarded (no logout, no redirect)
- The token comparison uses strict equality on the string value
- Tokens are transient (read from sessionStorage) — never stored in component state or refs
- No token is persisted in financial operation records

#### Edge Cases

- **Token is null at capture time:** The request was made without authentication. A 401 response is expected and should not trigger logout (there is no session to invalidate). Guard: `if (currentToken && currentToken === capturedToken)`.
- **Token removed between capture and 401:** `currentToken` is null, `capturedToken` is non-null. Comparison fails — no logout. Correct: someone already logged out.
- **Same token, legitimate 401:** Token hasn't changed but server rejected it (expired). Comparison passes — logout is correct.

### Component 3: Staleness-Aware Logout

The `logout()` function itself remains unchanged. The change is in **when** it's called:

1. Check request generation staleness first
2. If stale, skip 401 processing entirely (except financial evidence preservation)
3. If current, check session token match before logout

For financial handlers (`handlePostCredit`, `handleCheckStatus`):
- A stale 401 must NOT trigger logout
- A stale 401 on a financial POST must preserve the operation as UNKNOWN (the server may have committed before returning 401)
- The financial evidence preservation uses conditional persistence (Component 3 of the implementation)

### Affected Functions

| Function | Generation check | Session check | Notes |
|----------|-----------------|---------------|-------|
| `load()` | After each await | Before 401 logout | Pure read — discard stale entirely |
| `handlePostCredit()` | After first await | Before 401 logout | Financial — persist result even if stale |
| `handleCheckStatus()` | After first await | Before 401 logout | Financial — persist committed even if stale |
| `loadOlderEvents()` | After each await | Before 401 logout | Pure read — discard stale entirely |
| `submitStatusAction()` | After first await | Before 401 logout | Mutation — discard stale entirely |

### State Reset on Navigation

When `generationRef.current` increments (tenant change):
- `loading` should be set to `true` by the new `load()` call
- `reconciling` should be reset to `false` (stale reconciliation abandoned)
- `suspendBusy` should be reset to `false`
- `loadingOlder` should be reset to `false`
- `olderError`, `suspendError` should be cleared

This is handled by adding resets to the existing `[id]` effect that already clears `creditOp`.

### Invariants

**CTX-01:** A response from generation N cannot write React state if `generationRef.current > N`.

**CTX-02:** A 401 response cannot trigger `logout()` if the session token has changed since the request was created.

**CTX-03:** Financial evidence persistence (`saveCreditOp`) is exempt from generation-based discard — it uses conditional persistence with state precedence instead.

**CTX-04:** Loading indicators are only modified by the response matching the current generation.

**CTX-05:** The generation counter increments exactly once per tenant `id` change, including A -> B -> A returning to the same ID.
