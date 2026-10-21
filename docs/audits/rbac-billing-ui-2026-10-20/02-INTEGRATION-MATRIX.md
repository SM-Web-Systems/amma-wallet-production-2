# 02-INTEGRATION-MATRIX: Frontend-to-Backend Integration Assessment

**Date:** 2026-10-20
**Commit:** `a65e19c`
**Branch:** `worktree-rbac-billing-audit-2026-10-20`

---

## Assessment Methodology

Each feature assessed across 4 dimensions:

- **UI** — Does a frontend component exist?
- **API** — Does the backend endpoint exist?
- **Integration** — Is the UI wired to the correct API with proper auth headers, payloads, and response handling?
- **Browser Test** — Does an automated browser/component test exist?

Statuses: `WORKING` | `BUILT/UNVERIFIED` | `PARTIAL` | `UI MISSING` | `API MISSING` | `BROKEN` | `INTENTIONALLY OUT OF SCOPE`

**WORKING** requires: code exists, API contract matches, auth headers sent, error states handled, and either manual or automated verification evidence.

**BUILT/UNVERIFIED** means code exists and appears correct by code review, but no automated test or live verification confirms it.

---

## 1. Integration Matrix

| # | Feature | UI | API | Integration | Browser Test | Verdict |
|---|---------|-----|-----|-------------|-------------|---------|
| 1 | Administrator login | `AdminLogin.tsx` | `POST /api/v1/internal/auth/login` | sessionStorage JWT, error display, redirect | None | **BUILT/UNVERIFIED** |
| 2 | Tenant list/dashboard | `AdminConsole.tsx` | `GET /api/v1/internal/tenants` | Bearer token, 401 redirect, loading/error/empty states | None | **BUILT/UNVERIFIED** |
| 3 | Tenant billing details | `AdminTenantDetail.tsx` | `GET /api/v1/internal/tenants/:id/billing` | Bearer token, policy display, events list | None | **BUILT/UNVERIFIED** |
| 4 | XLM balance display | `AdminConsole.tsx:83,214` + `AdminTenantDetail.tsx:233,406` | Returned in tenant/billing responses | `parseFloat().toFixed(4)` — display precision concern | None | **PARTIAL** |
| 5 | Post billing credits | `AdminTenantDetail.tsx:150-177` | `POST /api/v1/internal/tenants/:id/credit` | Type, amount, notes fields; success/error; auto-refresh | None | **BUILT/UNVERIFIED** |
| 6 | Billing event history | `AdminTenantDetail.tsx:476-542` | `GET /api/v1/internal/tenants/:id/billing` (recentEvents) | Event list with type, amount, date, period, user, notes | None | **BUILT/UNVERIFIED** |
| 7 | Billing event pagination | `AdminTenantDetail.tsx:179-201` | `GET /api/v1/internal/tenants/:id/events?beforeId=N` | Cursor-based "Load older" button | None | **BUILT/UNVERIFIED** |
| 8 | Suspend tenant | `AdminTenantDetail.tsx:203-231` | `PATCH /api/v1/internal/tenants/:id/suspend` | Hard/soft radio group, confirmation modal, `{type}` payload | None | **BUILT/UNVERIFIED** |
| 9 | Unsuspend tenant | `AdminTenantDetail.tsx:205,209-231` | `PATCH /api/v1/internal/tenants/:id/unsuspend` | Confirmation modal, auto-refresh | None | **BUILT/UNVERIFIED** |
| 10 | Billing policy management | Read-only display at `AdminTenantDetail.tsx:455-472` | `PATCH /api/v1/internal/tenants/:id/billing-policy` exists | **Read-only display only — no edit UI** | None | **PARTIAL** |
| 11 | Administrator list | `AdminAdmins.tsx` | `GET /api/v1/internal/admins` | Bearer token, role badges, status indicators | None | **BUILT/UNVERIFIED** |
| 12 | Administrator creation | `AdminAdmins.tsx:141-164` (invite modal) | `POST /api/v1/internal/admins` | Email, name, role, password fields; role filtering by caller | None | **BUILT/UNVERIFIED** |
| 13 | Administrator deactivation | `AdminAdmins.tsx:166-187` | `PATCH /api/v1/internal/admins/:id/deactivate` | Confirmation modal, self-guard, role-guard | None | **BUILT/UNVERIFIED** |
| 14 | Administrator reactivation | `AdminAdmins.tsx:166-187` | `PATCH /api/v1/internal/admins/:id/reactivate` | Confirmation modal, role-guard | None | **BUILT/UNVERIFIED** |
| 15 | Administrator password reset | `AdminAdmins.tsx:189-213` | `POST /api/v1/internal/admins/:id/reset-password` | Super_admin-only guard, min 12 chars, confirmation modal | None | **BUILT/UNVERIFIED** |
| 16 | Role-based UI permissions | `AdminAdmins.tsx:122-138` | Backend enforces at route level | Client-side gating mirrors backend rules | None | **BUILT/UNVERIFIED** |
| 17 | Audit history viewer | **Not built** | **No endpoint** — audit_logs table exists, no GET route | N/A | None | **API MISSING + UI MISSING** |

---

## 2. Detailed Findings by Feature

### 2.1 Administrator Login (BUILT/UNVERIFIED)

**File:** `packages/web-app/src/pages/AdminLogin.tsx` (131 lines)

- **API call:** `POST /api/v1/internal/auth/login` with `{email, password}` — correct
- **Token storage:** `sessionStorage['aw_admin_token']` — clears on tab close, good security practice
- **Admin info cache:** `sessionStorage['aw_admin_info']` — stores `{id, email, name, role}` for UI gating
- **Error handling:** Generic error display, no information leakage
- **Loading state:** Spinner, disabled inputs during submit
- **Auto-redirect:** Navigates to `/admin` on success
- **Missing:** No CSRF protection (mitigated by Bearer token auth pattern)
- **Missing:** No keyboard trap management on form
- **Observation:** Admin routes at lines 111-114 in `App.tsx` have **NO route guard** — any browser can navigate to `/admin` and see the empty shell until the sessionStorage check in `useEffect` redirects. This is a cosmetic flash, not a security issue (API calls fail without token).

### 2.2 Tenant Dashboard (BUILT/UNVERIFIED)

**File:** `packages/web-app/src/pages/AdminConsole.tsx` (228 lines)

- **API call:** `GET /api/v1/internal/tenants` — correct
- **Summary cards:** Total tenants, active count, total balance
- **Tenant list:** Name, slug, email, balance, status, suspension reason
- **Quick links:** Staff accounts link
- **States:** Loading spinner, empty state, error with retry
- **Auth guard:** `sessionStorage` check → redirect to `/admin/login`
- **401 handling:** Auto-logout on 401

**Precision issue (FIND-UI-001):**
```typescript
// Line 83: aggregation via parseFloat
const totalBalance = tenants.reduce((sum, t) => sum + parseFloat(t.prepaidXlmBalance || "0"), 0);
// Lines 208-214: display via parseFloat
parseFloat(tenant.prepaidXlmBalance).toFixed(4)
```
`parseFloat` is used for display formatting. For typical balance ranges this produces correct 4-decimal display. However, the aggregation on line 83 accumulates floating-point error across tenants. For large tenant counts or extreme balances, the total could drift.

### 2.3 Tenant Billing Details (BUILT/UNVERIFIED)

**File:** `packages/web-app/src/pages/AdminTenantDetail.tsx` (638 lines)

Most feature-rich page. Covers:
- Balance display, status (active/soft-suspended/hard-suspended)
- Policy summary (read-only: debt limit, acquisition mode, grace period)
- Billing events with cursor pagination
- Credit posting form
- Suspend/unsuspend with hard/soft type selection
- Confirmation modals for destructive actions

**Credit posting (FIND-UI-002):**
```typescript
// Line 152: parseFloat for validation
const amount = parseFloat(creditAmount);
// Line 163: sends as numeric
body: JSON.stringify({ type: creditType, amount_xlm: amount, notes: creditNotes || undefined })
```
The amount is `parseFloat()`'d from the text input and sent as a JSON number. The backend route schema expects `amount_xlm` as a number with `maximum: 100000`. The backend's `writeBillingCredit` then converts via `toStroops()`. This path is safe for values up to 100,000 XLM (well within float64 precision for 4 decimal places), but the value is sent as a float rather than a string.

**Missing confirmation dialog for credit posting (FIND-UI-003):**
The credit form submits directly on button click with no confirmation step. Credits are irreversible financial operations. The suspend/unsuspend actions have confirmation modals, but credit posting does not.

**Duplicate submission protection (FIND-UI-004):**
The button is disabled during `creditSubmitting`, preventing rapid double-clicks. However, there is no idempotency key sent to the backend — if the network is slow and the user refreshes, a duplicate POST could be sent. The backend has no deduplication guard for credits.

### 2.4 Billing Policy (PARTIAL)

**Display only:** `AdminTenantDetail.tsx:455-472` shows debt limit, acquisition mode, and grace period as read-only values.

**Backend supports editing:** `PATCH /api/v1/internal/tenants/:id/billing-policy` accepts field updates (lines 1070-1201 in `admin.ts`). Restricted to PRIVILEGED_ROLES.

**No edit UI exists.** Admins must use direct API calls or a tool like curl to modify billing policies. This is a functional gap — the backend capability exists but is inaccessible from the admin interface.

### 2.5 Administrator Management (BUILT/UNVERIFIED)

**File:** `packages/web-app/src/pages/AdminAdmins.tsx` (563 lines)

Full admin lifecycle UI:
- **List:** Role badges, active/deactivated status, per-row actions
- **Invite:** Modal with email, name, role (filtered by caller's role), password
- **Deactivate:** Confirmation modal, self-guard (`row.id === currentAdmin.id`), role hierarchy
- **Reactivate:** Confirmation modal, role hierarchy
- **Reset password:** Super_admin-only, min 12 chars, separate modal

**Client-side role gating mirrors backend rules:**
- `canInvite`: super_admin or platform_admin
- `canDeactivate`: Not self, super_admin can target all, platform_admin cannot target super_admin
- `canResetPassword`: super_admin only, not self

**Invite password minimum mismatch (FIND-UI-005):**
```typescript
// AdminAdmins.tsx line 142: frontend validates min 8
if (inviteForm.password.length < 8) {
// Backend admin.ts: schema requires minLength: 12
```
The frontend accepts 8-character passwords but the backend requires 12. This creates a confusing UX — the frontend shows success until the backend rejects with a 400 error. Should be min 12 on frontend to match.

### 2.6 Audit History (API MISSING + UI MISSING)

The `audit_logs` table exists in the database schema. The backend writes audit entries via `auditLog()` for all admin write operations. However:
- **No backend GET endpoint** for retrieving audit logs
- **No frontend UI** for viewing audit history
- Admins have no way to review their own or others' actions through the interface

### 2.7 Route Protection

**App.tsx lines 111-114:** Admin routes are registered as top-level routes with NO `ProtectedRoute` wrapper:
```tsx
<Route path="/admin/login" element={<AdminLoginPage />} />
<Route path="/admin/tenants/:id" element={<AdminTenantDetailPage />} />
<Route path="/admin/admins" element={<AdminAdminsPage />} />
<Route path="/admin" element={<AdminConsolePage />} />
```

Each page self-guards via `sessionStorage` check in `useEffect`. This means:
1. The component mounts and renders briefly before the redirect
2. No centralized route guard — each page must implement its own check
3. If a new admin page is added without the check, it would be unprotected

Not a security vulnerability (API calls require the JWT), but a code-quality concern.

---

## 3. Cross-Cutting Concerns

### 3.1 `adminFetch` Helper (Duplicated)

The `adminFetch()` function is copy-pasted in 3 files:
- `AdminConsole.tsx:33-43`
- `AdminTenantDetail.tsx:41-51`
- `AdminAdmins.tsx:33-43`

Identical implementation. Should be extracted to a shared utility.

### 3.2 No Admin API Client in `lib/api.ts`

The user-facing `lib/api.ts` has structured API clients (`authApi`, `walletApi`, etc.) but **no admin API client**. Each admin page uses raw `fetch()` via the local `adminFetch` helper. This means:
- No centralized admin API types
- No shared error handling
- No token refresh logic (admin JWT has no refresh mechanism by design)

### 3.3 No Frontend Test Infrastructure for Admin Pages

- **No test framework** configured for the web-app (no vitest/jest/playwright in dependencies)
- **No admin component tests** exist
- **7 existing test files** are all for user-facing features (api, hd-wallet, send, swap, wallet stores)
- The web-app `package.json` has no `test` script

### 3.4 Session Expiry Handling

All admin pages handle 401 by calling `logout()` which clears sessionStorage and redirects to login. This is correct but there is no proactive session expiry check — the admin discovers their session expired only when an API call fails.

---

## 4. Summary Scorecard

| Category | Score |
|----------|-------|
| **Features with UI + API + Integration** | 15/17 (88%) |
| **Features with automated tests** | 0/17 (0%) |
| **Features fully verified (WORKING)** | 0/17 (0%) |
| **Features built but unverified** | 13/17 |
| **Features partial** | 2/17 (balance display precision, billing policy edit) |
| **Features missing** | 1/17 (audit log viewer — both API and UI absent) |
| **Security-critical issues** | 0 P0, 1 P1 (password min mismatch), 2 P2 (credit confirm, route guards) |

### New Findings

| ID | Severity | Description |
|----|----------|-------------|
| FIND-UI-001 | P2 | `parseFloat` aggregation for total balance display (precision drift) |
| FIND-UI-002 | P3 | Credit amount sent as float JSON number instead of string |
| FIND-UI-003 | P1 | No confirmation dialog for credit posting (irreversible financial op) |
| FIND-UI-004 | P2 | No idempotency key for credit POST (duplicate-on-refresh risk) |
| FIND-UI-005 | P1 | Invite password min 8 on frontend vs min 12 on backend |
| FIND-UI-006 | P2 | `adminFetch` duplicated in 3 files |
| FIND-UI-007 | P2 | No centralized admin route guard (each page self-guards) |
| FIND-UI-008 | P3 | Billing policy edit UI missing (backend supports PATCH) |
| FIND-UI-009 | P3 | Audit log viewer missing (no backend GET + no UI) |
| FIND-UI-010 | P2 | Zero admin component/integration/E2E tests |

---

## 5. Answer: Has the entire RBAC and billing UI been built, connected, and tested?

**No.** The UI is substantially built (88% feature coverage) with correct API integration patterns, but:

1. **Not tested** — zero automated tests for any admin feature
2. **Not fully verified** — no live or browser-automated verification evidence
3. **Two functional gaps** — billing policy editing UI and audit log viewer are absent
4. **Two data integrity issues** — password minimum mismatch, credit confirmation missing
5. **Display precision concern** — `parseFloat` used throughout for XLM balance display

The codebase demonstrates professional quality: accessible modals, role-based UI gating that mirrors backend rules, proper loading/error/empty states, and 401 session handling. But without any test coverage, these features remain BUILT/UNVERIFIED.
