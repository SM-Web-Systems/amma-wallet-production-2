# Phase 5.3.4 — Async Context Revalidation Specification (P534-02)

## Design candidates

### Option A — Convert finStale to a function (like reconStale)

**Change:** Replace `const finStale = ...` with `const isFinStale = () => ...` and
re-call after every `await`.

**Pros:**
- Minimal diff — matches existing `reconStale()` pattern in `handleCheckStatus`.
- No new abstractions.
- Every call site re-evaluates current state.

**Cons:**
- Slightly more verbose: every `!finStale` becomes `!isFinStale()`.
- Must manually add calls after each await (easy to miss in future edits).

### Option B — Request-context snapshot with validation helper

**Change:** Create a `CreditRequestContext` type capturing gen, adminId, token.
Provide a `validateContext(ctx)` helper that returns a fresh staleness check.

**Pros:**
- Encapsulates all identity checks in one place.
- Reusable across handlePostCredit and handleCheckStatus.

**Cons:**
- Introduces a new type and helper for a two-function use case.
- Over-engineering for the actual change required.

### Decision

**Selected: Option A.**

Rationale:
- `handleCheckStatus` already uses this exact pattern (`reconStale` as a closure).
- The fix is a 3-line change: rename `finStale` to `isFinStale()`, add calls after res.json().
- No new abstractions needed.
- Consistent with existing codebase style.

## Implementation detail

### Before (vulnerable)

```typescript
// Line 360
const finStale = gen !== generationRef.current || capturedAdminId !== getAdminInfo()?.id;
if (finStale) { ... return; }

// Line 381-382
if (res.status === 401) { safeLogout(capturedToken); return; }
const d = await res.json();
// finStale is NOT re-evaluated here

// Lines 395, 401, 415
if (!finStale && rejAccepted) setCreditOp(rejectedOp);
if (!finStale && unkAccepted) setCreditOp(unknownOp);
if (!finStale && comAccepted) { setCreditOp(committedOp); load(); }
```

### After (safe)

```typescript
// Line 360 — now a function
const isFinStale = () => gen !== generationRef.current || capturedAdminId !== getAdminInfo()?.id;
if (isFinStale()) { ... return; }

// Line 381-382
if (res.status === 401) { safeLogout(capturedToken); return; }
const d = await res.json();

// Re-evaluate after res.json() — context may have changed during body parsing
if (isFinStale()) {
  // Persist financial evidence (same as stale-path logic) but do NOT update UI
  if (res.ok) {
    const committedOp = { ...submittingOp, state: "COMMITTED" as const, committedEventId: d.billingEventId ?? undefined };
    const accepted = safeSaveCreditOp(committedOp);
    if (!accepted && (committedOp.state === "COMMITTED")) {
      saveConflictEvidence(committedOp);
    }
  } else if (res.status >= 500) {
    safeSaveCreditOp({ ...submittingOp, state: "UNKNOWN" as const });
  }
  return;
}

// Lines 395, 401, 415 — now use isFinStale()
if (!isFinStale() && rejAccepted) setCreditOp(rejectedOp);
if (!isFinStale() && unkAccepted) setCreditOp(unknownOp);
if (!isFinStale() && comAccepted) { setCreditOp(committedOp); load(); }
```

### Branches protected

| Branch | Status before fix | Status after fix |
|--------|------------------|-----------------|
| HTTP 200 COMMITTED | finStale stale | isFinStale() re-evaluated + conflict evidence |
| 4xx REJECTED | finStale stale | isFinStale() re-evaluated |
| 5xx UNKNOWN | finStale stale | isFinStale() re-evaluated |
| 401 (before res.json) | Already handled | Unchanged |
| catch (network error) | Already re-computes | Unchanged |

### Security implications

- No new authentication surfaces.
- No tokens stored in conflict evidence.
- Session revalidation strengthened (checked at more boundaries).
- No behavioral change for non-racy scenarios.
