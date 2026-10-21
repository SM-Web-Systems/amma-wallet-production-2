# Phase 5.3.4 — Financial and Asynchronous Context Invariants

## Financial invariants

**FIN-01:** Every logical credit operation retains one immutable UUID.
- Enforced by: `crypto.randomUUID()` at operation creation (line 299), idempotency_key passed to server.
- Status: MAINTAINED.

**FIN-02:** A response for UUID-A must never overwrite the active record for UUID-B.
- Enforced by: `safeSaveCreditOp()` UUID check (line 86).
- Status: MAINTAINED.

**FIN-03:** A COMMITTED result must remain recoverable under its original administrator, tenant, UUID, and immutable payload.
- Enforced by: `safeSaveCreditOp()` for same-UUID writes.
- **VIOLATED when different UUID occupies the slot.** The COMMITTED evidence is silently discarded.
- Fix target: P534-01.

**FIN-04:** COMMITTED must never be downgraded to UNKNOWN or REJECTED by a delayed response.
- Enforced by: `statePrecedence()` — COMMITTED(5) > UNKNOWN(3) > REJECTED(4). Wait — REJECTED(4) > UNKNOWN(3), but COMMITTED(5) > both.
- Status: MAINTAINED for same-UUID. Cross-UUID rejected by FIN-02.

**FIN-05:** A rejected persistence write must never be followed by an inconsistent React state update.
- Enforced by: `if (!finStale && rejAccepted)` pattern (lines 395, 401, 415).
- **PARTIALLY VIOLATED:** `finStale` is stale after `res.json()`. If context changes during body parsing, `finStale` is false but the write was accepted for the wrong context.
- Fix target: P534-02.

**FIN-06:** Existing UNKNOWN operations retain their idempotency key during retry and reconciliation.
- Enforced by: retry reuses `creditOp.key` (line 349), reconciliation queries by key (line 459).
- Status: MAINTAINED.

**FIN-07:** A `not_found` reconciliation response does not prove that an outstanding transaction will never commit.
- Enforced by: `handleCheckStatus` stays in UNKNOWN on not_found (line 499-508).
- Status: MAINTAINED.

**FIN-08:** Browser-side recovery information must never be mistaken for independent proof of a server-side financial commitment.
- Enforced by: documentation. No UI claims "server confirmed" — only shows "Credit posted successfully" and event ID.
- Status: MAINTAINED. New conflict records must also carry this distinction.

**FIN-09:** Conflicting financial outcomes must not be silently discarded.
- **VIOLATED.** `safeSaveCreditOp` returning false for a COMMITTED result triggers no fallback.
- Fix target: P534-01.

**FIN-10:** No additional credit POST may be triggered merely because a stale result was received.
- Enforced by: stale handler returns without calling `handlePostCredit` or `load()` for stale responses.
- Status: MAINTAINED. Must verify conflict-evidence handling doesn't trigger POSTs.

## Asynchronous context invariants

**CTX-01:** A financial UI update must belong to the active tenant.
- Enforced by: `gen !== generationRef.current` check (generation increments on tenant change).
- **VIOLATED after res.json()** — `finStale` computed before the await is not rechecked.
- Fix target: P534-02.

**CTX-02:** A financial UI update must belong to the active administrator.
- Enforced by: `capturedAdminId !== getAdminInfo()?.id` check in `finStale`.
- **VIOLATED after res.json()** — same stale-boolean issue.
- Fix target: P534-02.

**CTX-03:** The originating authentication session must still be current.
- Enforced by: `safeLogout(capturedToken)` compares tokens (line 142-147).
- Status: MAINTAINED at the 401 check (line 381), but session could change during res.json().
- Partial fix target: P534-02 context revalidation.

**CTX-04:** Context validity must be checked after each relevant `await`, including response-body parsing.
- **VIOLATED in handlePostCredit** — `finStale` computed once before res.json().
- **MAINTAINED in handleCheckStatus** — `reconStale()` is a function, re-called after res.json().
- Fix target: P534-02.

**CTX-05:** An obsolete HTTP 401 cannot log out a newer session.
- Enforced by: `safeLogout(capturedToken)` (line 142-147).
- Status: MAINTAINED.

**CTX-06:** Financial persistence and UI freshness are separate decisions.
- Partially enforced: stale handler persists without UI update. Non-stale handler couples them.
- **Requires attention in P534-01:** A rejected persistence write for a stale response should still attempt conflict-evidence preservation without updating UI.

**CTX-07:** An older response cannot overwrite the state of a newer active operation.
- Enforced by: `safeSaveCreditOp` UUID check + state precedence.
- Status: MAINTAINED (but evidence lost per FIN-03/FIN-09).

**CTX-08:** Existing A→B→A navigation and same-route read-request freshness protections must remain intact.
- Enforced by: `generationRef`, `loadSeqRef`, `isReadStale()`.
- Status: MAINTAINED. Changes must not regress these.
