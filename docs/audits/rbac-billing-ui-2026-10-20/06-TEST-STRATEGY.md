# 06-TEST-STRATEGY: Admin UI Test Strategy

**Date:** 2026-10-20
**Commit:** `a65e19c`

---

## 1. Current State

| Layer | Coverage |
|-------|----------|
| Backend unit/integration tests | 566 tests, 81 files (vitest) |
| Backend admin-specific tests | Role guard tests, auto-suspension tests, billing service tests |
| Frontend admin tests | **0 tests** |
| Frontend user-facing tests | 7 test files (api, hd-wallet, send, swap, wallet stores) |
| Frontend test framework (web-app) | Not configured — no vitest/jest/playwright in web-app deps |

## 2. Recommended Test Stack

| Tool | Purpose | Rationale |
|------|---------|-----------|
| vitest | Test runner + assertions | Already used in backend; consistent DX |
| @testing-library/react | Component rendering + interaction | React ecosystem standard |
| jsdom | Browser environment simulation | Lightweight, vitest-native |
| msw (Mock Service Worker) | API mocking | Intercepts fetch at network level; no `adminFetch` mocking needed |

**Not recommended at this time:**
- Playwright/Cypress E2E — requires running backend + database; high infrastructure cost for 4 admin pages
- Storybook — admin pages are internal-only; visual testing ROI is low

## 3. Test Scope by Priority

### 3.1 P1 — Security-Critical Behavior

| Test | Component | What to verify |
|------|-----------|----------------|
| Password validation | AdminAdmins | Invite form rejects passwords < 12 chars |
| Credit confirmation | AdminTenantDetail | Confirmation modal appears before credit POST |
| 401 auto-logout | All admin pages | 401 response clears sessionStorage and redirects to /admin/login |
| Role gating | AdminAdmins | canInvite/canDeactivate/canReactivate/canResetPassword follow role rules |
| AdminRoute guard | App.tsx | Unauthenticated users redirected to /admin/login |

### 3.2 P2 — Core Functionality

| Test | Component | What to verify |
|------|-----------|----------------|
| Login flow | AdminLogin | Successful login stores JWT + info in sessionStorage |
| Login error display | AdminLogin | Failed login shows error, does not store token |
| Tenant list rendering | AdminConsole | Renders tenant names, balances, status badges |
| Billing detail rendering | AdminTenantDetail | Renders balance, policy, events |
| Suspend/unsuspend | AdminTenantDetail | Modal workflow, correct API payload |
| Admin list rendering | AdminAdmins | Role badges, action buttons per role |
| Pagination | AdminTenantDetail | "Load older" fetches next page with cursor |

### 3.3 P3 — Edge Cases

| Test | Component | What to verify |
|------|-----------|----------------|
| Empty state | AdminConsole | "No tenants" message when list is empty |
| Loading state | All pages | Spinner shown during fetch |
| Error state | All pages | Error message with retry button |
| Self-action guard | AdminAdmins | Cannot deactivate or reset own account |

## 4. Test File Structure

```
packages/web-app/src/
├── test/
│   └── setup.ts              # jsdom + cleanup
├── pages/
│   ├── AdminLogin.test.tsx
│   ├── AdminConsole.test.tsx
│   ├── AdminTenantDetail.test.tsx
│   └── AdminAdmins.test.tsx
└── lib/
    └── admin-api.test.ts
```

## 5. Mock Strategy

### sessionStorage
```typescript
// Mock in beforeEach
const mockStorage: Record<string, string> = {};
vi.stubGlobal('sessionStorage', {
  getItem: (k: string) => mockStorage[k] ?? null,
  setItem: (k: string, v: string) => { mockStorage[k] = v; },
  removeItem: (k: string) => { delete mockStorage[k]; },
  clear: () => Object.keys(mockStorage).forEach(k => delete mockStorage[k]),
});
```

### API responses (MSW)
```typescript
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

const server = setupServer(
  http.get('/api/v1/internal/tenants', () =>
    HttpResponse.json({ tenants: [/* mock data */] })
  ),
  // ... other handlers
);
```

### react-router-dom navigation
```typescript
import { MemoryRouter } from 'react-router-dom';
// Wrap component in <MemoryRouter initialEntries={['/admin']}>
```

## 6. Configuration Changes Needed

**`packages/web-app/package.json`** — add:
```json
{
  "devDependencies": {
    "@testing-library/react": "^16.x",
    "@testing-library/jest-dom": "^6.x",
    "msw": "^2.x",
    "jsdom": "^25.x"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

**`packages/web-app/vitest.config.ts`** — create:
```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
  },
});
```

## 7. Coverage Targets

| Metric | Target | Rationale |
|--------|--------|-----------|
| Admin page tests | ≥1 test file per page (4 files) | Baseline coverage |
| Security-critical tests | 100% of P1 items | Non-negotiable for admin console |
| Line coverage | Not targeted | Coverage metrics for 4 pages are less useful than behavioral tests |

## 8. Implementation Order

1. Install test dependencies and configure vitest
2. Write `admin-api.test.ts` (shared utility)
3. Write `AdminLogin.test.tsx` (simplest page, proves infrastructure works)
4. Write `AdminAdmins.test.tsx` (most complex role-gating logic)
5. Write `AdminConsole.test.tsx`
6. Write `AdminTenantDetail.test.tsx` (most complex page, highest value)

---

## 9. Status

| Item | Status |
|------|--------|
| Test strategy document | DONE |
| Test infrastructure setup | TODO (UI-202) |
| AdminLogin tests | TODO (UI-203) |
| AdminConsole tests | TODO (UI-204) |
| AdminTenantDetail tests | TODO (UI-205) |
| AdminAdmins tests | TODO (UI-206) |
