# Phase 5.3.3 — Root Cause Analysis

## P533-01: Unsafe Financial Operation Replacement

### Root cause 1: Different-UUID overwrite in safeSaveCreditOp

**File:** `packages/web-app/src/lib/credit-op-storage.ts:83-87`

```typescript
if (existing.key !== op.key) {
    if (existingPrec >= 4) return false;
    saveCreditOp(op);
    return true;
}
```

**Why this is wrong:** The storage slot `aw_pending_credit_{adminId}_{tenantId}` holds exactly one operation at a time. When two operations share this slot (same admin, same tenant, different UUIDs), the function allows a newer or stale write to replace a non-terminal operation. The UNKNOWN state (precedence 3) represents genuine financial uncertainty — the server may have committed real money. Allowing a different UUID to silently replace an UNKNOWN record erases evidence of a potentially committed transaction.

**Confirmed defect states that can be overwritten:**
- CONFIRMED (prec 1): Operation confirmed by user, awaiting submission
- SUBMITTING (prec 2): HTTP POST currently in-flight
- UNKNOWN (prec 3): Financial outcome genuinely uncertain

### Root cause 2: Ignored safeSaveCreditOp return value

**File:** `packages/web-app/src/pages/AdminTenantDetail.tsx` (multiple locations)

The `safeSaveCreditOp()` function returns `boolean` — `true` if the write was accepted, `false` if rejected. Every call site in the component ignores this return value. When the function returns `false` (storage write rejected), the subsequent `setCreditOp()` call still executes, updating React state to a value that does not match storage.

**Affected call sites:**
- Line 363: `safeSaveCreditOp(rejectedOp)` → line 364: `setCreditOp(rejectedOp)` — unconditional
- Line 368: `safeSaveCreditOp(unknownOp)` → line 369: `setCreditOp(unknownOp)` — unconditional
- Line 381: `safeSaveCreditOp(committedOp)` → lines 382-383: `setCreditOp(committedOp)` — unconditional
- Line 389: `safeSaveCreditOp(unknownOp)` → line 390: `setCreditOp(unknownOp)` — unconditional
- Line 453-454: `safeSaveCreditOp(committedOp)` → line 455: `setCreditOp(committedOp)` — unconditional

**Consequence:** After a rejected persistence write, the UI displays financial information (e.g., "Credit rejected — not applied") while storage contains different information (e.g., COMMITTED with event ID). This contradicts the principle that storage is the source of truth for financial operations.

### Trigger sequence (demonstrated)

```
T=0  Admin starts op A (UUID-A) for tenant 42 → SUBMITTING
T=1  Server returns 500 → UNKNOWN stored
T=2  Admin clicks "Check credit status" → GET /credit-status in-flight
T=3  Admin navigates to tenant 99 (gen changes)
T=4  Admin navigates back to tenant 42 (gen changes again)
T=5  useEffect restores UUID-A UNKNOWN from storage
T=6  Admin acknowledges → clearCreditOp → storage empty
T=7  Admin creates op B (UUID-B) → CONFIRMED → SUBMITTING
T=8  Stale GET from T=2 resolves with status: "committed"
T=9  safeSaveCreditOp({...closureCreditOp, state: "COMMITTED"})
     closureCreditOp.key = UUID-A (from T=2 closure)
     storage has UUID-B SUBMITTING (prec 2 < 4)
     → UUID-B OVERWRITTEN by UUID-A COMMITTED
T=10 UUID-B's POST resolves → safeSaveCreditOp sees UUID-A COMMITTED (prec 5)
     → UUID-B's result REJECTED (different key, terminal existing)
T=11 Financial result for UUID-B is permanently lost from browser
```

---

## P533-02: Same-Route Request and Session Freshness

### Root cause: generationRef is route-scoped, not request-scoped

**File:** `packages/web-app/src/pages/AdminTenantDetail.tsx:84-89`

```typescript
const generationRef = useRef(0);
useEffect(() => {
    idRef.current = id;
    generationRef.current += 1;
}, [id]);
```

The generation counter increments only when the route parameter `id` changes. It does not increment when:
- `load()` is called for the same tenant (refresh, post-commit reload)
- The admin session changes without navigation
- Overlapping requests are made for the same tenant

**Why this matters:** The generation counter is the SOLE freshness check for all async handlers. If two requests share the same generation, the staleness check `gen !== generationRef.current` cannot distinguish between them. The last response to resolve wins, regardless of whether it's the newest request.

### Trigger sequence (overlapping same-tenant requests)

```
T=0  load() called → captures gen=5, starts fetch
T=1  load() called again (refresh) → captures gen=5, starts fetch
T=2  Response for T=1 (newer) arrives → gen===5 → updates state to NEW data
T=3  Response for T=0 (older) arrives → gen===5 → overwrites state to OLD data
```

### Trigger sequence (admin session change)

```
T=0  Admin A views tenant 42, load() captures gen=5, token=A
T=1  Admin B logs in (updates sessionStorage) — no route change
T=2  Admin A's response arrives → gen===5 → updates React state
     → Admin B sees Admin A's data
     → If A's response is a financial result, it may affect B's view
```

### Distinction between request freshness concepts

| Concept | Current implementation | Gaps |
|---------|----------------------|------|
| Route context identity | generationRef (increments on id change) | Working correctly |
| Request freshness | **Not tracked** — relies on generationRef | Overlapping same-route requests unprotected |
| Authentication session | safeLogout (token comparison for 401s only) | Successful responses don't check admin identity |
| Financial operation identity | creditOp.key (UUID) | safeSaveCreditOp allows different-UUID overwrites (P533-01) |
