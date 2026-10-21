# 02-RBAC-SPEC: Role-Based Access Control Specification

**Date:** 2026-10-20
**Commit:** `a65e19c`
**Status:** Current implementation (as-built)

---

## 1. Authentication Architecture

The system uses two completely independent authentication subsystems: JWT-based admin authentication for internal staff, and API-key-based authentication for tenant integrations. These subsystems share no secrets, no token formats, and no middleware.

### 1.1 Admin Authentication (`verifyInternalAdmin`)

**Source:** `packages/backend/src/middleware/admin-auth.ts:59-116`

The `verifyInternalAdmin` Fastify preHandler authenticates internal staff via JWT bearer tokens. The flow:

1. **Header extraction** (line 63-67): Requires `Authorization: Bearer <token>`. Missing or malformed header returns 401.
2. **JWT verification** (line 72-77): Token is verified against `config.ADMIN_JWT_SECRET` using `jsonwebtoken.verify()`. Invalid, expired, or wrong-secret tokens return 401.
3. **Type claim check** (line 82-84): Requires `payload.type === "admin"`. This is defence-in-depth against token confusion -- user JWTs do not carry `type:"admin"`.
4. **Subject parse** (line 86-89): `payload.sub` is parsed to integer. Non-finite values return 401.
5. **DB liveness check** (line 94-107): Queries `internal_admins` table for the admin ID. Checks both existence and `is_active = true`. This runs on **every request**, so deactivating an admin revokes access within the current request cycle, not at token expiry.
6. **Context attachment** (line 110-115): On success, attaches `request.admin = { id, email, name, role }` of type `AdminContext`.

**Uniform error response:** All failure modes return the identical `{ error: "Unauthorized" }` with HTTP 401 (lines 66, 76, 83, 88, 107). No information leakage about which step failed.

**Token issuance:** Admin JWTs are issued by `POST /api/v1/internal/auth/login` (`admin.ts:109-118`). Claims: `{ sub, email, name, role, type:"admin" }`. Signed with `ADMIN_JWT_SECRET`. Expiry: `ADMIN_JWT_EXPIRES_IN` (default 3600 seconds / 1 hour, `config/index.ts:98`). No refresh token mechanism exists for admin sessions.

### 1.2 Tenant API Key Authentication (`requireTenantApiKey`)

**Source:** `packages/backend/src/middleware/tenant-api-key.ts:245-263`

The `requireTenantApiKey` Fastify preHandler authenticates tenant API integrations via `x-api-key` header. The resolution flow (`resolveTenantApiKey`, lines 147-211):

1. **SHA-256 hash lookup** (lines 152-191): The raw key is hashed via `crypto.createHash("sha256")` (line 139). The hash is matched against `tenant_api_keys.key_hash` with additional filters: `is_active = true` AND (`expires_at IS NULL` OR `expires_at > now`). On match, a fire-and-forget `last_used_at` update is issued (line 179-182).

2. **Env-var fallback** (lines 200-208): If DB lookup fails (no match or DB unavailable), the raw key is compared against `config.API_KEYS` (comma-separated env var, `config/index.ts:93`) using timing-safe comparison (`timingSafeIncludes`, lines 121-133). Env-var keys return `{ source: "env", tenantId: null, keyId: null, scopes: [], rateLimitPerMinute: 60 }`.

3. **Per-key rate limiting** (lines 256-261): DB-backed keys are subject to in-memory sliding-window rate limiting (`checkAndCountRateLimit`, lines 75-104). 60-second fixed window. Returns 429 if exceeded. Env-var keys are exempt (only subject to global Fastify rate limiter). The rate limit store is process-local (`Map<number, RateLimitWindow>`), effective only for single-instance deployments.

4. **Context attachment** (line 263): On success, attaches `request.tenantApiKeyContext` of type `TenantApiKeyContext { source, tenantId, keyId, scopes, rateLimitPerMinute }`.

**Scope enforcement** (`requireScope`, lines 278-292): Factory function returning a preHandler. Behavior:
- No `tenantApiKeyContext`: passes (route handles absence)
- `source === "env"`: passes (env keys are scope-exempt, line 285)
- `source === "db"` AND scope missing: 403 with message `"API key missing required scope: ${scope}"`
- `source === "db"` AND scope present: passes

**Companion middleware:** `attachTenantApiKey` (lines 221-237) is a non-enforcing variant that resolves and attaches the key context if present but does not reject for missing or unknown keys. Still enforces rate limiting on recognized DB keys.

### 1.3 Token Confusion Defense

Three independent mechanisms prevent token confusion between admin and user contexts:

1. **Separate signing secrets** (`config/index.ts:37-39`): Startup fatally crashes if `ADMIN_JWT_SECRET === JWT_SECRET`. Also enforces `SSO_SECRET !== JWT_SECRET` and `JWT_REFRESH_SECRET !== JWT_SECRET`. All four secrets must be unique with minimum 16-character length.

2. **Type claim validation** (`admin-auth.ts:82-84`): Admin middleware explicitly checks `payload.type === "admin"`. User JWTs do not carry this claim. Even if the same secret were somehow used (prevented by #1), a user JWT would be rejected.

3. **Middleware isolation**: Admin routes use `verifyInternalAdmin`; tenant routes use `requireTenantApiKey`; user routes use a separate JWT middleware verifying against `JWT_SECRET`. There is no shared middleware that accepts multiple token types.

---

## 2. Role Hierarchy

### 2.1 Admin Roles

**Source:** `packages/backend/src/db/schema/index.ts:846-850`

Four roles are defined via a CHECK constraint (`chk_admin_role`) on the `internal_admins` table:

```sql
role IN ('super_admin', 'platform_admin', 'account_manager', 'support_agent')
```

The hierarchy is implicit, not formally encoded in a table:

| Rank | Role | Description |
|------|------|-------------|
| 1 (highest) | `super_admin` | Full access. Can reset other admins' passwords. Can target any role. |
| 2 | `platform_admin` | All write operations. Cannot create/deactivate/reactivate `super_admin` accounts. |
| 3 | `account_manager` | Read-only to all admin endpoints. No write operations. |
| 4 (lowest) | `support_agent` | Read-only to all admin endpoints. No write operations. |

**Note:** `account_manager` and `support_agent` are functionally identical in the current implementation. Neither has any write permissions. The distinction exists in schema only.

### 2.2 PRIVILEGED_ROLES Pattern

**Source:** `packages/backend/src/routes/admin.ts:28`

```typescript
const PRIVILEGED_ROLES = ["super_admin", "platform_admin"] as const;
```

All write-operation authorization uses a consistent inline guard pattern:

```typescript
if (!(PRIVILEGED_ROLES as readonly string[]).includes(request.admin!.role)) {
  return reply.status(403).send({
    error: "Forbidden: requires super_admin or platform_admin role",
  });
}
```

This guard appears in 7 route handlers (credit, suspend, unsuspend, billing-policy, create admin, deactivate admin, reactivate admin). The password-reset endpoint uses a stricter single-role check: `request.admin!.role !== "super_admin"`.

Authorization is enforced **inside each route handler**, not in middleware. The `verifyInternalAdmin` middleware handles authentication only (line 13: "It does NOT handle authorization (role checks) -- those are done by individual routes.").

---

## 3. Protected Endpoint Inventory

### 3.1 Admin Endpoints (14 total)

All admin endpoints are registered in `packages/backend/src/routes/admin.ts`. The `POST /api/v1/internal/auth/login` endpoint is the only one without `verifyInternalAdmin` -- it issues the JWT.

| # | Method | Path | Auth | Role Guard | Self-Guard | Audit | Notes |
|---|--------|------|------|-----------|------------|-------|-------|
| 1 | POST | `/api/v1/internal/auth/login` | None (issues JWT) | None | N/A | No | Rate-limited 5/15min. Timing-safe password check. Dummy hash on unknown email. (`admin.ts:34-138`) |
| 2 | GET | `/api/v1/internal/me` | `verifyInternalAdmin` | None (any role) | N/A | No | Returns authenticated admin identity. (`admin.ts:145-173`) |
| 3 | GET | `/api/v1/internal/tenants` | `verifyInternalAdmin` | None (any role) | N/A | No | Lists ALL tenants. No tenant scoping. (`admin.ts:179-231`) |
| 4 | GET | `/api/v1/internal/tenants/:id/billing` | `verifyInternalAdmin` | None (any role) | N/A | No | Full billing summary for one tenant. (`admin.ts:237-303`) |
| 5 | GET | `/api/v1/internal/tenants/:id/events` | `verifyInternalAdmin` | None (any role) | N/A | No | Cursor-paginated billing events. (`admin.ts:311-370`) |
| 6 | POST | `/api/v1/internal/tenants/:id/credit` | `verifyInternalAdmin` | `PRIVILEGED_ROLES` | N/A | Yes (`admin_credit`) | Atomic credit. Max 100,000 XLM (schema). (`admin.ts:377-521`) |
| 7 | PATCH | `/api/v1/internal/tenants/:id/suspend` | `verifyInternalAdmin` | `PRIVILEGED_ROLES` | N/A | Yes (`admin_suspend`) | Soft or hard suspend. reason = 'manual'. (`admin.ts:533-620`) |
| 8 | PATCH | `/api/v1/internal/tenants/:id/unsuspend` | `verifyInternalAdmin` | `PRIVILEGED_ROLES` | N/A | Yes (`admin_unsuspend`) | Restores tenant. Idempotent. (`admin.ts:997-1067`) |
| 9 | PATCH | `/api/v1/internal/tenants/:id/billing-policy` | `verifyInternalAdmin` | `PRIVILEGED_ROLES` | N/A | Yes (`admin_billing_policy`) | Partial update of current policy row. (`admin.ts:1075-1217`) |
| 10 | GET | `/api/v1/internal/admins` | `verifyInternalAdmin` | None (any role) | N/A | No | Lists all admins. Never returns password_hash. (`admin.ts:627-675`) |
| 11 | POST | `/api/v1/internal/admins` | `verifyInternalAdmin` | `PRIVILEGED_ROLES` | platform_admin cannot create super_admin | Yes (`admin_create`) | bcrypt cost 12. Min password 12 chars. (`admin.ts:683-793`) |
| 12 | PATCH | `/api/v1/internal/admins/:id/deactivate` | `verifyInternalAdmin` | `PRIVILEGED_ROLES` | Cannot self-deactivate. platform_admin cannot deactivate super_admin. | Yes (`admin_deactivate`) | Sets is_active=false. Immediate effect. (`admin.ts:802-888`) |
| 13 | PATCH | `/api/v1/internal/admins/:id/reactivate` | `verifyInternalAdmin` | `PRIVILEGED_ROLES` | platform_admin cannot reactivate super_admin | Yes (`admin_reactivate`) | Idempotent. (`admin.ts:897-989`) |
| 14 | POST | `/api/v1/internal/admins/:id/reset-password` | `verifyInternalAdmin` | `super_admin` only | Cannot reset own password | Yes (`admin_reset_password`) | bcrypt cost 12. Min password 12 chars. (`admin.ts:1225-1289`) |

### 3.2 Tenant Endpoints

**Source:** `packages/backend/src/routes/tenant.ts`

| # | Method | Path | Auth | Scope | Rate Limit | Notes |
|---|--------|------|------|-------|------------|-------|
| 1 | GET | `/api/v1/tenant/balance` | `requireTenantApiKey` | `funding:read` | 60/min (route-level) + per-key (DB keys) | Env-var keys rejected with 403 (no tenantId). (`tenant.ts:18-82`) |

### 3.3 Public Endpoints (no auth)

Within the admin/tenant route files:

- `POST /api/v1/internal/auth/login` -- Unauthenticated by design (it issues the auth token). Protected by rate limiting: 5 requests per 15 minutes per IP (`admin.ts:39`).

All other `/api/v1/internal/*` and `/api/v1/tenant/*` routes require authentication.

---

## 4. Role-Permission Matrix

> See also: `diagrams/admin-role-permission-matrix.mmd`

### 4.1 Full Matrix

| Operation | super_admin | platform_admin | account_manager | support_agent |
|-----------|:-----------:|:--------------:|:---------------:|:-------------:|
| **Read: own identity** (`GET /me`) | Allow | Allow | Allow | Allow |
| **Read: all tenants** (`GET /tenants`) | Allow | Allow | Allow | Allow |
| **Read: tenant billing** (`GET /tenants/:id/billing`) | Allow | Allow | Allow | Allow |
| **Read: tenant events** (`GET /tenants/:id/events`) | Allow | Allow | Allow | Allow |
| **Read: all admins** (`GET /admins`) | Allow | Allow | Allow | Allow |
| **Write: credit tenant** (`POST /tenants/:id/credit`) | Allow | Allow | **Deny (403)** | **Deny (403)** |
| **Write: suspend tenant** (`PATCH /tenants/:id/suspend`) | Allow | Allow | **Deny (403)** | **Deny (403)** |
| **Write: unsuspend tenant** (`PATCH /tenants/:id/unsuspend`) | Allow | Allow | **Deny (403)** | **Deny (403)** |
| **Write: billing policy** (`PATCH /tenants/:id/billing-policy`) | Allow | Allow | **Deny (403)** | **Deny (403)** |
| **Write: create admin** (`POST /admins`) | Allow (any role) | Allow (not super_admin) | **Deny (403)** | **Deny (403)** |
| **Write: deactivate admin** (`PATCH /admins/:id/deactivate`) | Allow (not self) | Allow (not self, not super_admin) | **Deny (403)** | **Deny (403)** |
| **Write: reactivate admin** (`PATCH /admins/:id/reactivate`) | Allow | Allow (not super_admin) | **Deny (403)** | **Deny (403)** |
| **Write: reset password** (`POST /admins/:id/reset-password`) | Allow (not self) | **Deny (403)** | **Deny (403)** | **Deny (403)** |

### 4.2 Sub-Role Constraints (within PRIVILEGED_ROLES)

These are enforced by route-specific guard clauses after the `PRIVILEGED_ROLES` check:

| Constraint | super_admin | platform_admin | Source |
|------------|:-----------:|:--------------:|--------|
| Create super_admin account | Allow | **Deny (403)** | `admin.ts:741-744` |
| Deactivate super_admin account | Allow | **Deny (403)** | `admin.ts:868-872` |
| Reactivate super_admin account | Allow | **Deny (403)** | `admin.ts:959-963` |
| Deactivate own account | **Deny (400)** | **Deny (400)** | `admin.ts:848-849` |
| Reset own password | **Deny (403)** | N/A | `admin.ts:1252-1255` |
| Reset any password | Allow | **Deny (403)** | `admin.ts:1241-1244` |

---

## 5. Authorization Decision Flow

> See also: `diagrams/rbac-auth-decision-flow.mmd`

The authorization decision for an incoming request follows this path:

**Admin route (`/api/v1/internal/*`):**

1. Is this the `/auth/login` endpoint? If yes, skip auth (rate-limited only).
2. `verifyInternalAdmin` preHandler runs:
   - Extract Bearer token from `Authorization` header. Missing/malformed: **401**.
   - Verify JWT signature against `ADMIN_JWT_SECRET`. Invalid/expired: **401**.
   - Check `payload.type === "admin"`. Wrong type: **401**.
   - Parse `payload.sub` to integer. Invalid: **401**.
   - DB query: `internal_admins WHERE id = :sub`. Not found or `is_active = false`: **401**.
   - Attach `request.admin`.
3. Route handler executes. If the route requires write access:
   - Check `request.admin.role` against `PRIVILEGED_ROLES` (super_admin, platform_admin). Not in list: **403**.
   - Apply route-specific sub-guards (e.g., platform_admin cannot target super_admin). Violation: **403** or **400**.
4. Execute operation. Emit audit log for write operations.

**Tenant route (`/api/v1/tenant/*`):**

1. `requireTenantApiKey` preHandler runs:
   - Extract `x-api-key` header. Missing: **401**.
   - SHA-256 hash the key, query `tenant_api_keys`. Match: set `source: "db"`.
   - No DB match or DB error: check env-var `API_KEYS`. Match: set `source: "env"`.
   - No match anywhere: **401**.
   - If DB-backed key: check per-key rate limit. Exceeded: **429**.
   - Attach `request.tenantApiKeyContext`.
2. `requireScope(scope)` preHandler runs (if chained):
   - `source === "env"`: **pass** (scope-exempt).
   - `source === "db"` and scope in `ctx.scopes`: **pass**.
   - `source === "db"` and scope not in `ctx.scopes`: **403**.
3. Route handler executes.

---

## 6. Tenant Scoping

### 6.1 admin_tenant_assignments Table

**Source:** `packages/backend/src/db/schema/index.ts:855-870`

The `admin_tenant_assignments` table exists with full schema:

```
id            BIGSERIAL PRIMARY KEY
admin_id      BIGINT NOT NULL → internal_admins(id) ON DELETE CASCADE
tenant_id     BIGINT NOT NULL → tenants(id) ON DELETE CASCADE
notes         TEXT
assigned_at   TIMESTAMPTZ NOT NULL DEFAULT now()
assigned_by   BIGINT → internal_admins(id) ON DELETE SET NULL
```

Constraints:
- `UNIQUE(admin_id, tenant_id)` via `uq_admin_tenant` index (line 867)
- Indexes on `admin_id` (line 868) and `tenant_id` (line 869)

**Design intent** (table comment, line 854): "Scopes account_manager and support_agent to specific tenants."

**Actual usage:** **Zero references in any route handler or middleware.** No code reads from, writes to, or joins against this table. Verified via codebase search.

### 6.2 Current State

All authenticated admins (any role) see all tenants on all read endpoints:

- `GET /api/v1/internal/tenants` returns **all** tenants ordered by ID (`admin.ts:215-229`). No WHERE clause filters by admin assignment.
- `GET /api/v1/internal/tenants/:id/billing` accepts **any** tenant ID (`admin.ts:291`). No assignment check.
- `GET /api/v1/internal/tenants/:id/events` accepts **any** tenant ID (`admin.ts:359`). No assignment check.

There is no row-level filtering, no tenant-scoping middleware, and no enforcement of the `admin_tenant_assignments` relationships. A `support_agent` can view billing details for every tenant on the platform.

**Cross-reference:** FIND-RBAC-001 in `04-SECURITY-FINDINGS.md`.

---

## 7. Identified Gaps

The following RBAC-related findings are documented in detail in `04-SECURITY-FINDINGS.md`. Summarized here for cross-reference:

| Finding ID | Severity | Summary | Spec Section |
|------------|----------|---------|--------------|
| FIND-RBAC-001 | MEDIUM | `admin_tenant_assignments` table is defined but never queried. All admins see all tenants. No row-level tenant scoping for `account_manager` or `support_agent`. | Section 6 |
| FIND-RBAC-002 | LOW | No `auditLog()` calls on admin read operations (tenants list, billing detail, events, admins list, /me). Write operations are fully audited. | Section 3.1 (Audit column) |
| FIND-RBAC-003 | LOW | Admin JWT has no refresh/rotation mechanism. Single token with fixed expiry (default 1h). Mitigated by per-request DB `is_active` check. | Section 1.1 |
| FIND-RBAC-004 | MEDIUM | No 2FA/MFA for admin accounts. User accounts have TOTP, backup codes, and static codes. Admin accounts use email+password only. | Section 1.1 |
| FIND-RBAC-005 | MEDIUM | Admin login has no per-account failed-attempt tracking or lockout. Relies solely on IP-based rate limiting (5/15min). `internal_admins` table has no `failed_login_attempts` column. | Section 3.1 (endpoint #1) |
| FIND-BILL-004 | MEDIUM | Env-var API keys bypass scope enforcement and per-key rate limiting. `source === "env"` keys are scope-exempt and have no tenant context. Documented as design decision for DB-outage resilience. | Section 1.2 |
