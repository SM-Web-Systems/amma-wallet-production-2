# Phase 5.3.4 — Source Assessment

## Functions examined

### credit-op-storage.ts
- `storageKey(adminId, tenantId)` — deterministic key: `aw_pending_credit_{adminId}_{tenantId}`
- `loadCreditOp(adminId, tenantId)` — validates JSON shape, adminId match, tenantId match
- `saveCreditOp(op)` — unconditional write to sessionStorage
- `safeSaveCreditOp(op)` — conditional write: rejects different-UUID writes (line 86), rejects state downgrades (line 96), accepts same-UUID upgrades (line 91-93)
- `clearCreditOp(adminId, tenantId)` — removes storage entry
- `statePrecedence(state)` — COMMITTED(5) > REJECTED(4) > UNKNOWN(3) > SUBMITTING(2) > CONFIRMED(1)

### AdminTenantDetail.tsx
- `generationRef` — monotonically increasing counter, incremented on route `id` change (line 96)
- `loadSeqRef` — per-request counter for read staleness, incremented on each load() call (line 164)
- `handlePostCredit()` — credit POST handler (lines 314-428)
- `handleCheckStatus()` — reconciliation handler (lines 435-521)
- `handleAcknowledge()` — clears terminal op, returns to IDLE (lines 524-529)
- `updateCreditOp(next)` — unconditional save + setCreditOp (lines 245-248)
- `isReadStale(gen, seq, capturedAdminId)` — staleness check for read operations (lines 151-157)

### admin-api.ts
- `adminFetch(path, options)` — attaches JWT from sessionStorage
- `getAdminInfo()` — parses admin identity from sessionStorage

## P534-01 trace: UUID-A COMMITTED lost when UUID-B occupies slot

### The code path (handlePostCredit, lines 345-418)

1. Admin submits operation A. `submittingOp` captures `{...creditOp, state: "SUBMITTING"}` with UUID-A.
2. `adminFetch()` starts on line 346.
3. Admin navigates away — `generationRef.current` increments.
4. Response arrives. `finStale = true` on line 360.
5. Stale handler (lines 362-377):
   - `res.ok` path (line 369-373): calls `safeSaveCreditOp({...submittingOp, state: "COMMITTED"})`.
   - If UUID-B occupies the slot, `safeSaveCreditOp` returns `false`.
   - **No fallback.** The handler returns on line 377. UUID-A's COMMITTED evidence is lost.

### Same pattern in handleCheckStatus (lines 462-476)

1. Reconciliation discovers COMMITTED for UUID-A.
2. If UUID-B occupies the slot, `safeSaveCreditOp` returns `false`.
3. No fallback. Returns on line 476.

### Can UUID-B legitimately occupy A's slot?

**Through normal UI flow:** Extremely unlikely. The SUBMITTING state locks the UI, preventing a new operation for the same (admin, tenant) pair. Navigation away clears React state but storage retains A as SUBMITTING.

**However, the following boundary conditions can invalidate this:**
- Session storage eviction by the browser under memory pressure
- Manual storage manipulation (devtools)
- Storage corruption (malformed JSON → loadCreditOp returns null → slot appears empty)
- Race between stale-path persistence and a concurrent operation in another code path

**The finding is valid regardless of reproduction difficulty.** When `safeSaveCreditOp` returns `false` on a COMMITTED result, the financial evidence is silently discarded. A financial system must not silently lose confirmed transaction evidence.

### Existing tests covering this area

- `credit-op-storage.test.ts`: Tests `safeSaveCreditOp` rejection for different UUIDs (6 tests). All verify rejection correctly but none test what happens to the rejected evidence.
- `AdminTenantDetail.test.tsx` P533-01-G: Claims to test "rejected storage write does not cause React state to display conflicting result" but only verifies a pre-loaded COMMITTED display — never executes a delayed POST response.

## P534-02 trace: stale context after res.json()

### The code path (handlePostCredit, lines 356-418)

```
Line 360: const finStale = gen !== generationRef.current || capturedAdminId !== getAdminInfo()?.id;
Line 361: if (finStale) { ... return; }  // correctly handles stale at this point
Line 381: if (res.status === 401) { safeLogout(capturedToken); return; }
Line 382: const d = await res.json();  // <== ASYNC BOUNDARY — context may change here
Line 384: if (!res.ok) {
Line 395:   if (!finStale && rejAccepted) setCreditOp(rejectedOp);  // finStale is STALE
Line 401:   if (!finStale && unkAccepted) setCreditOp(unknownOp);   // finStale is STALE
Line 415:   if (!finStale && comAccepted) {                          // finStale is STALE
Line 416:     setCreditOp(committedOp);
Line 417:     load();
Line 418:   }
```

`finStale` is computed **once** at line 360 as a boolean. After `await res.json()` on line 382, `finStale` is not rechecked. If tenant/admin/session changes during body parsing, `finStale` remains `false` and the handler updates React state for the wrong context.

### Contrast with handleCheckStatus

```
Line 462: const reconStale = () => gen !== generationRef.current || ...;  // FUNCTION
Line 479: const d = await res.json();
Line 481: const stale = reconStale();  // Re-evaluated after second await
```

`handleCheckStatus` uses `reconStale()` as a closure that re-evaluates at each call site. This correctly handles the res.json() boundary.

### Contrast with catch block in handlePostCredit

```
Line 425: const catchStale = gen !== generationRef.current || capturedAdminId !== getAdminInfo()?.id;
```

The catch block **does** re-compute staleness. Only the try-block success/error paths after line 382 are vulnerable.

### Window of vulnerability

Between the first `finStale` check passing (line 361) and the `!finStale` guards at lines 395, 401, 415. The `await res.json()` on line 382 is the exact async boundary where context can change.

### Existing tests

No existing test exercises delayed `res.json()` independent of delayed `fetch()`. All deferred-promise tests hold the entire MSW response, which means `res.json()` resolves immediately once fetch resolves.

### Reproduction

Requires a mechanism to delay response-body streaming after headers arrive but before JSON parsing completes. MSW deferred promises hold the entire response, which bundles headers and body together. A controlled fetch mock or a custom Response with a delayed ReadableStream body is needed to isolate the res.json() window.
