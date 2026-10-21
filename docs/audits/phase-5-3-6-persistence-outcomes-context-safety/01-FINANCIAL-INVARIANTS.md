# Phase 5.3.6 — Financial and Authentication Invariants

## Persistence outcome invariants

**PO-01:** Only successful active-slot persistence may authorize replacing the active React credit operation.

**PO-02:** Successful conflict-evidence preservation must never be interpreted as an active-slot update.

**PO-03:** A protected stronger record must not cause React to display weaker evidence.

**PO-04:** A persistence failure must not be reported as successful storage.

**PO-05:** Acknowledgment and discard operations must not clear a different UUID.

**PO-06:** Financial evidence remains associated with its originating administrator, tenant, and UUID.

**PO-07:** The operation's server-side idempotency key must never change during conflict handling.

## Financial identity invariants

**FI-01:** Immutable financial fields (amount, type, adminId, tenantId, notes, createdAt) must be validated before all state transitions in conflict evidence, not only at equal precedence.

**FI-02:** UNKNOWN → COMMITTED upgrade with altered amount is rejected.

**FI-03:** Duplicate COMMITTED with conflicting event IDs is rejected.

**FI-04:** Missing incoming eventId cannot erase existing authoritative eventId.

**FI-05:** Existing stronger evidence remains unchanged after any invalid update.

## Read-freshness invariants

**RF-01:** A successful billing response from session S1 cannot update session S2's view.

**RF-02:** Matching administrator IDs are insufficient to establish session identity.

**RF-03:** Route-generation and per-request freshness checks remain effective.

**RF-04:** A stale 401 cannot invalidate a newer session.

**RF-05:** Stale requests must not leave the active view in a permanently unusable loading state.

**RF-06:** Ordinary read-request invalidation must not discard authoritative financial POST results.
