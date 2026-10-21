# 06-TASKS: Phase 5 Remediation Task Tracker

**Date:** 2026-10-20

---

## Batch A — P0: Financial Integrity & DB Safety

| # | Finding | Task | Status | Commit |
|---|---------|------|--------|--------|
| A1 | FI-04 | Harden integration test DB safety guards | DONE | `8365c14` |
| A2 | FI-01 | Prepare safe database migration for idempotency | DONE | `22d4918` |
| A3 | FI-02 | Implement concurrent idempotency conflict recovery | DONE | `6f73026` |
| A4 | FI-03 | Preserve idempotency key across UI retries | DONE | `b744890` |
| A5 | FI-05 | Expand idempotency fingerprint to cover bundle fields | DONE | `cf512e4` |

## Batch B — P1: Frontend & Monetary

| # | Finding | Task | Status | Commit |
|---|---------|------|--------|--------|
| B1 | FI-06 | Exact XLM precision — eliminate parseFloat from credit pipeline | DONE | `22e45e6` |
| B2 | UI-01 | Remove bundle_purchase from credit form | DONE | `3034513` |

## Batch C — P2: Security & Test Infrastructure

| # | Finding | Task | Status | Commit |
|---|---------|------|--------|--------|
| C1 | SEC-01 | Investigate tenant-scoped RBAC | DONE (investigation) | N/A — no code change |
| C3 | TEST-02 | Separate Vitest and Playwright test discovery | DONE | `9d571e2` |

## Summary

- **9 findings addressed** (7 code fixes, 1 investigation, 1 config fix)
- **8 commits** on `worktree-rbac-billing-audit-2026-10-20`
- **41 new tests** added
- **1 finding BLOCKED** (SEC-01: requires product decision)
