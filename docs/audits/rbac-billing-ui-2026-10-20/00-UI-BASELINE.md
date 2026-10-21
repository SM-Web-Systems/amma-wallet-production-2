# 00-UI-BASELINE: Admin UI Baseline Assessment

**Date:** 2026-10-20
**Commit:** `a65e19c`
**Prior audit:** `docs/audits/rbac-billing-2026-10-20/` (backend RBAC & billing — 2 fixes applied)

---

## 1. Frontend Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | React | 19.2.x |
| Router | react-router-dom | 7.13.x |
| State | Zustand | 5.0.x |
| Data fetching | TanStack React Query (user pages) / raw fetch (admin pages) | 5.90.x |
| Styling | Tailwind CSS | 4.2.x |
| Icons | Lucide React | 0.575.x |
| Build | Vite | 8.0.0-beta.13 |
| TypeScript | ~5.9.x | |
| Charts | Recharts | 3.7.x |
| i18n | i18next | 23.x |
| Notifications | Sonner | 2.0.x |

## 2. Admin UI Files

| File | Lines | Purpose |
|------|-------|---------|
| `pages/AdminLogin.tsx` | 131 | Login form → `POST /internal/auth/login` |
| `pages/AdminConsole.tsx` | 228 | Tenant dashboard (list, summary cards) |
| `pages/AdminTenantDetail.tsx` | 638 | Billing detail, credits, suspend, events |
| `pages/AdminAdmins.tsx` | 563 | Staff management (invite, deactivate, reactivate, reset) |
| **Total** | **1,560** | **4 pages** |

## 3. Admin Authentication Pattern

- JWT stored in `sessionStorage['aw_admin_token']` (cleared on tab close)
- Admin info cached in `sessionStorage['aw_admin_info']` as JSON
- `adminFetch()` helper adds `Authorization: Bearer` header (duplicated in 3 files)
- 401 responses trigger `logout()` → clear storage → redirect `/admin/login`
- Completely separate from user auth (no shared tokens, stores, or middleware)

## 4. Admin Routes

```
/admin/login     → AdminLogin (public)
/admin           → AdminConsole (self-guarded)
/admin/tenants/:id → AdminTenantDetail (self-guarded)
/admin/admins    → AdminAdmins (self-guarded)
```

No centralized route guard — each page checks `sessionStorage` in `useEffect`.

## 5. Backend Admin Endpoints (14 total)

| Method | Path | UI Coverage |
|--------|------|-------------|
| POST | `/api/v1/internal/auth/login` | AdminLogin.tsx |
| GET | `/api/v1/internal/me` | Not directly called |
| GET | `/api/v1/internal/tenants` | AdminConsole.tsx |
| GET | `/api/v1/internal/tenants/:id/billing` | AdminTenantDetail.tsx |
| GET | `/api/v1/internal/tenants/:id/events` | AdminTenantDetail.tsx (pagination) |
| POST | `/api/v1/internal/tenants/:id/credit` | AdminTenantDetail.tsx |
| PATCH | `/api/v1/internal/tenants/:id/suspend` | AdminTenantDetail.tsx |
| PATCH | `/api/v1/internal/tenants/:id/unsuspend` | AdminTenantDetail.tsx |
| PATCH | `/api/v1/internal/tenants/:id/billing-policy` | **Read-only display** |
| GET | `/api/v1/internal/admins` | AdminAdmins.tsx |
| POST | `/api/v1/internal/admins` | AdminAdmins.tsx (invite modal) |
| PATCH | `/api/v1/internal/admins/:id/deactivate` | AdminAdmins.tsx |
| PATCH | `/api/v1/internal/admins/:id/reactivate` | AdminAdmins.tsx |
| POST | `/api/v1/internal/admins/:id/reset-password` | AdminAdmins.tsx |

**Coverage:** 13/14 endpoints have UI (93%). Missing: billing policy edit form.

## 6. Test Infrastructure

| Category | Status |
|----------|--------|
| Frontend test framework | Not configured (no vitest/jest/playwright in web-app) |
| Admin component tests | 0 |
| Admin integration tests | 0 |
| Admin E2E tests | 0 |
| Existing frontend tests | 7 files (user-facing only) |
| Backend test framework | vitest (566 tests pass) |
| Backend admin tests | Role guard tests in admin-roles-naming.test.ts |

## 7. Existing UI Patterns (for consistency)

- Rounded-2xl cards with ring/border styling
- Violet-600 primary color, emerald for success, red for error/danger
- Lucide icons throughout
- `text-xs` for labels, `text-sm` for body, `text-3xl` for summary numbers
- Confirmation modals with backdrop blur, escape-to-close, aria attributes
- Tabular-nums for financial displays
- `toFixed(4)` for XLM amounts
