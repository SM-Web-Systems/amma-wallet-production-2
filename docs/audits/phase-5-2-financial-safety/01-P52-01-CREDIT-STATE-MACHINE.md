# 01-P52-01: Prevent Abandonment of Unresolved Credits

**Finding:** P52-01 — Unsafe credit abandonment and retry behavior
**Severity:** P0 (Critical financial safety)
**Status:** RESOLVED

---

## Problem

The Phase 5.1 credit UI allowed:

1. **Silent abandonment**: Admin could discard a pending credit operation without
   confirmation, losing the idempotency key and potentially leaving an orphaned
   credit on the server.
2. **Amount editing after key generation**: Changing the amount generated a new
   UUID, effectively creating a new operation while the old one was silently lost.
3. **409 key clearing**: On a conflict response, the key was cleared from
   sessionStorage, destroying the evidence needed for reconciliation.
4. **No UNKNOWN state**: Network errors or timeouts resulted in silent failure
   with no way to check if the credit actually committed.

## Solution

### State Machine

Replaced the ad-hoc pending credit logic with a formal state machine:

```
IDLE → CONFIRMED → SUBMITTING → COMMITTED
                              → UNKNOWN → (reconciliation) → COMMITTED
                              → UNKNOWN → (reconciliation) → REJECTED
                              → REJECTED
```

- **IDLE** (null): No operation in progress. Inputs are editable.
- **CONFIRMED**: Key generated, dialog confirmed. Inputs are locked. HTTP not yet sent.
  Only safe transition out is "Discard and start fresh" (no HTTP was sent).
- **SUBMITTING**: HTTP request in flight. No user actions allowed.
- **COMMITTED**: HTTP 200 received. Shows success with event ID. Requires explicit
  "Post another credit" acknowledgment before inputs unlock.
- **UNKNOWN**: Network error, timeout, or 5xx. Outcome uncertain. Shows
  reconciliation UI with "Check credit status" and "Retry submission" buttons.
- **REJECTED**: 4xx (except 401). Proven no-write. Requires explicit "Try a new
  credit" acknowledgment before inputs unlock.

### Input Locking

Once a `CreditOperation` exists (any state), all form inputs are disabled:
`inputsDisabled = creditOp !== null`. This prevents amount/type/notes changes
after the key is generated.

### Reconciliation Endpoint

New read-only backend endpoint: `GET /api/v1/internal/tenants/:id/credit-status`

- Query parameter: `idempotency_key` (UUID v4)
- Returns `{ status: "committed" | "not_found", billingEventId, amountXlm, ... }`
- Protected by `verifyInternalAdmin` + `PRIVILEGED_ROLES` guard
- **Pure read** — does not modify financial state

### Storage Persistence

Operations are persisted to `sessionStorage` at every state transition. On page
reload, the state machine restores from storage and enforces the same constraints.

## Files Modified

| File | Change |
|------|--------|
| `packages/web-app/src/pages/AdminTenantDetail.tsx` | Complete rewrite of credit posting logic |
| `packages/web-app/src/lib/credit-op-storage.ts` | New: extracted storage functions for testability |
| `packages/web-app/src/lib/credit-op-storage.test.ts` | New: 21 unit tests for storage scoping |
| `packages/web-app/src/pages/AdminTenantDetail.test.tsx` | Updated 2 tests for new UI text |
| `packages/backend/src/routes/admin.ts` | New: reconciliation endpoint |
| `packages/backend/src/test-integration/api-credit-concurrency.test.ts` | New: 12 reconciliation tests |

## Test Evidence

- 21 frontend unit tests (storage scoping, corruption, state persistence)
- 12 backend integration tests (reconciliation endpoint)
- 22 existing frontend component tests (all passing with updated assertions)
