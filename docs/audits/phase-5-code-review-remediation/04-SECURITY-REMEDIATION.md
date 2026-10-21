# 04-SECURITY-REMEDIATION: Tenant-Scoped RBAC Investigation

**Date:** 2026-10-20
**Finding:** SEC-01 (C1)
**Priority:** P2

---

## 1. Finding

The independent code review identified that `admin_tenant_assignments` table exists in the schema (line 853 of `packages/backend/src/db/schema/index.ts`) but is not referenced by any route handler for access control. All admin roles (including `account_manager` and `support_agent`) have platform-wide read access to all tenants.

## 2. Investigation Results

- **Table exists:** `admin_tenant_assignments` with columns (id, admin_id, tenant_id, notes, assigned_at, assigned_by) and unique constraint `uq_admin_tenant`.
- **Middleware gap:** `verifyInternalAdmin` (in `admin-auth.ts`) authenticates the admin and loads their role but does NOT query `admin_tenant_assignments`.
- **Route handlers unscoped:** All read endpoints (`GET /tenants`, `GET /tenants/:id/billing`, `GET /tenants/:id/events`) allow any admin role without tenant-scoping.
- **Write endpoints protected:** `POST /tenants/:id/credit` and `PATCH /tenants/:id/suspend` are restricted to PRIVILEGED_ROLES (`super_admin`, `platform_admin`).

## 3. Risk Assessment

**Impact:** Information disclosure — a support_agent or account_manager can view billing data for tenants they are not assigned to.
**Likelihood:** Low — the admin console is internal-only, accessed behind SSO.
**Severity:** P2 — not a financial risk, but a security boundary gap.

## 4. Recommendation

This requires a product decision before implementation:
- **Option A:** Enforce tenant scoping in `verifyInternalAdmin` by JOINing `admin_tenant_assignments` for non-privileged roles. Return 403 if the admin is not assigned to the requested tenant.
- **Option B:** Remove `account_manager` and `support_agent` roles entirely if they are not being used. The table was provisioned but never wired.
- **Option C:** Accept the current flat access model as intentional for the current scale. Document it.

## 5. Status

**BLOCKED** — requires product owner decision on which option to pursue. No code changes made in Phase 5. The investigation is documented here for the next sprint.
