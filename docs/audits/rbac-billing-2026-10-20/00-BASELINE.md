# 00-BASELINE: AmmaWallet RBAC & Billing Audit

**Date:** 2026-10-20
**Auditor:** Claude (automated)
**Repository:** SM-Web-Systems/amma-wallet-production
**Branch:** main
**Local HEAD:** `a65e19c202f2641ad669c50f048a15efb3719ad2`
**Remote HEAD:** `a65e19c202f2641ad669c50f048a15efb3719ad2` (synchronized)
**Working tree:** Clean (no uncommitted changes)
**Worktree:** `rbac-billing-audit-2026-10-20`

---

## 1. Repository Structure

| Component | Path | Stack |
|-----------|------|-------|
| Backend | `packages/backend/` | Fastify 5, TypeScript, Drizzle ORM, PostgreSQL (Neon) |
| Web App (Admin) | `packages/web-app/` | React SPA |
| Mobile App | `packages/mobile/` | React Native (Expo) |
| Chrome Extension | `packages/chrome-extension/` | Chrome MV3 |
| Database Schema | `packages/backend/src/db/schema/index.ts` | Drizzle ORM (1,181 lines, 37 tables) |
| Build | tsx runtime (no compile step) | vitest for tests |
| Deploy | PM2 (`amma-backend`), manual deploy.sh | No CI/CD pipeline |
| Production | ammawallet.com | Neon PostgreSQL, Stellar public network |

## 2. Database Schema — RBAC & Billing Tables (22 Multi-Tenant Tables)

| # | Table | Purpose | Key Constraints |
|---|-------|---------|-----------------|
| 1 | `tenants` | Tenant identity, balance, suspension | slug UNIQUE, suspension_reason CHECK |
| 2 | `tenant_billing_policy` | Versioned billing parameters | UNIQUE(tenant_id, version), policy fee CHECKs |
| 3 | `tenant_api_keys` | DB-backed scoped API keys | key_hash UNIQUE, SHA-256 hashed |
| 4 | `wallet_roles` | Stellar keypair roles | role_slug UNIQUE |
| 5 | `funding_events` | On-chain Stellar tx audit trail | status CHECK (pending/confirmed/failed) |
| 6 | `fee_split_rules` | Partner commission (dormant) | partner_addr required if share > 0 |
| 7 | `tenant_members` | User-to-tenant org membership | UNIQUE(tenant_id, user_id), role CHECK |
| 8 | `tenant_users` | End-user-to-tenant attribution | UNIQUE(tenant_id, user_id) |
| 9 | `tenant_alert_log` | Notification deduplication | alert_type CHECK (11 types) |
| 10 | `referral_campaigns` | Referral program config | campaign_type CHECK, code_model CHECK |
| 11 | `referral_codes` | Personal referral codes | code UNIQUE |
| 12 | `tenant_referral_codes` | Tenant campaign codes | code UNIQUE |
| 13 | `internal_admins` | AmmaWallet staff identity | email UNIQUE, role CHECK (4 roles) |
| 14 | `admin_tenant_assignments` | Admin-to-tenant scoping | UNIQUE(admin_id, tenant_id) |
| 15 | `bundle_catalog` | Commercial tiers | slug UNIQUE |
| 16 | `tenant_bundle_purchases` | Purchase records | FK to billing_events |
| 17 | `unallocated_deposits` | Deposits awaiting allocation | is_allocated index |
| 18 | `billing_events` | Append-only XLM charge ledger | event_type CHECK (9 types), amount_nonzero CHECK |
| 19 | `referrals` | Referral state machine | UNIQUE(referred_id), no_self_referral CHECK |
| 20 | `provisioning_queue` | Wallet activation queue | status CHECK (6 statuses) |
| 21 | `monthly_maintenance_snapshots` | Monthly billing idempotency | UNIQUE(tenant_id, billing_period) |
| 22 | `system_config` | Platform-wide settings | key PRIMARY KEY |

## 3. RBAC Implementation Summary

### Admin Roles (via `internal_admins.role` CHECK constraint)

| Role | DB Exists | Route Enforcement | Tenant Scoping |
|------|-----------|-------------------|----------------|
| `super_admin` | Yes | Full access | N/A (global) |
| `platform_admin` | Yes | PRIVILEGED_ROLES (cannot escalate to super_admin) | N/A (global) |
| `account_manager` | Yes | Read-only (GET tenants, billing, admins) | **NOT ENFORCED** |
| `support_agent` | Yes | Read-only (GET tenants, billing, admins) | **NOT ENFORCED** |

### Authentication Architecture

| Property | Implementation | File:Line |
|----------|---------------|-----------|
| Admin JWT secret | Separate `ADMIN_JWT_SECRET` | `admin-auth.ts:73` |
| Token type claim | `type: "admin"` defense-in-depth | `admin-auth.ts:82` |
| DB is_active check | Every request (not cached) | `admin-auth.ts:94-104` |
| Token expiry | `ADMIN_JWT_EXPIRES_IN` (configured) | `admin.ts:119` |
| No refresh tokens | Admin JWTs are one-shot, no rotation | Design decision |
| Login rate limit | 5 requests / 15 minutes | `admin.ts:39` |
| Timing-safe auth | Dummy hash on missing admin | `admin.ts:99-101` |
| Uniform 401 | Same response for all failure modes | `admin-auth.ts:66,76,84,88,106` |

### Protected Admin Endpoints (11 total)

| Method | Path | Auth | Role Guard | Audit |
|--------|------|------|-----------|-------|
| POST | `/api/v1/internal/auth/login` | None (this IS auth) | N/A | No |
| GET | `/api/v1/internal/me` | verifyInternalAdmin | Any admin | No |
| GET | `/api/v1/internal/tenants` | verifyInternalAdmin | Any admin | No |
| GET | `/api/v1/internal/tenants/:id/billing` | verifyInternalAdmin | Any admin | No |
| GET | `/api/v1/internal/tenants/:id/events` | verifyInternalAdmin | Any admin | No |
| POST | `/api/v1/internal/tenants/:id/credit` | verifyInternalAdmin | PRIVILEGED_ROLES | Yes |
| PATCH | `/api/v1/internal/tenants/:id/suspend` | verifyInternalAdmin | PRIVILEGED_ROLES | Yes |
| PATCH | `/api/v1/internal/tenants/:id/unsuspend` | verifyInternalAdmin | PRIVILEGED_ROLES | Yes |
| PATCH | `/api/v1/internal/tenants/:id/billing-policy` | verifyInternalAdmin | PRIVILEGED_ROLES | Yes |
| GET | `/api/v1/internal/admins` | verifyInternalAdmin | Any admin | No |
| POST | `/api/v1/internal/admins` | verifyInternalAdmin | PRIVILEGED_ROLES | Yes |
| PATCH | `/api/v1/internal/admins/:id/deactivate` | verifyInternalAdmin | PRIVILEGED_ROLES | Yes |
| PATCH | `/api/v1/internal/admins/:id/reactivate` | verifyInternalAdmin | PRIVILEGED_ROLES | Yes |
| POST | `/api/v1/internal/admins/:id/reset-password` | verifyInternalAdmin | super_admin only | Yes |

### Tenant API Key Middleware

| Property | Implementation | File:Line |
|----------|---------------|-----------|
| Key resolution | SHA-256 hash lookup in `tenant_api_keys` | `tenant-api-key.ts:152-176` |
| Env-var fallback | Legacy bridge for LMS key | `tenant-api-key.ts:200` |
| Rate limiting | In-memory sliding window per DB key | `tenant-api-key.ts:75-104` |
| Scope enforcement | `requireScope(scope)` preHandler factory | `tenant-api-key.ts:278-292` |
| Env-var exemption | Env keys bypass rate limit and scopes | `tenant-api-key.ts:285` |
| Timing-safe comparison | `crypto.timingSafeEqual` for env keys | `tenant-api-key.ts:121-133` |
| Key expiry | `expires_at` check in query | `tenant-api-key.ts:170` |

## 4. Billing Implementation Summary

### Financial Arithmetic

| Property | Implementation | File:Line |
|----------|---------------|-----------|
| Precision | String-based 7-decimal (Stellar stroops) | `billing.service.ts:28-58` |
| Internal representation | BigInt (10^7 scale factor) | `billing.service.ts:30` |
| Operations | toStroops/fromStroops, add/mul/negate/compare | `billing.service.ts:33-69` |
| No floating-point | All monetary operations use BigInt | Verified |

### Billing Event Types

| Event Type | Direction | Authorization | Trigger |
|------------|-----------|--------------|---------|
| `new_wallet_activation` | Debit | Tenant API key | POST /api/v1/wallets |
| `existing_user_onboarding` | Debit | Tenant API key | POST /api/v1/wallets |
| `monthly_maintenance_charge` | Debit | System (cron) | Hourly job |
| `tenant_referral_reward` | Debit | System | Referral payout |
| `bundle_purchase` | Credit | Admin (PRIVILEGED_ROLES) | Admin console |
| `manual_topup` | Credit | Admin (PRIVILEGED_ROLES) | Admin console |
| `manual_adjustment` | Credit | Admin (PRIVILEGED_ROLES) | Admin console |
| `unallocated_deposit_allocated` | Credit | Admin | Deposit allocation |
| `stellar_tx_refund` | Credit | System | Refund processing |

### Concurrency Controls

| Control | Implementation | File:Line |
|---------|---------------|-----------|
| TOCTOU guard | `checkWalletBillingTx` with `FOR UPDATE` lock | `billing.service.ts:322-429` |
| Monthly idempotency | `UNIQUE(tenant_id, billing_period)` on snapshots | Schema line 1094 |
| Atomic balance update | `prepaid_xlm_balance + amount::numeric` in SQL | `billing.service.ts:489` |
| Auto-suspension guard | `isRunning` boolean flag | `auto-suspension.ts:27` |
| Soft-suspend idempotency | `WHERE suspended_at IS NULL` guard | `auto-suspension.ts:43` |
| Unsuspend safety | Only auto reasons, never 'manual' | `auto-suspension.ts:60` |

### Scheduled Jobs

| Job | Schedule | Source | Idempotent |
|-----|----------|--------|-----------|
| Monthly maintenance | Hourly check | `monthly-maintenance.ts` | Yes (unique constraint) |
| Auto-suspension | Hourly | `auto-suspension.ts` | Yes (is_running + WHERE guards) |

## 5. Test Inventory

**Total backend test files:** 80
**RBAC-specific test files:** 7

| Test File | Coverage Area |
|-----------|--------------|
| `admin-auth.test.ts` | Admin JWT verification middleware |
| `admin-billing.test.ts` | Credit operations, role guards |
| `admin-management.test.ts` | Create/deactivate/reactivate admins |
| `admin-policy.test.ts` | Billing policy updates |
| `admin-reset.test.ts` | Password reset (super_admin only) |
| `admin-roles-naming.test.ts` | Role naming consistency |
| `admin-suspension.test.ts` | Tenant suspend/unsuspend |
| `admin-audit.test.ts` | Audit logging |

**Billing-specific test files:** 6

| Test File | Coverage Area |
|-----------|--------------|
| `billing.service.test.ts` | Core billing service functions |
| `billing-toctou.test.ts` | TOCTOU race condition tests |
| `auto-suspension.test.ts` | Auto-suspension logic |
| `auto-suspension-acquisition.test.ts` | Acquisition mode edge cases |
| `auto-suspension-concurrency.test.ts` | Concurrent suspension checks |
| `auto-suspension-guard.test.ts` | Concurrency guard tests |
| `wallet-activate.test.ts` | Wallet activation billing flow |

## 6. External Integration Boundaries

| Integration | Direction | Auth | Billing Impact |
|-------------|-----------|------|---------------|
| LMS (lms.smwebsystems.com) | LMS → AW API | Env-var API key (`x-api-key`) | Wallet activations billed to tenant |
| Stellar Network (public) | AW → Horizon | Signing keys | Wallet funding XLM transactions |
| Stellar Testnet | AW → Horizon | Signing keys | Test transactions only |
| SMTP (Stalwart) | AW → Mail | Internal | Deficit/suspension notifications |
| Neon PostgreSQL | AW → DB | Connection string | All data persistence |

## 7. Tools and Skills Activated

| Tool | Status | Version |
|------|--------|---------|
| Ripwire | Available | 0.5.0 |
| Ripwire doctor | 7/7 checks passed | At `a65e19c` |
| vitest | Available | 2.1.9 |
| TypeScript | Available | 5.7.0 |
| Drizzle ORM | Available | 0.45.2 |
| Drizzle Kit | Available | 0.31.10 |

## 8. Historical Audit Documents Found

| Document | Size | Date | Status |
|----------|------|------|--------|
| `AUDIT_PLAN.md` | 30KB | Jul 27 | Previous audit methodology |
| `ARCHITECTURE.md` | 25KB | Jul 27 | Architecture overview |
| `DEV_SPEC.md` | 28KB | Jul 27 | Development specification |
| `FINDINGS.md` | 143KB | Jul 29 | 30+ findings across priorities |
| `FINAL_AUDIT_REPORT.md` | 12KB | Jul 27 | Previous audit conclusions |
| `CUMULATIVE_STATUS.md` | 13KB | Jul 29 | Status tracking |
| `SECURITY_POSTURE.md` | 6KB | Jul 27 | Security assessment |
| `TEST_REPORT.md` | 16KB | Jul 27 | Test results |
| `production-audit/` | Directory | Sep 2 | Production audit artifacts |
| `docs/superpowers/` | Directory | Various | Specs, plans, reviews, verification |

All previous findings require re-verification against current code.
