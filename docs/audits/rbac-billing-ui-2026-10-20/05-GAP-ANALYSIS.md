# 05-GAP-ANALYSIS: RBAC & Billing UI Gap Analysis

**Date:** 2026-10-20
**Audit scope:** AmmaWallet admin frontend — RBAC, billing, and integration completeness
**Source documents:** 00-UI-BASELINE.md, 02-INTEGRATION-MATRIX.md, 08-TASKS.md

---

## 1. Summary of Findings

The UI audit identified **10 gaps** across security, data integrity, code quality, and feature completeness. Of these:

- **4 FIXED** during the remediation phase
- **4 DEFERRED** with documented justification
- **2 OPEN** requiring backend support or broader infrastructure work

---

## 2. Gap Inventory

| ID | Severity | Category | Description | Status | Resolution |
|----|----------|----------|-------------|--------|------------|
| FIND-UI-001 | P2 | Data integrity | `parseFloat` aggregation for total balance — floating-point drift across tenants | **DEFERRED** | Practical impact negligible for <100 tenants; total balance card is informational, not financial |
| FIND-UI-002 | P3 | Data integrity | Credit amount sent as float JSON number, not string | **DEFERRED** | Safe for amounts up to 100,000 XLM; backend converts via `toStroops()` correctly within float64 precision |
| FIND-UI-003 | P1 | Security | Credit confirmation dialog missing — irreversible financial operation had no confirmation step | **FIXED** | Added confirmation modal matching the existing suspend/unsuspend pattern (backdrop blur, escape-to-close, aria attributes) |
| FIND-UI-004 | P2 | Reliability | No idempotency key for credit POST — duplicate-on-refresh risk | **OPEN** | Requires backend support for idempotency key header; button-disable mitigates rapid double-click but not page refresh |
| FIND-UI-005 | P1 | Security | Password minimum length mismatch — frontend accepted 8 chars, backend required 12 | **FIXED** | Frontend validation updated to minimum 12 characters to match backend schema |
| FIND-UI-006 | P2 | Code quality | `adminFetch` helper duplicated identically in 3 files | **FIXED** | Extracted to `lib/admin-api.ts`; all 3 admin pages now import from shared module |
| FIND-UI-007 | P2 | Code quality | No centralized admin route guard — each page self-guards via `useEffect` | **FIXED** | `AdminRoute` wrapper component added in `App.tsx`; all admin routes now use centralized auth check |
| FIND-UI-008 | P3 | Feature gap | Billing policy edit UI missing — backend PATCH endpoint exists but no frontend form | **DEFERRED** | Requires design decisions on which fields are editable, validation rules, and confirmation UX |
| FIND-UI-009 | P3 | Feature gap | Audit log viewer missing — no backend GET endpoint and no UI | **DEFERRED** | Requires new backend endpoint (`GET /internal/audit-logs`) before UI can be built |
| FIND-UI-010 | P2 | Test coverage | Zero admin component, integration, or E2E tests | **OPEN** | Test infrastructure (vitest + @testing-library/react) needs to be added; task items UI-202 through UI-206 track this |

---

## 3. Backend vs Frontend Coverage

### 3.1 Endpoint Coverage

| Metric | Count | Percentage |
|--------|-------|------------|
| Total backend admin endpoints | 14 | 100% |
| Endpoints with UI integration | 13 | 93% |
| Endpoints with no UI | 1 | 7% |

The single uncovered endpoint is `PATCH /api/v1/internal/tenants/:id/billing-policy` (FIND-UI-008). The billing policy data is displayed read-only on the tenant detail page, but no edit form exists.

`GET /api/v1/internal/me` is not directly called by any page but is available for future use. The admin info is instead cached from the login response in `sessionStorage['aw_admin_info']`.

### 3.2 Feature Integration Summary

| Verdict | Count | Features |
|---------|-------|----------|
| BUILT/UNVERIFIED | 13 | Login, tenant list, billing details, credit posting, events, pagination, suspend, unsuspend, admin list, invite, deactivate, reactivate, password reset |
| PARTIAL | 2 | Balance display (parseFloat precision), billing policy (read-only) |
| API MISSING + UI MISSING | 1 | Audit log viewer |
| **Total assessed** | **17** | |

---

## 4. Test Infrastructure Gap

### 4.1 Backend vs Frontend Test Comparison

| Dimension | Backend | Frontend (Admin) | Gap |
|-----------|---------|------------------|-----|
| Test framework | vitest (configured, running) | Not configured | No test runner in web-app |
| Total tests | 566 passing | 0 | 566 : 0 |
| RBAC role guard tests | Yes (admin-roles-naming.test.ts) | None | Backend validates roles; frontend role gating untested |
| Integration tests | Yes | None | API contract compliance unverified from UI side |
| E2E / browser tests | N/A | None | No playwright or cypress in dependencies |
| Existing frontend tests | N/A | 7 files (user-facing only) | Admin pages have zero coverage |

### 4.2 Risk of Zero Admin Tests

All 13 integrated features carry the **BUILT/UNVERIFIED** verdict. Code review confirms correct patterns (Bearer auth, 401 handling, role gating, loading/error states), but no automated test validates:

- Token is actually sent on every admin request
- 401 triggers redirect to `/admin/login`
- Role-based button visibility matches backend rules
- Credit form validation rejects negative amounts
- Pagination cursor advances correctly

---

## 5. Feature Completeness

### 5.1 Before Remediation

| Metric | Value |
|--------|-------|
| Features with UI + API + Integration | 15/17 (88%) |
| Security-critical issues | 2 P1 (password mismatch, missing credit confirmation) |
| Code quality issues | 2 P2 (duplicated adminFetch, no route guard) |

### 5.2 After Remediation (Current State)

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| P1 security issues | 2 | 0 | -2 (both FIXED) |
| P2 code quality issues | 2 | 0 | -2 (both FIXED) |
| Centralized auth guard | No | Yes | AdminRoute added |
| Shared admin API module | No | Yes | lib/admin-api.ts |
| Feature coverage (UI+API) | 88% | 88% | No change (deferred items are feature additions, not regressions) |
| Automated test coverage | 0% | 0% | No change (OPEN — tracked as UI-202..206) |

The remediation phase resolved all P1 security findings and the two most impactful P2 code quality issues. Feature coverage remains at 88% because the two missing features (billing policy edit, audit log viewer) were deferred pending design and backend decisions.

---

## 6. Residual Risk Assessment for Deferred Items

### 6.1 FIND-UI-001 — parseFloat Aggregation (P2, DEFERRED)

**What:** The tenant dashboard sums `prepaidXlmBalance` across all tenants using `parseFloat().reduce()`, which accumulates floating-point rounding errors.

**Residual risk:** LOW
- The total balance card is purely informational (dashboard summary)
- No financial decisions or transactions are driven by this aggregated value
- For <100 tenants with typical XLM balances (0-10,000 range), the cumulative error is sub-stroops
- Individual tenant balances are displayed correctly via `parseFloat(x).toFixed(4)`

**Mitigation if needed:** Replace with string-based decimal arithmetic (e.g., multiply by 10^7, sum as integers, divide back). Tracked as UI-201.

### 6.2 FIND-UI-002 — Credit Amount as Float (P3, DEFERRED)

**What:** The credit posting form sends `amount_xlm` as a JSON number (float) rather than a string.

**Residual risk:** LOW
- Backend schema constrains `amount_xlm` to maximum 100,000 XLM
- float64 has 15-16 significant digits; 100,000.0000 requires 9 digits — well within precision
- Backend's `toStroops()` conversion handles the float-to-integer path correctly
- No known case where a user-entered 4-decimal XLM value would lose precision in this range

**Mitigation if needed:** Change frontend to send `amount_xlm` as a string; update backend schema to accept string. Tracked as UI-301.

### 6.3 FIND-UI-008 — Billing Policy Edit UI (P3, DEFERRED)

**What:** The backend supports `PATCH /api/v1/internal/tenants/:id/billing-policy` but no frontend form exists.

**Residual risk:** MEDIUM
- Admins cannot modify billing policies through the UI; they must use curl or similar tools
- This limits operational self-service for non-technical staff
- The backend endpoint is restricted to PRIVILEGED_ROLES, so unauthorized modification is not a concern
- Policy values are displayed read-only, so admins can at least verify current state

**Mitigation if needed:** Build an edit form with field-level validation matching the backend schema, a confirmation modal, and audit logging. Tracked as UI-300. Requires product owner decision on scope.

### 6.4 FIND-UI-009 — Audit Log Viewer (P3, DEFERRED)

**What:** The `audit_logs` table is written to by all admin write operations, but there is no way to read these logs through the interface.

**Residual risk:** MEDIUM
- Audit trail exists in the database but is inaccessible without direct DB access
- For compliance or incident investigation, an operator must query the database manually
- No data is being lost — the write side is fully functional
- Risk increases as the team grows and more admins perform operations

**Mitigation if needed:** Add `GET /internal/audit-logs` endpoint with pagination and filtering, then build a viewer UI. Tracked as UI-302. Requires backend work first.

---

## 7. Open Items Requiring Action

| ID | Finding | What Is Needed | Owner |
|----|---------|----------------|-------|
| FIND-UI-004 | No idempotency key for credit POST | Backend must accept and enforce an `Idempotency-Key` header on `POST /internal/tenants/:id/credit`; frontend generates a UUID per submission | Backend + Frontend |
| FIND-UI-010 | Zero admin tests | Add vitest + @testing-library/react to web-app; write component tests for all 4 admin pages; optionally add E2E tests with Playwright | Frontend |

These two items cannot be resolved within the current audit scope without additional infrastructure or backend changes. They are tracked in 08-TASKS.md as UI-202 through UI-206 (tests) and remain the primary quality risks for the admin UI.

---

## 8. Conclusion

The admin UI has strong architectural foundations — correct auth patterns, role-based UI gating that mirrors backend rules, accessible confirmation modals, and proper error/loading state handling. The remediation phase eliminated both P1 security findings and improved code organization with a shared API module and centralized route guard.

The two most significant remaining gaps are the complete absence of automated tests (FIND-UI-010, OPEN) and the lack of idempotency protection for financial operations (FIND-UI-004, OPEN). The four deferred items carry low to medium residual risk and are appropriate to address in future development cycles based on operational need.

| Category | Count |
|----------|-------|
| Total findings | 10 |
| FIXED | 4 |
| DEFERRED | 4 |
| OPEN | 2 |
| P1 findings remaining | 0 |
