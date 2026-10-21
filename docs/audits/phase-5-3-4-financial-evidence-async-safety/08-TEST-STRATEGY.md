# Phase 5.3.4 — Test Strategy

## Testing tools
- Vitest (test runner)
- React Testing Library (component rendering)
- React Router (createMemoryRouter + RouterProvider for navigation)
- MSW (HTTP mock server)
- Controlled deferred promises (async timing control)

## P534-01 mandatory tests

### Storage-level tests (credit-op-storage.test.ts)

| ID | Test | Invariant |
|----|------|-----------|
| S01 | saveConflictEvidence stores under UUID-specific key | FIN-03 |
| S02 | loadConflictEvidence retrieves matching records | FIN-03 |
| S03 | clearConflictEvidence removes specific record | FIN-03 |
| S04 | Duplicate saves overwrite same key (no accumulation) | FIN-09 |
| S05 | Malformed conflict records skipped on load | FIN-08 |
| S06 | Storage failure returns false | FIN-09 |
| S07 | Conflict records isolated by admin/tenant | FIN-02 |

### Component-level tests (AdminTenantDetail.test.tsx)

| ID | Test | Invariant |
|----|------|-----------|
| C01 | UUID-A COMMITTED evidence preserved when UUID-B active (stale path) | FIN-03, FIN-09 |
| C02 | UUID-B remains the active operation after conflict | FIN-02 |
| C03 | Same-UUID COMMITTED preserved normally (no conflict) | FIN-03 |
| C04 | Same-UUID UNKNOWN cannot overwrite COMMITTED | FIN-04 |
| C05 | Duplicate confirmation does not create duplicate evidence | FIN-09 |
| C06 | Storage failure does not report successful persistence | FIN-09 |
| C07 | No extra credit POST triggered by conflict handling | FIN-10 |
| C08 | Conflict evidence banner shown when evidence exists | FIN-03 |
| C09 | Corrected P533-01-G: delayed POST + conflicting storage + persistence rejection | FIN-05 |

### Test mechanism for C01 (key test)

1. Render component for tenant "1".
2. Start credit operation A (UUID-A) — submit through confirmation dialog.
3. Hold credit POST response with deferred promise.
4. Navigate to tenant "2" (makes response stale).
5. Manually place UUID-B in storage for tenant "1" (simulating boundary condition).
6. Resolve deferred — server returns COMMITTED for UUID-A.
7. Assert: UUID-B remains in active storage slot.
8. Assert: UUID-A COMMITTED exists in conflict evidence storage.
9. Assert: UI does not show UUID-A's result on tenant "2".

## P534-02 mandatory tests

### Component-level tests (AdminTenantDetail.test.tsx)

| ID | Test | Invariant |
|----|------|-----------|
| R01 | Context revalidation after res.json() — tenant change during body parse | CTX-01, CTX-04 |
| R02 | Context revalidation after res.json() — admin change during body parse | CTX-02, CTX-04 |
| R03 | Context revalidation after res.json() — session change during body parse | CTX-03, CTX-04 |
| R04 | Stale 401 cannot invalidate newer session | CTX-05 |
| R05 | Delayed error response cannot produce stale UI state | CTX-01 |
| R06 | Existing successful credit POST behavior remains intact | CTX-08 |
| R07 | Existing same-route refresh and A→B→A tests remain green | CTX-08 |

### Test mechanism for R01 (key test)

To isolate the `res.json()` boundary from the `fetch()` boundary:

1. Override `global.fetch` (or use vi.spyOn) to return a Response whose `.json()` method is a controlled deferred promise.
2. Submit credit POST.
3. Fetch resolves immediately (headers arrive) — but `res.json()` is held.
4. Navigate to tenant "2" (changes generationRef).
5. Resolve the deferred json promise.
6. Assert: Tenant "2" UI is unchanged — no COMMITTED banner from tenant "1".
7. Assert: Financial evidence for tenant "1" is still persisted via safeSaveCreditOp or conflict evidence.

This approach directly exercises the `await res.json()` boundary that MSW deferred promises cannot isolate.

## Corrected P533-01-G test

The existing test pre-loads a COMMITTED operation in storage and verifies the UI shows it.
It never executes a delayed POST response that would be rejected by safeSaveCreditOp.

**Corrected test must:**
1. Start a real credit POST request (not pre-loaded state).
2. Hold the response with a deferred promise.
3. While held, place a conflicting operation (different UUID) in storage.
4. Release the deferred response.
5. Verify safeSaveCreditOp rejects the write (storage unchanged).
6. Verify React does not display the rejected result.

## Baseline red-test requirement

At least one test per finding must fail against the Phase 5.3.3 baseline:
- P534-01: C01 should fail because `saveConflictEvidence` does not exist.
- P534-02: R01 should fail because `isFinStale()` does not exist and `finStale` is stale.

## No-weaken rule

Tests must not be weakened to pass. If a test fails unexpectedly, use systematic debugging to find and fix the root cause.
