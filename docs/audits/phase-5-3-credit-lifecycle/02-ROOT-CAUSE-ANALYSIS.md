# 02 — Root Cause Analysis

## P53-01: Financial Reconciliation Race

### Root Cause

**File:** `packages/web-app/src/pages/AdminTenantDetail.tsx`
**Function:** `handleCheckStatus`
**Lines:** 319–325

```typescript
} else if (d.status === "not_found") {
  // P52: confirmed not committed — safe to discard
  const rejectedOp: CreditOperation = {
    ...creditOp,
    state: "REJECTED",
    rejectionReason: "Credit not found in ledger — operation did not commit.",
  };
  updateCreditOp(rejectedOp);
}
```

### Trigger Condition

1. Admin submits a credit. Network returns a timeout or 5xx. State becomes UNKNOWN.
2. The backend transaction is still in-flight (slow commit, connection pool delay, PG replication lag).
3. Admin clicks "Check credit status".
4. The credit-status endpoint queries `billing_events` and returns `not_found` (the INSERT has not yet committed).
5. The frontend interprets `not_found` as definitive proof that the credit was never applied.
6. State transitions: UNKNOWN → REJECTED.

### Incorrect Behavior

The `not_found` response is treated as authoritative negative confirmation. The comment says "confirmed not committed — safe to discard." This is false — `not_found` only means the event was not visible at the time of the read.

### Expected Behavior

`not_found` should leave the operation in UNKNOWN state. The administrator should be informed that the credit status could not be confirmed, and the operation's original idempotency key must be preserved for future reconciliation or retry.

### Financial Consequences

After REJECTED is acknowledged:
1. `handleAcknowledge` → `discardCreditOp()` → clears sessionStorage → state = null (IDLE).
2. Admin enters the same amount and clicks "Post credit".
3. `handleCreditClick` generates a **new UUID** (line 219).
4. Admin confirms and submits.
5. If the original transaction eventually commits, TWO credits now exist in the ledger with different idempotency keys for the same logical operation.
6. **Result: Double credit. The tenant receives 2× the intended amount.**

### Severity: CRITICAL

This is a confirmed financial safety defect. The sequence requires only normal operational conditions (slow backend, impatient admin) — no adversarial behavior needed.

### Confirmed vs Theoretical

**CONFIRMED BUG.** The code path is clear: `not_found` → `REJECTED` → acknowledge → new UUID → double credit. No external conditions beyond a slow backend transaction are required.

---

## P53-02: Incorrect Tenant Context (Stale React State)

### Root Cause

**File:** `packages/web-app/src/pages/AdminTenantDetail.tsx`
**Function:** `useEffect` on `[id]`
**Lines:** 147–162

```typescript
useEffect(() => {
  if (!id) return;
  const adminInfo = getAdminInfo();
  if (!adminInfo || typeof adminInfo.id !== "number") return;
  const restored = loadCreditOp(adminInfo.id, id);
  if (restored) {
    setCreditOp(restored);
    setCreditType(restored.type as "manual_topup");
    setCreditAmount(restored.amount);
    setCreditNotes(restored.notes ?? "");
  }
}, [id]);
```

### Trigger Condition

1. Admin is viewing tenant A (id="42"). An UNKNOWN credit operation exists in React state.
2. Admin navigates to tenant B (id="99") via the "All tenants" link.
3. `id` changes to "99". The `useEffect` fires.
4. `loadCreditOp(adminId, "99")` returns null (no pending op for tenant 99).
5. The `if (restored)` block is skipped.
6. **`setCreditOp(null)` is never called.** React state `creditOp` still holds tenant A's operation.

### Incorrect Behavior

After navigation, the component renders tenant B's billing data but displays tenant A's UNKNOWN credit operation. The operation's tenantId is "42" but the route's `id` is "99".

### Financial Consequences

**Scenario A — Cross-tenant credit submission:**
1. Admin sees the UNKNOWN banner for tenant A's operation while viewing tenant B.
2. Admin clicks "Retry submission".
3. `handlePostCredit` POSTs to `/api/v1/internal/tenants/99/credit` (using route `id`).
4. Body contains tenant A's idempotency key and amount.
5. If this is a fresh key for tenant 99, the backend creates a credit for tenant 99.
6. **Result: Tenant B receives an unauthorized credit. Tenant A's operation remains unresolved.**

**Scenario B — Cross-tenant reconciliation:**
1. Admin clicks "Check credit status".
2. `handleCheckStatus` GETs `/api/v1/internal/tenants/99/credit-status?idempotency_key=...`.
3. The key belongs to tenant 42. Querying tenant 99 returns `not_found`.
4. Combined with P53-01: UNKNOWN → REJECTED for tenant A's operation, reconciled against the wrong tenant.
5. **Result: Operation falsely rejected. Original in-flight credit for tenant A becomes invisible.**

### Severity: CRITICAL

Cross-tenant financial operations are a fundamental authorization violation.

### Confirmed vs Theoretical

**CONFIRMED BUG.** The missing `else { setCreditOp(null); }` branch is directly observable in the code. The `handlePostCredit` function uses `id` (route param) for the URL and `creditOp` (stale state) for the body — no identity check exists.

---

## P53-02 (Secondary): Missing Identity Guard at Operation Boundary

### Root Cause

**File:** `packages/web-app/src/pages/AdminTenantDetail.tsx`
**Functions:** `handlePostCredit` (line 248), `handleCheckStatus` (line 302)

Neither function validates that `creditOp.tenantId === id` or `creditOp.adminId === currentAdminId` before making the network request.

### Trigger Condition

Any situation where React state `creditOp` does not match the current route parameters or admin identity. The primary trigger is tenant navigation (above), but any future code path that fails to clear `creditOp` on context change would also be vulnerable.

### Expected Behavior

Before any financial network request, verify:
1. `creditOp.tenantId === id` (route param)
2. `creditOp.adminId === getAdminInfo()?.id`

If mismatched, refuse the operation and display an error.

### Remediation Classification

This is a **defence-in-depth** guard. Fixing the `useEffect` (primary P53-02 fix) eliminates the primary trigger, but the identity check at the operation boundary provides protection against any future failure to clear stale state.

---

## P53-02 (Tertiary): Administrator Context

### Current Safety

Logout (`sessionStorage.removeItem("aw_admin_token")` + navigate to login) unmounts the component, destroying React state. Re-login mounts fresh. The `useEffect` loads ops scoped to the new admin's ID.

### Residual Risk

There is no runtime guard that detects admin identity change WITHOUT a full logout cycle. If `aw_admin_info` changes while the component is mounted (manual manipulation, token refresh returning different identity), the component continues operating with the stale `creditOp`. The defence-in-depth identity check at the operation boundary (above) addresses this.

### Severity: LOW (with defence-in-depth fix)

The normal logout/login cycle provides adequate protection. The identity check at the operation boundary covers edge cases.
