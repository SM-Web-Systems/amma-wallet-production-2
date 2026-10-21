# 02-P52-02: Harden Database Test Isolation

**Finding:** P52-02 — Test database isolation insufficient
**Severity:** P0 (Critical infrastructure safety)
**Status:** RESOLVED

---

## Problem

The Phase 5.1 test harness had several weaknesses:

1. **`postgres` superuser allowed**: The `ALLOWED_TEST_ROLES` list included
   `"postgres"`, which is a superuser with full database access.
2. **Self-provisioning trust marker**: Tests could create their own marker table,
   defeating the purpose of the verification step.
3. **No DATABASE_URL alignment**: The harness validated `TEST_DATABASE_URL` but
   didn't verify it pointed to the same database as `DATABASE_URL`.
4. **No superuser detection**: A test running as superuser bypassed all
   PostgreSQL permission restrictions.

## Solution

### Restricted Role

- Removed `"postgres"` from `ALLOWED_TEST_ROLES`
- Added `"aw_test_runner"` — a restricted role created with
  `NOSUPERUSER NOCREATEDB NOCREATEROLE`
- New `init-test-db.sql` for Docker container initialization

### Trusted Provisioning Nonce

- `PROVISIONING_NONCE = "p52-disposable-verified"` — a constant that must be
  present in the marker table
- New `provision-test-db.ts` script (run separately before tests)
- `ensureVerifiedTestDb()` checks the marker table has the correct nonce
- All seed operations gate behind `ensureVerifiedTestDb()`

### Superuser Detection

- `createTestConnection()` returns a `verify()` method
- `verify()` queries `pg_user.usesuper` and rejects if `true`
- All integration test files call `verify()` in `beforeAll`

### URL Alignment

- `verifyDatabaseUrlAlignment()` ensures `DATABASE_URL` and `TEST_DATABASE_URL`
  point to the same database
- `.env.integration` updated: both URLs use `aw_test_runner` role

### Connection Pool Verification

- `createTestConnection()` returns `{ sql, db, verify }` tuple
- `verify()` runs identity + marker + superuser checks
- Additional connection pools (concurrent tests) must call `verify()` explicitly

## Files Modified

| File | Change |
|------|--------|
| `packages/backend/src/test-integration/db-harness.ts` | Major rewrite: role restriction, nonce, superuser detection, alignment |
| `packages/backend/src/test-integration/db-safety.test.ts` | Major rewrite: 29 structural tests |
| `packages/backend/src/test-integration/.env.integration` | Updated role to `aw_test_runner` |
| `packages/backend/src/test-integration/provision-test-db.ts` | New: provisioning script |
| `packages/backend/src/test-integration/init-test-db.sql` | New: Docker init script for restricted role |
| `packages/backend/docker-compose.test-db.yml` | New: ephemeral test DB container |
| `packages/backend/package.json` | New: `test:provision-db`, `test:integration` scripts |
| `packages/backend/src/test-integration/concurrent-idempotency.test.ts` | Added `verify()` calls |
| `packages/backend/src/test-integration/migration-idempotency.test.ts` | Added `verify()` calls |

## Test Evidence

- 29 db-safety tests (URL parsing, production name rejection, host/port rejection,
  role restrictions, alignment, structural completeness)
- All integration test files updated with pool verification
