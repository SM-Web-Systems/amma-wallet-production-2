# Phase 5.3.3 — Financial Persistence Specification

## P533-01: Strict operation identity matching

### Existing behavior

```
safeSaveCreditOp(op):
  existing = loadCreditOp(op.adminId, op.tenantId)
  if !existing → save → return true
  if existing.key ≠ op.key:
    if existingPrec ≥ 4 → return false      // terminal protected
    else → save → return true                // NON-TERMINAL OVERWRITTEN ← DEFECT
  if incomingPrec ≥ existingPrec → save → return true
  return false
```

### Proposed behavior

```
safeSaveCreditOp(op):
  existing = loadCreditOp(op.adminId, op.tenantId)
  if !existing → save → return true          // preserve evidence for cleared slots
  if existing.key ≠ op.key → return false    // STRICT: different UUID always rejected
  if incomingPrec ≥ existingPrec → save → return true
  return false
```

### Valid state transitions (same UUID)

| From | To | Allowed | Reason |
|------|----|---------|--------|
| CONFIRMED (1) | SUBMITTING (2) | Yes | Normal submission flow |
| SUBMITTING (2) | UNKNOWN (3) | Yes | Network error / 5xx |
| SUBMITTING (2) | REJECTED (4) | Yes | 4xx response |
| SUBMITTING (2) | COMMITTED (5) | Yes | 200 OK response |
| UNKNOWN (3) | SUBMITTING (2) | No | Would lose uncertainty evidence |
| UNKNOWN (3) | UNKNOWN (3) | Yes | Equal precedence (idempotent retry) |
| UNKNOWN (3) | COMMITTED (5) | Yes | Reconciliation success |
| COMMITTED (5) | any lower | No | Terminal — cannot downgrade |
| REJECTED (4) | COMMITTED (5) | Yes | Server committed despite initial 4xx |
| REJECTED (4) | any lower | No | Cannot downgrade below REJECTED |

### Invalid state transitions (different UUID)

ALL state transitions between different UUIDs are rejected. A different UUID's result cannot modify the active operation's storage slot.

### React state consistency requirement

After calling `safeSaveCreditOp(op)`:
- If return is `true`: `setCreditOp(op)` is safe
- If return is `false`: `setCreditOp(op)` MUST NOT be called. Instead, reload from storage or preserve current React state.

### Component handler changes required

| Call site | Current | Required |
|-----------|---------|----------|
| handlePostCredit current 4xx (line 363-364) | save then set unconditionally | check return, only set on true |
| handlePostCredit current 5xx (line 368-369) | save then set unconditionally | check return, only set on true |
| handlePostCredit current OK (line 381-383) | save then set unconditionally | check return, only set on true |
| handlePostCredit catch (line 389-390) | save then set unconditionally | check return, only set on true |
| handleCheckStatus committed (line 453-455) | save then set unconditionally | check return, only set on true |

### FIN-08 handling: rejected COMMITTED evidence

When `safeSaveCreditOp` rejects a COMMITTED write because a different UUID occupies the slot:
- The COMMITTED evidence exists on the server (authoritative)
- The admin can reconcile via "Check credit status" with the original UUID
- A `console.warn` log records the conflict for debugging
- No secondary storage slot is introduced — the server is the source of truth
- This limitation is documented

### Acceptance criteria

1. Different UUID writes are always rejected by safeSaveCreditOp
2. Same UUID valid upgrades continue to work
3. Terminal state downgrades continue to be rejected
4. React state is never updated when persistence is rejected
5. Cleared slots accept new evidence (empty → save)
6. Existing P52/P53/P532 tests continue to pass
