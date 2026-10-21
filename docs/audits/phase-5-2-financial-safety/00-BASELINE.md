# 00-BASELINE: Phase 5.2 Starting Point

**Baseline commit:** `5b210886c6c31d9d4e8b340b651d324b62bd2032`
**Message:** `fix(REV-06,REV-05): MSW mock type + migration mechanism accuracy`
**Branch:** `phase-5-2-financial-safety` (worktree isolated)
**Date:** 2026-10-20

## Context

Phase 5.2 addresses findings from ChatGPT's independent review of Phase 5.1.
All work occurs in an isolated git worktree — no production modifications,
no deployments, no merges.

## Baseline Test Counts

| Suite | Files | Tests | Status |
|-------|-------|-------|--------|
| Backend unit | 82 | 592 | All pass |
| Frontend unit | 12 | 93 | All pass |
| Integration (db-safety) | 1 | 29 | All pass (no DB required) |
| Integration (with DB) | 4 | ~41 | Require test DB container |

## Pre-Existing Issues at Baseline

1. **2 flaky schema validation tests** (`REV-06`): `rejects numeric amount_xlm`
   and `rejects unknown payload properties` — Fastify coerces numeric to string
   and does not enforce `additionalProperties: false` at runtime. Not introduced
   by Phase 5.2.

2. **Backend TypeScript errors** in `server.ts` (Stellar SDK type mismatches)
   and `billing.service.test.ts` (discriminated union narrowing) — pre-existing,
   not in files modified by Phase 5.2.

## Absolute Constraints

- No LMS modifications
- No production changes
- No deployments
- No merges
- No production migrations
