# Phase 5.3.4 — Conflict Evidence Specification (P534-01)

## Design candidates

### Option A — Verify existing reconciliation path suffices

**Premise:** If the original UUID is always available (via the `submittingOp` closure in memory or via React state), the admin can use the existing "Check credit status" reconciliation endpoint to recover the outcome.

**Analysis:**
- When `finStale` is true, the handler returns early. React state is not updated.
- `submittingOp` exists only in the closure — once the handler returns, it is garbage collected.
- The admin sees a different tenant's view. They cannot access UUID-A's reconciliation UI.
- If they navigate back, they see UUID-B (if B exists) or IDLE (if slot was corrupted/cleared).
- UUID-A's key is permanently lost from the browser.

**Verdict: REJECTED.** Existing reconciliation requires the UUID, which is lost when the closure exits.

### Option B — Minimal conflict-evidence record in sessionStorage

**Premise:** When `safeSaveCreditOp` rejects a write for a COMMITTED (or significant) result, preserve the evidence in a separate, narrowly scoped conflict-evidence entry.

**Design:**

1. Add a `saveConflictEvidence(op: CreditOperation)` function to `credit-op-storage.ts`.
2. Storage key: `aw_credit_conflict_{adminId}_{tenantId}_{uuid}` — unique per operation.
3. Saved only when:
   - `safeSaveCreditOp` returns `false` (different UUID rejection).
   - The incoming operation state is COMMITTED or UNKNOWN (financially significant).
4. Content: the full `CreditOperation` object (preserves UUID, amount, eventId, timestamps).
5. Deduplication: key includes UUID, so duplicate saves overwrite harmlessly.
6. Accumulation limit: not needed — sessionStorage is per-tab and cleared on tab close. Conflicts are rare edge cases.
7. Retrieval: `loadConflictEvidence(adminId, tenantId)` scans sessionStorage for matching prefix.
8. UI: When conflict evidence exists for the active tenant, show an informational banner with the UUID and a link to reconciliation.

**Requirements satisfied:**
- FIN-02: Active operation B is never overwritten.
- FIN-03: A's evidence is recoverable via conflict record.
- FIN-09: Conflicting evidence is not silently discarded.
- FIN-08: Banner must clarify this is browser-side evidence, not server proof.
- FIN-10: No POST is triggered by conflict handling.
- FIN-01: Original UUID preserved.
- No new backend endpoint needed.
- No authentication tokens stored.
- Storage failures handled explicitly.

**Verdict: SELECTED.**

## Selected design — Option B

### New functions in credit-op-storage.ts

```typescript
const CONFLICT_PREFIX = "aw_credit_conflict_";

function conflictKey(adminId: number, tenantId: string, uuid: string): string {
  return `${CONFLICT_PREFIX}${adminId}_${tenantId}_${uuid}`;
}

export function saveConflictEvidence(op: CreditOperation): boolean {
  try {
    const key = conflictKey(op.adminId, op.tenantId, op.key);
    sessionStorage.setItem(key, JSON.stringify(op));
    // Verify the write succeeded (storage may be full)
    const verify = sessionStorage.getItem(key);
    return verify !== null;
  } catch {
    return false;
  }
}

export function loadConflictEvidence(adminId: number, tenantId: string): CreditOperation[] {
  const prefix = `${CONFLICT_PREFIX}${adminId}_${tenantId}_`;
  const results: CreditOperation[] = [];
  for (let i = 0; i < sessionStorage.length; i++) {
    const k = sessionStorage.key(i);
    if (k && k.startsWith(prefix)) {
      try {
        const parsed = JSON.parse(sessionStorage.getItem(k) ?? "null");
        if (parsed && typeof parsed.key === "string" && parsed.adminId === adminId && parsed.tenantId === tenantId) {
          results.push(parsed);
        }
      } catch { /* skip malformed */ }
    }
  }
  return results;
}

export function clearConflictEvidence(adminId: number, tenantId: string, uuid: string): void {
  sessionStorage.removeItem(conflictKey(adminId, tenantId, uuid));
}
```

### Caller changes in AdminTenantDetail.tsx

Where `safeSaveCreditOp` returns `false` for a financially significant result:

```typescript
const accepted = safeSaveCreditOp(committedOp);
if (!accepted && (committedOp.state === "COMMITTED" || committedOp.state === "UNKNOWN")) {
  saveConflictEvidence(committedOp);
}
```

### UI changes

When conflict evidence exists for the current (admin, tenant), display an
informational banner below the Post Credit section:

> "A previous credit operation (UUID: xxx) has a confirmed/uncertain outcome
> that could not be recorded in the active operation slot. This is browser-side
> recovery evidence — verify with the server using the idempotency key.
> [Dismiss]"

Dismiss calls `clearConflictEvidence`. The banner is purely informational —
it does not trigger any POST or modify the active operation.

### Retention behavior

- **Scope:** sessionStorage (tab-scoped, cleared on tab close).
- **Duplicate records:** Key includes UUID — duplicate saves overwrite the same key.
- **Malformed records:** `loadConflictEvidence` skips entries that fail JSON parsing or validation.
- **Storage failures:** `saveConflictEvidence` returns false if the write fails.
- **Cross-session:** Evidence does not persist across browser sessions. This is acceptable because the server ledger is authoritative — the evidence is for in-session recovery only.

### Limitations

- If the browser tab is closed before the admin sees the banner, the evidence is lost.
- The evidence alone does not prove a server-side commitment — it preserves the UUID for reconciliation.
- No automatic reconciliation is triggered.
