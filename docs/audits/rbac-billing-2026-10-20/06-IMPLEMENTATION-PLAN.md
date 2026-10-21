# 06-IMPLEMENTATION-PLAN: Prioritized Remediation Plan

**Date:** 2026-10-20  
**Commit:** `a65e19c`  
**Status:** Plan — distinguishes audit-implemented fixes from recommended future work

---

## 1. Fixes Implemented in This Audit

These changes exist in the worktree branch `worktree-rbac-billing-audit-2026-10-20` and are ready for review/merge.

### FIX-001: Undefined `threshold` variable (FIND-BILL-001)

| Field | Value |
|-------|-------|
| **Severity** | HIGH |
| **File** | `packages/backend/src/jobs/auto-suspension.ts:314-317` |
| **Change** | Replaced `${threshold}` with `${t.debtLimit}` in log string |
| **Tests** | 2 regression tests added to `auto-suspension.test.ts` |
| **Verification** | TDD: tests failed before fix, pass after. Full suite: 566/566 |
| **Risk** | None — log-only change, no behavior change |

**Before:**
```typescript
`balance=${t.balance} > threshold=${threshold}`
```

**After:**
```typescript
`balance=${t.balance} (2×balance > limit=${t.debtLimit})`
```

### FIX-002: parseFloat in monetary comparisons (FIND-BILL-002)

| Field | Value |
|-------|-------|
| **Severity** | MEDIUM |
| **Files** | `auto-suspension.ts:224,269` + `billing.service.ts:668,730` |
| **Change** | Replaced `parseFloat(x)` with `compareDecimalStrings(x, "0")` |
| **Tests** | Existing tests pass (behavioral equivalent within normal ranges) |
| **Verification** | Full suite: 566/566 |
| **Risk** | None — semantic equivalent with better precision guarantees |

**4 replacement sites:**
1. `auto-suspension.ts:224` — `enforceMaintGrace` balance check
2. `auto-suspension.ts:269` — `recoverMaintenanceGrace` balance check
3. `billing.service.ts:668` — `runMonthlyMaintenanceForTenant` grace start check
4. `billing.service.ts:730` — `maybeNotifyDeficit` early return

**Note:** `billing.service.ts:770` (`parseFloat(newBalance).toFixed(4)`) is retained — it's display formatting for email, not a monetary comparison.

---

## 2. Recommended Future Remediation

Ordered by priority. These require design decisions from the project owner.

### Tier 1 — Security Improvements (MEDIUM findings)

| # | Finding | Effort | Risk if Deferred |
|---|---------|--------|------------------|
| 1 | **FIND-BILL-003:** Pass `tx` to `getBillingPolicy` in `checkWalletBillingTx` | Low (1-2h) | TOCTOU window during concurrent admin policy + wallet activation |
| 2 | **FIND-RBAC-004:** Add 2FA for admin accounts | High (2-3 days) | Single-factor admin auth for high-privilege operations |
| 3 | **FIND-RBAC-005:** Add per-account login lockout for admins | Medium (4-8h) | Distributed brute-force resistant only to IP rate limiting |
| 4 | **FIND-RBAC-001:** Enforce tenant scoping via `admin_tenant_assignments` | Medium (1 day) | All admins see all tenant data |
| 5 | **FIND-BILL-004:** Add scope enforcement for env-var API keys | Medium (4-8h) | Env-var key has unrestricted access |

### Tier 2 — Defense in Depth (LOW findings)

| # | Finding | Effort | Risk if Deferred |
|---|---------|--------|------------------|
| 6 | **FIND-RBAC-002:** Audit logging for admin read operations | Low (2-4h) | No trail of tenant data access |
| 7 | **FIND-BILL-005:** Service-level credit amount maximum | Low (1h) | No upper bound in reusable function |
| 8 | **FIND-RBAC-003:** Admin JWT refresh/rotation | Medium (4-8h) | Long-lived admin tokens |
| 9 | **FIND-BILL-006:** DB-level auto-suspension concurrency guard | Low (2h) | Duplicate work in multi-process PM2 |

### Tier 3 — Test Infrastructure

| # | Action | Effort |
|---|--------|--------|
| 10 | Add integration test database (test Neon or local PG) | 1 day |
| 11 | Admin role guard matrix test (14 endpoints × 4 roles) | 4-8h |
| 12 | Billing transaction atomicity test | 4h |
| 13 | API key scope enforcement test suite | 2-4h |

---

## 3. Deployment Considerations

### For the audit fixes (FIX-001, FIX-002):

1. **Review** the worktree diff (2 files changed, 2 test additions)
2. **Merge** to main — these are safe, backward-compatible changes
3. **Deploy** via normal PM2 restart — no migration required
4. **Verify** in production: trigger a debt-limit recovery scenario and confirm no `[auto-suspension] Unexpected error` in logs

### For FIND-BILL-003 (policy read in tx):

This is the most impactful remaining code fix. Implementation approach:
1. Add `tx` parameter to `getBillingPolicy()` (or create `getBillingPolicyTx(tx, tenantId)`)
2. Use `tx.select(...)` instead of `db.select(...)` for the policy read
3. Call the tx-aware version from `checkWalletBillingTx()`
4. Leave the non-tx version for pre-flight checks

### For FIND-RBAC-001 (tenant scoping):

Requires design decision:
- **Option A:** Filter read routes by `admin_tenant_assignments` for non-privileged roles
- **Option B:** Document that all admins have platform-wide read access (simplest)
- **Option C:** Remove `admin_tenant_assignments` table if not planned for use

---

## 4. Risk Assessment

| Category | Before Audit | After Audit Fixes | After Tier 1 |
|----------|-------------|-------------------|-------------|
| Runtime crashes | 1 (FIND-BILL-001) | **0** | 0 |
| Precision issues | 4 sites (FIND-BILL-002) | **0** | 0 |
| TOCTOU gaps | 1 (FIND-BILL-003) | 1 | 0 |
| Auth gaps | 3 (2FA, lockout, scoping) | 3 | 0 |
| Test regressions | 0 new | 2 regression tests added | +12 recommended |
