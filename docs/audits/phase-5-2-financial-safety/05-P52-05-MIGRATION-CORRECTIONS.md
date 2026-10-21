# 05-P52-05: Migration Safety Corrections

**Finding:** P52-05 — SQL migration comments contain inaccurate lock claims
**Severity:** P1
**Status:** RESOLVED

---

## Problem

The migration SQL file (`001_add_idempotency_key.sql`) contained several
inaccurate claims:

1. Step 1 header said "safe, instant, no lock" — but `ALTER TABLE ADD COLUMN`
   acquires an `AccessExclusiveLock` even for nullable columns with no default.
2. The rollback section did not mention the `CONCURRENTLY` transaction
   restriction for `DROP INDEX CONCURRENTLY`.
3. No warning about destroying idempotency audit records on column drop.

The Phase 5.1 migration runbook (05-MIGRATION-RUNBOOK.md) already corrected
the lock description in prose, but the SQL file itself retained the incorrect
comments.

## Corrections Made

### Step 1 Comment (Line 21-24)

**Before:**
```sql
-- ── Step 1: Add nullable column (safe, instant, no lock) ────
```

**After:**
```sql
-- ── Step 1: Add nullable column ─────────────────────────────
-- Acquires AccessExclusiveLock briefly for catalog update (sub-ms on PG 12+).
-- No table rewrite for nullable column with no DEFAULT. Safe to run during
-- low traffic but NOT lock-free — concurrent queries will queue momentarily.
```

### Step 2 Comment (Lines 28-34)

Expanded to note:
- MUST run outside transaction block
- `ShareUpdateExclusiveLock` (not just "no lock")
- `IF NOT EXISTS` limitation on PG < 12
- Invalid index risk if interrupted

### Rollback Comment (Lines 14-19)

**Before:**
```sql
-- Rollback:
--   DROP INDEX CONCURRENTLY IF EXISTS uq_billing_credit_idempotency;
--   ALTER TABLE billing_events DROP COLUMN IF EXISTS idempotency_key;
```

**After:** Added `CAUTION` prefix, notes about `CONCURRENTLY` transaction
restriction, audit data destruction warning, and cross-reference to runbook
Section 7.

## File Modified

- `packages/backend/migrations/001_add_idempotency_key.sql`
