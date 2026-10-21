# 01 — Source Assessment

## Credit Operation Lifecycle Trace

### 1. Creating a credit operation (IDLE → CONFIRMED)

**Function:** `handleCreditClick` (AdminTenantDetail.tsx:185-230)

1. Guards: If existing op is COMMITTED/REJECTED, returns (UI already hides form). If UNKNOWN, blocks with error message.
2. Validates `creditAmount` as positive decimal string with up to 7 decimal places.
3. If a CONFIRMED op already exists, reopens the confirmation dialog (retry path).
4. Reads admin identity via `getAdminInfo()` from sessionStorage.
5. Generates `crypto.randomUUID()` as idempotency key.
6. Creates `CreditOperation` object with state=CONFIRMED, binds `adminId` and `tenantId`.
7. Calls `updateCreditOp(newOp)` → persists to sessionStorage + sets React state.
8. Opens confirmation dialog.

### 2. Assigning the UUID

**Location:** `handleCreditClick` line 219: `key: crypto.randomUUID()`

UUID is generated once per logical operation during the IDLE → CONFIRMED transition. It becomes the immutable idempotency key.

### 3. Persisting to sessionStorage

**Function:** `saveCreditOp` (credit-op-storage.ts:51-53)

Storage key format: `aw_pending_credit_{adminId}_{tenantId}`

The operation is serialized as JSON. Each (adminId, tenantId) pair has at most one pending operation.

### 4. State transitions

| From | To | Trigger | Location |
|------|----|---------|----------|
| null (IDLE) | CONFIRMED | `handleCreditClick` | L185-230 |
| CONFIRMED | SUBMITTING | `handlePostCredit` | L242 |
| SUBMITTING | COMMITTED | HTTP 200 response | L281-286 |
| SUBMITTING | UNKNOWN | HTTP 5xx or network error | L273-275, L290 |
| SUBMITTING | REJECTED | HTTP 4xx (except 401) | L266-270 |
| UNKNOWN | SUBMITTING | Retry button click | L242 (via handlePostCredit) |
| UNKNOWN | COMMITTED | Reconciliation returns "committed" | L311-316 |
| **UNKNOWN** | **REJECTED** | **Reconciliation returns "not_found"** | **L319-325** |
| COMMITTED | null (IDLE) | Acknowledge button | L338-343 |
| REJECTED | null (IDLE) | Acknowledge button | L338-343 |
| CONFIRMED | null (IDLE) | Discard button | L347-351 |

### 5. Submitting the credit (CONFIRMED/UNKNOWN → SUBMITTING → terminal)

**Function:** `handlePostCredit` (AdminTenantDetail.tsx:234-293)

1. Transitions to SUBMITTING state, persists.
2. POSTs to `/api/v1/internal/tenants/${id}/credit` using route param `id`.
3. Body contains `creditOp.type`, `creditOp.amount`, `creditOp.notes`, `creditOp.key`.
4. HTTP 200 → COMMITTED (with `billingEventId`), triggers data reload.
5. HTTP 4xx (except 401) → REJECTED.
6. HTTP 5xx → UNKNOWN.
7. Network error (catch block) → UNKNOWN.

### 6. Handling specific HTTP responses

| Status | Behavior | Financial guarantee |
|--------|----------|-------------------|
| 200 | COMMITTED, data reload | Credit applied, idempotent on retry |
| 400 | REJECTED | Server rejected before write |
| 401 | Logout redirect | No credit; session expired |
| 403 | REJECTED | Insufficient role |
| 409 | REJECTED | Idempotency key conflict; comment says "if original had committed, retry would return 200 not 409" |
| 500 | UNKNOWN | Server error; write may or may not have occurred |

### 7. Network timeout handling

Caught by the `catch` block at line 288-292. Transitions to UNKNOWN. This is correct — timeout does not prove no-write.

### 8. Component unmount handling

**No explicit cleanup.** There is no `useEffect` return cleanup function for the credit operation. If the component unmounts during SUBMITTING:
- The `await adminFetch(...)` promise resolves or rejects after unmount.
- The `updateCreditOp()` call will write to sessionStorage but `setCreditOp()` is a no-op on an unmounted component (React ignores it).
- The sessionStorage write is durable. On remount, the operation is restored in SUBMITTING state.
- **Risk:** A SUBMITTING state is restored on reload, but there is no mechanism to resume or retry the in-flight request. The user sees nothing (no UI state matches SUBMITTING from the `useEffect`). Actually: the UI DOES render the SUBMITTING banner, but no automatic retry occurs. The user would need to understand they need to check status.

### 9. Restoring operations after reload

**Function:** `useEffect([id])` (AdminTenantDetail.tsx:147-162)

1. Checks `id` is present.
2. Gets admin identity via `getAdminInfo()`.
3. Calls `loadCreditOp(adminInfo.id, id)`.
4. If found, restores to React state and populates form inputs.
5. **CRITICAL OMISSION:** If NOT found, does NOT clear React state to null.

### 10. Reconciliation (status check)

**Function:** `handleCheckStatus` (AdminTenantDetail.tsx:297-335)

1. GET `/api/v1/internal/tenants/${id}/credit-status?idempotency_key=...`
2. Uses route param `id` (current tenant), not `creditOp.tenantId`.
3. `committed` → UNKNOWN → COMMITTED (correct).
4. `not_found` → **UNKNOWN → REJECTED** (UNSAFE — P53-01).
5. Network error → displays reconcile error, stays UNKNOWN (correct).

### 11. Acknowledging completed/rejected operations

**Function:** `handleAcknowledge` (AdminTenantDetail.tsx:338-343)

Calls `discardCreditOp()` which clears sessionStorage and sets React state to null. Resets form inputs. Returns to IDLE.

### 12. Navigating between tenants

The `id` param changes via React Router. The `useEffect([id])` fires. **Problem:** If the new tenant has no stored operation, the React state `creditOp` is NOT cleared to null. The old tenant's operation persists in React memory.

### 13. Switching administrator accounts

Logout clears `aw_admin_token` and `aw_admin_info` from sessionStorage and navigates to `/admin/login`. This unmounts the component, discarding React state. On re-login and navigation back, the component mounts fresh with `creditOp = null`. The `useEffect` restores the new admin's operation if any.

**Partial safety:** The logout→login cycle destroys React state through unmount. But there is no runtime guard that prevents a stale `creditOp` from being used if admin identity changes WITHOUT a full logout (e.g., manual sessionStorage manipulation, or an expired-then-renewed token for a different admin).

## Backend Contract Summary

### POST /api/v1/internal/tenants/:id/credit

- Requires `super_admin` or `platform_admin` role.
- Accepts `idempotency_key` (optional UUID v4).
- Within `db.transaction()`: checks for existing event with same (tenantId, idempotencyKey).
  - Found + same parameters → returns original result with `duplicate: true`, no balance change.
  - Found + different parameters → throws 409.
  - Not found → inserts event + increments balance.
- On `23505` unique violation (concurrent insert): recovers by re-reading committed event.
- **Key property:** A committed credit with a given idempotency key will always return 200 on retry. The client can safely retry with the same key.

### GET /api/v1/internal/tenants/:id/credit-status

- Pure read — no writes, no balance changes.
- Returns `"committed"` if a billing_event exists with matching (tenantId, idempotencyKey).
- Returns `"not_found"` if no such event exists.
- **Key limitation:** `not_found` reflects a point-in-time snapshot. Under READ COMMITTED, a concurrent INSERT that hasn't committed yet is invisible to this SELECT. The response does NOT guarantee that a write will never occur for this key.
