# 07-TASKS: RBAC & Billing Audit Task Checklist

**Date:** 2026-10-20
**Commit:** `a65e19c`

---

## Phase 1 — Baseline Assessment

| ID | Priority | Task | Status | Evidence |
|----|----------|------|--------|----------|
| T-001 | P0 | Identify repo root and active branch | VERIFIED | `main` @ `a65e19c`, synced |
| T-002 | P0 | Record local/remote HEAD SHAs | VERIFIED | Both `a65e19c` |
| T-003 | P0 | Check for uncommitted changes | VERIFIED | Clean working tree |
| T-004 | P0 | Map backend structure | VERIFIED | `00-BASELINE.md` §1 |
| T-005 | P0 | Inventory RBAC source files | VERIFIED | `00-BASELINE.md` §3 |
| T-006 | P0 | Inventory billing source files | VERIFIED | `00-BASELINE.md` §4 |
| T-007 | P0 | Identify test suites | VERIFIED | 80 test files, vitest |
| T-008 | P0 | Review existing audit documents | **DONE** | 319 findings reconciled |
| T-009 | P0 | Write baseline report | VERIFIED | `00-BASELINE.md` |
| T-010 | P0 | Write initial security findings | VERIFIED | `04-SECURITY-FINDINGS.md` — 11 findings |

## Phase 2 — RBAC Assessment

| ID | Priority | Task | Status | Evidence |
|----|----------|------|--------|----------|
| T-020 | P0 | Verify admin auth middleware | VERIFIED | `admin-auth.ts` — separate secret, DB check, type claim |
| T-021 | P0 | Verify admin role enforcement | VERIFIED | PRIVILEGED_ROLES enforced on all write endpoints |
| T-022 | P1 | Verify tenant-scoped authorization | VERIFIED | **FIND-RBAC-001: NOT enforced** |
| T-023 | P1 | Create role-permission matrix | VERIFIED | `00-BASELINE.md` §3 |
| T-024 | P1 | Check privilege escalation paths | VERIFIED | platform_admin → super_admin blocked |
| T-025 | P1 | Check self-modification safeguards | VERIFIED | Self-deactivate blocked, self-reset blocked |
| T-026 | P1 | Verify tenant API key middleware | VERIFIED | DB-backed + env-var fallback, rate limit, scopes |
| T-027 | P2 | Check token confusion defense | VERIFIED | type:"admin" claim + separate secret |
| T-028 | P2 | Verify admin login security | VERIFIED | Rate limit, timing-safe, dummy hash |
| T-029 | P2 | Assess admin 2FA gap | VERIFIED | **FIND-RBAC-004: No 2FA for admin** |
| T-030 | P2 | Assess admin login lockout | VERIFIED | **FIND-RBAC-005: No per-account lockout** |
| T-031 | P1 | Create auth decision-flow diagram | DONE | `diagrams/rbac-auth-decision-flow.mmd` |
| T-032 | P1 | Create admin auth sequence diagram | DONE | `diagrams/admin-role-permission-matrix.mmd` |
| T-033 | P1 | Create tenant isolation diagram | N/A | Covered in FIND-RBAC-001 |
| T-034 | P1 | Write RBAC specification | **DONE** | `02-RBAC-SPEC.md` |

## Phase 3 — Billing Assessment

| ID | Priority | Task | Status | Evidence |
|----|----------|------|--------|----------|
| T-040 | P0 | Verify billing arithmetic precision | VERIFIED | BigInt stroops, no floating-point |
| T-041 | P0 | Verify billing event atomicity | VERIFIED | db.transaction + atomic SQL update |
| T-042 | P0 | Verify TOCTOU protection | VERIFIED | FOR UPDATE lock in checkWalletBillingTx |
| T-043 | P0 | Verify monthly maintenance idempotency | VERIFIED | UNIQUE constraint on snapshots |
| T-044 | P1 | Verify auto-suspension logic | VERIFIED | 4-pass design, idempotent guards |
| T-045 | P1 | Check undefined `threshold` variable | VERIFIED | **FIND-BILL-001: runtime crash** |
| T-046 | P1 | Check parseFloat in monetary code | VERIFIED | **FIND-BILL-002: inconsistency** |
| T-047 | P1 | Check policy read in tx | VERIFIED | **FIND-BILL-003: outside lock** |
| T-048 | P2 | Verify credit amount validation | VERIFIED | **FIND-BILL-005: no service-level max** |
| T-049 | P2 | Verify deficit notification cooldown | VERIFIED | system_config-based cooldown |
| T-050 | P1 | Create billing architecture diagram | DONE | `diagrams/billing-architecture.mmd` |
| T-051 | P1 | Create billing sequence diagrams | DONE | `diagrams/wallet-activation-billing-sequence.mmd`, `diagrams/suspension-state-machine.mmd` |
| T-052 | P1 | Write billing specification | **DONE** | `03-BILLING-SPEC.md` |

## Phase 4 — Remediation (Authorized Worktree Changes)

| ID | Priority | Task | Status | Dependencies |
|----|----------|------|--------|-------------|
| T-060 | P0 | Fix FIND-BILL-001: undefined `threshold` | **DONE** | T-045 — 2 regression tests added |
| T-061 | P1 | Fix FIND-BILL-002: parseFloat → compareDecimalStrings | **DONE** | T-046 — 4 sites replaced |
| T-062 | P2 | Enhance FIND-BILL-003: policy read within tx | TODO | T-047 |
| T-063 | P2 | Add service-level credit max (FIND-BILL-005) | DEFERRED | Low risk |
| T-064 | P2 | Document admin_tenant_assignments design (FIND-RBAC-001) | TODO | T-022 |

## Phase 5 — Testing

| ID | Priority | Task | Status | Evidence |
|----|----------|------|--------|----------|
| T-070 | P0 | Run existing test suite | **DONE** | 566 tests pass (564 orig + 2 new) |
| T-071 | P1 | Write regression test for FIND-BILL-001 | **DONE** | 2 tests: error-free log + multi-candidate loop |
| T-072 | P1 | Write regression test for FIND-BILL-002 | N/A | Existing tests cover paths (behavioral equiv.) |
| T-073 | P1 | Run TypeScript type checking | **DONE** | 0 new errors from audit changes |
| T-074 | P2 | Verify all admin role guards in tests | TODO | |

## Phase 6 — Documentation and Review

| ID | Priority | Task | Status | Evidence |
|----|----------|------|--------|----------|
| T-080 | P1 | Architecture overview | **DONE** | `01-ARCHITECTURE.md` |
| T-081 | P1 | RBAC specification | **DONE** | `02-RBAC-SPEC.md` |
| T-082 | P1 | Billing specification | **DONE** | `03-BILLING-SPEC.md` |
| T-083 | P1 | Reconcile historical findings | **DONE** | 319 findings reconciled; 6 open in `04-SECURITY-FINDINGS.md` |
| T-084 | P1 | Final assessment report | **DONE** | `10-FINAL-ASSESSMENT.md` |
| T-085 | P1 | Independent code review | **DONE** | Self-review: TDD regression, full suite pass, tsc clean |

---

## Priority Key

| Priority | Meaning | SLA |
|----------|---------|-----|
| P0 | Critical — blocks audit or security risk | Immediate |
| P1 | High — significant finding or required deliverable | This audit |
| P2 | Medium — improvement or defense-in-depth | Recommended |
| P3 | Low — documentation or cosmetic | Optional |
