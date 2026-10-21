# Phase 5.3.7 — Findings and Baseline

Baseline: `ae1d9bbedc3e76b47a3bbbb2f2b91d06f929b35f` (Phase 5.3.6 HEAD)

## P537-01: Storage failure replaces the wrong active React operation

**File:** `AdminTenantDetail.tsx` lines 489–495

The HTTP 200 `storage_failed` branch executes `setCreditOp(committedOp)` for UUID-A even though UUID-B occupies the active storage slot. This recreates the React/storage divergence that P536-01 was designed to eliminate.

**Trigger:** UUID-A POST in-flight → UUID-B replaces active slot → UUID-A gets HTTP 200 → `safeSaveCreditOp` rejects (UUID mismatch) → `saveConflictEvidence` throws (quota) → `storage_failed` → `setCreditOp(committedOp)` puts UUID-A into React while UUID-B is in storage.

## P537-02: Operation clearing remains unsafe

**File:** `AdminTenantDetail.tsx` lines 268–288, 650–651

1. `discardCreditOp(expectedKey?)` — key is optional. On UUID mismatch (line 277), `setCreditOp(null)` creates false IDLE while UUID-B remains in storage.
2. `handleDiscardConfirmed()` (line 650–651) calls `discardCreditOp()` without any key, bypassing the guard entirely.

## P537-03: Session replacement strands the billing page

**File:** `AdminTenantDetail.tsx` lines 186, 211

When S1's billing response is discarded via `isReadStale`, the `finally` block (line 211) also skips `setLoading(false)` because `isReadStale` returns true. No fresh S2 request is triggered. The page stays in "Loading billing data…" permanently. The Refresh button is rendered only when `data` exists and `!loading`.

## P537-04: Identity conflicts reported as successful preservation

**File:** `credit-op-storage.ts` line 144

`saveConflictEvidence()` returns `true` for identity mismatches (amount, type, notes, createdAt differ). This is indistinguishable from a successful write. Callers like `persistWithConflictFallback()` return `conflict_preserved` for both genuine writes and disputed identity — the caller cannot distinguish them.
