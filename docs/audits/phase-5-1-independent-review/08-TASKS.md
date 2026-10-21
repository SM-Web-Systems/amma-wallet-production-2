# 08-TASKS: Finding Status Tracker

---

## REV-01 — Durable Credit Operation Identity

| Field | Value |
|-------|-------|
| Status | VERIFIED |
| Root cause | pendingCreditKey in React state only; lost on reload |
| Files modified | `packages/web-app/src/pages/AdminTenantDetail.tsx` |
| Regression tests | Existing frontend tests (23 passing); manual verification of sessionStorage lifecycle |
| Security considerations | sessionStorage is same-origin; key scoped by tenant ID |
| Acceptance criteria | Key survives page reload; same key used on retry; cleared on success/rejection |
| Commit SHA | `91a8a10` |
| Verification evidence | Code review of lifecycle states; frontend test suite passes |
| Outstanding limitations | Browser crash loses sessionStorage (acceptable — server-side idempotency still protects) |

---

## REV-02 — API-Level Concurrent Idempotency

| Field | Value |
|-------|-------|
| Status | VERIFIED |
| Root cause | Drizzle ORM wraps postgres.js errors; err.code undefined at outer level |
| Files modified | `packages/backend/src/routes/admin.ts`, `packages/backend/src/test-integration/api-credit-concurrency.test.ts` (new) |
| Regression tests | 10 API-level integration tests + 592 backend unit tests |
| Security considerations | Error unwrapping is defensive (falls back to outer error if no cause) |
| Acceptance criteria | Two concurrent identical requests → exactly one credit; duplicate returns 200 |
| Commit SHA | `6c52bd5` |
| Verification evidence | All 10 API tests pass against real PostgreSQL |
| Outstanding limitations | None |

---

## REV-03 — Test Database Isolation

| Field | Value |
|-------|-------|
| Status | VERIFIED |
| Root cause | Silent fallback URL; independent connection pools; no marker verification |
| Files modified | `db-harness.ts`, `concurrent-idempotency.test.ts`, `migration-idempotency.test.ts`, `admin-billing.integration.test.ts`, `db-safety.test.ts`, `.env.integration` |
| Regression tests | 21 safety boundary tests + all integration tests use centralized connections |
| Security considerations | Prevents accidental writes to production database |
| Acceptance criteria | Missing TEST_DATABASE_URL → hard error; production names rejected; marker required |
| Commit SHA | `3117aac` |
| Verification evidence | 21 db-safety tests pass; all integration tests use createTestConnection() |
| Outstanding limitations | None |

---

## REV-04 — Fail-Closed Bundle Fingerprint

| Field | Value |
|-------|-------|
| Status | VERIFIED |
| Root cause | Inline comparison accepted missing bundle purchase record |
| Files modified | `packages/backend/src/services/billing.service.ts`, `packages/backend/src/services/billing.service.test.ts`, `packages/backend/src/routes/admin.ts` |
| Regression tests | Existing unit tests updated (592 passing) |
| Security considerations | Fail-closed: missing relationship → 409 rejection |
| Acceptance criteria | bundle_purchase duplicate without linked record → 409; tenant mismatch → 409 |
| Commit SHA | `969e812` |
| Verification evidence | Unit tests pass; function extracted and shared between route and service |
| Outstanding limitations | None |

---

## REV-05 — Migration Documentation

| Field | Value |
|-------|-------|
| Status | VERIFIED |
| Root cause | Documentation inaccurately described lock behavior and rollback safety |
| Files modified | `docs/audits/phase-5-1-independent-review/05-MIGRATION-RUNBOOK.md` (new) |
| Regression tests | N/A (documentation only) |
| Security considerations | Rollback plan now preserves financial audit data |
| Acceptance criteria | Correct lock description; conditional rollback; execution method documented |
| Commit SHA | `8054359` |
| Verification evidence | Document reviewed against PostgreSQL documentation |
| Outstanding limitations | Production migration not yet executed (requires authorization) |

---

## REV-06 — API Compatibility

| Field | Value |
|-------|-------|
| Status | VERIFIED |
| Root cause | No compatibility analysis when amount_xlm changed from number to string |
| Files modified | `api-credit-concurrency.test.ts` (7 new schema tests), `docs/.../06-API-COMPATIBILITY.md` (new) |
| Regression tests | 7 schema validation integration tests |
| Security considerations | Strict string-only prevents IEEE 754 precision loss |
| Acceptance criteria | Numeric amounts rejected (400); all known consumers send strings |
| Commit SHA | `8054359` |
| Verification evidence | Consumer discovery complete; 7 schema tests pass |
| Outstanding limitations | External consumers outside repo not discoverable |

---

## REV-07 — Strict Constraint Identification

| Field | Value |
|-------|-------|
| Status | VERIFIED |
| Root cause | Empty constraint name accepted as idempotency match |
| Files modified | `packages/backend/src/routes/admin.ts` |
| Regression tests | 592 backend unit tests; 10 API integration tests |
| Security considerations | Prevents misclassifying unrelated unique violations |
| Acceptance criteria | Only exact constraint name match triggers duplicate recovery |
| Commit SHA | `969e812` |
| Verification evidence | Code review; API tests exercise the 23505 path |
| Outstanding limitations | None |

---

## Approval Gates

### SEC-01 — Tenant-Scoped RBAC

| Field | Value |
|-------|-------|
| Status | DEFERRED |
| Recommendation | Restrict account managers and support agents to assigned tenants |
| Reason | Product-owner decision required; no implementation without explicit authorization |

### Production Migration

| Field | Value |
|-------|-------|
| Status | BLOCKED — requires authorization |
| Migration file | `packages/backend/migrations/001_add_idempotency_key.sql` |
| Tested | Yes (disposable database) |
| Production executed | No |
