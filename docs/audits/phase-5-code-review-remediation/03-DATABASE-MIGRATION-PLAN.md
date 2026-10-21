# 03-DATABASE-MIGRATION-PLAN: Idempotency Key Migration

**Date:** 2026-10-20
**Finding:** FI-01 (A2)
**Migration file:** `packages/backend/migrations/001_add_idempotency_key.sql`

---

## 1. Overview

Add a nullable `idempotency_key` TEXT column and a partial UNIQUE index to `billing_events` to support credit posting idempotency (FIND-UI-004).

## 2. Migration Steps

### Step 1: Add Column (safe, instant)

```sql
ALTER TABLE billing_events ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
```

- Nullable: no default needed, no table rewrite.
- PostgreSQL adds nullable columns instantly (no lock beyond brief AccessExclusiveLock for catalog update).
- `IF NOT EXISTS` makes it idempotent.

### Step 2: Create Index (safe, non-blocking)

```sql
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_billing_credit_idempotency
  ON billing_events (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

- `CONCURRENTLY` avoids write locks during index build.
- Cannot run inside a transaction block (psql auto-commit mode required).
- `WHERE idempotency_key IS NOT NULL` excludes historical events.
- `IF NOT EXISTS` makes it idempotent.

### Step 3: Verify

- Column exists: `SELECT column_name FROM information_schema.columns WHERE table_name = 'billing_events' AND column_name = 'idempotency_key'`
- Index valid: `SELECT indisvalid FROM pg_index JOIN pg_class ON pg_class.oid = pg_index.indexrelid WHERE pg_class.relname = 'uq_billing_credit_idempotency'`
- Index must show `indisvalid = true`. If false, the CONCURRENTLY build failed and must be retried: `DROP INDEX CONCURRENTLY uq_billing_credit_idempotency; CREATE UNIQUE INDEX CONCURRENTLY ...`

## 3. Deployment Sequence (Expand-then-Deploy)

1. **Run migration** against production database (Step 1 + Step 2).
2. **Verify** index validity (Step 3).
3. **Deploy application** with idempotency code.
4. **Verify** runtime behavior: new credits should populate `idempotency_key`.

The application is backward compatible: if deployed before the migration, `idempotency_key` is not referenced in any SELECT that would break. The `writeBillingCredit` function handles `idempotencyKey: null` (the default) as a no-op for the idempotency check.

## 4. Rollback

```sql
DROP INDEX CONCURRENTLY IF EXISTS uq_billing_credit_idempotency;
ALTER TABLE billing_events DROP COLUMN IF EXISTS idempotency_key;
```

Non-destructive: removes the column and index but does not affect balances, event history, or existing columns.

## 5. Test Results

9 integration tests verify the migration on the isolated test database:

| Test | Result |
|------|--------|
| Column exists and is nullable TEXT | PASS |
| Partial unique index exists and is valid | PASS |
| Index definition includes WHERE clause | PASS |
| Existing app works after schema expansion (NULL keys) | PASS |
| New app works with expanded schema (with key) | PASS |
| Historical records unchanged (NULL keys coexist) | PASS |
| Duplicate non-NULL tenant/key rejected by DB | PASS |
| Cross-tenant key reuse allowed | PASS |
| Migration SQL is idempotent (IF NOT EXISTS) | PASS |

## 6. Authorization Status

**Production migration execution requires separate authorization.**
The migration script is prepared and tested. It has NOT been run against production.
