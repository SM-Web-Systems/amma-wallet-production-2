# 01-UI-ARCHITECTURE: Admin UI Architecture

**Date:** 2026-10-20

---

## 1. Component Hierarchy

The admin UI is a four-page section embedded within the main AmmaWallet SPA. All admin pages are lazy-loaded via `React.lazy()` and wrapped in a shared `<Suspense>` boundary.

```
App (src/App.tsx)
  <Suspense>
    <Routes>
      ...user routes (ProtectedRoute / AuthRoute guards)...

      /admin/login        -> AdminLoginPage        (no guard)
      /admin/tenants/:id  -> AdminRoute -> AdminTenantDetailPage
      /admin/admins       -> AdminRoute -> AdminAdminsPage
      /admin              -> AdminRoute -> AdminConsolePage
    </Routes>
  </Suspense>
```

**Key structural facts:**

- Admin pages are declared at `App.tsx:117-120`. They are siblings of user routes, not nested under a shared admin layout component.
- There is no shared admin `<Layout>` wrapper (contrast with user routes at `App.tsx:93-114` which share a `<Layout>` component). Each admin page renders its own header, nav, and logout button independently.
- The `/admin/login` route is unguarded (`App.tsx:117`). The three protected admin routes are wrapped by `<AdminRoute>` (`App.tsx:118-120`).
- Lazy imports at `App.tsx:29-33`.

## 2. Authentication Flow

Admin authentication is completely isolated from user authentication. The flow:

1. **Login:** `AdminLogin.tsx:27-38` POSTs credentials to `POST /api/v1/internal/auth/login`. On success, the response contains `{ token, admin }`.
2. **Token storage:** JWT stored in `sessionStorage['aw_admin_token']` (`AdminLogin.tsx:37`). Admin identity object (id, email, name, role) stored in `sessionStorage['aw_admin_info']` as JSON (`AdminLogin.tsx:38`).
3. **Session lifetime:** `sessionStorage` is scoped to the browser tab. Closing the tab clears the session automatically. The UI notes this explicitly (`AdminLogin.tsx:126`).
4. **Admin info cache:** The `getAdminInfo()` utility (`admin-api.ts:25-30`) parses `aw_admin_info` from sessionStorage with a try/catch safety wrapper that returns `null` on failure.

**Storage keys:**

| Key | Content | Set by | Read by |
|-----|---------|--------|---------|
| `aw_admin_token` | JWT string | AdminLogin.tsx:37 | adminFetch (admin-api.ts:7), AdminRoute (App.tsx:54), all pages |
| `aw_admin_info` | JSON `{id,email,name,role}` | AdminLogin.tsx:38 | getAdminInfo (admin-api.ts:25), AdminConsole.tsx:34, AdminAdmins.tsx:103-106 |

## 3. Data Fetching Pattern

Admin pages use a shared `adminFetch()` utility (`src/lib/admin-api.ts:6-16`) instead of React Query (which is used by user-facing pages).

```typescript
// admin-api.ts:6-16
export function adminFetch(path: string, options: RequestInit = {}) {
  const token = sessionStorage.getItem("aw_admin_token");
  return fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: token ? `Bearer ${token}` : "",
      ...(options.headers ?? {}),
    },
  });
}
```

**Characteristics:**

- Wraps native `fetch()` with automatic Bearer token injection from sessionStorage (`admin-api.ts:7-8`).
- Always sets `Content-Type: application/json` (`admin-api.ts:11`). Custom headers can override via spread (`admin-api.ts:13`).
- If no token exists, sends an empty `Authorization` header (`admin-api.ts:12`) rather than omitting it.
- No caching, deduplication, or retry logic. Every call is a fresh network request.
- No React Query, no SWR, no shared query cache for admin pages.
- Each page manages its own loading/error/data lifecycle via `useState` + `useCallback` + `useEffect`.

**Typical data-fetch pattern (repeated in all three protected pages):**

```
const load = useCallback(async () => {
  setLoading(true); setError(null);
  try {
    const res = await adminFetch(endpoint);
    if (res.status === 401) { logout(); return; }
    if (!res.ok) { setError(...); return; }
    const data = await res.json();
    setState(data);
  } catch { setError("Network error..."); }
  finally { setLoading(false); }
}, [deps]);

useEffect(() => {
  if (!sessionStorage.getItem("aw_admin_token")) { navigate("/admin/login"); return; }
  load();
}, [load, navigate]);
```

This pattern appears at:
- `AdminConsole.tsx:42-56` (load tenants)
- `AdminTenantDetail.tsx:99-123` (load billing)
- `AdminAdmins.tsx:80-98` (load admins)

## 4. State Management

Admin pages use **local `useState` exclusively** with no shared state store. There is no Zustand store, no React Context, and no global state for admin data.

**Per-page state breakdown:**

| Page | State variables | Notes |
|------|----------------|-------|
| AdminLogin | email, password, showPassword, loading, error (5 vars, `AdminLogin.tsx:13-17`) | Form-only state |
| AdminConsole | tenants, loading, error (3 vars, `AdminConsole.tsx:29-31`) | Plus derived `adminInfo` from sessionStorage |
| AdminTenantDetail | data, loading, error + credit form (6 vars) + suspend (2 vars) + pagination (4 vars) + modal (1 var) = **13 state vars** (`AdminTenantDetail.tsx:64-91`) | Most complex page |
| AdminAdmins | admins, loading, error + currentAdmin + confirmModal, resetModal, inviteOpen + actionBusy, actionError + inviteForm, inviteBusy, inviteError + resetPwd, resetError, resetSuccess = **14 state vars** (`AdminAdmins.tsx:52-73`) | Highest state count |

**Cross-page communication:** None. Each page fetches its own data independently. Navigating from AdminConsole to AdminTenantDetail triggers a fresh API call; there is no shared cache or prefetching.

## 5. Route Protection

Admin routes use a **two-layer defense** strategy:

### Layer 1: AdminRoute guard (App.tsx:53-57)

```typescript
function AdminRoute({ children }: { children: React.ReactNode }) {
  const hasToken = !!sessionStorage.getItem("aw_admin_token");
  if (!hasToken) return <Navigate to="/admin/login" replace />;
  return <>{children}</>;
}
```

- Applied to `/admin`, `/admin/tenants/:id`, and `/admin/admins` (`App.tsx:118-120`).
- Checks only for token **existence** in sessionStorage. Does not validate token format, expiry, or signature.
- Synchronous check -- no async validation against the server.
- Not applied to `/admin/login` (correctly left unguarded, `App.tsx:117`).

### Layer 2: Per-page defense-in-depth (useEffect checks)

Each protected page independently re-checks the token in its `useEffect` before loading data:

- `AdminConsole.tsx:59`: `if (!sessionStorage.getItem("aw_admin_token")) { navigate("/admin/login"); return; }`
- `AdminTenantDetail.tsx:126`: `if (!sessionStorage.getItem("aw_admin_token")) { navigate("/admin/login"); return; }`
- `AdminAdmins.tsx:101`: `if (!sessionStorage.getItem("aw_admin_token")) { navigate("/admin/login"); return; }`

This is a redundant safety net that protects against edge cases where the token could be cleared between the `AdminRoute` render check and the page's data fetch.

### Layer 3: Server-side 401 handling

Every `adminFetch()` response is checked for `status === 401`, which triggers `logout()` (clear sessionStorage + redirect). This ensures that even if the client has a stale or invalid token, the server's rejection forces a clean re-authentication:

- `AdminConsole.tsx:47`
- `AdminTenantDetail.tsx:105, 170, 189, 225`
- `AdminAdmins.tsx:85, 143, 163, 190`

## 6. Error Handling Pattern

All admin pages follow a consistent error-handling pattern with three UI states:

### Loading state
- Centered spinner with descriptive text (e.g., "Loading tenants...", "Loading billing data...", "Loading admins...").
- Implemented via conditional rendering on `loading` boolean.
- Examples: `AdminConsole.tsx:146-150`, `AdminTenantDetail.tsx:454-458`, `AdminAdmins.tsx:452-456`.

### Error state
- Red-bordered alert box with `AlertCircle` icon and error message.
- Network errors show a fixed message (e.g., "Network error -- could not load tenants.").
- Server errors show the response body's `error` field, falling back to `"Server error ${status}"`.
- Examples: `AdminConsole.tsx:138-143`, `AdminTenantDetail.tsx:447-452`, `AdminAdmins.tsx:422-426`.

### Empty state
- Centered neutral text (e.g., "No tenants found.", "No billing events yet.", "No admin accounts found.").
- Examples: `AdminConsole.tsx:151`, `AdminTenantDetail.tsx:559`, `AdminAdmins.tsx:458`.

### 401 auto-logout
- Every fetch response checks `res.status === 401` before any other error handling.
- On 401, calls `logout()` which: (1) removes `aw_admin_token` from sessionStorage, (2) removes `aw_admin_info` from sessionStorage, (3) navigates to `/admin/login`.
- The logout function is defined identically in each page: `AdminConsole.tsx:36-39`, `AdminTenantDetail.tsx:93-97`, `AdminAdmins.tsx:74-78`.

### Action-specific error handling
- Credit posting: separate `creditError` state with inline display (`AdminTenantDetail.tsx:75-76, 675-679`).
- Suspend/unsuspend: separate `suspendError` state (`AdminTenantDetail.tsx:80, 493-495`).
- Admin deactivate/reactivate: per-row `actionError` keyed by admin ID (`AdminAdmins.tsx:64, 539-544`).
- Credit success auto-dismiss: `creditResult` clears after 8 seconds via `setTimeout` in a `useEffect` (`AdminTenantDetail.tsx:131-139`).
- Password reset success: `resetSuccess` clears after 5 seconds (`AdminAdmins.tsx:197`).

## 7. Admin-User Auth Separation

The admin and user authentication systems are **completely independent** with no shared code, storage, or state:

| Aspect | User Auth | Admin Auth |
|--------|-----------|------------|
| **State store** | Zustand `useAuthStore` (`App.tsx:3`) | Raw `sessionStorage` (no store) |
| **Token storage** | Zustand-managed (persisted) | `sessionStorage['aw_admin_token']` (`AdminLogin.tsx:37`) |
| **Login endpoint** | `/api/v1/auth/login` | `/api/v1/internal/auth/login` (`AdminLogin.tsx:27`) |
| **Route guard** | `ProtectedRoute` uses `useAuthStore` (`App.tsx:37-45`) | `AdminRoute` reads `sessionStorage` (`App.tsx:53-57`) |
| **Data fetching** | React Query + Zustand | `adminFetch()` + local `useState` |
| **Session lifetime** | Persists across tabs (Zustand persistence) | Dies with tab close (sessionStorage) |
| **Identity cache** | Zustand profile state | `sessionStorage['aw_admin_info']` JSON |
| **Namespace** | `/login`, `/dashboard`, `/tokens`, etc. | `/admin/*` namespace |
| **Shared components** | `<Layout>` wrapper | None (each page self-contained) |

**No cross-contamination vectors:** An admin token cannot be used for user API calls and vice versa. The `adminFetch()` helper (`admin-api.ts:6-16`) only reads from `aw_admin_token`. The user auth system (`useAuthStore`) has no awareness of admin sessionStorage keys. Logging out of one system has zero effect on the other.

The comment at `App.tsx:28` explicitly documents this separation: "Internal admin console (sessionStorage auth, completely separate from user flow)".
