# Phase 5.3.3 — Request Freshness Specification

## P533-02: Per-request freshness and session identity

### Existing behavior

```
generationRef increments on route [id] change only.
All async handlers capture gen at start, check gen after await.
No per-request counter. No admin identity verification after await.
```

### Proposed behavior

```
generationRef increments on route [id] change (unchanged).
NEW: loadSeqRef increments on every load() call.
Read handlers check BOTH gen and seq after each await.
Financial handlers check gen (route) + admin identity after await.
Admin identity verified after response for all mutation paths.
```

### New ref: loadSeqRef

```typescript
const loadSeqRef = useRef(0);
```

Incremented at the start of every `load()` call. Captured by `load()` and `loadOlderEvents()`.

### Why separate from generationRef

`generationRef` is used by financial handlers (handlePostCredit, handleCheckStatus) to detect route changes. These handlers must NOT be invalidated by a refresh button click. A manual refresh calls `load()` but does NOT mean an in-flight credit POST is stale.

Incrementing `generationRef` on every `load()` would break financial safety:
- Credit POST in-flight → user clicks Refresh → gen increments
- Credit response arrives → gen check fails → takes stale path
- Financial result treated as stale even though it's for the current context

`loadSeqRef` provides request-level freshness for read operations without affecting financial operation freshness.

### Handler changes

#### load()

```
Before:  capture gen
After:   capture gen AND (++loadSeqRef, capture seq)
         capture adminId
         
Checks:  gen !== generationRef.current || seq !== loadSeqRef.current
         capturedAdminId !== getAdminInfo()?.id
```

#### loadOlderEvents()

```
Before:  capture gen
After:   capture gen AND loadSeqRef.current (NOT incremented — inherits from load)
         
Checks:  gen !== generationRef.current || seq !== loadSeqRef.current
```

Rationale: `loadOlderEvents` is logically part of the same load context. If `load()` is called while pagination is in-flight, the new load resets pagination state and the stale pagination response should be discarded.

#### submitStatusAction() (suspend/unsuspend)

```
Before:  capture gen
After:   capture gen AND loadSeqRef.current AND adminId

Checks:  gen !== generationRef.current || seq !== loadSeqRef.current
         capturedAdminId !== getAdminInfo()?.id
```

#### handlePostCredit() (financial)

```
Before:  capture gen
After:   capture gen AND adminId (NO loadSeqRef — financial freshness is separate)

Non-stale path checks:
  gen !== generationRef.current  (existing — route change)
  capturedAdminId !== getAdminInfo()?.id  (NEW — admin session change)
```

If admin identity changed but gen is current:
- Save financial result via safeSaveCreditOp (it goes to the correct admin's slot)
- Do NOT update React state (wrong admin viewing)
- Do NOT call load() (would refresh with wrong context)

#### handleCheckStatus() (financial)

Same pattern as handlePostCredit.

### Freshness concept separation

| Concept | Mechanism | Used by |
|---------|-----------|---------|
| Route context | generationRef | All handlers |
| Read request freshness | loadSeqRef | load, loadOlderEvents, submitStatusAction |
| Admin session identity | capturedAdminId vs current | All handlers |
| Financial operation identity | creditOp.key (UUID) | safeSaveCreditOp |

### Same-route overlapping request protection

```
T=0  load() → loadSeqRef=1, captures seq=1
T=1  load() → loadSeqRef=2, captures seq=2
T=2  Response for seq=2 arrives → seq(2)===loadSeqRef(2) → updates
T=3  Response for seq=1 arrives → seq(1)!==loadSeqRef(2) → DISCARDED
```

### Admin switching protection

```
T=0  Admin A clicks load → captures adminId=1
T=1  Admin B logs in (sessionStorage changes)
T=2  Response arrives → capturedAdminId(1) !== getAdminInfo().id(2) → DISCARDED
```

### A → B → A protection (preserved)

```
T=0  Tenant A: gen=1
T=1  Navigate to B: gen=2
T=2  Navigate to A: gen=3
T=3  Stale response for gen=1 → gen(1)!==generationRef(3) → DISCARDED
```

### Acceptance criteria

1. Overlapping same-tenant load() calls: older response discarded
2. Manual refresh: only latest refresh response updates state
3. Admin switching without navigation: stale response discarded
4. A → B → A navigation: still protected (gen check)
5. Financial POST not affected by load() counter
6. Financial POST response checks admin identity
7. Loading indicators correctly associated with active requests
8. Existing P532 tests continue to pass
