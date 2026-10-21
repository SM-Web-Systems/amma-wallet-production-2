# Phase 5.3.6 — Baseline and Root-Cause Analysis

Baseline: `9bc8f8db9d404e29428c6dea5351501aa4d81cd4` (Phase 5.3.5 HEAD)

## P536-01: Financial persistence outcomes are conflated

**File:** `AdminTenantDetail.tsx` lines 381–395 (`safePersistWithConflict`)

`safePersistWithConflict()` returns `boolean` — `true` means either:
1. `safeSaveCreditOp()` accepted (active slot updated), OR
2. `saveConflictEvidence()` succeeded (active slot NOT updated)

The component treats `true` as permission to call `setCreditOp(committedOp)` (lines 469–477),
making React state inconsistent with the active storage slot.

**Failure sequence:**
1. UUID-A submitted → SUBMITTING in active slot and React.
2. UUID-B replaces UUID-A in active slot (e.g., concurrent session restore).
3. UUID-A's COMMITTED response arrives — route and session unchanged.
4. `safeSaveCreditOp(A)` rejects (UUID mismatch) → returns false.
5. `saveConflictEvidence(A)` succeeds → `safePersistWithConflict` returns true.
6. `setCreditOp(committedOp)` executes → React shows UUID-A as COMMITTED.
7. Active storage still holds UUID-B.
8. Admin acknowledges UUID-A → `clearCreditOp()` → UUID-B destroyed.

**Previous tests masked this** by navigating away before releasing the deferred response,
which triggered the generation staleness guard and prevented the `setCreditOp` call.

## P536-02: Conflict evidence identity validation is incomplete

**File:** `credit-op-storage.ts` lines 138–153 (`saveConflictEvidence`)

Immutable financial field validation (amount, type, adminId, tenantId) only executes
when `incomingPrec === existingPrec` (line 139). For upgrades (`incomingPrec > existingPrec`),
the code falls through to `sessionStorage.setItem()` on line 158 without identity checks.

**Failure sequence:**
- Existing: `{ key: "UUID-A", state: "UNKNOWN", amount: "100.0000000" }`
- Incoming: `{ key: "UUID-A", state: "COMMITTED", amount: "999.0000000", committedEventId: 77 }`
- `incomingPrec(COMMITTED)=5 > existingPrec(UNKNOWN)=3` → skips identity check → overwrites.

Also: duplicate COMMITTED with conflicting `committedEventId` values can overwrite
because `CE-06` only preserves existing eventId when incoming is null, not when it conflicts.

## P536-03: Read requests lack authentication-session freshness

**File:** `AdminTenantDetail.tsx` lines 158–164 (`isReadStale`)

`isReadStale()` checks route generation, per-request sequence, and admin ID.
It does NOT check the authentication token — unlike `isFinStale()` (lines 371–374) which does.

**Failure sequence:**
1. Admin A opens Tenant 1 under session S1 (token "jwt-1").
2. `load()` fires with `capturedToken = "jwt-1"`.
3. Admin re-authenticates → session S2 (token "jwt-2"), same admin ID.
4. S1's billing response arrives.
5. `isReadStale(gen, seq, adminId)` → gen matches, seq matches, adminId matches → NOT stale.
6. S1's data is applied to S2's view.

The captured token is already available in `load()`, `loadOlderEvents()`, and `submitStatusAction()`
but is only used for `safeLogout()`, not passed to `isReadStale()`.
