# Phase 5.3.5 — Baseline and Findings

## Baseline

- **Branch:** `fix/phase-5-3-4-financial-evidence-async-safety`
- **Commit:** `25bd58d646f2a2a3df6f780ea412874cf19f6d7e`
- **Source:** Independent ChatGPT review of Phase 5.3.4

## Findings

### P534-R01 — HIGH: Conflict evidence state downgrade

**Root cause:** `saveConflictEvidence()` (`credit-op-storage.ts:118-126`) unconditionally
writes to sessionStorage without checking state precedence. A second write for the same
UUID replaces the existing record, allowing COMMITTED evidence (including `committedEventId`)
to be overwritten by UNKNOWN.

**Failure path:**
1. UUID-A COMMITTED response stored as conflict evidence (eventId=42)
2. Delayed network-error or retry produces UNKNOWN for UUID-A
3. `saveConflictEvidence` overwrites COMMITTED with UNKNOWN
4. `committedEventId` is lost

**Affected function:** `saveConflictEvidence` — no state-precedence logic.

### P534-R02 — MEDIUM: Same-administrator session bypass

**Root cause:** `isFinStale()` closure (`AdminTenantDetail.tsx:369`) checks
`generationRef.current` and `getAdminInfo()?.id` but not the authentication token.
`capturedToken` is already captured at line 345 but unused in the staleness closure.
Same defect in `reconStale()` (line 504) and catch-block staleness (line 467).

**Failure path:**
1. Admin A (id=1, token S1) submits credit
2. Response headers arrive, `res.json()` pending
3. Admin A logs out and logs back in (id=1, token S2)
4. `res.json()` resolves
5. `isFinStale()` returns false — gen unchanged, adminId matches
6. S1's result updates S2's UI

### P534-R03 — MEDIUM: Unhandled conflict evidence storage failures

**Root cause:** Four call sites ignore `saveConflictEvidence()` return value:
- `safePersistWithConflict` (line 377) — ignores return
- Catch block (lines 463-464) — ignores return
- `handleCheckStatus` stale path (line 517) — ignores return
- `handleCheckStatus` committed path (line 541) — ignores return

When sessionStorage throws (quota exceeded), callers proceed as if evidence
was preserved. No warning is surfaced.
