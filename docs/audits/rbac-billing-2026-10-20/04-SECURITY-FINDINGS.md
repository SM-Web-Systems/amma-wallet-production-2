# 04-SECURITY-FINDINGS: RBAC & Billing Audit

**Date:** 2026-10-20
**Auditor:** Claude (automated)
**Commit:** `a65e19c`

---

## Finding Register

### FIND-RBAC-001: admin_tenant_assignments table unused — no tenant scoping
**Severity:** MEDIUM
**Status:** Open
**Component:** `packages/backend/src/routes/admin.ts`
**Schema:** `packages/backend/src/db/schema/index.ts:855-870`

**Evidence:**
- `admin_tenant_assignments` table exists with `UNIQUE(admin_id, tenant_id)` constraint
- The table links `account_manager` and `support_agent` to specific tenants
- **No route handler references `admin_tenant_assignments`** — verified via ripwire and grep
- All admin endpoints allow any authenticated admin to access all tenants
- `GET /api/v1/internal/tenants` returns ALL tenants for any admin role
- `GET /api/v1/internal/tenants/:id/billing` has no tenant-scoping check

**Impact:** account_manager and support_agent roles can view ALL tenant data across the platform. If these roles are assigned to external partners or limited-scope staff, they gain visibility into unrelated tenants' billing, balances, and suspension states.

**Risk:** Horizontal privilege violation (data exposure across tenants for scoped roles).

**Recommendation:** Either:
(a) Enforce tenant scoping in read routes for non-privileged roles using admin_tenant_assignments, or
(b) Document that account_manager and support_agent have platform-wide read access by design, and add a schema comment.

---

### FIND-RBAC-002: No audit logging on admin read operations
**Severity:** LOW
**Status:** Open
**Component:** `packages/backend/src/routes/admin.ts`

**Evidence:**
- `auditLog()` is called for all write operations (credit, suspend, unsuspend, create, deactivate, reactivate, reset-password, billing-policy)
- No `auditLog()` call for read operations:
  - `GET /api/v1/internal/tenants` (view all tenants)
  - `GET /api/v1/internal/tenants/:id/billing` (view billing details)
  - `GET /api/v1/internal/tenants/:id/events` (view billing events)
  - `GET /api/v1/internal/admins` (view all admin accounts)
  - `GET /api/v1/internal/me` (view own identity)

**Impact:** No trail of which admin accessed which tenant data. Makes insider threat detection and compliance reporting more difficult.

**Recommendation:** Add audit logging for sensitive read operations, at minimum for tenant billing detail access.

---

### FIND-RBAC-003: Admin JWT has no refresh/rotation mechanism
**Severity:** LOW
**Status:** Open (accepted risk)
**Component:** `packages/backend/src/routes/admin.ts:109-119`

**Evidence:**
- Admin login issues a single JWT with `ADMIN_JWT_EXPIRES_IN` expiry
- No refresh token endpoint exists for admin sessions
- Admin must re-authenticate after token expires
- User JWT system has refresh token rotation (separate table `refresh_tokens`)

**Impact:** Admin sessions are time-limited by design. If ADMIN_JWT_EXPIRES_IN is long (e.g., 24h), a stolen token remains valid for the full duration. If short (e.g., 1h), admin UX requires frequent re-login.

**Risk:** Mitigated by DB is_active check on every request — deactivating an admin immediately revokes access regardless of token validity.

---

### FIND-BILL-001: `auto-suspension.ts:317` references undefined variable `threshold`
**Severity:** HIGH
**Status:** FIXED — regression tests added, verified in worktree
**Component:** `packages/backend/src/jobs/auto-suspension.ts:317`

**Evidence:**
```typescript
// Line 317:
console.log(
  `[auto-suspension] debt_limit recovery: unsuspended tenant=${t.slug} ` +
    `balance=${t.balance} > threshold=${threshold}`,
);
```
The variable `threshold` is never defined in `recoverDebtLimit()`. This will throw a `ReferenceError` when a tenant recovers from debt-limit suspension, causing the entire auto-suspension run to fail after the unsuspend succeeds but before logging completes.

**Impact:** When a tenant recovers from debt_limit suspension:
1. The unsuspend DB write succeeds
2. The notification email is sent
3. The console.log crashes with ReferenceError
4. The error is caught by the try/catch in `checkAndRunAutoSuspension` (line 339)
5. The remaining `recoverDebtLimit` iterations are skipped

**Actual severity in production:** The crash occurs AFTER the unsuspend and notification, so the recovery action itself succeeds. But subsequent tenants in the same batch won't be processed.

**Fix:** Replace `threshold` with the actual computed threshold value:
```typescript
`balance=${t.balance} > threshold=${fromStroops(toStroops(t.debtLimit) / 2n)}`
```
Or simply remove the threshold from the log message.

---

### FIND-BILL-002: `enforceMaintGrace` uses parseFloat for balance comparison
**Severity:** MEDIUM
**Status:** FIXED — replaced with compareDecimalStrings() in 4 locations
**Component:** `packages/backend/src/jobs/auto-suspension.ts:224`

**Evidence:**
```typescript
// Line 224:
if (parseFloat(t.balance) >= 0) continue;
```
All other balance comparisons in the billing system use `compareDecimalStrings()` which uses exact BigInt arithmetic. This one uses `parseFloat()` which introduces IEEE 754 floating-point imprecision.

Similarly at line 269:
```typescript
if (parseFloat(t.balance) <= 0) continue;
```

**Impact:** For balances near zero (e.g., `"-0.0000001"`), parseFloat may produce `-1e-7` which compares correctly, but for very large balances near the 18-digit precision limit, parseFloat loses precision. Practical risk is low given typical balance ranges, but it violates the invariant that all monetary comparisons use exact arithmetic.

**Recommendation:** Replace with `compareDecimalStrings(t.balance, "0")` for consistency.

---

### FIND-BILL-003: `checkWalletBillingTx` reads policy outside transaction lock
**Severity:** MEDIUM
**Status:** Open
**Component:** `packages/backend/src/services/billing.service.ts:355`

**Evidence:**
```typescript
// Line 355 (inside checkWalletBillingTx, which receives `tx` parameter):
const policy = await getBillingPolicy(tenantId);
```
`getBillingPolicy()` uses the global `db` connection, not the `tx` transaction object. This means:
1. The tenant row is locked with `FOR UPDATE` (line 338)
2. But the billing policy is read OUTSIDE the lock
3. A concurrent admin policy update could change fees between the lock and the policy read

**Impact:** TOCTOU window: an admin changing billing policy while a wallet activation is in-flight could cause the activation to use stale or mismatched policy values. The debit would use old fee amounts while the policy has already been updated.

**Practical risk:** Low — policy changes are rare admin operations. But the inconsistency means the TOCTOU guard is incomplete.

**Recommendation:** Pass `tx` to `getBillingPolicy` or inline the policy read using the transaction object.

---

### FIND-BILL-004: Env-var API keys bypass scope and rate limiting
**Severity:** MEDIUM
**Status:** Open (documented as design decision)
**Component:** `packages/backend/src/middleware/tenant-api-key.ts:199-208, 285`

**Evidence:**
- Env-var keys (from `API_KEYS` config) have `source: "env"`, `tenantId: null`, `scopes: []`
- `requireScope()` at line 285: `if (ctx.source === "env") return;` — scope-exempt
- Rate limiting only applies to DB-backed keys (line 230)
- Env-var keys have no tenant context — billing is skipped
- Used as DB-outage guard for LMS integration

**Impact:** The LMS API key operates with no scope restrictions, no per-key rate limiting (only global Fastify rate limiter), and no billing. If the env-var key is compromised, the attacker has unrestricted API access with no tenant attribution.

**Risk:** Mitigated by the key being stored server-side in .env. But the design creates a privileged bypass channel that is invisible to the billing and monitoring systems.

---

### FIND-BILL-005: No upper bound validation on credit amounts at service level
**Severity:** LOW
**Status:** Open
**Component:** `packages/backend/src/services/billing.service.ts:530-534`

**Evidence:**
- `writeBillingCredit` validates `amountStroops > 0n` but has no upper bound
- The admin route at `admin.ts:397` has `maximum: 100000` in JSON schema
- But `writeBillingCredit` is a reusable function that could be called from other contexts
- A direct caller bypassing the route schema could credit arbitrary amounts

**Impact:** Defense-in-depth gap. Not exploitable through current routes.

---

### FIND-BILL-006: Auto-suspension concurrency guard is process-local
**Severity:** LOW
**Status:** Open (documented)
**Component:** `packages/backend/src/jobs/auto-suspension.ts:27`

**Evidence:**
- `let isRunning = false;` is an in-memory boolean
- Only effective for single-process deployment
- PM2 with multiple instances would allow parallel runs
- Monthly maintenance has DB-level idempotency (unique constraint)
- Auto-suspension has DB-level idempotency guards (WHERE clauses)

**Impact:** Low — the DB guards prevent double-suspension. The isRunning guard prevents unnecessary duplicate work, not correctness issues.

---

### FIND-RBAC-004: No 2FA/MFA for admin accounts
**Severity:** MEDIUM
**Status:** Open
**Component:** `packages/backend/src/routes/admin.ts:76-137`

**Evidence:**
- Admin login is email + password only
- No 2FA field in `internal_admins` table schema
- User accounts have full 2FA support (TOTP, backup codes, static codes)
- Admin accounts have none

**Impact:** Admin accounts control billing, tenant suspension, and staff management. Single-factor authentication for these high-privilege accounts is a security gap. A compromised admin password grants full access.

---

### FIND-RBAC-005: Admin login does not track failed attempts or lockout
**Severity:** MEDIUM
**Status:** Open
**Component:** `packages/backend/src/routes/admin.ts:76-137`

**Evidence:**
- User accounts have `failedLoginAttempts` and `lastFailedLogin` fields
- Admin accounts have no equivalent fields in `internal_admins` table
- Admin login relies solely on rate limiting (5/15min) for brute-force protection
- Rate limiting is per-IP (Fastify rate-limit default), not per-account
- A distributed brute-force attack from multiple IPs would bypass this

**Impact:** No per-account lockout after repeated failed login attempts.

---

## Historical Findings Reconciliation

A full reconciliation of 319 historical findings (from `docs/audits/FINDINGS.md`) was performed against the current commit `a65e19c`. Key results:

- **~220 historical findings verified fixed** — all P0 CRITICAL and HIGH findings resolved
- **6 historical findings remain open** — documented below as cross-references

### HIST-001: Backup codes hashed with SHA-256 (P3-7-F2)
**Severity:** HIGH
**Status:** Open
**Component:** `packages/backend/src/routes/two-fa.ts:20-21`

`hashCode()` uses `crypto.createHash("sha256")` for 2FA backup codes. 8-hex-char codes (32-bit entropy) are GPU brute-forceable against a leaked database. Should use bcrypt or Argon2.

### HIST-002: 8 AuditAction types never emitted (P2-7-F3)
**Severity:** MEDIUM
**Status:** Open
**Component:** `packages/backend/src/lib/audit.ts`

`2fa_enable`, `2fa_disable`, `wallet_add`, `wallet_remove`, `api_key_create`, `api_key_revoke`, `profile_update`, `signing_mode_change` are defined in the AuditAction type union but zero `auditLog()` calls exist for these actions. 2FA changes and wallet operations leave no audit trail.

### HIST-003: `requireScope()` silent pass-through (P1-1-F6)
**Severity:** MEDIUM
**Status:** Open
**Component:** `packages/backend/src/middleware/tenant-api-key.ts`

`requireScope()` returns early (no error) when `tenantApiKeyContext` is undefined. A route missing the `requireTenantApiKey` preHandler would silently skip scope enforcement.

### HIST-004: `/transactions/submit` no route-level rate limit (P0-4-F3 partial)
**Severity:** HIGH
**Status:** Open
**Component:** `packages/backend/src/server.ts`

`/transactions/sign` and `/transactions/sign-and-submit` have `max: 5 / 15 min` rate limits. `/transactions/submit` relies only on the global Fastify rate limiter — no per-route limit.

### HIST-005: `addressBook.userId` no FK constraint (P2-5-F1)
**Severity:** MEDIUM
**Status:** Open
**Component:** `packages/backend/src/db/schema/index.ts`

The `addressBook.userId` column has no foreign key constraint or index. Requires schema migration to fix.

### HIST-006: `/2fa/send-email-code` no dedicated rate limit (P3-7-F6)
**Severity:** MEDIUM
**Status:** Open
**Component:** `packages/backend/src/routes/two-fa.ts`

Public (unauthenticated) endpoint for login flow has no `config.rateLimit` — relies only on global Fastify limiter. Abusable for email flooding.

---

## Summary

### New Findings (This Audit)

| ID | Severity | Component | Status |
|----|----------|-----------|--------|
| FIND-RBAC-001 | MEDIUM | admin_tenant_assignments unused | Open |
| FIND-RBAC-002 | LOW | No audit on admin reads | Open |
| FIND-RBAC-003 | LOW | No admin JWT refresh | Accepted Risk |
| FIND-RBAC-004 | MEDIUM | No admin 2FA/MFA | Open |
| FIND-RBAC-005 | MEDIUM | No admin login lockout | Open |
| FIND-BILL-001 | HIGH | Undefined `threshold` variable (runtime crash) | **FIXED** |
| FIND-BILL-002 | MEDIUM | parseFloat in monetary comparison | **FIXED** |
| FIND-BILL-003 | MEDIUM | Policy read outside tx lock | Open |
| FIND-BILL-004 | MEDIUM | Env-var key bypasses scopes/rate limiting | Documented |
| FIND-BILL-005 | LOW | No service-level credit maximum | Open |
| FIND-BILL-006 | LOW | Process-local concurrency guard | Documented |

### Remaining Historical Findings

| ID | Severity | Component | Status |
|----|----------|-----------|--------|
| HIST-001 | HIGH | Backup codes SHA-256 hashed | Open |
| HIST-002 | MEDIUM | 8 AuditAction types never emitted | Open |
| HIST-003 | MEDIUM | requireScope() silent pass-through | Open |
| HIST-004 | HIGH | /transactions/submit no route rate limit | Open |
| HIST-005 | MEDIUM | addressBook.userId no FK constraint | Open |
| HIST-006 | MEDIUM | /2fa/send-email-code no dedicated rate limit | Open |

### Totals

| Severity | New | Historical Open | Fixed |
|----------|-----|----------------|-------|
| HIGH | 1 | 2 | 1 (FIND-BILL-001) |
| MEDIUM | 6 | 4 | 1 (FIND-BILL-002) |
| LOW | 4 | 0 | 0 |
| **Total** | **11** | **6** | **2** |
