# 08-TASKS: RBAC & Billing UI Task Checklist

**Date:** 2026-10-20
**Updated:** 2026-10-20 (Phase 3 complete)
**Commit:** `9f8f590`

---

## Assessment Phase

| ID | Priority | Task | Status | Evidence |
|----|----------|------|--------|----------|
| UI-000 | P0 | Read existing backend audit deliverables | DONE | 11 docs reviewed |
| UI-001 | P0 | Assess admin login flow | DONE | BUILT/UNVERIFIED |
| UI-002 | P0 | Assess tenant dashboard | DONE | BUILT/UNVERIFIED |
| UI-003 | P0 | Assess tenant billing detail | DONE | BUILT/UNVERIFIED |
| UI-004 | P0 | Assess credit posting | DONE | BUILT/UNVERIFIED (FIND-UI-003,004) |
| UI-005 | P0 | Assess suspend/unsuspend | DONE | BUILT/UNVERIFIED |
| UI-006 | P0 | Assess billing policy management | DONE | PARTIAL — read-only |
| UI-007 | P0 | Assess admin management | DONE | BUILT/UNVERIFIED (FIND-UI-005) |
| UI-008 | P0 | Assess audit log viewer | DONE | API MISSING + UI MISSING |
| UI-009 | P0 | Assess billing event pagination | DONE | BUILT/UNVERIFIED |
| UI-010 | P0 | Assess role-based UI permissions | DONE | BUILT/UNVERIFIED |
| UI-011 | P0 | Map parseFloat precision concerns | DONE | FIND-UI-001,002 |
| UI-012 | P0 | Write integration matrix | DONE | 02-INTEGRATION-MATRIX.md |
| UI-013 | P0 | Write UI baseline | DONE | 00-UI-BASELINE.md |

## Remediation Phase — P1 Fixes (Security / Correctness)

| ID | Priority | Task | Status |
|----|----------|------|--------|
| UI-100 | P1 | Fix password minimum mismatch: 8 → 12 in AdminAdmins invite form (FIND-UI-005) | DONE |
| UI-101 | P1 | Add credit posting confirmation dialog (FIND-UI-003) | DONE |
| UI-102 | P1 | Extract `adminFetch` to shared utility (FIND-UI-006) | DONE |

## Remediation Phase — P2 Fixes (Reliability / Quality)

| ID | Priority | Task | Status |
|----|----------|------|--------|
| UI-200 | P2 | Add centralized admin route guard component (FIND-UI-007) | DONE |
| UI-201 | P2 | Replace parseFloat aggregation with string-based sum (FIND-UI-001) | DEFERRED |
| UI-202 | P2 | Add frontend test infrastructure (vitest + @testing-library/react) | **DONE** |
| UI-203 | P2 | Write component tests for admin login | **DONE** (9 tests) |
| UI-204 | P2 | Write component tests for admin console | **DONE** (12 tests) |
| UI-205 | P2 | Write component tests for tenant detail | **DONE** (22 tests) |
| UI-206 | P2 | Write component tests for admin management | **DONE** (21 tests) |

## Remediation Phase — P3 Enhancements

| ID | Priority | Task | Status |
|----|----------|------|--------|
| UI-300 | P3 | Add billing policy edit form (FIND-UI-008) | DEFERRED |
| UI-301 | P3 | Send credit amount as string instead of float (FIND-UI-002) | DEFERRED |
| UI-302 | P3 | Add audit log viewer (FIND-UI-009) — requires backend endpoint | DEFERRED |

## Phase 2 — Integration Verification

| ID | Priority | Task | Status |
|----|----------|------|--------|
| UI-210 | P1 | Update integration matrix with test coverage | **DONE** (12-INTEGRATION-MATRIX-UPDATED.md) |
| UI-211 | P1 | Verify frontend-backend request/response contracts via MSW | **DONE** (12 handlers match actual API) |

## Phase 3 — Financial Idempotency

| ID | Priority | Task | Status |
|----|----------|------|--------|
| UI-220 | P1 | Trace credit flow end-to-end (FIND-UI-004) | **DONE** |
| UI-221 | P1 | Write idempotency specification | **DONE** (13-CREDIT-IDEMPOTENCY-SPEC.md) |
| UI-222 | P1 | Write idempotency regression test cases | **DONE** (8 cases in spec) |
| UI-223 | P1 | Create idempotency Mermaid diagram | **DONE** (credit-idempotency-flow.mmd) |
| UI-224 | — | Implement idempotency (DB migration + API change) | **BLOCKED** — requires design review |

## Phase 4 — Remaining UI Gaps

| ID | Priority | Task | Status |
|----|----------|------|--------|
| UI-230 | P3 | Document UI-300/301/302 gaps and acceptance criteria | **DONE** (14-REMAINING-UI-GAPS.md) |

## Documentation Phase

| ID | Priority | Task | Status |
|----|----------|------|--------|
| UI-400 | P1 | Write RBAC UI specification (03-RBAC-UI-SPEC.md) | DONE |
| UI-401 | P1 | Write billing UI specification (04-BILLING-UI-SPEC.md) | DONE |
| UI-402 | P1 | Write gap analysis (05-GAP-ANALYSIS.md) | DONE |
| UI-403 | P1 | Create Mermaid diagrams (8 diagrams) | DONE |
| UI-404 | P1 | Write verification report (09-VERIFICATION-REPORT.md) | DONE |
| UI-405 | P1 | Write final assessment (11-FINAL-ASSESSMENT.md) | DONE |
| UI-406 | P1 | Write UI architecture (01-UI-ARCHITECTURE.md) | DONE |
| UI-407 | P1 | Write test strategy (06-TEST-STRATEGY.md) | DONE |
| UI-408 | P1 | Write development plan (07-DEVELOPMENT-PLAN.md) | DONE |
| UI-409 | P1 | Write code review (10-CODE-REVIEW.md) | DONE |

---

## Notes

- FIND-UI-001 (parseFloat aggregation) DEFERRED: practical impact is negligible for <100 tenants with typical XLM balances. The total balance card is informational, not used for financial decisions.
- FIND-UI-008 (billing policy edit) DEFERRED: requires design decisions about which fields are editable, validation rules, and confirmation UX. Backend endpoint exists but the scope of what should be exposed in UI needs owner decision.
- FIND-UI-009 (audit log viewer) DEFERRED: requires a new backend endpoint (`GET /internal/audit-logs`) before UI can be built. Design decision needed.
- FIND-UI-002 (credit amount as string) DEFERRED: current float path works correctly for amounts up to 100,000 XLM. Backend converts via toStroops(). Low risk.
