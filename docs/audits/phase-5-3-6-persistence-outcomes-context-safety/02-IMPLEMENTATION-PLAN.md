# Phase 5.3.6 — Implementation Plan

## P536-01: Separate financial persistence outcomes

### credit-op-storage.ts
- Export `PersistenceOutcome` discriminated union: `"active_updated" | "conflict_preserved" | "storage_failed"`
- Export `persistWithConflictFallback(op)` returning `PersistenceOutcome`
  - Calls `safeSaveCreditOp(op)` — if true → `"active_updated"`
  - If false and state is COMMITTED/UNKNOWN → calls `saveConflictEvidence(op)` → `"conflict_preserved"` or `"storage_failed"`
  - Otherwise → `"conflict_preserved"` (rejection without evidence needed)

### AdminTenantDetail.tsx
- Replace local `safePersistWithConflict` closure with `persistWithConflictFallback`
- All call sites: only `setCreditOp` when outcome is `"active_updated"`
- On `"conflict_preserved"`: refresh React state from storage and reload conflict evidence
- On `"storage_failed"`: show error, for COMMITTED also show the state (admin must know)
- Guard `discardCreditOp` with UUID match check (PO-05)

### Tests
- Same-route, same-session conflict preservation does not setCreditOp
- UUID-B remains in active storage after UUID-A's conflict preservation
- UUID-A's COMMITTED evidence in conflict storage
- Acknowledgment cannot clear UUID-B
- Successful same-UUID COMMITTED updates React normally
- Storage failure produces warning
- No duplicate POST

## P536-02: Enforce immutable financial identity across all transitions

### credit-op-storage.ts — `saveConflictEvidence()`
- Move immutable field validation BEFORE state precedence comparison
- Validate: amount, type, adminId, tenantId, notes, createdAt
- Protect committedEventId: reject conflicting values (not just missing)
- Handle missing/undefined fields safely for legacy records

### Tests
- UNKNOWN → COMMITTED with matching identity succeeds
- UNKNOWN → COMMITTED with altered amount rejected
- UNKNOWN → COMMITTED with altered notes rejected
- UNKNOWN → COMMITTED with altered createdAt rejected
- UNKNOWN → COMMITTED with altered type rejected
- Duplicate COMMITTED with same eventId is idempotent
- Duplicate COMMITTED with different eventIds rejected
- Missing incoming eventId cannot erase existing
- COMMITTED → UNKNOWN cannot downgrade (preserved from P535)
- Existing evidence unchanged after invalid update

## P536-03: Authentication-session freshness for billing reads

### AdminTenantDetail.tsx — `isReadStale()`
- Add `capturedToken` parameter
- Compare with current `sessionStorage.getItem("aw_admin_token")`
- Update all call sites: `load()`, `loadOlderEvents()`, `submitStatusAction()`

### Tests
- Same admin, same tenant, S1 → S2 without navigation: S1 response discarded
- S2 fresh response populates view
- S1 pagination results cannot append to S2 events
- Obsolete S1 401 cannot log out S2
- Loading indicators recover
- A → B → A navigation regression green
- Financial POST independent of read-sequence invalidation
