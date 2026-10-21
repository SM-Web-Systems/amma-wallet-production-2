# Phase 5.3.3 — Financial and Request-Freshness Invariants

## Financial Invariants

**FIN-01:** Each logical credit operation has one immutable UUID (idempotency key).

**FIN-02:** Different UUIDs must not silently replace each other's persisted records through asynchronous result handling.

**FIN-03:** An old response cannot overwrite a newer active operation.

**FIN-04:** COMMITTED cannot be downgraded to UNKNOWN, REJECTED, or SUBMITTING.

**FIN-05:** An uncertain financial outcome must not be represented as a definitive rejection without authoritative evidence.

**FIN-06:** Rejected persistence must not be followed by an inconsistent React state update.

**FIN-07:** A financial result must remain associated with its original administrator, tenant, UUID, and payload.

**FIN-08:** A delayed legitimate COMMITTED result must not be silently discarded without providing a safe means of reconciliation or recording the conflict.

**FIN-09:** The existing reconciliation `not_found` result must continue to preserve UNKNOWN.

**FIN-10:** No new UUID should be generated as a consequence of mishandling an obsolete response.

## Request-Freshness Invariants

**REQ-01:** An older billing response cannot overwrite a newer billing response.

**REQ-02:** Request freshness must work without route navigation.

**REQ-03:** Route navigation A → B → A must remain safe.

**REQ-04:** A response issued under administrator A must not update administrator B's view.

**REQ-05:** An obsolete HTTP 401 cannot log out a newer authenticated session.

**REQ-06:** Financial POST responses and ordinary read responses must be handled according to their different safety requirements.

**REQ-07:** A rejected stale response must not leave unrelated loading indicators stuck.

**REQ-08:** Requests that overlap within the same tenant must be handled deterministically.

## Invariant → Defect mapping

| Invariant | Violated by P533-01 | Violated by P533-02 |
|-----------|---------------------|---------------------|
| FIN-01 | — | — |
| FIN-02 | **YES** (different UUID overwrites non-terminal) | — |
| FIN-03 | **YES** (stale response can overwrite newer op) | — |
| FIN-04 | — (already protected by prec check) | — |
| FIN-05 | — (preserved by P53-01 fix) | — |
| FIN-06 | **YES** (return value ignored) | — |
| FIN-07 | **YES** (stale response replaces different op) | — |
| FIN-08 | Partially (strict matching may reject legitimate evidence) | — |
| FIN-09 | — (preserved) | — |
| FIN-10 | — | — |
| REQ-01 | — | **YES** (same gen allows overwrite) |
| REQ-02 | — | **YES** (gen only changes on route change) |
| REQ-03 | — | — (existing protection works) |
| REQ-04 | — | **YES** (no admin identity check after response) |
| REQ-05 | — | — (safeLogout already handles this) |
| REQ-06 | — | **YES** (financial and read freshness conflated) |
| REQ-07 | — | — (existing cleanup on navigation works) |
| REQ-08 | — | **YES** (no per-request counter) |
