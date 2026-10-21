# Phase 5.3.4 — Root Cause Analysis

## P534-01: Confirmed Financial Evidence Can Be Lost

### Root cause

`safeSaveCreditOp()` in `credit-op-storage.ts:86` correctly rejects a write when
`existing.key !== op.key`. This prevents cross-UUID overwrites, satisfying FIN-02.

However, the callers in `AdminTenantDetail.tsx` treat the returned `false` as
permission to silently discard the operation. When the rejected write contains a
COMMITTED result, the financial evidence for that operation is permanently lost
from browser-side recovery state.

### Affected code paths

| Location | Pattern | Evidence lost? |
|----------|---------|---------------|
| Line 370-373 (stale ok path) | `safeSaveCreditOp(A_COMMITTED)` returns false, handler returns | Yes |
| Line 364 (stale 401 path) | `safeSaveCreditOp(A_UNKNOWN)` returns false, handler returns | Yes (UNKNOWN) |
| Line 375 (stale 5xx path) | `safeSaveCreditOp(A_UNKNOWN)` returns false, handler returns | Yes (UNKNOWN) |
| Line 468-474 (stale reconciliation) | `safeSaveCreditOp(A_COMMITTED)` returns false, handler returns | Yes |
| Lines 394, 400, 414 (non-stale) | `!finStale && accepted` — rejected write skips setCreditOp | UI not updated, but handler continues |

### Why it matters

The server-side ledger is authoritative, but browser-side storage serves as
financial-operation recovery evidence. If the admin's browser is the only
record that operation A was COMMITTED (e.g., the admin needs to verify or
dispute a transaction), silent loss means:

1. The admin cannot prove A was confirmed.
2. The admin cannot reconcile A using the idempotency key.
3. The admin may initiate a duplicate manual investigation.

### Reproduction difficulty

Through normal UI: Very difficult. The SUBMITTING state locks the form.
Through boundary conditions: Possible via storage corruption, browser eviction,
or devtools manipulation. The code path exists and is exercised by tests —
only the fallback is missing.

---

## P534-02: Stale Financial UI Update After Response Parsing

### Root cause

In `handlePostCredit()` at line 360, staleness is computed as a one-time boolean:

```typescript
const finStale = gen !== generationRef.current || capturedAdminId !== getAdminInfo()?.id;
```

This value is captured **before** `const d = await res.json()` at line 382.
After the await, `finStale` is reused without re-evaluation at lines 395, 401,
and 415. If the active tenant, administrator, or session changes during
response-body parsing, the stale boolean incorrectly indicates freshness.

### Why it matters

1. Tenant A's COMMITTED result could be displayed on Tenant B's view.
2. A rejected operation from Tenant A could appear as Tenant B's state.
3. `load()` at line 417 would refresh Tenant B's billing data, which is correct
   for B but was triggered by A's stale result — a confusing UI inconsistency.

### Contrast with correct pattern

`handleCheckStatus()` uses `reconStale()` as a closure (line 462), re-called
after `await res.json()` at line 481. The catch block in `handlePostCredit()`
also re-computes (line 425). Only the try-block after line 382 is vulnerable.

### Reproduction

Requires delaying `res.json()` independently of the fetch response. Standard
MSW deferred promises bundle headers and body, so they cannot isolate this
window. A custom fetch mock that returns a Response with a delayed
ReadableStream body, or a spy that holds `res.json()` via a deferred promise,
can exercise this boundary.
