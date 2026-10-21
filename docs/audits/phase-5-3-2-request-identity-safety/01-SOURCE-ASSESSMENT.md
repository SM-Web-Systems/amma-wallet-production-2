# Phase 5.3.2 — Source Assessment

## Async Execution Path Inventory

### 1. `load()` (lines 121-150)

| Property | Value |
|----------|-------|
| **Trigger** | `useEffect` on mount and `id` change (line 152-155) |
| **Originating admin** | Implicit via `aw_admin_token` in sessionStorage |
| **Originating tenant** | Closure-captured `id` from `useParams()` |
| **Originating session** | Not tracked |
| **Financial operation** | None |
| **Await points** | 3: `adminFetch()`, `res.json()` (error path), `res.json()` (success path) |
| **State mutations after await** | `setData`, `setAllEvents`, `setEventsHasMore`, `setEventsNextCursor`, `setOlderError`, `setError`, `setLoading` |
| **Storage mutations** | None |
| **Logout action** | Line 129: `if (res.status === 401) { logout(); return; }` |
| **Staleness guard** | `idRef.current !== id` checked after each await |
| **P532-01 vulnerable** | YES — A->B->A makes `idRef.current === id` true again |
| **P532-02 vulnerable** | YES — 401 calls `logout()` without session verification |

### 2. `handlePostCredit()` (lines 255-335)

| Property | Value |
|----------|-------|
| **Trigger** | User clicks "Post credit" in confirmation dialog or "Retry submission" |
| **Originating admin** | `creditOp.adminId` (verified at line 269) |
| **Originating tenant** | `creditOp.tenantId` (verified at line 264) |
| **Originating session** | Not tracked — token read at call time by `adminFetch` |
| **Financial operation** | `creditOp.key` (UUID) |
| **Await points** | 2: `adminFetch()`, `res.json()` |
| **State mutations after await** | `setCreditOp` (lines 307, 312, 325, 332) |
| **Storage mutations** | `saveCreditOp()` at lines 306, 311, 324, 331 — **unconditional** |
| **Logout action** | Line 290: `if (res.status === 401) { logout(); return; }` — **before staleness check** |
| **Staleness guard** | `idRef.current === id` for React state only; storage writes are unconditional |
| **P532-01 vulnerable** | YES — A->B->A allows late response to write React state |
| **P532-02 vulnerable** | YES — 401 on line 290 has no session check; unconditional `saveCreditOp` has no state precedence |

**Critical observation:** The 401 check (line 290) executes **before** any `idRef` staleness check. If admin A's credit request returns 401 after admin B logs in, admin B is logged out.

**Financial persistence issue:** `saveCreditOp(unknownOp)` at line 331 writes unconditionally. If a retry already wrote COMMITTED, the late network error overwrites it with UNKNOWN.

### 3. `handleCheckStatus()` (lines 342-405)

| Property | Value |
|----------|-------|
| **Trigger** | User clicks "Check credit status" |
| **Originating admin** | `creditOp.adminId` (verified at line 350) |
| **Originating tenant** | `creditOp.tenantId` (verified at line 348) |
| **Originating session** | Not tracked |
| **Financial operation** | `creditOp.key` |
| **Await points** | 2: `adminFetch()`, `res.json()` |
| **State mutations after await** | `setCreditOp`, `setReconcileError`, `setReconciling` |
| **Storage mutations** | `saveCreditOp(committedOp)` at line 380 — unconditional on "committed" |
| **Logout action** | Line 362: `if (res.status === 401) { logout(); return; }` — **before idRef check** |
| **Staleness guard** | `idRef.current !== id` at line 364 (first), then `stale` variable at line 368 |
| **P532-01 vulnerable** | YES — A->B->A makes stale check pass |
| **P532-02 vulnerable** | YES — 401 before session check; `saveCreditOp` unconditional |

**Note:** The `stale` variable on line 368 re-checks `idRef.current !== id` after the second await, which is correct architecture but still vulnerable to A->B->A.

### 4. `loadOlderEvents()` (lines 424-449)

| Property | Value |
|----------|-------|
| **Trigger** | User clicks "Load older" |
| **Originating admin** | Implicit via token |
| **Originating tenant** | Closure-captured `id` |
| **Originating session** | Not tracked |
| **Financial operation** | None |
| **Await points** | 3: `adminFetch()`, `res.json()` (error), `res.json()` (success) |
| **State mutations after await** | `setAllEvents` (append), `setEventsHasMore`, `setEventsNextCursor`, `setOlderError`, `setLoadingOlder` |
| **Logout action** | Line 431: `if (res.status === 401) { logout(); return; }` — before idRef check |
| **Staleness guard** | `idRef.current !== id` |
| **P532-01 vulnerable** | YES — stale events appended to newer view after A->B->A |
| **P532-02 vulnerable** | YES — 401 without session check |

### 5. `submitStatusAction()` (lines 457-480)

| Property | Value |
|----------|-------|
| **Trigger** | User confirms suspend/unsuspend in modal |
| **Originating admin** | Implicit via token |
| **Originating tenant** | Closure-captured `id` |
| **Originating session** | Not tracked |
| **Financial operation** | None |
| **Await points** | 2: `adminFetch()`, `res.json()` |
| **State mutations after await** | `setSuspendError`, `setSuspendBusy`, then `load()` call |
| **Logout action** | Line 469: `if (res.status === 401) { logout(); return; }` — before idRef check |
| **Staleness guard** | `idRef.current !== id` at line 471 |
| **P532-01 vulnerable** | YES — stale suspend result could trigger `load()` for wrong generation |
| **P532-02 vulnerable** | YES — 401 without session check |

### 6. `updateCreditOp()` (lines 186-189)

| Property | Value |
|----------|-------|
| Synchronous helper. Calls `saveCreditOp(next)` then `setCreditOp(next)`. |
| **No staleness guard** — relies on caller context |
| **No state-precedence check** — overwrites unconditionally |

### 7. `discardCreditOp()` (lines 192-201)

| Property | Value |
|----------|-------|
| Synchronous helper. Calls `clearCreditOp()` then sets React state to null. |
| Uses current `id` from closure and `getAdminInfo()` at call time — correct scoping |

### 8. Tenant restoration effect (lines 157-183)

| Property | Value |
|----------|-------|
| Runs on `[id]` change. Clears stale creditOp state, then restores from sessionStorage. |
| **Correct for P53-02.** Does not introduce P532 vulnerabilities. |

### 9. `logout()` (lines 115-119)

| Property | Value |
|----------|-------|
| Unconditionally removes `aw_admin_token` and `aw_admin_info` from sessionStorage. |
| Navigates to `/admin/login`. |
| **No session identity check** — the core P532-02 vulnerability. |

## Loading Indicator Scoping

| Indicator | Set true | Set false | Scoped to generation? |
|-----------|----------|-----------|----------------------|
| `loading` | `load()` line 123 | `load()` finally line 148 | NO — only idRef check |
| `reconciling` | `handleCheckStatus()` line 356 | finally line 403 | NO — only idRef check |
| `suspendBusy` | `submitStatusAction()` line 461 | finally line 478 | NO — only idRef check |
| `loadingOlder` | `loadOlderEvents()` line 426 | finally line 447 | NO — only idRef check |

After A->B->A, a stale `finally` block could set loading to `false` while a newer request for the same tenant is still in-flight.

## Summary of Vulnerable Points

| # | Location | Vulnerability | Severity |
|---|----------|--------------|----------|
| V1 | All async functions | `idRef.current === id` passes after A->B->A | HIGH |
| V2 | Lines 129, 290, 362, 431, 469 | 401 calls `logout()` without session verification | HIGH |
| V3 | Lines 306, 311, 324, 331 | `saveCreditOp()` has no terminal-state precedence | HIGH |
| V4 | Lines 148, 403, 447, 478 | Loading indicators not scoped to request generation | MEDIUM |
| V5 | Line 290 | 401 check before any staleness check in `handlePostCredit` | HIGH |
| V6 | Line 362 | 401 check before idRef check in `handleCheckStatus` | HIGH |
