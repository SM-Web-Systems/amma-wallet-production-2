# Phase 5.3.5 — Invariants and Design

## Conflict Evidence Invariants (CE-01 to CE-08)

- **CE-01:** COMMITTED evidence cannot be downgraded to UNKNOWN, REJECTED, or SUBMITTING.
- **CE-02:** A late UNKNOWN response cannot erase an existing committed event ID.
- **CE-03:** An operation's UUID, administrator, tenant, amount, type, notes, and creation identity remain immutable.
- **CE-04:** Different UUIDs cannot overwrite one another (enforced by UUID-specific conflict keys).
- **CE-05:** Repeated COMMITTED evidence for the same UUID is idempotent.
- **CE-06:** Equal-precedence updates cannot silently erase previously recorded authoritative fields.
- **CE-07:** Conflicting immutable payloads are rejected or explicitly reported rather than silently accepted.
- **CE-08:** A browser-stored COMMITTED record represents evidence of a server response; it must not be treated as an independent accounting ledger.

## Authentication Session Invariants (AUTH-01 to AUTH-06)

- **AUTH-01:** A financial response from session S1 must not update the UI belonging to session S2.
- **AUTH-02:** Matching administrator IDs do not establish matching authentication sessions.
- **AUTH-03:** Financial evidence remains associated with the original UUID regardless of UI freshness.
- **AUTH-04:** An obsolete 401 cannot invalidate a newer session (already handled by `safeLogout`).
- **AUTH-05:** A refresh or navigation must not generate an additional credit.
- **AUTH-06:** Session tokens must not be logged or persisted in financial evidence records.

## Design Decisions

### R01: Monotonic saveConflictEvidence

Extend `saveConflictEvidence()` to:
1. Load existing conflict record for the same UUID before writing.
2. Apply `statePrecedence()` comparison (reuse existing function — export it).
3. Reject downgrades (return `true` — evidence IS protected by existing stronger record).
4. On equal precedence, preserve existing `committedEventId` if incoming is undefined.
5. On equal precedence, reject writes with conflicting immutable financial fields.
6. Treat malformed existing records as overwritable.

Return semantics: `true` = evidence is safe (written or already protected), `false` = genuine storage failure.

### R02: Token in staleness closures

Add `capturedToken !== sessionStorage.getItem("aw_admin_token")` to:
- `isFinStale()` in `handlePostCredit` (line 369)
- `reconStale()` in `handleCheckStatus` (line 504)
- Catch-block staleness check in `handlePostCredit` (line 467)

`capturedToken` is already captured at line 345 / 493. No new variable needed.

### R03: Check conflict evidence return values

At each `saveConflictEvidence` call site:
- Check return value.
- In current context (not stale): surface `setCreditError` warning with the idempotency key.
- In stale context: document limitation — cannot safely update wrong tenant's UI.
- Distinguish rejected downgrade (true) from genuine failure (false).
