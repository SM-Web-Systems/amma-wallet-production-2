# 01 — Async Race Assessment

## Component Architecture

`AdminTenantDetail` is a single React component mounted at `/admin/tenants/:id`. When the admin navigates between tenants (e.g., `/admin/tenants/1` → `/admin/tenants/2`), React Router **reuses the same component instance** — it does NOT unmount and remount. Only the `id` param from `useParams()` changes, triggering a re-render.

This means:
- All `useState` values persist across tenant navigations
- All in-flight async operations continue executing with their **captured closures**
- `useEffect([id])` fires on the new `id`, but cannot cancel already-running async functions

## Async Function Inventory

### 1. `load()` (L114-138)

| Property | Value |
|----------|-------|
| **Defined as** | `useCallback([id])` |
| **Captures** | `id` (via closure in useCallback) |
| **URL** | `/api/v1/internal/tenants/${id}/billing` |
| **State modified after await** | `setData(json)`, `setAllEvents(...)`, `setEventsHasMore(...)`, `setEventsNextCursor(...)`, `setOlderError(null)`, `setLoading(false)`, `setError(...)` |
| **Called from** | `useEffect([load, navigate])` (L140-143), `handlePostCredit` (L308), `handleCheckStatus` (L354), `submitStatusAction` (L435) |
| **Race impact** | **MEDIUM** — Overwrites display-only billing data with wrong tenant's data. Not a direct financial risk, but confusing and could lead admin to make decisions based on wrong data. |

**Race scenario:** Admin is on tenant A. `load()` fetches `/tenants/1/billing`. Admin navigates to tenant B before response. The `useEffect([id])` creates a new `load` for tenant B, but the old `load` for tenant A is still in-flight. When tenant A's response arrives, `setData(json)` overwrites tenant B's data with tenant A's billing info.

**Compounding factor:** `load()` is also called from `handlePostCredit` and `handleCheckStatus` after successful operations. These calls use the `load` captured in the closure at the time the handler was rendered, which has the OLD tenant's `id`.

### 2. `handlePostCredit()` (L243-313)

| Property | Value |
|----------|-------|
| **Defined as** | Inline async function (recreated every render) |
| **Captures** | `id`, `creditOp`, `load` (from render closure) |
| **URL** | `/api/v1/internal/tenants/${id}/credit` |
| **State modified after await** | `updateCreditOp(...)` → `saveCreditOp(next)` + `setCreditOp(next)`, `load()`, `setCreditError(...)` |
| **Pre-flight guards (P53-02)** | `creditOp.tenantId !== id` (L252), admin identity check (L257) |
| **Race impact** | **HIGH** — After `await adminFetch(...)`, `updateCreditOp` calls `setCreditOp()` which modifies React state for whatever tenant is currently displayed. `load()` fetches the old tenant's data into the new tenant's display. |

**Race scenario:** Admin starts credit submission for tenant A. Navigates to tenant B during await. Response arrives:
- `saveCreditOp(committedOp)` → SAFE (uses `committedOp.tenantId = "1"`, writes to correct storage key)
- `setCreditOp(committedOp)` → **UNSAFE** (sets tenant A's COMMITTED op into React state while tenant B is displayed)
- `load()` → **UNSAFE** (calls the closure-captured `load` which has tenant A's `id`, fetches tenant A's data, writes into shared `data` state)

**Key insight:** The P53-02 identity guards (L252-259) protect the **outgoing** request but NOT the **incoming** response. The guards run synchronously before the `await`. After the `await`, the closured `id` and `creditOp` are stale.

### 3. `handleCheckStatus()` (L321-371)

| Property | Value |
|----------|-------|
| **Defined as** | Inline async function |
| **Captures** | `id`, `creditOp` (from render closure) |
| **URL** | `/api/v1/internal/tenants/${id}/credit-status?idempotency_key=...` |
| **State modified after await** | `updateCreditOp(committedOp)` → `setCreditOp()`, `load()`, `setReconcileError(...)`, `setReconciling(false)` |
| **Pre-flight guards (P53-02)** | `creditOp.tenantId !== id` (L325), admin identity check (L329) |
| **Race impact** | **HIGH** — Same pattern as `handlePostCredit`. After await, `setCreditOp()` and `load()` modify wrong tenant's display. |

**Additional concern:** If reconciliation returns `committed` and the admin has navigated away, `updateCreditOp(committedOp)` writes the correct storage entry (safe) but `setCreditOp(committedOp)` shows a COMMITTED banner on the wrong tenant.

### 4. `loadOlderEvents()` (L390-411)

| Property | Value |
|----------|-------|
| **Defined as** | Inline async function |
| **Captures** | `id`, `eventsNextCursor` (from render closure) |
| **URL** | `/api/v1/internal/tenants/${id}/events?beforeId=${eventsNextCursor}` |
| **State modified after await** | `setAllEvents(prev => [...prev, ...page.events])`, `setEventsHasMore(...)`, `setEventsNextCursor(...)`, `setLoadingOlder(false)`, `setOlderError(...)` |
| **Race impact** | **LOW** — Display corruption only. Tenant A's older events appended to tenant B's event list. |

### 5. `submitStatusAction()` (L419-441)

| Property | Value |
|----------|-------|
| **Defined as** | Inline async function |
| **Captures** | `id`, `statusModal` (from render closure) |
| **URL** | `/api/v1/internal/tenants/${id}/${action}` |
| **State modified after await** | `load()`, `setSuspendBusy(false)`, `setSuspendError(...)` |
| **Race impact** | **MEDIUM** — Suspend/unsuspend action targets correct tenant (uses captured `id`), but post-action `load()` uses captured `load` which refreshes the old tenant's data into the current display. |

### 6. `useEffect([id])` restoration (L148-171) — async interaction

Not async itself, but interacts with async operations:
- `setCreditOp(null)` (L154) fires synchronously when `id` changes
- If a stale `handlePostCredit` response then arrives and calls `setCreditOp(committedOp)`, it **overwrites** the null, re-introducing a stale operation

## Root Cause

The root cause is a fundamental mismatch between:

1. **Storage writes** (`saveCreditOp`) — correctly scoped by `(adminId, tenantId)` from the operation's own fields
2. **React state writes** (`setCreditOp`, `setData`, etc.) — **NOT scoped** to any tenant; they modify whatever the component is currently displaying

All async functions capture `id` and other state in closures at call time. After `await`, these closures are stale if the admin has navigated. The functions continue to execute with the old context and write results into the **shared** React state, which now belongs to a different tenant.

## Summary Table

| Function | Financial Risk | Display Corruption | Closure Stale After |
|----------|---------------|-------------------|---------------------|
| `load()` | None | YES — wrong billing data | `await adminFetch(...)` |
| `handlePostCredit()` | **Indirect** — wrong COMMITTED banner shown | YES | `await adminFetch(...)` |
| `handleCheckStatus()` | **Indirect** — wrong reconciliation result shown | YES | `await adminFetch(...)` |
| `loadOlderEvents()` | None | YES — mixed event lists | `await adminFetch(...)` |
| `submitStatusAction()` | None | YES — stale data refresh | `await adminFetch(...)` |

**Note:** No DIRECT financial risk exists because:
1. `saveCreditOp()` always uses the operation's own `tenantId`/`adminId` (correctly scoped)
2. The outgoing HTTP request uses the closure-captured `id` which matches the original tenant
3. The P53-02 pre-flight guards prevent starting new operations for the wrong tenant

The risk is **indirect**: showing wrong data could cause an admin to take incorrect actions on a tenant they believe they're viewing.
