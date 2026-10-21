# Phase 5.3.3 — TODO Tracker

## P533-01: Financial Operation Identity

| ID | Task | Finding | Files | Test | Status |
|----|------|---------|-------|------|--------|
| T01 | Different UUID cannot overwrite UNKNOWN | P533-01 | credit-op-storage.ts | P533-01-A | DONE |
| T02 | Different UUID cannot overwrite SUBMITTING | P533-01 | credit-op-storage.ts | P533-01-B | DONE |
| T03 | Different UUID cannot overwrite CONFIRMED | P533-01 | credit-op-storage.ts | P533-01-C | DONE |
| T04 | Older response cannot overwrite newer UUID | P533-01 | credit-op-storage.ts | P533-01-D | DONE |
| T05 | COMMITTED cannot be downgraded to UNKNOWN | P533-01 | credit-op-storage.ts | P533-01-E | DONE |
| T06 | COMMITTED cannot be downgraded to REJECTED | P533-01 | credit-op-storage.ts | P533-01-F | DONE |
| T07 | Rejected storage -> React state not updated | P533-01 | AdminTenantDetail.tsx | P533-01-G | DONE |
| T08 | Same-UUID valid progression still works | P533-01 | credit-op-storage.ts | P533-01-H | DONE |
| T09 | Immutable payload preserved | P533-01 | credit-op-storage.ts | P533-01-I | DONE |
| T10 | Conflicting COMMITTED evidence handled | P533-01 | credit-op-storage.ts | P533-01-J | DONE |
| T11 | Retry UNKNOWN retains original UUID | P533-01 | AdminTenantDetail.tsx | P533-01-K | DONE |
| T12 | Reconciliation not_found preserves UNKNOWN | P533-01 | AdminTenantDetail.tsx | P533-01-L | DONE |

## P533-02: Request and Session Freshness

| ID | Task | Finding | Files | Test | Status |
|----|------|---------|-------|------|--------|
| T13 | loadOlderEvents discarded when Refresh supersedes | P533-02 | AdminTenantDetail.tsx | P533-02-A | DONE |
| T14 | loadSeqRef increment only in load() | P533-02 | AdminTenantDetail.tsx | P533-02-A | DONE |
| T15 | Component stays mounted during overlap | P533-02 | AdminTenantDetail.tsx | P533-02-A | DONE |
| T16 | Admin identity change during Refresh discards response | P533-02 | AdminTenantDetail.tsx | P533-02-B | DONE |
| T17 | Admin A starts request, Admin B active | P533-02 | AdminTenantDetail.tsx | P533-02-C | DONE |
| T18 | Admin A's response does not update B's view | P533-02 | AdminTenantDetail.tsx | P533-02-C | DONE |
| T19 | Admin A's stale 401 cannot log out B | P533-02 | AdminTenantDetail.tsx | P533-02-D | DONE |
| T20 | A -> B -> A navigation still safe | P533-02 | AdminTenantDetail.tsx | P533-02-E | DONE |
| T21 | loadingOlder not stuck after Refresh supersedes Load more | P533-02 | AdminTenantDetail.tsx | P533-02-F | DONE |
| T22 | Financial POST protected from read cancellation | P533-02 | AdminTenantDetail.tsx | P533-02-G | DONE |
| T23 | Stale older events not appended after supersede | P533-02 | AdminTenantDetail.tsx | P533-02-A | DONE |
| T24 | Fresh Refresh data displayed after overlap | P533-02 | AdminTenantDetail.tsx | P533-02-A | DONE |
| T25 | loadingOlder reset by successful load() | P533-02 | AdminTenantDetail.tsx | P533-02-F | DONE |

## Design Note

P533-02-A/B/F were redesigned during implementation. The original test designs
attempted overlapping Refresh button clicks, but the UI prevents this:
`disabled={loading}` and `{loading ? <Loader> : data ? <content>}` remove the
button from the DOM during loading. The redesigned tests use achievable overlaps:
- P533-02-A: loadOlderEvents + Refresh (Load older does not set loading=true)
- P533-02-B: Admin identity change during Refresh (single Refresh, admin switches mid-flight)
- P533-02-F: loadingOlder orphan prevention after Load older + Refresh overlap
