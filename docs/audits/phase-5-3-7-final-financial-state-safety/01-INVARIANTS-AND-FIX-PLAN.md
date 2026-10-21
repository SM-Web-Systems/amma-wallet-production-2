# Phase 5.3.7 — Invariants and Fix Plan

## P537-01 Fix: Storage failure warning without replacing active operation

### Invariants
- FS-01: React must not show UUID-A as active while UUID-B is in storage.
- FS-02: COMMITTED result is important financial evidence regardless of storage.
- FS-03: Financial confirmation and persistence success are separate facts.
- FS-04: Storage failure must not authorize active-operation replacement.
- FS-05: Admin must receive reconciliation warning with the idempotency key.

### Plan
- On `storage_failed`, do NOT call `setCreditOp(committedOp)`.
- Call `refreshFromStorage()` to show the actual active operation (UUID-B).
- Set `setCreditError()` with warning containing UUID-A's key.
- The admin sees UUID-B as active + a warning about UUID-A.

## P537-02 Fix: Make expected UUID mandatory for clearing

### Invariants
- DC-01: Every user-initiated clear must identify the operation being cleared.
- DC-02: UUID mismatch must never delete the stored operation.
- DC-03: UUID mismatch must never create false IDLE while a stored op exists.
- DC-04: Acknowledgment of UUID-A must not clear UUID-B.
- DC-05: Discarding CONFIRMED must only clear that same UUID.

### Plan
- Make `expectedKey` required (not optional) in `discardCreditOp`.
- On UUID mismatch: restore stored operation into React (not null).
- Update `handleDiscardConfirmed()` to pass `creditOp?.key`.
- Verify `updateCreditOp` and `handleCreditClick` cannot overwrite a protected UUID.

## P537-03 Fix: Recover billing reads after session replacement

### Invariants
- SR-01: S1 responses cannot populate S2's view.
- SR-03: S2 must be able to obtain fresh billing data.
- SR-05: Read refresh cannot invalidate in-flight financial POST.

### Plan
- In `load()`'s `finally` block: if `isReadStale` is true, still reset `setLoading(false)`.
- Additionally, clear stale data so the admin sees an empty state rather than stale data.
- Show an error/retry prompt so the admin can trigger a fresh load under S2.
- Alternative: detect session change and re-invoke `load()` — but this risks
  complexity. The simplest fix is to ensure `loading` never gets stuck.

## P537-04 Fix: Discriminated conflict evidence results

### Invariants
- IC-01: Identity disagreement cannot overwrite existing evidence.
- IC-02: Identity disagreement must not be reported as successful preservation.
- IC-03: Same-UUID same-payload updates remain idempotent.

### Plan
- Change `saveConflictEvidence` return type to `ConflictEvidenceResult` discriminated union.
- Return `"identity_conflict"` when immutable fields differ.
- Return `"existing_protected"` for state-precedence downgrades.
- Return `"written"` for successful writes.
- Return `"storage_failed"` for genuine failures.
- Update `persistWithConflictFallback` to map these to `PersistenceOutcome`,
  adding `"identity_conflict"` variant.
- Callers can now distinguish all outcomes.
