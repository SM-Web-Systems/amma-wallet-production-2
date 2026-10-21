# Phase 5.3.3 — Source Assessment

## A1. Financial Persistence Analysis

### Storage model

- One slot per (adminId, tenantId): `aw_pending_credit_{adminId}_{tenantId}`
- Multiple UUIDs share the same slot if they belong to the same admin+tenant
- Only one operation can be "active" at a time per slot

### Write paths traced

| # | Function | File:Line | UUID source | Sync/Async | Storage write | React state update | Return checked |
|---|----------|-----------|-------------|------------|---------------|-------------------|----------------|
| W1 | `updateCreditOp` | ATD:219-222 | current creditOp | Sync | `saveCreditOp(next)` | `setCreditOp(next)` | N/A (unconditional) |
| W2 | `handleCreditClick` (IDLE→CONFIRMED) | ATD:272-283 | new `crypto.randomUUID()` | Sync | via `updateCreditOp` | via `updateCreditOp` | N/A |
| W3 | `handlePostCredit` (CONFIRMED→SUBMITTING) | ATD:312-313 | existing creditOp.key | Sync | via `updateCreditOp` | via `updateCreditOp` | N/A |
| W4 | `handlePostCredit` stale 401 | ATD:334 | closure submittingOp.key | Async | `safeSaveCreditOp` | **none** | **NO** |
| W5 | `handlePostCredit` stale OK | ATD:340-343 | closure submittingOp.key | Async | `safeSaveCreditOp` | **none** | **NO** |
| W6 | `handlePostCredit` stale 5xx | ATD:345 | closure submittingOp.key | Async | `safeSaveCreditOp` | **none** | **NO** |
| W7 | `handlePostCredit` current 4xx→REJECTED | ATD:363-364 | closure submittingOp.key | Async | `safeSaveCreditOp` | `setCreditOp(rejectedOp)` | **NO** |
| W8 | `handlePostCredit` current 5xx→UNKNOWN | ATD:368-369 | closure submittingOp.key | Async | `safeSaveCreditOp` | `setCreditOp(unknownOp)` | **NO** |
| W9 | `handlePostCredit` current OK→COMMITTED | ATD:381-383 | closure submittingOp.key | Async | `safeSaveCreditOp` | `setCreditOp(committedOp)` | **NO** |
| W10 | `handlePostCredit` catch→UNKNOWN | ATD:389-390 | closure submittingOp.key | Async | `safeSaveCreditOp` | `setCreditOp(unknownOp)` | **NO** |
| W11 | `handleCheckStatus` stale committed | ATD:429-432 | closure creditOp.key | Async | `safeSaveCreditOp` | **none** | **NO** |
| W12 | `handleCheckStatus` current committed | ATD:453-455 | closure creditOp.key | Async | `safeSaveCreditOp` | `setCreditOp(committedOp)` | **NO** |
| W13 | `discardCreditOp` (acknowledge) | ATD:225-234 | N/A | Sync | `clearCreditOp` | `setCreditOp(null)` | N/A |

**ATD** = AdminTenantDetail.tsx

### safeSaveCreditOp analysis (credit-op-storage.ts:72-96)

The function has three branches:

1. **No existing record** (line 74): Saves unconditionally → OK
2. **Different UUID** (lines 83-87): Rejects only if existing is terminal (prec ≥ 4). **DEFECT: allows overwrite of UNKNOWN (3), SUBMITTING (2), CONFIRMED (1)**
3. **Same UUID** (lines 90-93): Allows upgrade or equal precedence → OK

### Defect: Different-UUID overwrite of non-terminal operations

When `existing.key !== op.key` and `existingPrec < 4`:

| Existing state | Existing prec | Result |
|---------------|---------------|--------|
| CONFIRMED | 1 | **OVERWRITTEN** |
| SUBMITTING | 2 | **OVERWRITTEN** |
| UNKNOWN | 3 | **OVERWRITTEN** |
| REJECTED | 4 | Protected |
| COMMITTED | 5 | Protected |

The UNKNOWN state (prec 3) represents a genuinely uncertain financial outcome. Allowing a different UUID to replace it erases financial evidence.

### Defect: Ignored safeSaveCreditOp return value

Write paths W4–W12 all call `safeSaveCreditOp()` but ignore the boolean return. Paths W7–W10 and W12 then update React state unconditionally (gated only by gen check). If `safeSaveCreditOp` returns `false` (write rejected), React state diverges from storage.

---

## A2. Request Freshness Analysis

### generationRef behavior (ATD:84-89)

```typescript
const generationRef = useRef(0);
useEffect(() => {
    idRef.current = id;
    generationRef.current += 1;
}, [id]);
```

Increments ONLY when the route parameter `id` changes.

### Unprotected scenarios

| Scenario | Route change? | Gen changes? | Protected? |
|----------|--------------|-------------|------------|
| Navigate tenant A → B | Yes | Yes | **Yes** |
| Navigate A → B → A | Yes (×2) | Yes (×2) | **Yes** |
| Overlapping `load()` same tenant | No | No | **NO** |
| Manual refresh while load in-flight | No | No | **NO** |
| Admin A → B without navigation | No | No | **NO** |
| Stale OK after admin session change | No | No | **NO** |

### Overlapping same-tenant request race

1. User clicks Refresh → load() captures gen=5
2. User clicks Refresh again → load() captures gen=5 (same!)
3. Request 2 resolves → gen===5 → updates state
4. Request 1 resolves (older data) → gen===5 → **overwrites with stale data**

### Admin session change without navigation

1. Admin A views tenant 42, load() captures gen=5, token=A
2. Admin B logs in (changes sessionStorage) without route change
3. Admin A's response arrives → gen===5 (hasn't changed) → **updates admin B's view with admin A's data**

### safeLogout protection scope

`safeLogout` (ATD:134-139) correctly compares captured token to current token. This protects against stale 401s logging out a newer session. But it does NOT protect against:
- A successful stale response updating the wrong admin's view
- A successful stale response persisting financial results for the wrong session

---

## A3. Assessment Summary

### P533-01 Root causes

1. `safeSaveCreditOp()` allows different-UUID overwrite when existing state is non-terminal (UNKNOWN, SUBMITTING, CONFIRMED)
2. Component handlers ignore `safeSaveCreditOp()` return value, causing React state / storage divergence

### P533-02 Root causes

1. `generationRef` only increments on route parameter changes, not per-request
2. No admin identity verification after async response in non-stale paths
3. Overlapping same-tenant requests share the same generation counter

### Trigger sequence — P533-01

1. Op A (UUID-A) submitted → SUBMITTING
2. Server 500 → UNKNOWN → user clicks "Check credit status"
3. User navigates away (gen changes)
4. User navigates back, restores UNKNOWN
5. User acknowledges, clears storage, starts op B (UUID-B) → CONFIRMED → SUBMITTING
6. Stale handleCheckStatus resolves with "committed" for UUID-A
7. `safeSaveCreditOp({...creditOp, state: "COMMITTED"})` — creditOp from closure = UUID-A
8. Storage has UUID-B SUBMITTING (prec 2 < 4) → **UUID-B overwritten by UUID-A COMMITTED**
9. UUID-B's POST response arrives, sees UUID-A in storage (different key, prec 5) → rejected
10. Financial result for UUID-B is lost

### Trigger sequence — P533-02

1. Admin A views tenant 42, clicks Refresh → load() captures gen=5
2. Admin A clicks Refresh again before first response → load() captures gen=5
3. Response 2 (newer) resolves first → gen===5 → sets data
4. Response 1 (older) resolves → gen===5 → **overwrites newer data with older data**

### Existing test coverage

- 17 P532 regression tests (T01-T18) — all route-navigation-based
- No test for same-tenant overlapping requests without navigation
- No test for admin session change without navigation
- No test for different-UUID overwrite of non-terminal operations
- No test for safeSaveCreditOp return value being checked
