# 03-RBAC-UI-SPEC: Client-Side Role-Based Access Control Specification

**Date:** 2026-10-20
**Commit:** `a65e19c`
**Status:** Current implementation (as-built)

---

## 1. Trust Model

All security enforcement is authoritative on the backend. Client-side role gating exists solely as a UX convenience -- it hides buttons and form options that the current admin's role cannot use, preventing unnecessary 403 errors. If client-side gating were entirely removed, the system would remain secure because every write endpoint independently checks `request.admin.role` before executing.

| Layer | Purpose | Bypass Impact |
|-------|---------|---------------|
| **Backend** (`admin.ts` route handlers) | Authoritative enforcement. JWT authentication + per-route role checks. | System compromised -- all security depends on this layer. |
| **Frontend** (`AdminAdmins.tsx` gating functions) | UX convenience. Hides inapplicable actions. | No security impact -- backend rejects unauthorized requests with 403. |

**Evidence:** Backend RBAC spec (`02-RBAC-SPEC.md`, Section 2.2) documents that all write operations check `PRIVILEGED_ROLES` inline. The frontend never sends role information in requests; the backend reads the role from the JWT-authenticated `request.admin` context attached by `verifyInternalAdmin` middleware (`admin-auth.ts:110-115`).

---

## 2. Admin Role Hierarchy

Four roles, ranked from most to least privileged:

| Rank | Role | UI Capabilities | Backend Capabilities |
|------|------|-----------------|---------------------|
| 1 (highest) | `super_admin` | All actions: invite (any role), deactivate, reactivate, reset password | All write endpoints. Can target any role. |
| 2 | `platform_admin` | Invite (not super_admin), deactivate (not super_admin), reactivate (not super_admin) | `PRIVILEGED_ROLES` write endpoints. Cannot create/deactivate/reactivate super_admin. |
| 3 | `account_manager` | Read-only. No action buttons shown. | Read endpoints only. All writes return 403. |
| 4 (lowest) | `support_agent` | Read-only. No action buttons shown. | Read endpoints only. All writes return 403. |

**Source:** Role list defined at `AdminAdmins.tsx:47`:
```typescript
const ALL_ROLES = ["super_admin", "platform_admin", "account_manager", "support_agent"] as const;
```

Backend role CHECK constraint at `schema/index.ts:846-850` enforces the same four values.

---

## 3. Client-Side Role Gating Rules

The current admin's identity is read from `sessionStorage['aw_admin_info']` on mount (`AdminAdmins.tsx:100-108`). This stores `{ id, email, name, role }` as JSON, set during login. The parsed identity drives four gating functions.

### 3.1 `canInvite` (line 113)

```typescript
const canInvite = currentAdmin?.role === 'super_admin' || currentAdmin?.role === 'platform_admin';
```

| Current Admin Role | Can Invite? |
|--------------------|-------------|
| `super_admin` | Yes |
| `platform_admin` | Yes |
| `account_manager` | No |
| `support_agent` | No |
| Not authenticated / malformed info | No |

**UI effect:** The "Invite admin" button (`AdminAdmins.tsx:437-443`) is conditionally rendered only when `canInvite` is truthy.

**Backend mirror:** `POST /api/v1/internal/admins` checks `PRIVILEGED_ROLES` (`admin.ts:683-793`).

### 3.2 `canDeactivate(row)` (lines 115-119)

```typescript
const canDeactivate = (row: AdminAccount) => {
  if (!currentAdmin || !row.isActive || row.id === currentAdmin.id) return false;
  if (currentAdmin.role === 'super_admin') return true;
  return currentAdmin.role === 'platform_admin' && row.role !== 'super_admin';
};
```

| Current Admin Role | Target Role | Target Active? | Target is Self? | Can Deactivate? |
|--------------------|-------------|----------------|-----------------|-----------------|
| `super_admin` | any | Yes | No | **Yes** |
| `super_admin` | any | Yes | Yes | No (self-guard) |
| `super_admin` | any | No | No | No (already inactive) |
| `platform_admin` | `platform_admin` | Yes | No | **Yes** |
| `platform_admin` | `account_manager` | Yes | No | **Yes** |
| `platform_admin` | `support_agent` | Yes | No | **Yes** |
| `platform_admin` | `super_admin` | Yes | No | No (hierarchy guard) |
| `account_manager` | any | any | any | No |
| `support_agent` | any | any | any | No |

**UI effect:** The "Deactivate" button per-row (`AdminAdmins.tsx:493-503`) renders only when `canDeactivate(admin)` is truthy.

**Backend mirror:** `PATCH /api/v1/internal/admins/:id/deactivate` enforces `PRIVILEGED_ROLES`, self-deactivation check (`admin.ts:848-849`), and platform_admin-cannot-target-super_admin (`admin.ts:868-872`).

### 3.3 `canReactivate(row)` (lines 121-125)

```typescript
const canReactivate = (row: AdminAccount) => {
  if (!currentAdmin || row.isActive) return false;
  if (currentAdmin.role === 'super_admin') return true;
  return currentAdmin.role === 'platform_admin' && row.role !== 'super_admin';
};
```

| Current Admin Role | Target Role | Target Active? | Can Reactivate? |
|--------------------|-------------|----------------|-----------------|
| `super_admin` | any | No | **Yes** |
| `super_admin` | any | Yes | No (already active) |
| `platform_admin` | `platform_admin` | No | **Yes** |
| `platform_admin` | `account_manager` | No | **Yes** |
| `platform_admin` | `support_agent` | No | **Yes** |
| `platform_admin` | `super_admin` | No | No (hierarchy guard) |
| `account_manager` | any | any | No |
| `support_agent` | any | any | No |

**UI effect:** The "Reactivate" button per-row (`AdminAdmins.tsx:505-515`) renders only when `canReactivate(admin)` is truthy.

**Backend mirror:** `PATCH /api/v1/internal/admins/:id/reactivate` enforces `PRIVILEGED_ROLES` and platform_admin-cannot-target-super_admin (`admin.ts:959-963`).

### 3.4 `canResetPassword(row)` (lines 127-128)

```typescript
const canResetPassword = (row: AdminAccount) =>
  !!currentAdmin && currentAdmin.role === 'super_admin' && row.id !== currentAdmin.id;
```

| Current Admin Role | Target is Self? | Can Reset Password? |
|--------------------|-----------------|---------------------|
| `super_admin` | No | **Yes** |
| `super_admin` | Yes | No (self-guard) |
| `platform_admin` | any | No |
| `account_manager` | any | No |
| `support_agent` | any | No |

**UI effect:** The "Reset pwd" button per-row (`AdminAdmins.tsx:517-526`) renders only when `canResetPassword(admin)` is truthy.

**Backend mirror:** `POST /api/v1/internal/admins/:id/reset-password` checks `role !== "super_admin"` (single-role, stricter than PRIVILEGED_ROLES) and self-reset guard (`admin.ts:1241-1244`, `admin.ts:1252-1255`).

---

## 4. UI Role-Permission Matrix (Composite)

Summary of all client-side gating in one table:

| Action | super_admin | platform_admin | account_manager | support_agent | Self-Guard |
|--------|:-----------:|:--------------:|:---------------:|:-------------:|:----------:|
| View admin list | Yes | Yes | Yes | Yes | N/A |
| Invite admin | Yes | Yes | No | No | N/A |
| Invite as super_admin | Yes | **No** | No | No | N/A |
| Invite as platform_admin | Yes | Yes | No | No | N/A |
| Invite as account_manager | Yes | Yes | No | No | N/A |
| Invite as support_agent | Yes | Yes | No | No | N/A |
| Deactivate admin | Yes | Yes (not super_admin targets) | No | No | Cannot deactivate self |
| Reactivate admin | Yes | Yes (not super_admin targets) | No | No | N/A (inactive admins only) |
| Reset password | Yes | No | No | No | Cannot reset own password |

---

## 5. Role-Filtered Invite Form

When the invite modal opens (`AdminAdmins.tsx:209-280`), the role dropdown is dynamically filtered based on the current admin's role:

**Source:** `AdminAdmins.tsx:251-253`:
```typescript
{ALL_ROLES
  .filter(r => currentAdmin?.role !== 'platform_admin' || r !== 'super_admin')
  .map(r => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}
```

**Filtering logic:**
- If `currentAdmin.role === 'super_admin'`: all four roles are shown (no filter applied).
- If `currentAdmin.role === 'platform_admin'`: `super_admin` is excluded from the dropdown. Available roles: `platform_admin`, `account_manager`, `support_agent`.

**Default value:** The invite form initializes with `role: 'platform_admin'` (`AdminAdmins.tsx:66`).

**Backend mirror:** `POST /api/v1/internal/admins` (`admin.ts:741-744`) rejects creation of a `super_admin` when the caller is `platform_admin` with HTTP 403: `"Forbidden: platform_admin cannot create super_admin accounts"`.

**Password validation:** The invite form enforces a minimum of 12 characters client-side (`AdminAdmins.tsx:132`), matching the backend schema requirement (`admin.ts` minLength: 12).

---

## 6. Self-Action Guards

Two self-action guards prevent admins from performing destructive actions on their own account:

### 6.1 Cannot Deactivate Self

**Source:** `AdminAdmins.tsx:116` -- `row.id === currentAdmin.id` returns `false` immediately.

**Effect:** The "Deactivate" button never renders on the current admin's own row.

**Backend mirror:** `admin.ts:848-849` returns HTTP 400: `"Cannot deactivate your own account"`.

### 6.2 Cannot Reset Own Password

**Source:** `AdminAdmins.tsx:128` -- `row.id !== currentAdmin.id` must be truthy.

**Effect:** The "Reset pwd" button never renders on the current admin's own row.

**Backend mirror:** `admin.ts:1252-1255` returns HTTP 403: `"Cannot reset your own password via this endpoint"`.

**Note:** There is no self-reactivation guard because the `canReactivate` function already requires `row.isActive === false` (`AdminAdmins.tsx:122`). An active (logged-in) admin cannot reactivate themselves because they are already active.

---

## 7. Admin Login Flow

**Source:** `AdminLogin.tsx` (131 lines)

### 7.1 Flow Sequence

1. User navigates to `/admin/login`.
2. User enters email and password.
3. Client-side validation: both fields required (`AdminLogin.tsx:23`).
4. `POST /api/v1/internal/auth/login` with `{ email, password }` as JSON (`AdminLogin.tsx:27-30`).
5. On success (`res.ok`):
   - JWT stored: `sessionStorage.setItem("aw_admin_token", data.token)` (line 37).
   - Admin identity stored: `sessionStorage.setItem("aw_admin_info", JSON.stringify(data.admin))` (line 38).
   - Redirect to `/admin` (line 39).
6. On failure (`!res.ok`): error message displayed from `data.error` (line 34).
7. On network error: generic "Network error" message (line 41).

### 7.2 Endpoint Details

- **Path:** `POST /api/v1/internal/auth/login`
- **Rate limit:** 5 requests per 15 minutes per IP (`admin.ts:39`)
- **Security:** Timing-safe password comparison, dummy hash on unknown email to prevent user enumeration
- **Response on success:** `{ token: "<JWT>", admin: { id, email, name, role } }`
- **Response on failure:** `{ error: "Invalid credentials" }` (uniform message)

### 7.3 Login Page Isolation

The admin login is entirely separate from the user authentication flow:
- Uses `fetch()` directly, not the user-facing `authApi` client.
- Does not interact with `useAuthStore` (the user auth Zustand store).
- Stores credentials in `sessionStorage` (not `localStorage`), clearing on tab close.
- The `/admin/login` route has no `AdminRoute` or `AuthRoute` wrapper (`App.tsx:117`).

---

## 8. Session Management

### 8.1 Storage Mechanism

| Key | Storage | Contents | Set By | Cleared By |
|-----|---------|----------|--------|------------|
| `aw_admin_token` | `sessionStorage` | JWT string | `AdminLogin.tsx:37` | `logout()` in each admin page, or tab close |
| `aw_admin_info` | `sessionStorage` | JSON `{ id, email, name, role }` | `AdminLogin.tsx:38` | `logout()` in each admin page, or tab close |

### 8.2 Session Lifetime

- **JWT expiry:** Default 1 hour (`config/index.ts:98`, `ADMIN_JWT_EXPIRES_IN`).
- **No refresh token:** The admin auth system does not issue or accept refresh tokens. When the JWT expires, the next API call returns 401 and the UI redirects to login.
- **Tab-scoped:** `sessionStorage` is cleared when the browser tab closes. Opening a new tab requires re-authentication.
- **Immediate revocation:** The backend checks `is_active` in the database on every request (`admin-auth.ts:94-107`). Deactivating an admin account revokes access within the current request cycle, regardless of JWT expiry time.

### 8.3 Logout Behavior

Every admin page implements a `logout()` function that:
1. Removes `aw_admin_token` from `sessionStorage`.
2. Removes `aw_admin_info` from `sessionStorage`.
3. Navigates to `/admin/login`.

**Source:** `AdminAdmins.tsx:74-78` (representative; identical pattern in all admin pages).

### 8.4 401 Auto-Logout

All `adminFetch` call sites check for `res.status === 401` and call `logout()`:
- `AdminAdmins.tsx:85` (load admins list)
- `AdminAdmins.tsx:143` (invite submit)
- `AdminAdmins.tsx:165` (deactivate/reactivate)
- `AdminAdmins.tsx:191` (reset password)

This provides passive session expiry detection -- the admin discovers their session expired on the next API interaction.

---

## 9. AdminRoute Centralized Guard

**Source:** `App.tsx:53-57`

```typescript
function AdminRoute({ children }: { children: React.ReactNode }) {
  const hasToken = !!sessionStorage.getItem("aw_admin_token");
  if (!hasToken) return <Navigate to="/admin/login" replace />;
  return <>{children}</>;
}
```

### 9.1 Behavior

- Checks for the presence (not validity) of `aw_admin_token` in `sessionStorage`.
- If absent: redirects to `/admin/login` via React Router `<Navigate>`.
- If present: renders the child component.

### 9.2 Route Coverage

| Route | Guard | Source |
|-------|-------|--------|
| `/admin/login` | None (public) | `App.tsx:117` |
| `/admin` | `AdminRoute` | `App.tsx:120` |
| `/admin/tenants/:id` | `AdminRoute` | `App.tsx:118` |
| `/admin/admins` | `AdminRoute` | `App.tsx:119` |

### 9.3 Defense-in-Depth

`AdminRoute` is the first layer of protection but NOT the only one. Each admin page also performs its own `sessionStorage` check on mount:

- `AdminAdmins.tsx:101`: `if (!sessionStorage.getItem("aw_admin_token")) { navigate("/admin/login"); return; }`

This double-check means that even if `AdminRoute` were bypassed (e.g., by a future code change removing the wrapper), the page would still redirect.

### 9.4 Limitations

- **Token presence only:** `AdminRoute` does not verify JWT validity, expiry, or signature. An expired or corrupted token in `sessionStorage` will pass the route guard. The first API call will then return 401, triggering auto-logout.
- **No role-based routing:** `AdminRoute` does not check the admin's role. All authenticated admins can navigate to all admin pages. Action restrictions are handled within each page via the gating functions (Section 3).
- **Synchronous check:** `sessionStorage.getItem()` is synchronous, so there is no render flash -- the redirect happens before the child component mounts.

---

## 10. Shared Admin API Layer

**Source:** `lib/admin-api.ts` (31 lines)

### 10.1 `adminFetch(path, options)`

```typescript
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

- Reads the JWT from `sessionStorage` on each call (lines 7-8).
- Attaches `Authorization: Bearer <token>` header (line 11).
- Sets `Content-Type: application/json` as default (line 10).
- Allows header overrides via `options.headers` spread (line 12).
- Returns the raw `Response` promise -- callers handle status codes.

### 10.2 `getAdminInfo()`

```typescript
export function getAdminInfo(): AdminInfo | null {
  try {
    return JSON.parse(sessionStorage.getItem("aw_admin_info") ?? "null");
  } catch {
    return null;
  }
}
```

- Safe JSON parse with `try/catch` and `null` fallback (lines 26-30).
- Returns typed `AdminInfo` (`{ id, email, name, role }`) or `null`.
- Used by `AdminConsole.tsx:26` for dashboard role display. `AdminAdmins.tsx` performs its own inline parse with additional type narrowing (`AdminAdmins.tsx:103-108`).

### 10.3 Centralization Status

All three admin pages import `adminFetch` from `lib/admin-api.ts`:
- `AdminConsole.tsx:26`
- `AdminTenantDetail.tsx:41`
- `AdminAdmins.tsx:33`

No page defines a local `adminFetch` function. The helper is fully centralized.

---

## 11. Frontend-Backend Gating Correspondence

A line-by-line mapping of each frontend gating rule to its backend enforcement:

| UI Gate | Frontend Location | Backend Location | Match? |
|---------|-------------------|------------------|--------|
| Invite: requires super_admin or platform_admin | `AdminAdmins.tsx:113` | `admin.ts:728-733` (`PRIVILEGED_ROLES` check) | Exact match |
| Invite: platform_admin cannot create super_admin | `AdminAdmins.tsx:252` (filter dropdown) | `admin.ts:741-744` (explicit role check) | Exact match |
| Deactivate: requires super_admin or platform_admin | `AdminAdmins.tsx:117-118` | `admin.ts:838-843` (`PRIVILEGED_ROLES` check) | Exact match |
| Deactivate: cannot target self | `AdminAdmins.tsx:116` (`row.id === currentAdmin.id`) | `admin.ts:848-849` (`targetId === request.admin.id`) | Exact match |
| Deactivate: platform_admin cannot target super_admin | `AdminAdmins.tsx:118` (`row.role !== 'super_admin'`) | `admin.ts:868-872` (explicit role check) | Exact match |
| Reactivate: requires super_admin or platform_admin | `AdminAdmins.tsx:123-124` | `admin.ts:935-940` (`PRIVILEGED_ROLES` check) | Exact match |
| Reactivate: platform_admin cannot target super_admin | `AdminAdmins.tsx:124` (`row.role !== 'super_admin'`) | `admin.ts:959-963` (explicit role check) | Exact match |
| Reset password: super_admin only | `AdminAdmins.tsx:128` (`role === 'super_admin'`) | `admin.ts:1241-1244` (`role !== "super_admin"` check) | Exact match |
| Reset password: cannot target self | `AdminAdmins.tsx:128` (`row.id !== currentAdmin.id`) | `admin.ts:1252-1255` (self-check) | Exact match |
| Invite password minimum: 12 chars | `AdminAdmins.tsx:132` (`length < 12`) | `admin.ts` schema `minLength: 12` | Exact match |

**Assessment:** All nine frontend gating rules exactly mirror their backend counterparts. No divergence found between client-side UX filtering and server-side enforcement.

---

## 12. Data Flow Summary

```
Login:
  Browser → POST /api/v1/internal/auth/login → Backend validates credentials
  Backend → { token, admin } → Browser stores in sessionStorage

Authenticated page load:
  AdminRoute checks sessionStorage['aw_admin_token'] → present → render page
  Page useEffect parses sessionStorage['aw_admin_info'] → sets currentAdmin state
  Gating functions (canInvite, canDeactivate, etc.) evaluated → buttons shown/hidden

API request:
  adminFetch() reads sessionStorage['aw_admin_token'] → attaches Bearer header
  Backend verifyInternalAdmin → JWT verify → DB is_active check → attach request.admin
  Route handler → PRIVILEGED_ROLES check → sub-role guards → execute or 403

Session end:
  Tab close → sessionStorage cleared automatically
  JWT expiry → next API call returns 401 → logout() clears storage → redirect to login
  Admin deactivated → next API call returns 401 (DB check) → logout()
```
