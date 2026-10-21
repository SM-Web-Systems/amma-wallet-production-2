# Phase 5.3.2 — Financial Result Persistence Specification

## Problem

`saveCreditOp()` performs unconditional overwrites. A late-arriving response can downgrade a terminal state (COMMITTED -> UNKNOWN) or overwrite an unrelated operation.

## State Machine

### States

| State | Terminal? | Description |
|-------|-----------|-------------|
| CONFIRMED | No | Operation prepared, not yet submitted |
| SUBMITTING | No | HTTP request in-flight |
| UNKNOWN | No | Outcome uncertain (network error, 5xx) |
| COMMITTED | **Yes** | Server confirmed the credit was applied |
| REJECTED | **Yes** | Server confirmed the credit was NOT applied (4xx) |

### Valid Transitions

```
CONFIRMED   -> SUBMITTING
SUBMITTING  -> COMMITTED | REJECTED | UNKNOWN
UNKNOWN     -> SUBMITTING (retry) | COMMITTED (reconciliation)
COMMITTED   -> (none)
REJECTED    -> (none)
```

### State Precedence (highest to lowest authority)

1. COMMITTED — server-confirmed financial write
2. REJECTED — server-confirmed no-write (4xx)
3. UNKNOWN — uncertain outcome
4. SUBMITTING — in-flight
5. CONFIRMED — pre-submission

## Conditional Persistence: `safeSaveCreditOp()`

### Signature

```typescript
function safeSaveCreditOp(op: CreditOperation): boolean
```

### Algorithm

```
1. Read existing = loadCreditOp(op.adminId, op.tenantId)
2. If existing is null: write op, return true
3. If existing.key !== op.key: 
   - The incoming op is for a DIFFERENT operation
   - Only allow if incoming state has higher precedence
   - Terminal states (COMMITTED/REJECTED) for a different key must NOT be overwritten
   - If existing is terminal: reject write, return false
   - Otherwise: write op, return true
4. If existing.key === op.key (same operation):
   - If existing state is terminal (COMMITTED/REJECTED): reject write, return false
   - If incoming state has higher or equal precedence: write op, return true
   - Otherwise: reject write, return false
```

### Precedence Function

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

A write is allowed only if `statePrecedence(incoming) >= statePrecedence(existing)` **when keys match**, or if the existing record is non-terminal **when keys differ**.

### Special Case: SUBMITTING -> SUBMITTING (retry)

When retrying from UNKNOWN, the transition is UNKNOWN -> SUBMITTING. This is a precedence decrease (3 -> 2) but is valid because the user explicitly initiated a retry. This transition happens synchronously in `handlePostCredit` via `updateCreditOp(submittingOp)` — it's a deliberate user action, not an async response.

**Solution:** `updateCreditOp()` (used for deliberate user actions) continues to use unconditional `saveCreditOp()`. Only async response handlers use `safeSaveCreditOp()`.

### Atomicity

Since sessionStorage is synchronous and JavaScript is single-threaded within a tab, the read-check-write in `safeSaveCreditOp` is atomic — no interleaving is possible between the `loadCreditOp` and `saveCreditOp` calls within the same synchronous function.

### Browser Storage Limitations

- **No cross-tab guarantees:** sessionStorage is per-tab. Two tabs cannot conflict.
- **No persistence across tab close:** sessionStorage is cleared when the tab closes. This is existing behavior and acceptable for the credit operation lifecycle.
- **No encryption:** Financial operation details (amount, key) are stored in cleartext. This is existing behavior and outside P532 scope.

## Financial Invariants

**FIN-01:** A credit operation retains its immutable UUID (`key`), `adminId`, `tenantId`, `amount`, `type`, and `notes`. These fields are set at CONFIRMED and never modified.

**FIN-02:** A financial response can only update the storage record belonging to its original operation identity (`key` match required for same-precedence writes).

**FIN-03:** An old response cannot overwrite a newer operation that replaced the previous operation (terminal state blocks different-key overwrites).

**FIN-04:** A confirmed COMMITTED result cannot be downgraded to UNKNOWN, SUBMITTING, or REJECTED by an obsolete response (terminal state precedence).

**FIN-05:** A stale network error cannot erase an authoritative committed result (`safeSaveCreditOp` rejects UNKNOWN when COMMITTED exists).

**FIN-06:** An obsolete request from administrator A cannot update administrator B's visible state (generation counter + session token check).

**FIN-07:** A financial result from Tenant A cannot appear on Tenant B (generation counter + storage key scoping by adminId+tenantId).

**FIN-08:** An operation that remains uncertain retains its original idempotency key (UNKNOWN state preserves all original fields).

**FIN-09:** The existing `not_found` reconciliation response continues to preserve UNKNOWN (no state change on not_found).

**FIN-10:** No new credit UUID is generated as a consequence of discarding or misclassifying an obsolete response (UUID generation only happens in `handleCreditClick` for IDLE -> CONFIRMED).

## Implementation Changes

### `credit-op-storage.ts`

Add:
```typescript
export function safeSaveCreditOp(op: CreditOperation): boolean {
  const existing = loadCreditOp(op.adminId, op.tenantId);
  if (!existing) { saveCreditOp(op); return true; }
  
  const existingPrec = statePrecedence(existing.state);
  const incomingPrec = statePrecedence(op.state);
  
  // Different operation: only overwrite if existing is non-terminal
  if (existing.key !== op.key) {
    if (existingPrec >= 4) return false; // existing is COMMITTED or REJECTED
    saveCreditOp(op);
    return true;
  }
  
  // Same operation: only allow upgrade or equal precedence
  if (incomingPrec >= existingPrec) {
    saveCreditOp(op);
    return true;
  }
  
  return false; // rejected: would downgrade
}
```

### `AdminTenantDetail.tsx`

Replace `saveCreditOp()` calls in async response handlers with `safeSaveCreditOp()`:
- `handlePostCredit()` lines 306, 311, 324, 331
- `handleCheckStatus()` line 380

Keep `saveCreditOp()` (unconditional) in:
- `updateCreditOp()` — deliberate user actions (IDLE->CONFIRMED, CONFIRMED->SUBMITTING)

## Test Coverage

- Late UNKNOWN cannot overwrite stored COMMITTED
- Late UNKNOWN cannot overwrite stored REJECTED  
- COMMITTED can overwrite UNKNOWN (reconciliation)
- COMMITTED can overwrite SUBMITTING (normal success)
- Different-key operation cannot overwrite terminal state
- Same-key equal-precedence write is accepted (idempotent)
- Null existing state accepts any write
