# 03 — Financial Invariants

## Core Invariants

### INV-1: Immutable Idempotency Key

One logical credit operation retains one immutable idempotency key throughout its uncertain lifetime. The key is generated once (IDLE → CONFIRMED) and never replaced until the operation reaches a verified terminal state.

**Enforcement:** The key is set in `handleCreditClick` and stored in `CreditOperation.key`. No code path should generate a new key for the same logical operation.

### INV-2: Absent Record ≠ Proof of Non-Commitment

An absent committed ledger record does not establish that an in-flight transaction cannot still commit. PostgreSQL READ COMMITTED isolation means a concurrent INSERT may not yet be visible.

**Enforcement:** `not_found` from the credit-status endpoint must NOT transition an operation to REJECTED.

### INV-3: No Key Replacement on Status Check

An unresolved operation must not be replaced with a new key merely because a status lookup returned `not_found`. The original key must be preserved for future reconciliation.

**Enforcement:** Only verified terminal states (COMMITTED from status check, or authoritative 4xx from the credit endpoint) may finalize an operation.

### INV-4: Tenant Binding

A credit operation created for tenant A must never be submitted to tenant B. The operation's `tenantId` must match the API request URL at submission time.

**Enforcement:** Runtime check `creditOp.tenantId === id` before POST and GET credit-status.

### INV-5: Administrator Binding

An operation created under administrator A must never be silently reused by administrator B. Storage scoping by adminId prevents cross-admin restoration, but runtime checks must guard against stale React state.

**Enforcement:** Runtime check `creditOp.adminId === getAdminInfo()?.id` before financial actions.

### INV-6: Read-Only Reconciliation

Reconciliation (credit-status endpoint) must never modify the ledger or tenant balance. It is a pure read operation.

**Enforcement:** Backend endpoint uses only SELECT, no INSERT/UPDATE. Frontend status check only updates local operation state, never sends a POST.

### INV-7: No Auto-Rejection on Interruption

A network timeout, reload, or authentication interruption must not automatically turn an unknown financial outcome into a rejected operation.

**Enforcement:** The catch blocks correctly transition to UNKNOWN. The only path to REJECTED must be an authoritative server response (4xx on credit POST).

### INV-8: Immutable Financial Payload on Retry

Retries of an uncertain operation must preserve its immutable financial payload (amount, type, notes, key). No mutation of these fields is permitted once the operation leaves CONFIRMED state.

**Enforcement:** `handlePostCredit` reads from `creditOp` (immutable after CONFIRMED) and never from form inputs during retry.

## Additional Invariants Identified

### INV-9: Single Active Operation Per (Admin, Tenant)

At most one credit operation may be active per (adminId, tenantId) pair. A new operation cannot be created while an unresolved operation exists.

**Enforcement:** `handleCreditClick` checks for existing UNKNOWN op and blocks. Storage key format enforces one entry per pair.

### INV-10: State Transition Monotonicity

State transitions must be monotonic — once an operation reaches a terminal state (COMMITTED or REJECTED), it cannot return to a non-terminal state. The only exit from a terminal state is explicit acknowledgment (clearing the operation).

**Enforcement:** `handlePostCredit` only accepts CONFIRMED or UNKNOWN states. Terminal states are guarded by UI (shows acknowledge button, hides form).

### INV-11: Tenant Context Coherence

All operations displayed, submitted, retried, and reconciled for a given page view must belong to the tenant identified in the current URL route. A stale operation from a previous tenant must not be visible or actionable.

**Enforcement:** The `useEffect([id])` must clear stale state when tenant changes. Defence-in-depth checks before network calls.
