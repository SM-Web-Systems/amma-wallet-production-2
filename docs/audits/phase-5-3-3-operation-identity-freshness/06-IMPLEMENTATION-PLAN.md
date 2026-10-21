# Phase 5.3.3 — Implementation Plan

## Chosen solutions

### P533-01: Strict operation identity matching (Option A)

- `safeSaveCreditOp()`: reject ALL different-UUID writes
- Component handlers: check return value before updating React state
- Console.warn for rejected COMMITTED evidence (FIN-08)
- No secondary storage, no ledger, no new backend

### P533-02: Per-request counter + admin identity (Option B hybrid)

- New `loadSeqRef` for read-request freshness
- Admin identity capture and verification for all handlers
- Separate freshness concepts: route (gen), request (seq), admin (id), financial (uuid)
- No Redux, Zustand, or request framework

## Implementation order

1. **P533-01 storage fix** — credit-op-storage.ts
2. **P533-01 component fix** — AdminTenantDetail.tsx (safeSaveCreditOp return checking)
3. **P533-02 request freshness** — AdminTenantDetail.tsx (loadSeqRef + admin identity)
4. **Regression tests** — credit-op-storage.test.ts + AdminTenantDetail.test.tsx

Tests are written FIRST (TDD red phase), then implementation turns them green.

## Files changed

| File | Change type | Description |
|------|-------------|-------------|
| `packages/web-app/src/lib/credit-op-storage.ts` | Modify | Strict UUID matching in safeSaveCreditOp |
| `packages/web-app/src/pages/AdminTenantDetail.tsx` | Modify | Return value checking + loadSeqRef + admin identity |
| `packages/web-app/src/lib/credit-op-storage.test.ts` | Modify | P533-01 storage regression tests |
| `packages/web-app/src/pages/AdminTenantDetail.test.tsx` | Modify | P533-01 + P533-02 component regression tests |

## Risk assessment

| Risk | Mitigation |
|------|------------|
| Breaking existing P532 A→B→A tests | generationRef behavior unchanged; loadSeqRef is additive |
| Financial POST freshness broken by loadSeqRef | Financial handlers use gen only, NOT loadSeqRef |
| Resurrected cleared operations | Accepted: preserving COMMITTED evidence for empty slots is safer than losing it |
| FIN-08 conflict evidence lost | Documented limitation: server is authoritative. Console.warn logs the conflict |
