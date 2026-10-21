# 06-P52-06: SQL Documentation and Runbook Alignment

**Finding:** P52-06 — Migration runbook references outdated, monitoring claims imprecise
**Severity:** P2
**Status:** RESOLVED

---

## Problem

1. The runbook (Section 8) referenced `stellarwallet_test` as the test
   environment table owner, but Phase 5.2 replaced it with `aw_test_runner`.
2. The balance reconciliation guidance (Section 10, item 3) said balances
   "should match exactly" without explaining the sign convention.

## Corrections Made

### Section 8: Required Privileges

Updated test environment role reference from `stellarwallet_test` to
`aw_test_runner` with cross-reference to `init-test-db.sql`.

### Section 10: Monitoring and Reconciliation

Added clarification that credits are positive, debits (maintenance charges)
are negative, and the balance is the algebraic sum. Added note about what
a mismatch indicates.

## File Modified

- `docs/audits/phase-5-1-independent-review/05-MIGRATION-RUNBOOK.md`
