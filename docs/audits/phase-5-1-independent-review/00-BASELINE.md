# 00-BASELINE: Phase 5.1 Independent Review Remediation

**Date:** 2026-10-20
**Base commit:** `400574e6a0572b990f0cb031ce301cc8bf29b1af`
**Branch:** `fix/phase-5-1-independent-review`
**Worktree:** `.claude/worktrees/phase-5-1-review`

---

## 1. Scope

Remediation of 7 findings from ChatGPT's independent review of AmmaWallet
Phase 5 code. Work occurs exclusively in an isolated git worktree branched
from the baseline commit.

## 2. Safety Rules (Enforced)

| Rule | Status |
|------|--------|
| No LMS changes | Confirmed — no LMS files touched |
| No production deployment | Confirmed — no deploy commands issued |
| No production DB writes | Confirmed — all DB work on test database (port 15432) |
| No merge to main | Confirmed — branch not merged |

## 3. Repository State at Baseline

- **Repository:** AmmaWallet (SM-Web-Systems/amma-wallet)
- **Branch:** `fix/phase-5-1-independent-review` from `400574e6`
- **Backend tests:** 592 passing (82 files)
- **Frontend tests:** 23 passing (7 files)
- **TypeScript:** 0 frontend errors; 8 pre-existing backend errors in server.ts
- **Git worktree:** Clean, isolated from main working tree

## 4. Findings to Remediate

| ID | Severity | Summary | Phase |
|----|----------|---------|-------|
| REV-01 | HIGH | Pending credit key lost on page reload | C |
| REV-02 | CRITICAL | 23505 recovery untested at API level | B |
| REV-03 | HIGH | Destructive test database isolation not fully enforced | A |
| REV-04 | MEDIUM | Bundle fingerprint accepts missing relationships | B |
| REV-05 | HIGH | Migration documentation and rollback are unsafe | D |
| REV-06 | MEDIUM | Numeric-to-string credit API transition may break clients | D |
| REV-07 | MEDIUM | PostgreSQL 23505 classification is too permissive | B |
