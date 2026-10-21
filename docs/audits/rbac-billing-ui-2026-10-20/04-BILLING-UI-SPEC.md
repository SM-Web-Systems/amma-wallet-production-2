# 04-BILLING-UI-SPEC: Billing UI Specification

**Date:** 2026-10-20
**Commit:** `a65e19c`
**Sources:** `AdminConsole.tsx`, `AdminTenantDetail.tsx`, `admin.ts` (backend routes)

---

## 1. Tenant Dashboard (List View)

**File:** `packages/web-app/src/pages/AdminConsole.tsx`
**Route:** `/admin`
**API:** `GET /api/v1/internal/tenants`

### 1.1 Summary Cards

Three summary cards in a responsive 1-column (mobile) / 3-column (sm+) grid (`AdminConsole.tsx:94-107`):

| Card | Value Source | Display |
|------|-------------|---------|
| Total tenants | `tenants.length` (`:97`) | Integer, `text-neutral-900` |
| Active tenants | `tenants.filter(t => t.isActive).length` (`:101`) | Integer, `text-emerald-600` |
| Total prepaid balance | `tenants.reduce((sum, t) => sum + parseFloat(t.prepaidXlmBalance))` (`:63`) | `toFixed(4)` XLM, color-conditional: `text-red-600` if negative, `text-violet-700` otherwise (`:105`) |

**Precision note (FIND-UI-001):** The total balance aggregation at line 63 accumulates floating-point error across tenants via `parseFloat()` summation. Acceptable for small tenant counts; drift possible at scale.

### 1.2 Tenant List

Each tenant renders as a clickable `<Link>` row navigating to `/admin/tenants/:id` (`AdminConsole.tsx:154-200`):

| Column | Source Field | Display Logic |
|--------|-------------|---------------|
| Status icon | `tenant.isActive` (`:162-164`) | Green `CheckCircle` if active, red `XCircle` if inactive |
| Name | `tenant.name` (`:170`) | Semibold, truncated |
| Slug | `tenant.slug` (`:171`) | Mono font, neutral-400 |
| Email | `tenant.contactEmail` (`:174-176`) | Shown if present, neutral-400, truncated |
| Suspension reason | `tenant.suspensionReason` (`:177-180`) | Shown only when `!isActive`, red-500, prefixed "Suspended: " |
| Balance | `tenant.prepaidXlmBalance` (`:187-196`) | `parseFloat().toFixed(4)`, color: red-600 if <0, amber-600 if <5, neutral-900 otherwise |
| Chevron | Always present (`:199`) | Right arrow, hover highlight |

### 1.3 Filtering and Search

**Not implemented.** The tenant list renders all tenants returned by the API with no client-side search input or filtering controls. The API endpoint `GET /api/v1/internal/tenants` returns the full tenant set (no query parameters for filtering in `admin.ts:207-231`).

### 1.4 Data Loading

- **Auth guard:** `sessionStorage['aw_admin_token']` check in `useEffect` (`:58-59`); redirects to `/admin/login` if absent.
- **Loading state:** Centered spinner with "Loading tenants..." text (`:146-149`).
- **Empty state:** "No tenants found." centered message (`:150-151`).
- **Error state:** Red alert banner with `AlertCircle` icon (`:138-143`).
- **Refresh button:** Manual reload via `load()` callback, disabled while loading, spinner animation on icon (`:127-135`).
- **401 handling:** Automatic logout and redirect to `/admin/login` (`:48`).

### 1.5 API Endpoint Mapping

| Action | Method | Endpoint | Auth | Role |
|--------|--------|----------|------|------|
| Load tenant list | GET | `/api/v1/internal/tenants` | Bearer JWT (`adminFetch`) | Any admin role |

---

## 2. Tenant Billing Detail

**File:** `packages/web-app/src/pages/AdminTenantDetail.tsx`
**Route:** `/admin/tenants/:id`
**API:** `GET /api/v1/internal/tenants/:id/billing`

### 2.1 Balance Display

**Location:** `AdminTenantDetail.tsx:463-475`

The balance card displays the tenant's `prepaid_xlm_balance` as a large numeral:

```
balance = parseFloat(data.balance)    // :236
balance.toFixed(4)                    // :472
```

**Color thresholds** (`:469-471`):
- `balance < 0` -- `text-red-600` (deficit)
- `balance < 5` -- `text-amber-600` (low balance warning)
- `balance >= 5` -- `text-violet-700` (healthy)

The balance card uses `tabular-nums` CSS (`font-variant-numeric: tabular-nums`) for monospaced digit alignment (`:469`). The unit label "XLM" is rendered as a separate sub-line in `text-xs text-neutral-400` (`:474`).

### 2.2 Status Indicators

**Location:** `AdminTenantDetail.tsx:478-518`

Three-state display derived from two fields (`isActive` and `suspendedAt`):

| UI Label | Condition | Icon | Color |
|----------|-----------|------|-------|
| "Active" | `isActive && !suspendedAt` (`:481`) | Green `CheckCircle` | `text-emerald-700` |
| "Soft-suspended" | `isActive && suspendedAt` (`:485`) | Red `XCircle` | `text-red-600` |
| "Suspended" (hard) | `!isActive` (`:485`) | Red `XCircle` | `text-red-600` |

The status logic at line 485 uses a ternary chain:
```typescript
data.isActive && !data.suspendedAt ? "Active" : data.isActive ? "Soft-suspended" : "Suspended"
```

When `suspensionReason` is present, it is displayed as a truncated `text-xs text-red-500` line with a `title` attribute for the full text (`:488-490`).

### 2.3 Data Model

The `TenantBilling` interface (`AdminTenantDetail.tsx:25-39`) maps to the backend response:

| Field | Type | Backend Source |
|-------|------|----------------|
| `tenantId` | `number` | `tenants.id` |
| `tenantName` | `string \| null` | `tenants.name` |
| `tenantSlug` | `string` | `tenants.slug` |
| `balance` | `string` | `tenants.prepaid_xlm_balance` (decimal string) |
| `isActive` | `boolean` | `tenants.is_active` |
| `suspendedAt` | `string \| null` | `tenants.suspended_at` (ISO datetime) |
| `suspensionReason` | `string \| null` | `tenants.suspension_reason` |
| `debtLimit` | `string \| null` | `tenant_billing_policy.acquisition_debt_limit_xlm` |
| `acquisitionModeEnabled` | `boolean \| null` | `tenant_billing_policy.acquisition_mode_enabled` |
| `gracePeriodDays` | `number \| null` | `tenant_billing_policy.grace_period_days` |
| `recentEvents` | `BillingEvent[]` | 20 most recent `billing_events` rows |
| `eventsHasMore` | `boolean` | Whether more events exist beyond the initial 20 |
| `eventsNextCursor` | `number \| null` | `id` of the oldest returned event (for pagination) |

### 2.4 API Endpoint Mapping

| Action | Method | Endpoint | Auth | Role |
|--------|--------|----------|------|------|
| Load billing detail | GET | `/api/v1/internal/tenants/:id/billing` | Bearer JWT | Any admin role |

---

## 3. Billing Policy Display (Read-Only)

**Location:** `AdminTenantDetail.tsx:522-538`

The policy card renders three fields from the current `tenant_billing_policy` row as a read-only summary:

| Display Label | Source Field | Formatting |
|---------------|-------------|------------|
| Debt limit | `data.debtLimit` (`:527`) | `"{value} XLM"` or em-dash if null |
| Acquisition mode | `data.acquisitionModeEnabled` (`:531`) | `"On"` / `"Off"` |
| Grace period | `data.gracePeriodDays` (`:535`) | `"{value}d"` or em-dash if null |

**No edit UI exists.** The backend supports `PATCH /api/v1/internal/tenants/:id/billing-policy` (`admin.ts:1070-1201`) with full field editing restricted to PRIVILEGED_ROLES (super_admin, platform_admin), but the frontend has no form or controls to invoke it. This is documented as FIND-UI-008 in the integration matrix.

---

## 4. Credit Posting Form

**Location:** `AdminTenantDetail.tsx:633-698` (form), `:69-76` (state), `:142-178` (handlers)
**API:** `POST /api/v1/internal/tenants/:id/credit`

### 4.1 Form Fields

| Field | Element | State Variable | Validation |
|-------|---------|---------------|------------|
| Type | `<select>` (`:643-650`) | `creditType` (`:70`) | TypeScript union: `"manual_topup" \| "bundle_purchase"` |
| Amount (XLM) | `<input type="number">` (`:653-661`) | `creditAmount` (`:71`) | `min="0.0001"`, `step="0.01"`, `parseFloat > 0` client-side (`:143-145`) |
| Notes | `<input type="text">` (`:665-670`) | `creditNotes` (`:72`) | Optional; sent as `undefined` when empty (`:166`) |

**Available credit types in the UI** (`:648-649`):
1. `manual_topup` -- "Manual top-up"
2. `bundle_purchase` -- "Bundle purchase"

**Backend-accepted types** (`admin.ts:396`): `enum: ["manual_topup", "bundle_purchase"]` -- matches the UI exactly.

**Note on type coverage:** The backend `billing_events` schema defines 9 event types (see `03-BILLING-SPEC` Section 2.2), but only `manual_topup` and `bundle_purchase` are exposed through the credit posting form and API. Other credit types (`manual_adjustment`, `unallocated_deposit_allocated`, `stellar_tx_refund`) have no admin UI path. The `refund` and `wallet_funding` labels exist in the `eventTypeLabel` display map (`:44-52`) for rendering historical events, but are not selectable for new credits.

### 4.2 Amount Validation

**Client-side** (`AdminTenantDetail.tsx:143-148`):
```typescript
const amount = parseFloat(creditAmount);
if (!creditAmount || isNaN(amount) || amount <= 0) {
  setCreditError("Amount must be a positive number.");
  return;
}
```

**Backend route schema** (`admin.ts:397`):
```json
{ "type": "number", "exclusiveMinimum": 0, "maximum": 100000 }
```

**Backend service** (`billing.service.ts:531-534`): `toStroops(amountXlm)` must be `> 0n`.

**Gap:** The frontend has no upper-bound validation. The HTML input has no `max` attribute. Amounts above 100,000 XLM will be accepted by the UI but rejected by the backend with a 400 error. The effective range is `(0, 100000]` XLM, enforced only at the backend.

### 4.3 Confirmation Dialog (FIND-UI-003 Fix)

**Location:** `AdminTenantDetail.tsx:347-407`

The credit posting flow uses a two-step confirmation pattern:

1. **Step 1 -- Validate:** `handleCreditClick()` (`:142-149`) validates the amount, then opens the confirmation modal by setting `creditConfirmOpen = true`.
2. **Step 2 -- Confirm:** The modal displays a summary of the pending credit:
   - Amount formatted as `parseFloat(creditAmount).toFixed(4)` XLM (`:377`)
   - Credit type label: "manual top-up" or "bundle purchase" (`:378`)
   - Tenant name (`:379`)
   - Notes if provided (`:381-383`)
   - Irreversibility warning in amber alert box (`:384-386`)
3. **Step 3 -- Submit:** The "Post credit" button calls `handlePostCredit()` (`:153-178`) which:
   - Closes the confirmation modal immediately (`:154`)
   - Re-validates the amount (`:155-158`) -- defense-in-depth
   - Sets `creditSubmitting = true` (`:159`)
   - POSTs to the API (`:163-167`)
   - On success: displays result message, clears form, calls `load()` to refresh (`:171-174`)

**Modal dismissal:** Escape key (`:354`), backdrop click (`:358`), Cancel button (`:390`), and X button (`:367`).

**Accessibility:** `role="dialog"`, `aria-modal="true"`, `aria-labelledby="credit-confirm-title"` (`:349-351`).

### 4.4 Submit-During-Loading Protection

The "Post credit" button is disabled when either `creditSubmitting` is true OR `creditAmount` is empty (`AdminTenantDetail.tsx:691`):

```typescript
disabled={creditSubmitting || !creditAmount}
```

During submission, the button text changes to "Posting..." with a spinning `Loader2` icon (`:693-694`). This prevents double-clicks and rapid resubmission.

**Limitation:** There is no idempotency key sent with the POST request. If the user refreshes the page during a slow request, a duplicate credit could be posted. The backend (`admin.ts:423-519`) has no deduplication guard for credit operations. See FIND-UI-004.

### 4.5 Success/Error Feedback

- **Success message** (`:682-685`): Green text with `CheckCircle` icon, format: `+{amount} XLM posted. New balance: {balance} XLM`. Auto-clears after 8 seconds via `useEffect` timer (`:131-138`).
- **Error message** (`:676-679`): Red text with `AlertCircle` icon. Displays backend error or "Network error" fallback. Persists until next action.

### 4.6 API Endpoint Mapping

| Action | Method | Endpoint | Auth | Role | Request Body |
|--------|--------|----------|------|------|-------------|
| Post credit | POST | `/api/v1/internal/tenants/:id/credit` | Bearer JWT | super_admin, platform_admin | `{ type, amount_xlm, notes? }` |

**Response (200):** `{ tenantId, billingEventId, bundlePurchaseId, newBalance, amountCredited, eventType }`

---

## 5. Suspend / Unsuspend

**Location:** `AdminTenantDetail.tsx:206-233` (handlers), `:240-344` (modal), `:496-518` (trigger buttons)
**API:** `PATCH /api/v1/internal/tenants/:id/suspend`, `PATCH /api/v1/internal/tenants/:id/unsuspend`

### 5.1 Trigger Buttons

Displayed in the status card (`AdminTenantDetail.tsx:496-518`):

- **When not suspended** (`!data.suspendedAt`, `:497`): Red "Suspend" button with `Ban` icon. Calls `handleSuspend()` which opens the modal defaulting to hard suspend (`:207`).
- **When suspended** (`data.suspendedAt`, `:507`): Green "Unsuspend" button with `RotateCcw` icon. Calls `handleUnsuspend()` which opens the modal for unsuspend confirmation (`:208`).

Both buttons are disabled while `suspendBusy` is true (`:501, 511`), with text changing to "Suspending..." / "Unsuspending..." respectively.

### 5.2 Suspend Type Selection

The suspend confirmation modal includes a radio group (`AdminTenantDetail.tsx:271-309`, `role="radiogroup"`) with two options:

| Type | Default | `isActive` Effect | Description in UI |
|------|---------|-------------------|-------------------|
| **Hard suspend** | Selected by default (`:207`) | Sets `false` | "Deactivates the account. Blocks wallets, transfers, and API access immediately." (`:288`) |
| **Soft suspend** | Must be selected | Stays `true` | "Blocks new activations and onboardings only. Existing wallets and SSO reads stay live." (`:305`) |

Radio selection updates the modal state via `setSuspendType()` (`:209-210`). Visual feedback: selected hard = red border/background, selected soft = amber border/background (`:273-277, :295-299`).

### 5.3 Confirmation Modals

**Suspend modal** (`:240-344`):
- Title dynamically reflects selected type: "Hard suspend tenant?" or "Soft suspend tenant?" (`:258`)
- Detailed description of consequences (`:312-315`)
- Confirm button color matches type: red for hard, amber for soft (`:330-333`)
- Confirm button text: "Hard suspend tenant" or "Soft suspend tenant" (`:337-338`)

**Unsuspend modal** (same component, `:240-344`):
- Title: "Unsuspend tenant?" (`:259`)
- Description: "Full wallet and API access will be restored immediately." (`:316`)
- Confirm button: green, "Unsuspend tenant" (`:334, 339`)

**Modal dismissal:** Escape key (`:247`), backdrop click (`:252`), Cancel button (`:320`), X button (`:262`).

### 5.4 Submit Flow

`submitStatusAction()` (`AdminTenantDetail.tsx:212-233`):

1. Captures `suspendType` from modal state before clearing it (`:214`) -- this prevents a bug where modal state is nulled before the type is read.
2. Closes modal (`:215`).
3. Sets `suspendBusy = true` (`:216`).
4. For suspend: `PATCH /api/v1/internal/tenants/:id/suspend` with `{ type: suspendType }` (`:219-222`).
5. For unsuspend: `PATCH /api/v1/internal/tenants/:id/unsuspend` with no body (`:223`).
6. On success: calls `load()` to auto-refresh the billing detail (`:227`).
7. On error: displays error in the status card via `suspendError` (`:226, 492-494`).

### 5.5 Backend Contract

**Suspend** (`admin.ts:533-618`):
- Body: `{ type: "soft" | "hard" }` (required, `:549-555`)
- Sets `suspension_reason = "manual"` always (`:596`)
- Hard suspend: `is_active = false` (`:594`)
- Soft suspend: `is_active` stays `true` (`:594`)
- Creates audit log entry `admin_suspend` (`:610`)

**Unsuspend** (`admin.ts:997-1067`):
- No request body (`:1012`)
- Sets `is_active = true`, `suspended_at = NULL`, `suspension_reason = NULL` (`:1045`)
- Idempotent: safe to call on already-active tenant
- Creates audit log entry `admin_unsuspend` (`:1058`)

### 5.6 API Endpoint Mapping

| Action | Method | Endpoint | Auth | Role | Request Body |
|--------|--------|----------|------|------|-------------|
| Suspend | PATCH | `/api/v1/internal/tenants/:id/suspend` | Bearer JWT | super_admin, platform_admin | `{ type: "soft" \| "hard" }` |
| Unsuspend | PATCH | `/api/v1/internal/tenants/:id/unsuspend` | Bearer JWT | super_admin, platform_admin | (none) |

---

## 6. Billing Event History

**Location:** `AdminTenantDetail.tsx:541-631` (event list), `:14-23` (BillingEvent interface), `:43-53` (display helpers)
**API:** `GET /api/v1/internal/tenants/:id/billing` (initial load), `GET /api/v1/internal/tenants/:id/events?beforeId=N` (pagination)

### 6.1 Event List Display

Each event renders as a row in a divided list (`AdminTenantDetail.tsx:562-606`):

| Column | Source | Display Logic |
|--------|--------|---------------|
| Direction icon | `parseFloat(event.amountXlm) > 0` (`:563`) | Green `TrendingUp` on emerald-50 circle for credits; red `TrendingDown` on red-50 circle for debits |
| Event type | `event.eventType` (`:576`) | Via `eventTypeLabel()` lookup (`:43-53`), capitalized |
| Timestamp | `event.createdAt` (`:579`) | `new Date().toLocaleString()`, `tabular-nums` |
| Billing period | `event.billingPeriod` (`:581-584`) | Shown in a neutral-100 pill badge if present |
| User | `event.userId` (`:586-588`) | "user #N" if present |
| Notes | `event.notes` (`:591-596`) | Truncated with `title` for hover, shown if present |
| Amount | `event.amountXlm` (`:601-603`) | `parseFloat().toFixed(4) + " XLM"`, with `+` prefix for positive values. Color via `amountColor()`: emerald-600 for positive, red-600 for negative, neutral-500 for zero (`:55-60`) |

**Event type label mapping** (`AdminTenantDetail.tsx:44-52`):

| `eventType` value | Display label |
|-------------------|---------------|
| `new_wallet_activation` | "Wallet activation" |
| `monthly_maintenance` | "Monthly maintenance" |
| `manual_topup` | "Manual top-up" |
| `bundle_purchase` | "Bundle purchase" |
| `wallet_funding` | "Wallet funding" |
| `refund` | "Refund" |
| (any other) | Underscores replaced with spaces (`:52`) |

### 6.2 Cursor-Based Pagination

**State management** (`AdminTenantDetail.tsx:83-87`):
- `allEvents`: accumulated event array, initialized from `data.recentEvents` on full reload (`:114`)
- `eventsHasMore`: boolean flag from API response
- `eventsNextCursor`: `id` of the oldest event in the current set
- `loadingOlder`: loading state for pagination requests
- `olderError`: error state for pagination requests

**Initial load:** The billing detail endpoint returns up to 20 events plus `eventsHasMore` and `eventsNextCursor` fields (`admin.ts:265-281`).

**Pagination flow** (`loadOlderEvents()`, `:183-204`):

1. Guard: returns immediately if no `eventsNextCursor` or already loading (`:184`)
2. Calls `GET /api/v1/internal/tenants/:id/events?beforeId=${eventsNextCursor}` (`:188`)
3. Appends returned `page.events` to `allEvents` (`:196`)
4. Updates `eventsHasMore` and `eventsNextCursor` from response (`:197-198`)

**UI control** (`:609-630`): A "Load older" button appears when `eventsHasMore` is true. Shows a spinner while loading. Error messages are displayed above the button in an amber alert box.

**Header count** (`:544-546`): Displays "Recent billing events (N)" where N = `allEvents.length`, with a trailing "+" when `eventsHasMore` is true.

### 6.3 API Endpoint Mapping

| Action | Method | Endpoint | Auth | Role | Parameters |
|--------|--------|----------|------|------|-----------|
| Initial events | GET | `/api/v1/internal/tenants/:id/billing` | Bearer JWT | Any admin | (none; returns 20 most recent) |
| Paginate older | GET | `/api/v1/internal/tenants/:id/events` | Bearer JWT | Any admin | `?beforeId=N` (required, `^[0-9]+$`) |

**Pagination response schema** (`admin.ts:330-355`):
```json
{ "events": [...], "hasMore": boolean, "nextCursor": number|null }
```

Page size is 20 events per request (`admin.ts:308`).

---

## 7. XLM Amount Display Pattern

All XLM amounts in the billing UI use the same display pattern:

```typescript
parseFloat(stringValue).toFixed(4)
```

### 7.1 Occurrences

| Location | Context | Code Reference |
|----------|---------|---------------|
| `AdminConsole.tsx:63` | Total balance aggregation | `parseFloat(t.prepaidXlmBalance \|\| "0")` |
| `AdminConsole.tsx:105` | Total balance display | `totalBalance.toFixed(4)` |
| `AdminConsole.tsx:194` | Per-tenant balance in list | `parseFloat(tenant.prepaidXlmBalance).toFixed(4)` |
| `AdminTenantDetail.tsx:236` | Balance card value | `parseFloat(data.balance)` |
| `AdminTenantDetail.tsx:472` | Balance card display | `balance.toFixed(4)` |
| `AdminTenantDetail.tsx:171` | Credit success message | `parseFloat(d.amountCredited).toFixed(4)` and `parseFloat(d.newBalance).toFixed(4)` |
| `AdminTenantDetail.tsx:377` | Credit confirmation dialog | `parseFloat(creditAmount).toFixed(4)` |
| `AdminTenantDetail.tsx:563,603` | Event amount display | `parseFloat(event.amountXlm)` then `.toFixed(4)` |

### 7.2 Styling

Amounts consistently use `tabular-nums` CSS class for monospaced digit alignment:
- Balance card: `AdminTenantDetail.tsx:469`
- Per-tenant balance in list: `AdminConsole.tsx:187`
- Event timestamps: `AdminTenantDetail.tsx:579`
- Event amounts: `AdminTenantDetail.tsx:601`

### 7.3 Precision Context

The backend stores balances as `NUMERIC(18,7)` (7 decimal places) and transmits them as decimal strings (e.g. `"3.0000000"`). The UI truncates display to 4 decimal places via `toFixed(4)`. This is display-only formatting -- the full-precision string is used for all API interactions. The backend performs all financial arithmetic using BigInt stroop arithmetic, never `parseFloat` (see `03-BILLING-SPEC` Section 1).

---

## 8. Error Handling for Billing Operations

### 8.1 Error Handling Matrix

| Operation | Network Error | HTTP 401 | HTTP 400/403/404 | Success |
|-----------|--------------|----------|-------------------|---------|
| Load billing detail | "Network error -- could not load billing data." (`:119`) | Logout + redirect (`:105`) | `d.error ?? "Server error {status}"` (`:108`) | Render data |
| Post credit | "Network error -- could not post credit." (`:176`) | Logout + redirect (`:168`) | `d.error ?? "Error {status}"` (`:170`) | Success message + auto-refresh |
| Suspend/Unsuspend | "Network error -- could not {action} tenant." (`:230`) | Logout + redirect (`:224`) | `d.error ?? "Error {status}"` (`:226`) | Auto-refresh via `load()` |
| Load older events | "Network error -- could not load older events." (`:200`) | Logout + redirect (`:189`) | `d.error ?? "Error {status}"` (`:192`) | Append events |

### 8.2 Error Display Patterns

- **Page-level errors** (`AdminTenantDetail.tsx:447-452`): Red-bordered alert box with `AlertCircle` icon, displayed between breadcrumb and content area.
- **Credit errors** (`:676-679`): Inline red text below the credit form with `AlertCircle` icon.
- **Suspend errors** (`:492-494`): Inline red text in the status card.
- **Pagination errors** (`:612-615`): Amber alert box above the "Load older" button.

### 8.3 401 Session Expiry Pattern

All API calls follow the same 401 handling pattern:
```typescript
if (res.status === 401) { logout(); return; }
```

Where `logout()` (`AdminTenantDetail.tsx:93-97`):
1. Removes `aw_admin_token` from sessionStorage
2. Removes `aw_admin_info` from sessionStorage
3. Navigates to `/admin/login`

There is no proactive session expiry check -- the admin discovers expiry only when an API call fails.

### 8.4 JSON Parse Safety

The billing detail load uses `.json().catch(() => ({}))` for error responses (`AdminTenantDetail.tsx:107`), preventing crashes from non-JSON error bodies. The credit and suspend handlers also follow this pattern.

---

## 9. Known Limitations

### 9.1 No Billing Policy Edit UI (FIND-UI-008)

The backend supports full billing policy editing via `PATCH /api/v1/internal/tenants/:id/billing-policy` (`admin.ts:1070-1201`) restricted to PRIVILEGED_ROLES. The frontend displays policy values as read-only text (`AdminTenantDetail.tsx:522-538`). Admins must use direct API calls (e.g. `curl`) to modify billing policies.

### 9.2 No Idempotency Key for Credits (FIND-UI-004)

The credit POST request (`AdminTenantDetail.tsx:163-167`) sends no client-generated idempotency key. The backend credit endpoint (`admin.ts:423-519`) has no deduplication mechanism. If a network timeout occurs after the server processes the request but before the client receives the response, the user may retry and create a duplicate credit. The `creditSubmitting` flag (`:691`) prevents rapid double-clicks but does not protect against page refresh or retry scenarios.

### 9.3 Credit Type Coverage Gap

The UI credit form exposes only 2 of the 5 credit event types defined in the billing schema:
- **Exposed:** `manual_topup`, `bundle_purchase`
- **Not exposed:** `manual_adjustment`, `unallocated_deposit_allocated`, `stellar_tx_refund`

The `refund` and `wallet_funding` entries in the `eventTypeLabel` map (`:44-52`) are display-only labels for rendering historical events in the event list.

### 9.4 No Client-Side Amount Upper Bound

The HTML `<input type="number">` at `:653` has `min="0.0001"` and `step="0.01"` but no `max` attribute. The backend enforces `maximum: 100000` at the Fastify schema level (`admin.ts:397`). Users entering amounts above 100,000 XLM will see a backend 400 error rather than a client-side validation message.

### 9.5 Float-Based Balance Aggregation (FIND-UI-001)

The tenant dashboard total balance (`AdminConsole.tsx:63`) uses `parseFloat` summation across all tenants. For typical deployments with small tenant counts, this is functionally correct. At scale (hundreds of tenants with large balances), floating-point accumulation error could produce a visibly incorrect total.

### 9.6 No Automated Test Coverage

No automated tests (unit, component, integration, or E2E) exist for any billing UI feature. The web-app `package.json` has no `test` script. All billing UI features have a verification status of BUILT/UNVERIFIED.

### 9.7 No Tenant Search or Filtering

The tenant dashboard has no search input, status filter, or balance range filter. All tenants are displayed in a single list with no pagination. For deployments with many tenants, this may become a usability issue.
