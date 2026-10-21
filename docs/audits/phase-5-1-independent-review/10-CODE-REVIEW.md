# 10-CODE-REVIEW: Internal Review of Phase 5.1 Changes

---

## Commits Reviewed

| SHA | Description | Files |
|-----|-------------|-------|
| `3117aac` | REV-03: Harden test database isolation | db-harness.ts, 3 test files, .env.integration, db-safety.test.ts |
| `969e812` | REV-07, REV-04: Strict constraint ID + fail-closed bundle | admin.ts, billing.service.ts, billing.service.test.ts |
| `6c52bd5` | REV-02: Drizzle error unwrapping + API tests | admin.ts, api-credit-concurrency.test.ts |
| `91a8a10` | REV-01: sessionStorage persistence | AdminTenantDetail.tsx |
| `8054359` | REV-06, REV-05: Schema tests + corrected docs | api-credit-concurrency.test.ts, 2 doc files |

## Review Findings

### REV-03 (3117aac) — APPROVED

- Silent fallback correctly removed.
- `createTestConnection()` properly validates before returning connection.
- Marker table check is robust (queries `information_schema.tables`).
- All existing test files updated to use centralized connections.
- 21 safety boundary tests are comprehensive.

### REV-07 + REV-04 (969e812) — APPROVED

- Empty constraint name acceptance correctly removed (single line change).
- `validateIdempotencyFingerprint()` correctly extracted to shared function.
- Bundle purchase validation is fail-closed: missing `bundlePurchaseId` → 409,
  missing linked record → 409, tenant mismatch → 409.
- Test mock updated to include `tenantId`.

### REV-02 (6c52bd5) — APPROVED

- Drizzle error unwrapping (`err.cause ?? err`) is correct and defensive.
- Falls back to outer error properties if no `.cause` exists.
- 10 API tests exercise real PostgreSQL through Fastify `app.inject()`.
- **Bug discovery validated:** The original `err.code` check could never match
  through the HTTP route — this was a real production bug, not just a test gap.

### REV-01 (91a8a10) — APPROVED

- sessionStorage scoped by tenant ID prevents cross-tenant interference.
- Immutable payload (type + amount) stored alongside key.
- Restoration on mount with visual indicator is correct UX.
- Clear-on-success and clear-on-4xx are correct lifecycle transitions.
- Keep-on-5xx and keep-on-network-error are correct for safety.
- The `handlePostCredit` guard (`if (!idempotencyKey)`) prevents submission
  without a key, replacing the unsafe `?? crypto.randomUUID()` fallback.

### REV-06 + REV-05 (8054359) — APPROVED

- 7 schema validation tests cover the full acceptance/rejection matrix.
- Migration runbook corrects all inaccuracies identified by the reviewer:
  - `AccessExclusiveLock` correctly described (not "lock-free").
  - Manual psql execution correctly specified (not drizzle-kit).
  - Conditional rollback: only drop column if no live data.
  - Pre-deployment verification checklist added.

## Outstanding Issues

1. **Playwright E2E blocked** — requires running dev servers (documented in
   09-TEST-RESULTS.md).
2. **SEC-01 (tenant-scoped RBAC)** — deferred, requires product-owner decision.
3. **Production migration** — prepared and tested, not executed.
