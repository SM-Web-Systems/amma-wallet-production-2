# Phase 5.3.2 — Root Cause Analysis

## RC-01: Tenant Identity Is Not Request Identity

**Finding:** P532-01  
**Severity:** HIGH  
**Location:** `AdminTenantDetail.tsx` lines 77-78

### Mechanism

```typescript
const idRef = useRef(id);
useEffect(() => { idRef.current = id; }, [id]);
```

The `idRef` tracks **which tenant is currently displayed**, not **which request is currently expected**. This is sufficient for the A -> B case (different tenant IDs), but fails for A -> B -> A because the tenant ID cycles back to the original value.

### Timeline

```
T0: id="A", idRef.current="A"    — load() fires, request A1 starts
T1: navigate to B                 — idRef.current="B"
T2: navigate back to A            — idRef.current="A", load() fires, request A2 starts
T3: A2 resolves                   — idRef.current="A" === id="A" -> ACCEPTED (correct)
T4: A1 resolves                   — idRef.current="A" === id="A" -> ACCEPTED (WRONG)
```

A1 carries **older** data than A2 but passes the staleness check because tenant identity alone cannot distinguish request generations.

### Required Fix

Track a monotonically increasing request generation counter. Each navigation or `load()` call increments the counter. After an `await`, compare the captured generation to the current generation — not just the tenant ID.

---

## RC-02: Logout Has No Session Identity Verification

**Finding:** P532-02  
**Severity:** HIGH  
**Location:** `AdminTenantDetail.tsx` lines 115-119, 129, 290, 362, 431, 469

### Mechanism

```typescript
const logout = () => {
  sessionStorage.removeItem("aw_admin_token");
  sessionStorage.removeItem("aw_admin_info");
  navigate("/admin/login");
};
```

Every async handler calls `logout()` on HTTP 401 without verifying that the token which generated the 401 is still the active session token.

### Timeline

```
T0: Admin A token = "token-A" in sessionStorage
T1: Admin A's request starts (adminFetch captures "token-A")
T2: Admin A logs out
T3: Admin B logs in, token = "token-B" in sessionStorage
T4: Admin A's request returns 401 (server rejected "token-A")
T5: logout() removes "token-B" — Admin B is logged out
```

### Required Fix

Capture the session token (or a derivative) at request creation time. Before calling `logout()`, verify that the captured token still matches what is currently in sessionStorage. If it doesn't, the 401 belongs to an obsolete session and must not affect the current one.

---

## RC-03: Financial Persistence Has No Terminal-State Precedence

**Finding:** P532-02 (financial invariants)  
**Severity:** HIGH  
**Location:** `credit-op-storage.ts` line 51-53, `AdminTenantDetail.tsx` lines 306-331

### Mechanism

```typescript
export function saveCreditOp(op: CreditOperation): void {
  sessionStorage.setItem(storageKey(op.adminId, op.tenantId), JSON.stringify(op));
}
```

`saveCreditOp()` performs an unconditional overwrite. There is no check for:
- Whether the existing stored state is terminal (COMMITTED, REJECTED)
- Whether the incoming state would be a downgrade (UNKNOWN overwriting COMMITTED)
- Whether the incoming operation UUID matches the stored operation UUID

### Scenario

```
T0: Credit op X created (key="uuid-1", state=CONFIRMED)
T1: Submit -> state=SUBMITTING, request R1 starts
T2: Network timeout -> saveCreditOp({state: "UNKNOWN"}) — R1 catch block
T3: User clicks "Retry" -> state=SUBMITTING, request R2 starts  
T4: R2 succeeds -> saveCreditOp({state: "COMMITTED", eventId: 42})
T5: R1 finally resolves with 500 -> saveCreditOp({state: "UNKNOWN"}) — OVERWRITES COMMITTED
```

This is possible because `handlePostCredit` constructs `submittingOp` from `creditOp` at call time, and the catch block writes its own `unknownOp` based on that snapshot — not checking what's currently in storage.

### Required Fix

Implement conditional persistence: before writing, read the current stored state. If the stored state is terminal (COMMITTED or REJECTED), do not allow a non-terminal state to overwrite it. Define explicit valid state transitions.

### State Precedence (highest to lowest)

1. **COMMITTED** — immutable, cannot be downgraded
2. **REJECTED** — immutable, cannot be downgraded  
3. **UNKNOWN** — can transition to COMMITTED (via reconciliation) or retry to SUBMITTING
4. **SUBMITTING** — in-flight, can transition to COMMITTED/REJECTED/UNKNOWN
5. **CONFIRMED** — pre-submission, can transition to SUBMITTING

### Valid Transitions

```
CONFIRMED -> SUBMITTING (only)
SUBMITTING -> COMMITTED | REJECTED | UNKNOWN
UNKNOWN -> SUBMITTING (retry) | COMMITTED (reconciliation)
COMMITTED -> (none — terminal)
REJECTED -> (none — terminal)
```

A write that would violate these transitions must be silently rejected (the storage already contains a more authoritative result).

---

## RC-04: Loading Indicators Not Scoped to Request Generation

**Finding:** P532-02 (UI indicators)  
**Severity:** MEDIUM  
**Location:** `AdminTenantDetail.tsx` `finally` blocks at lines 147-149, 402-404, 446-448, 477-479

### Mechanism

Each async function sets a loading flag to `true` at the start and `false` in the `finally` block, guarded only by `idRef.current === id`.

After A -> B -> A, two requests may be in-flight for the same tenant ID. When the first (stale) request completes, its `finally` block sets `loading = false` while the second (current) request is still pending.

### Required Fix

Associate loading state with request generation. Only the response matching the current generation should reset loading indicators.

---

## RC-05: 401 Processed Before Staleness Check in Financial Handlers

**Finding:** P532-02 (authentication)  
**Severity:** HIGH  
**Location:** `AdminTenantDetail.tsx` line 290 (`handlePostCredit`), line 362 (`handleCheckStatus`)

### Mechanism

In `handlePostCredit()`:
```typescript
const res = await adminFetch(...);           // line 281
if (res.status === 401) { logout(); return; } // line 290 — NO staleness check first
const d = await res.json();                   // line 291
```

The 401 check happens immediately after the first await, before any `idRef` check. Even if the response is stale (admin navigated away), the logout executes.

For `handleCheckStatus()`, the 401 check at line 362 also precedes the first `idRef` check at line 364.

Combined with RC-02, this means a stale 401 from any async operation can log out a different administrator's session.

### Required Fix

Check staleness (via request generation) **before** processing 401. If the request is stale, skip the 401 entirely and handle the response as discardable (except for financial evidence preservation).

---

## Browser Storage Atomicity Limitations

sessionStorage provides:
- Synchronous read/write within a single tab
- No cross-tab visibility (unlike localStorage)
- No transactional guarantees across multiple read-then-write sequences

Within a single tab, JavaScript is single-threaded, so there is no true race condition on the read-check-write pattern. However, multiple `await` points create interleaving opportunities where two async continuations can both read the "current" state before either writes.

For conditional persistence, the read-check-write must be atomic (no `await` between read and write). Since sessionStorage is synchronous and JS is single-threaded within a tab, this is achievable by performing the check-and-write in a synchronous function.

Cross-tab scenarios (admin opens two tabs) are outside scope — sessionStorage is already per-tab.
