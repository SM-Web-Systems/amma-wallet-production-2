# 05-MIGRATION-RUNBOOK: Idempotency Key Schema Expansion (REV-05)

**Finding:** REV-05 — Migration documentation and rollback are unsafe
**Severity:** HIGH
**Status:** VERIFIED — documentation corrected, tested on disposable DB

---

## 1. Overview

The idempotency feature requires a new column (`idempotency_key TEXT`) and a
partial unique index (`uq_billing_credit_idempotency`) on the `billing_events`
table. This document corrects the Phase 5 migration documentation based on the
independent review findings.

**Migration file:** `packages/backend/migrations/001_add_idempotency_key.sql`

## 2. Schema Compatibility

### Before Migration (Old Schema)

- `billing_events` table has no `idempotency_key` column.
- All billing operations succeed without idempotency protection.

### After Migration (Expanded Schema)

- `billing_events.idempotency_key` column exists (nullable TEXT).
- Partial unique index enforces uniqueness on `(tenant_id, idempotency_key)`
  where `idempotency_key IS NOT NULL`.
- Historical rows have `idempotency_key = NULL` and are unaffected by the index.

### Application Compatibility Matrix

| Application Version | Schema State | Behavior |
|---------------------|-------------|----------|
| Old app | Old schema | Normal (no idempotency) |
| Old app | Expanded schema | Normal — old app does not reference the column; NULL keys coexist |
| New app | Expanded schema | Full idempotency — keys inserted and uniqueness enforced |
| New app | Old schema | **FAILS** — INSERT includes `idempotency_key` column that does not exist |

**The new application cannot safely run against the unmigrated schema.**

## 3. Migration Execution Method

### Current Production Mechanism: `drizzle-kit push`

The project uses `drizzle-kit push` as its sole DDL mechanism. The deploy
script (`deploy.sh` line 11) runs `npm run db:push`, which reads the Drizzle
schema definition (`src/db/schema/index.ts`) and applies schema diffs directly.

**`drizzle-kit push` WILL apply the column and index.** The `idempotencyKey`
column and `uq_billing_credit_idempotency` index are defined in the Drizzle
schema (lines 968, 982-984). When `push` runs against a database without these
objects, it generates and executes the appropriate DDL.

**`drizzle-kit push` does NOT use `CONCURRENTLY`.** It generates standard
`CREATE UNIQUE INDEX` statements, which take a `ShareLock` on the table. This
**blocks all writes** (INSERT, UPDATE, DELETE) for the duration of the index
build. On a large `billing_events` table, this could cause noticeable downtime.

### The Manual SQL File

`packages/backend/migrations/001_add_idempotency_key.sql` uses
`CREATE UNIQUE INDEX CONCURRENTLY`, which avoids write locks during index
construction. However, this file is **not discovered by any automated process**:

- `drizzle-kit push` reads the schema TS file, not SQL migration files.
- `drizzle-kit migrate` uses the `./drizzle/` output directory (currently
  empty), not `./migrations/`.
- No CI/CD step references this SQL file.

The manual SQL file exists as a reference for operators who want to execute the
migration with `CONCURRENTLY` to avoid write locks.

### Recommended Approach for Production

For a small `billing_events` table (< 100K rows), `drizzle-kit push` is
acceptable — the `ShareLock` duration will be brief.

For larger tables, execute the manual SQL file with `psql` **before** running
`drizzle-kit push`. When `push` runs afterward, it will detect that the column
and index already exist and make no changes:

```bash
# Step 1: Apply migration with CONCURRENTLY (non-blocking)
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/backend/migrations/001_add_idempotency_key.sql

# Step 2: Verify index validity
psql "$DATABASE_URL" -c "SELECT indisvalid FROM pg_index JOIN pg_class ON pg_class.oid = pg_index.indexrelid WHERE pg_class.relname = 'uq_billing_credit_idempotency'"

# Step 3: Run push (will detect schema is already aligned)
npm run db:push

# Step 4: Deploy application
pm2 restart amma-backend
```

**Critical:** The manual SQL uses `CONCURRENTLY` which cannot run inside a
transaction block. Use `psql` in auto-commit mode (the default). Do NOT wrap
in `BEGIN`/`COMMIT`.

## 4. Migration Steps (Corrected)

### Step 1: Add Nullable Column

```sql
ALTER TABLE billing_events ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
```

**Lock behavior (CORRECTED):** PostgreSQL acquires a brief `AccessExclusiveLock`
on `billing_events` for the catalog update. This lock blocks all concurrent
reads and writes on the table for the duration of the catalog modification.
For a nullable column with no default, this is typically sub-millisecond on
modern PostgreSQL (12+), but it is **not lock-free**.

**Operational safeguard:** Schedule execution during low-traffic periods. The
lock duration is negligible for most workloads but could cause brief query
queuing under heavy concurrent access.

`IF NOT EXISTS` makes this idempotent — safe to re-run.

### Step 2: Create Partial Unique Index

```sql
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_billing_credit_idempotency
  ON billing_events (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

**Lock behavior:** `CONCURRENTLY` avoids an exclusive lock during index
construction. It takes a `ShareUpdateExclusiveLock` which allows concurrent
reads and writes. Index creation time depends on table size.

**Restrictions:**
- Cannot run inside a transaction block.
- Cannot be used in `drizzle-kit push` or standard migration runners.
- If interrupted, may leave an **invalid** index (see Section 6).

`IF NOT EXISTS` makes this idempotent — if the index already exists (and is
valid), the statement is a no-op.

### Step 3: Verify Index Validity

```sql
SELECT pg_index.indisvalid
FROM pg_index
JOIN pg_class ON pg_class.oid = pg_index.indexrelid
WHERE pg_class.relname = 'uq_billing_credit_idempotency';
```

**Expected result:** `indisvalid = true`.

If `indisvalid = false`, the CONCURRENTLY build was interrupted or encountered
an error. See Section 6 for recovery.

## 5. Deployment Sequence

### Option A: Small Table (< 100K rows) — Use `drizzle-kit push`

```
┌─────────────────────────────────────────────────────────┐
│ 1. BACKUP: Full PostgreSQL dump (pg_dump)               │
│ 2. RUN: npm run db:push (adds column + index)           │
│    ⚠ ShareLock blocks writes during index build         │
│ 3. VERIFY: Column + index via information_schema        │
│ 4. DEPLOY: pm2 restart amma-backend                     │
│ 5. VERIFY: New credits populate idempotency_key         │
│ 6. MONITOR: Check for 23505 duplicate rejections        │
└─────────────────────────────────────────────────────────┘
```

This matches the current `deploy.sh` workflow but should be preceded by a
backup and followed by verification.

### Option B: Large Table — Manual SQL + `drizzle-kit push`

```
┌─────────────────────────────────────────────────────────┐
│ 1. BACKUP: Full PostgreSQL dump (pg_dump)               │
│ 2. RUN Step 1: ALTER TABLE (brief AccessExclusiveLock)  │
│ 3. VERIFY: Column exists via information_schema         │
│ 4. RUN Step 2: CREATE INDEX CONCURRENTLY (non-blocking) │
│ 5. VERIFY: indisvalid = true                            │
│ 6. RUN: npm run db:push (detects schema is aligned)     │
│ 7. DEPLOY: pm2 restart amma-backend                     │
│ 8. VERIFY: New credits populate idempotency_key         │
│ 9. MONITOR: Check for 23505 duplicate rejections        │
└─────────────────────────────────────────────────────────┘
```

**Gap between Steps 2 and 7:** The old application runs against the expanded
schema. This is safe — the old app does not reference the new column. All new
rows will have `idempotency_key = NULL`, which the partial index ignores.

## 6. Failed or Invalid Index Recovery

If `CREATE UNIQUE INDEX CONCURRENTLY` is interrupted:

```sql
-- Check if an invalid index exists
SELECT indisvalid FROM pg_index
JOIN pg_class ON pg_class.oid = pg_index.indexrelid
WHERE pg_class.relname = 'uq_billing_credit_idempotency';

-- If indisvalid = false, drop and recreate
DROP INDEX CONCURRENTLY IF EXISTS uq_billing_credit_idempotency;

-- Re-run the creation
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_billing_credit_idempotency
  ON billing_events (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

An invalid index does not enforce uniqueness and will cause application errors
when the new code attempts to rely on duplicate detection. Always verify
validity before deploying the new application.

## 7. Rollback Plan (CORRECTED)

### Application Rollback (Deploy Old Code)

If the new application has issues, roll back the application to the previous
version. The old application runs safely against the expanded schema.

**Do NOT drop the column or index during application rollback.**

### Rationale for Preserving the Column

Once the new application has processed live credit operations with idempotency
keys:

1. The `idempotency_key` column contains **financial audit data** — evidence of
   which credits were protected against duplicates.
2. Dropping the column destroys this audit trail.
3. The unique index prevents duplicate credits from any source — removing it
   creates a window for double-credit risk.

### Full Schema Rollback (Only If No Live Data)

If the migration was applied but the new application was **never deployed**
(no rows have non-NULL `idempotency_key`):

```sql
-- Verify no live data exists
SELECT COUNT(*) FROM billing_events WHERE idempotency_key IS NOT NULL;
-- Must return 0

-- Safe to remove
DROP INDEX CONCURRENTLY IF EXISTS uq_billing_credit_idempotency;
ALTER TABLE billing_events DROP COLUMN IF EXISTS idempotency_key;
```

### Full Schema Rollback (After Live Data)

**Not recommended.** If absolutely required:

1. Export idempotency key data for audit preservation.
2. Drop the index and column.
3. Accept that future duplicate submissions are no longer detectable.

This requires explicit authorization from the product owner and compliance
team.

## 8. Required Privileges

The PostgreSQL role executing the migration needs:

- `ALTER TABLE` privilege on `billing_events`.
- `CREATE INDEX` privilege on the schema.
- Typically, the table owner or a superuser role.

In the test environment, `aw_test_runner` is the table owner (Phase 5.2
restricted role; see `init-test-db.sql`) and has all required privileges.

## 9. Pre-Deployment Verification Checklist

| Check | Command | Expected |
|-------|---------|----------|
| Column exists | `SELECT column_name FROM information_schema.columns WHERE table_name = 'billing_events' AND column_name = 'idempotency_key'` | 1 row |
| Column is nullable | `SELECT is_nullable FROM information_schema.columns WHERE table_name = 'billing_events' AND column_name = 'idempotency_key'` | `YES` |
| Index exists | `SELECT indexname FROM pg_indexes WHERE indexname = 'uq_billing_credit_idempotency'` | 1 row |
| Index is valid | `SELECT indisvalid FROM pg_index JOIN pg_class ON pg_class.oid = pg_index.indexrelid WHERE pg_class.relname = 'uq_billing_credit_idempotency'` | `true` |
| Historical rows unaffected | `SELECT COUNT(*) FROM billing_events WHERE idempotency_key IS NULL` | Same as pre-migration |
| Uniqueness enforced | Duplicate INSERT test (see migration file Step 3) | Second INSERT fails |
| Backup exists | Verify pg_dump timestamp | Recent |

## 10. Monitoring and Post-Deployment Reconciliation

After deploying the new application:

1. **Query for new idempotency keys:**
   ```sql
   SELECT COUNT(*) FROM billing_events
   WHERE idempotency_key IS NOT NULL AND created_at > NOW() - INTERVAL '1 hour';
   ```

2. **Check for duplicate rejections (application logs):**
   Look for HTTP 200 responses with `duplicate: true` — these indicate the
   idempotency system is working correctly.

3. **Check for balance discrepancies:**
   Compare `tenants.prepaid_xlm_balance` against `SUM(billing_events.amount_xlm)`
   for each tenant. These should match exactly. Note: credits are positive,
   debits (maintenance charges) are negative. The balance is the algebraic sum
   of all events. A mismatch indicates a bug or an out-of-band balance
   modification.

## 11. Test Evidence

9 integration tests in `migration-idempotency.test.ts` verify:

| Test | Result |
|------|--------|
| Column exists and is nullable TEXT | PASS |
| Partial unique index exists and is valid | PASS |
| Index definition includes WHERE clause | PASS |
| Old app works with expanded schema (NULL keys) | PASS |
| New app works with expanded schema (with key) | PASS |
| Historical records unchanged | PASS |
| Duplicate non-NULL keys rejected | PASS |
| Cross-tenant key reuse allowed | PASS |
| Migration SQL is idempotent | PASS |

## 12. Authorization Status

**This migration has NOT been applied to production.**

Production execution requires:
- Explicit authorization from the operations team.
- A verified pg_dump backup taken immediately before execution.
- Execution during a scheduled maintenance window.
- Post-migration verification using the checklist in Section 9.

A successful code review does not constitute permission to execute this
migration against production.
