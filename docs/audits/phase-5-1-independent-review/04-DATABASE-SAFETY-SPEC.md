# 04-DATABASE-SAFETY-SPEC: Integration Test Database Isolation (REV-03)

---

## 1. Problem

The integration test harness had multiple safety gaps:

1. Silent fallback to a default database URL when `TEST_DATABASE_URL` was not set.
2. Individual test files created their own `postgres()` connections, bypassing
   the safety validator.
3. No verification that the connected database was actually disposable (marker
   table check was absent).

## 2. Safety Boundaries

### Required Configuration

```
TEST_DATABASE_URL=postgresql://stellarwallet_test:test_only_password@localhost:15432/stellarwallet_test
```

Missing or empty `TEST_DATABASE_URL` → hard error, tests refuse to start.

### Validation Layers

```mermaid
flowchart TD
    A[TEST_DATABASE_URL] --> B{URL Format}
    B -->|Invalid| X1[REJECT: Invalid format]
    B -->|Valid| C{Protocol}
    C -->|Not postgresql/postgres| X2[REJECT: Wrong protocol]
    C -->|OK| D{Host}
    D -->|Not localhost/127.0.0.1| X3[REJECT: Not local]
    D -->|OK| E{Port}
    E -->|5432 or unlisted| X4[REJECT: Production port]
    E -->|15432/15433| F{Database Name}
    F -->|stellarwallet/amma/production| X5[REJECT: Production name]
    F -->|Not in allow-list| X6[REJECT: Unknown database]
    F -->|stellarwallet_test| G{Connection Test}
    G --> H{Role Check}
    H -->|Not in ALLOWED_TEST_ROLES| X7[REJECT: Wrong role]
    H -->|OK| I{Marker Table}
    I -->|Missing| X8[REJECT: Not disposable]
    I -->|Present| J[SAFE: Tests proceed]
```

### Allowed Values

| Parameter | Allowed Values |
|-----------|---------------|
| Host | `localhost`, `127.0.0.1` |
| Port | `15432`, `15433` |
| Database | `stellarwallet_test` |
| Role | `stellarwallet_test`, `postgres` (local dev) |
| Marker table | `aw_test_harness_marker` must exist |

### Rejected Values

| Parameter | Rejected Examples | Reason |
|-----------|-------------------|--------|
| Host | `db.example.com`, `10.0.0.5` | Remote host |
| Port | `5432`, `3306` | Production PostgreSQL / MySQL port |
| Database | `stellarwallet`, `amma`, `amma_wallet`, `amma_production` | Production names |
| Database | `my_custom_db` | Not in allow-list |

## 3. Centralized Connection Factory

All integration test files use `createTestConnection()` from `db-harness.ts`:

```typescript
import { createTestConnection } from "./db-harness";
const conn = createTestConnection();
// conn.sql is a postgres.js instance, validated against safety rules
```

Direct `postgres()` pool creation is prohibited in test files.

### Files Updated

| File | Change |
|------|--------|
| `db-harness.ts` | Added `createTestConnection()`, `provisionTestMarker()`, removed fallback URL |
| `concurrent-idempotency.test.ts` | Replaced `postgres()` with `createTestConnection()` |
| `migration-idempotency.test.ts` | Replaced `postgres()` with `createTestConnection()` |
| `admin-billing.integration.test.ts` | Added `provisionTestMarker()` call |
| `api-credit-concurrency.test.ts` | New file, uses harness from creation |

## 4. Marker Table

```sql
CREATE TABLE IF NOT EXISTS aw_test_harness_marker (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  marker TEXT DEFAULT 'integration_test_db'
);
```

This table must exist in any database used for integration tests. It serves as
proof that the database was deliberately provisioned for testing (not a
production database that happens to match the name/port criteria).

`provisionTestMarker()` creates the table if missing and is called in
`beforeAll()` of every integration test suite.

## 5. Test Evidence

21 test cases in `db-safety.test.ts` verify the safety boundaries:

- URL parsing (4 tests)
- Production database name rejection (5 tests)
- Host rejection (3 tests)
- Port rejection (4 tests)
- Unknown database rejection (1 test)
- Valid configuration acceptance (3 tests)
- Protocol variant handling (1 test)
