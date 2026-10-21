# 07-DEVELOPMENT-PLAN: Admin UI Remediation Plan

**Date:** 2026-10-20
**Commit:** `a65e19c`
**Branch:** `worktree-rbac-billing-audit-2026-10-20`

---

## 1. Completed Remediations

| ID | Fix | Files Changed | Verified |
|----|-----|---------------|----------|
| UI-100 | Password minimum 8 → 12 in invite form | `AdminAdmins.tsx:142,156` | tsc ✓, vite build ✓ |
| UI-101 | Credit posting confirmation dialog | `AdminTenantDetail.tsx` (4 edits) | tsc ✓, vite build ✓ |
| UI-102 | Extract `adminFetch` to `lib/admin-api.ts` | `admin-api.ts` (new), `AdminConsole.tsx`, `AdminTenantDetail.tsx`, `AdminAdmins.tsx` | tsc ✓, vite build ✓ |
| UI-200 | Centralized `AdminRoute` guard in App.tsx | `App.tsx` (AdminRoute component + 3 route wrappers) | tsc ✓, vite build ✓ |

### 1.1 UI-100: Password Minimum Fix (FIND-UI-005)

**Problem:** Frontend accepted 8-character passwords but backend requires 12. Users would see the frontend accept their password, then get a confusing 400 error from the backend.

**Fix:** Changed validation threshold from 8 to 12 in `AdminAdmins.tsx`:
- Line 142: `inviteForm.password.length < 8` → `< 12`
- Line 156: Placeholder `"Min. 8 characters"` → `"Min. 12 characters"`
- Error message updated: `"Password must be at least 12 characters."`

### 1.2 UI-101: Credit Confirmation Dialog (FIND-UI-003)

**Problem:** Credit posting (an irreversible financial operation) submitted directly on button click with no confirmation step. Suspend/unsuspend had confirmation modals but credits did not.

**Fix:** Added confirmation dialog to `AdminTenantDetail.tsx` matching the existing modal pattern:
- New state: `creditConfirmOpen`
- New function: `handleCreditClick()` — validates inputs, opens confirmation modal
- Confirmation modal displays: tenant name, credit type, amount, irreversibility warning
- Confirm button calls existing `handlePostCredit()` which now closes modal first
- Cancel and backdrop click dismiss without posting

### 1.3 UI-102: adminFetch Extraction (FIND-UI-006)

**Problem:** Identical `adminFetch()` helper copy-pasted in 3 files (AdminConsole, AdminTenantDetail, AdminAdmins).

**Fix:** Created `packages/web-app/src/lib/admin-api.ts` with:
- `adminFetch()` — shared fetch wrapper with admin JWT header
- `AdminInfo` interface — shared type definition
- `getAdminInfo()` — shared sessionStorage parser for admin identity

Updated all 3 pages to import from `lib/admin-api`.

### 1.4 UI-200: Centralized Admin Route Guard (FIND-UI-007)

**Problem:** Admin routes in App.tsx had no wrapper — each page self-guarded via `sessionStorage` check in `useEffect`. New admin pages could accidentally skip the check.

**Fix:** Added `AdminRoute` component in `App.tsx` (same pattern as existing `ProtectedRoute` for user routes). Wraps `/admin`, `/admin/tenants/:id`, and `/admin/admins`. Login route (`/admin/login`) stays public.

Per-page `useEffect` guards retained as defense-in-depth.

---

## 2. Remaining Work

### 2.1 Open Items

| ID | Priority | Description | Blocker |
|----|----------|-------------|---------|
| UI-202 | P2 | Frontend test infrastructure (vitest + testing-library) | None |
| UI-203 | P2 | AdminLogin component tests | UI-202 |
| UI-204 | P2 | AdminConsole component tests | UI-202 |
| UI-205 | P2 | AdminTenantDetail component tests | UI-202 |
| UI-206 | P2 | AdminAdmins component tests | UI-202 |

### 2.2 Deferred Items (Owner Decision Required)

| ID | Priority | Description | Why Deferred |
|----|----------|-------------|--------------|
| UI-201 | P2 | Replace parseFloat aggregation with string-based sum | Impact negligible for <100 tenants |
| UI-300 | P3 | Billing policy edit form | Needs design decisions on which fields to expose |
| UI-301 | P3 | Send credit amount as string | Current float path safe up to 100,000 XLM |
| UI-302 | P3 | Audit log viewer | Requires new backend GET endpoint |
| FIND-UI-004 | P2 | Idempotency key for credit POST | Requires backend dedup support |

### 2.3 Documentation Remaining

| ID | Deliverable | Status |
|----|-------------|--------|
| UI-400 | 03-RBAC-UI-SPEC.md | In progress |
| UI-401 | 04-BILLING-UI-SPEC.md | In progress |
| UI-402 | 05-GAP-ANALYSIS.md | In progress |
| UI-403 | Mermaid diagrams (8 diagrams) | In progress |
| UI-404 | 09-VERIFICATION-REPORT.md | Pending |
| UI-405 | 11-FINAL-ASSESSMENT.md | Pending |

---

## 3. Risk Assessment

### 3.1 Mitigated Risks

| Risk | Mitigation |
|------|-----------|
| Admin creates weak password → backend rejects | Frontend now validates min 12 (UI-100) |
| Accidental credit posting → irreversible | Confirmation dialog added (UI-101) |
| New admin page forgets auth check | Centralized AdminRoute guard (UI-200) |
| adminFetch drift between pages | Single source in lib/admin-api.ts (UI-102) |

### 3.2 Residual Risks

| Risk | Severity | Mitigation |
|------|----------|-----------|
| No admin tests — regressions undetected | P2 | Backend tests cover API layer; manual testing covers UI until UI-202+ |
| No idempotency on credit POST | P2 | Button disabled during submission prevents most duplicates; network-level duplicates possible but unlikely |
| parseFloat aggregation drift | Low | Informational display only; not used for decisions |
| No audit log viewer | P3 | Backend writes audit entries; can query DB directly if needed |
