# 09-DECISIONS: RBAC & Billing Audit Decision Log

**Date:** 2026-10-20
**Commit:** `a65e19c`

---

## DEC-001: Scope of authorized remediation

**Decision:** Only fix confirmed code defects (bugs) in this worktree. RBAC design gaps (missing 2FA, tenant scoping, audit logging) are documented as findings but not implemented in this audit — they require design decisions from the project owner.

**Rationale:** This audit is assessment-focused. Implementing new RBAC features (2FA, tenant-scoped access) would require schema migrations, frontend changes, and production deployment decisions that exceed read-only audit scope.

**Authorized fixes:**
- FIND-BILL-001: undefined `threshold` variable (runtime crash)
- FIND-BILL-002: parseFloat in monetary comparison (consistency bug)
- FIND-BILL-003: policy read outside tx lock (if minimal change possible)

---

## DEC-002: admin_tenant_assignments — design vs defect classification

**Decision:** Classified as MEDIUM finding (FIND-RBAC-001), not P0 critical.

**Rationale:** The table exists in schema but no routes reference it. Current deployment likely has no account_manager or support_agent admins in use (bootstrap creates only super_admin). The table was created as forward-looking schema for future development. The finding documents the gap and recommends enforcement or documentation, but does not treat it as a security bypass since the lower roles currently have read-only access (no write operations).

---

## DEC-003: Test execution environment

**Decision:** Run existing tests in the worktree using `npx vitest run`. No database connection or production access required — all 564 tests use vitest mocks.

**Evidence:** All 81 test files, 564 tests pass in 12.55s with no external dependencies.

---

## DEC-004: LMS isolation verification

**Decision:** Verified that this audit worktree is entirely within the AmmaWallet repository (`/home/webadmin/web-stack/html/amma-wallet/.claude/worktrees/rbac-billing-audit-2026-10-20`). No LMS files are present. No LMS operations have been or will be performed.

**Evidence:** Working directory is an isolated git worktree branched from AmmaWallet main.
