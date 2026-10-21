# Phase 5.3.7 — Independent Code Review

## Reviewer

Claude Opus (independent subagent, separate context from implementation)

## 12 Mandatory Review Questions

### Q1: Does `persistWithConflictFallback` correctly map every `ConflictEvidenceResult` variant?
**PASS.** Switch covers all four variants: `written`/`existing_protected` -> `conflict_preserved`,
`identity_conflict` -> `identity_conflict`, `storage_failed` -> `storage_failed`.

### Q2: Does `saveConflictEvidence` return `identity_conflict` for ALL immutable field mismatches?
**FAIL (minor).** Six fields (amount, type, notes, createdAt, adminId, tenantId) checked symmetrically.
`committedEventId` is asymmetric — existing `null` silently accepts incoming value.
This is tested and intentional (UNKNOWN->COMMITTED fills in the ID), but was not documented.
**Resolved:** Comment added at the asymmetric check explaining the design choice.

### Q3: Can `discardCreditOp("")` (empty string key) cause unintended clearing?
**PASS.** Empty string never matches a real UUID. Mismatch branch restores stored op.

### Q4: Does the P537-02 mismatch path restore stored op WITHOUT clearing it?
**PASS.** `setCreditOp(stored)` + early return before `clearCreditOp`.

### Q5: Does `setLoading(false)` ALWAYS run in `finally`?
**PASS.** Both stale and non-stale branches in `finally` call `setLoading(false)`.

### Q6: Does "Session changed" error only appear when token actually changed?
**PASS.** Gated by `tokenChanged` check, not just `isReadStale`. Newer load() with same
token (different sequence) shows no error.

### Q7: Any code paths where `setCreditOp(committedOp)` still runs after `storage_failed`?
**PASS.** All three consumption sites (HTTP 200, catch, reconciliation) now call
`refreshFromStorage()` on `storage_failed`, never `setCreditOp(committedOp)`.

### Q8: Do updated P534/P536 test assertions accurately reflect new discriminated types?
**PASS.** All boolean expectations replaced with `.toEqual({ kind: "..." })`.

### Q9: Is `creditError` visible in ALL operation state views?
**PASS.** Added to SUBMITTING and UNKNOWN blocks. Already present in COMMITTED and IDLE/CONFIRMED.
REJECTED excluded — `creditError` is always cleared before entering REJECTED.

### Q10: Can race between `refreshFromStorage()` and `setCreditError()` cause flash?
**PASS.** Both are synchronous in same block; React batches. Error persists until
explicitly cleared by navigation or `discardCreditOp`.

### Q11: Does `identity_conflict` PersistenceOutcome get handled safely?
**PASS.** Falls into the `else` branch alongside `conflict_preserved` — both call
`refreshFromStorage()`. Safe because storage data is already protected.

### Q12: Any TypeScript type holes from old boolean return?
**PASS.** `saveConflictEvidence` typed `(): ConflictEvidenceResult`. All call sites
use `.kind` property access. `tsc --noEmit` clean.

## Summary

**11/12 PASS, 1 minor finding resolved.** No blocking issues. All safety invariants hold.
