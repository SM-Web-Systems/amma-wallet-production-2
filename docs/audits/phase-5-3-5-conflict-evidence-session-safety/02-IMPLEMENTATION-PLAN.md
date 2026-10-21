# Phase 5.3.5 — Implementation Plan

## Step 1: RED — Regression tests

### R01 tests (credit-op-storage.test.ts)
- UNKNOWN → COMMITTED upgrade succeeds
- COMMITTED → UNKNOWN rejected, existing preserved
- COMMITTED → REJECTED rejected
- Duplicate COMMITTED preserves correct eventId
- COMMITTED without eventId cannot erase existing eventId
- Altered immutable fields rejected
- Different UUIDs remain isolated
- Delayed network error cannot overwrite committed conflict
- All existing S01–S07 tests continue passing

### R02 tests (AdminTenantDetail.test.tsx)
- Same-admin session S1 → S2 during res.json() prevents stale UI update
- S1's financial result correctly persisted despite UI rejection
- Delayed error from S1 cannot display in S2
- Obsolete 401 from S1 cannot log out S2
- Existing different-admin and navigation tests still pass

### R03 tests (AdminTenantDetail.test.tsx)
- Quota error during saveConflictEvidence
- Caller recognizes failure (warning shown in current context)
- Active UUID unchanged
- No additional credit POST
- Stale-context failure cannot update wrong tenant's UI
- Rejected downgrade distinguished from genuine failure

## Step 2: GREEN — Minimal implementation

### credit-op-storage.ts
- Export `statePrecedence` (currently private, needed by tests and saveConflictEvidence)
- Add monotonic write logic to `saveConflictEvidence`:
  - Load existing, compare precedence, reject downgrades
  - Preserve committedEventId on equal-state writes
  - Reject conflicting immutable fields on equal-state writes

### AdminTenantDetail.tsx
- Add `capturedToken` comparison to `isFinStale()` closure
- Add `capturedToken` comparison to `reconStale()` closure
- Add `capturedToken` comparison to catch-block staleness check
- Check `saveConflictEvidence` return values in `safePersistWithConflict`
- Check `saveConflictEvidence` return values in catch block
- Check `saveConflictEvidence` return values in `handleCheckStatus`
- Surface warning on genuine failure in current context

## Step 3: VERIFY — Targeted + full regression
- All P535 tests pass
- All P534 tests pass
- Full frontend suite passes
- Full backend suite passes
- TypeScript clean
- Production build successful

## Step 4: REVIEW — Independent code review (12 questions)

## Step 5: COMMIT — Logical commits
1. Regression tests
2. Implementation corrections
3. Documentation and verification results
