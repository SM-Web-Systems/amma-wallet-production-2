-- Migration 001: Add idempotency_key to billing_events
-- Date: 2026-10-20
-- Branch: worktree-rbac-billing-audit-2026-10-20
-- Finding: FI-01 (A2) — Safe database migration for idempotency
--
-- This migration is designed for expand-then-deploy:
--   1. Add nullable column (brief AccessExclusiveLock, no table rewrite on PG 11+)
--   2. Create unique index CONCURRENTLY (no write lock, but cannot be in a transaction)
--   3. Verify index validity
--
-- IMPORTANT: Run steps 1 and 2 separately. Step 2 uses CONCURRENTLY which
-- cannot run inside a transaction block. Do NOT wrap in BEGIN/COMMIT.
--
-- Rollback (CAUTION: destroys idempotency audit records if live data exists):
--   DROP INDEX CONCURRENTLY IF EXISTS uq_billing_credit_idempotency;
--   -- CONCURRENTLY cannot run inside a transaction block. Use auto-commit mode.
--   ALTER TABLE billing_events DROP COLUMN IF EXISTS idempotency_key;
--   -- Only safe if no rows have non-NULL idempotency_key, or if audit data
--   -- has been exported. See migration runbook Section 7 for full guidance.

-- ── Step 1: Add nullable column ─────────────────────────────────────────────
-- Acquires AccessExclusiveLock briefly for catalog update (sub-ms on PG 12+).
-- No table rewrite for nullable column with no DEFAULT. Safe to run during
-- low traffic but NOT lock-free — concurrent queries will queue momentarily.

ALTER TABLE billing_events ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- ── Step 2: Create partial unique index CONCURRENTLY ────────────────────────
-- MUST run OUTSIDE a transaction block. psql runs in auto-commit by default.
-- If using a migration runner or script, ensure no BEGIN/COMMIT wrapper.
-- CONCURRENTLY takes ShareUpdateExclusiveLock (allows concurrent reads/writes)
-- but cannot run in a transaction, cannot be used with IF NOT EXISTS on PG < 12,
-- and may leave an INVALID index if interrupted (check pg_index.indisvalid).
-- The WHERE clause excludes NULL keys (historical events without idempotency).

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_billing_credit_idempotency
  ON billing_events (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ── Step 3: Verification queries ────────────────────────────────────────────

-- Verify column exists:
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'billing_events' AND column_name = 'idempotency_key';
-- Expected: idempotency_key | text | YES

-- Verify index exists and is valid:
-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE tablename = 'billing_events' AND indexname = 'uq_billing_credit_idempotency';

-- Verify index is not invalid (CONCURRENTLY can leave invalid indexes on failure):
-- SELECT pg_index.indisvalid
-- FROM pg_index
-- JOIN pg_class ON pg_class.oid = pg_index.indexrelid
-- WHERE pg_class.relname = 'uq_billing_credit_idempotency';
-- Expected: true

-- Verify historical rows are unaffected (NULL keys):
-- SELECT COUNT(*) FROM billing_events WHERE idempotency_key IS NULL;
-- Expected: same count as before migration

-- Verify uniqueness enforcement:
-- INSERT INTO billing_events (tenant_id, event_type, amount_xlm, idempotency_key, created_by)
--   VALUES (1, 'manual_topup', '1.0000000', 'test-key-verify', 'migration-check');
-- INSERT INTO billing_events (tenant_id, event_type, amount_xlm, idempotency_key, created_by)
--   VALUES (1, 'manual_topup', '1.0000000', 'test-key-verify', 'migration-check');
-- Expected: second INSERT fails with unique_violation
-- Cleanup: DELETE FROM billing_events WHERE idempotency_key = 'test-key-verify';
