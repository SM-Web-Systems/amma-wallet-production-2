# UI-GAP-PLAN: Detailed Specifications for Deferred UI Features

**Date:** 2026-10-20
**Branch:** `worktree-rbac-billing-audit-2026-10-20`
**Upstream reference:** `14-REMAINING-UI-GAPS.md`
**Status:** SPECIFICATION COMPLETE -- Implementation deferred

---

## Table of Contents

- [UI-300: Billing Policy Editing](#ui-300-billing-policy-editing)
- [UI-301: String-Based Financial Amount Handling](#ui-301-string-based-financial-amount-handling)
- [UI-302: Audit Log Viewer](#ui-302-audit-log-viewer)

---

## UI-300: Billing Policy Editing

### Current Backend Support

**Endpoint:** `PATCH /api/v1/internal/tenants/:id/billing-policy`

The route is fully implemented in `packages/backend/src/routes/admin.ts` (line ~1094).
It accepts 9 optional body fields with `minProperties: 1` and `additionalProperties: false`.
Only fields included in the request body are written to the database (sparse update pattern).
Numeric XLM fields are converted to strings via `.toString()` before storage.

The current policy row is fetched via `WHERE tenant_id = :id AND is_current = true`.

An audit log entry (`admin_billing_policy`) is written on every successful mutation, recording the admin ID, tenant ID, and list of changed field names.

**Existing data endpoint:** `GET /api/v1/internal/tenants/:id/billing` returns `debtLimit`, `acquisitionModeEnabled`, and `gracePeriodDays` in the billing summary. However, it does not return all 9 policy fields. A new `GET /api/v1/internal/tenants/:id/billing-policy` endpoint (or extension of the existing billing summary) may be required to populate the edit form with current values for all fields.

**Backend tests:** `packages/backend/src/routes/admin-policy.test.ts` covers 403/400/404/200 cases.

### Required UI Components

1. **BillingPolicyEditModal** -- Modal dialog rendered from `AdminTenantDetail.tsx`
   - Triggered by an "Edit Policy" button in the existing read-only Policy card (line ~532 of `AdminTenantDetail.tsx`)
   - Renders a form with all 9 editable fields grouped into logical sections
   - Tracks dirty state per field; only sends changed fields in the PATCH body

2. **BillingPolicyConfirmDialog** -- Nested confirmation step inside the modal
   - Lists every field being changed with before/after values
   - Warning banner: "Policy changes affect billing for all users of this tenant."
   - Requires explicit "Confirm changes" click before submission

3. **Field grouping in the form:**

   | Section | Fields | Input type |
   |---------|--------|------------|
   | Acquisition | `acquisitionModeEnabled`, `acquisitionDebtLimitXlm` | Toggle, Number (max 0) |
   | Wallet Funding | `walletFundingEnabled`, `walletFundingMode` | Toggle, Select (auto/manual/batch) |
   | Monthly Maintenance | `monthlyMaintenanceEnabled`, `monthlyFeePerActiveUser`, `activityWindowDays` | Toggle, Number (min 0), Integer (min 1) |
   | Onboarding | `onboardingFeeXlm` | Number (min 0) |
   | Grace Period | `gracePeriodDays` | Integer (min 1) |

### Authorization Requirements

- **Roles:** `super_admin` and `platform_admin` only
- **Enforcement point (backend):** `PRIVILEGED_ROLES` guard at handler entry (already implemented)
- **Enforcement point (frontend):** The "Edit Policy" button must be conditionally rendered. The admin role is available from `sessionStorage['aw_admin_info']`. If the role is `account_manager` or `support_agent`, the button must not appear.
- **Backend returns 403** if a non-privileged role calls the endpoint; the UI must handle this gracefully.

### API Contract

**Request:**

```
PATCH /api/v1/internal/tenants/:id/billing-policy
Authorization: Bearer <admin_jwt>
Content-Type: application/json

{
  "gracePeriodDays": 14,              // integer, min 1 (optional)
  "acquisitionModeEnabled": false,    // boolean (optional)
  "acquisitionDebtLimitXlm": -500,    // number, max 0 (optional)
  "monthlyMaintenanceEnabled": true,  // boolean (optional)
  "monthlyFeePerActiveUser": 0.15,    // number, min 0 (optional)
  "activityWindowDays": 60,           // integer, min 1 (optional)
  "onboardingFeeXlm": 1.5,           // number, min 0 (optional)
  "walletFundingEnabled": true,       // boolean (optional)
  "walletFundingMode": "manual"       // string, enum: "auto"|"manual"|"batch" (optional)
}
```

At least one field must be present (`minProperties: 1`).

**Success Response (200):**

```json
{
  "policyId": 1,
  "tenantId": 2,
  "gracePeriodDays": 14,
  "acquisitionModeEnabled": false,
  "acquisitionDebtLimitXlm": "-500.0000000",
  "monthlyMaintenanceEnabled": true,
  "monthlyFeePerActiveUser": "0.1500",
  "activityWindowDays": 60,
  "onboardingFeeXlm": "1.5000",
  "walletFundingEnabled": true,
  "walletFundingMode": "manual"
}
```

Note: XLM amount fields are returned as strings (decimal representation).

**Error Responses:**

| Status | Body | Condition |
|--------|------|-----------|
| 400 | `{ "error": "Invalid tenant ID" }` | Non-numeric or non-positive `:id` |
| 400 | `{ "error": "No updatable fields provided" }` | Empty body (belt-and-suspenders; schema also rejects) |
| 400 | Fastify validation error | Field type/range violations |
| 401 | `{ "error": "..." }` | Missing or invalid JWT |
| 403 | `{ "error": "Forbidden: requires super_admin or platform_admin role" }` | Insufficient role |
| 404 | `{ "error": "Tenant billing policy not found" }` | No `is_current = true` row for tenant |

### Validation Rules

**Frontend (pre-submission):**

| Field | Rule | Error message |
|-------|------|---------------|
| `gracePeriodDays` | Integer >= 1 | "Grace period must be at least 1 day" |
| `acquisitionDebtLimitXlm` | Number <= 0 | "Debt limit must be zero or negative" |
| `monthlyFeePerActiveUser` | Number >= 0 | "Monthly fee cannot be negative" |
| `activityWindowDays` | Integer >= 1 | "Activity window must be at least 1 day" |
| `onboardingFeeXlm` | Number >= 0 | "Onboarding fee cannot be negative" |
| `walletFundingMode` | One of: auto, manual, batch | "Invalid funding mode" |
| Overall | At least one field changed | "No changes to save" (disable submit button) |

**Backend (Fastify schema):**

The backend enforces the same constraints via JSON Schema (`minimum`, `maximum`, `enum`) before the handler runs. Frontend validation is purely for UX responsiveness.

### Error Handling

1. **Network failure:** Display inline error "Network error -- could not update policy." below the form. Allow retry.
2. **401 Unauthorized:** Redirect to `/admin/login` (same pattern as existing `AdminTenantDetail` handlers).
3. **403 Forbidden:** Display "You do not have permission to edit billing policy." This should not occur if the button is properly hidden, but serves as defense-in-depth.
4. **404 Not Found:** Display "Billing policy not found for this tenant. It may not have been initialized." Close the modal.
5. **400 Validation:** Display the `error` string from the response body as an inline form error.
6. **Success:** Close the modal, show a toast/inline success message "Policy updated successfully", and call `load()` to refresh the billing summary.

### Acceptance Criteria

1. An "Edit Policy" button appears in the Policy card on `AdminTenantDetail` for `super_admin` and `platform_admin` roles only.
2. The "Edit Policy" button does not appear for `account_manager` or `support_agent` roles.
3. Clicking "Edit Policy" opens a modal pre-populated with the tenant's current policy values.
4. The form displays all 9 policy fields grouped into logical sections with appropriate input types.
5. Boolean fields use toggle switches; numeric fields use number inputs with appropriate step/min/max; `walletFundingMode` uses a select dropdown.
6. The form tracks dirty state: only changed fields are included in the PATCH request body.
7. The "Save" button is disabled when no fields have been changed.
8. Clicking "Save" opens a confirmation dialog listing each changed field with its old and new value.
9. The confirmation dialog includes a warning: "Policy changes affect billing for all users of this tenant."
10. Upon confirming, only changed fields are sent in the PATCH request.
11. On success, the modal closes, a success message is displayed, and the billing summary reloads.
12. On error, an appropriate error message is displayed inline without closing the modal.
13. The modal is dismissible via Escape key and clicking the backdrop overlay.
14. All form inputs are accessible (labeled, keyboard-navigable, ARIA attributes).

### Regression Test Requirements

1. **Unit tests (Vitest, JSDOM):**
   - Modal opens and closes correctly
   - Form renders all 9 fields with correct initial values
   - Dirty tracking: unchanged fields are not sent in PATCH body
   - Confirmation dialog shows correct before/after values
   - "Save" button disabled when no fields are dirty
   - Role-based visibility: button hidden for non-privileged roles
   - Error states render correct messages for 400, 403, 404, network error

2. **Existing backend tests to preserve:**
   - All tests in `packages/backend/src/routes/admin-policy.test.ts` must continue to pass
   - All tests in `packages/backend/src/routes/admin-audit.test.ts` must continue to pass (audit log integration)

3. **Integration tests (if applicable):**
   - Full round-trip: open modal, change one field, confirm, verify PATCH was sent with correct body, verify UI refreshes

---

## UI-301: String-Based Financial Amount Handling

### Current Backend Support

**Endpoint:** `POST /api/v1/internal/tenants/:id/credit`

The route is implemented in `packages/backend/src/routes/admin.ts` (line ~377).
The body schema currently defines `amount_xlm` as:

```json
{ "type": "number", "exclusiveMinimum": 0, "maximum": 100000 }
```

The handler passes the received number directly to `postTenantCredit()` in `packages/backend/src/services/billing.service.ts`, which calls `toStroops()` for exact bigint conversion.

**Frontend current behavior (line ~170 of AdminTenantDetail.tsx):**

```typescript
amount_xlm: parseFloat(creditAmount),  // sends a JSON number
```

The `creditAmount` state variable holds the raw string from the input field.

**`toStroops()` implementation** (`packages/backend/src/services/billing.service.ts`, line ~33):

```typescript
function toStroops(s: string): bigint {
  const neg = s.startsWith("-");
  const abs = neg ? s.slice(1) : s;
  const [whole = "0", frac = ""] = abs.split(".");
  const paddedFrac = frac.padEnd(STELLAR_DECIMALS, "0").slice(0, STELLAR_DECIMALS);
  const stroops = BigInt(whole) * SCALE + BigInt(paddedFrac);
  return neg ? -stroops : stroops;
}
```

The function accepts strings natively. When it currently receives a number from the request body, JavaScript coerces it to string at the call site (the service layer calls `.toString()` or the number is coerced in string context).

### Required Changes

**Frontend change (single line):**

```typescript
// Before
amount_xlm: parseFloat(creditAmount),
// After
amount_xlm: creditAmount,
```

**Backend schema change:**

The Fastify body schema for `amount_xlm` must accept strings:

```json
{
  "amount_xlm": {
    "oneOf": [
      { "type": "number", "exclusiveMinimum": 0, "maximum": 100000 },
      { "type": "string", "pattern": "^(0|[1-9][0-9]{0,5})(\\.[0-9]{1,7})?$" }
    ]
  }
}
```

Alternatively, change to `{ "type": "string", "pattern": "..." }` only, but `oneOf` preserves backward compatibility with any existing API consumers.

**Backend handler change:**

The handler must ensure the value passed to `postTenantCredit()` is always a string. If `oneOf` is used:

```typescript
const amountStr = typeof body.amount_xlm === "number"
  ? body.amount_xlm.toString()
  : body.amount_xlm;
```

### Authorization Requirements

No change. Same `super_admin` / `platform_admin` guard already in place.

### API Contract

**Request (proposed):**

```
POST /api/v1/internal/tenants/:id/credit
Authorization: Bearer <admin_jwt>
Content-Type: application/json

{
  "type": "manual_topup",
  "amount_xlm": "50.0001",
  "notes": "Monthly top-up",
  "idempotency_key": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Response:** Unchanged from current implementation.

```json
{
  "tenantId": 2,
  "billingEventId": 42,
  "bundlePurchaseId": null,
  "newBalance": "350.0001000",
  "amountCredited": "50.0001000",
  "eventType": "manual_topup",
  "duplicate": false
}
```

### Validation Rules

**Frontend:**
- `creditAmount` must match `/^(0|[1-9]\d{0,5})(\.\d{1,7})?$/` (positive, max 6 integer digits, max 7 decimal places)
- Must not be empty, "0", or negative
- Existing `parseFloat` validation for the "is it a valid number?" check should be retained as a pre-check; the string is sent as-is

**Backend:**
- If `type: "string"`: regex pattern `^(0|[1-9][0-9]{0,5})(\.[0-9]{1,7})?$`
- `toStroops()` will throw on malformed input (non-numeric characters), which must be caught and returned as 400
- Maximum logical value: 100,000 XLM (enforced by regex digit count and/or explicit check)

### Error Handling

No change to error handling patterns. The same 400/401/403 error responses apply.

If a string fails `toStroops()` parsing (should not happen if the regex is correct), the service layer throws and the handler returns:

```json
{ "error": "Invalid amount format" }
```

### Acceptance Criteria

1. The credit form sends `amount_xlm` as a JSON string (not a JSON number) in the request body.
2. The backend accepts both string and number types for `amount_xlm` (backward compatibility via `oneOf`).
3. The `toStroops()` function receives a string and produces the correct bigint stroop value.
4. Credit amounts with up to 7 decimal places are preserved exactly (no float rounding).
5. The value `"99999.9999999"` (near the 100,000 XLM cap) is accepted and processed correctly.
6. The value `"0.0000001"` (1 stroop) is accepted and processed correctly.
7. Invalid strings (`"abc"`, `""`, `"-5"`, `"100001"`) are rejected with a 400 error.
8. The existing idempotency key mechanism continues to work with string amounts.
9. The `duplicate: true` response works identically for string and number amounts.

### Regression Test Requirements

1. **Frontend unit tests:**
   - Verify the POST body contains `amount_xlm` as a string type
   - Verify input validation rejects empty, zero, negative, non-numeric strings
   - Verify amounts with 7 decimal places are sent verbatim (no float truncation)

2. **Backend unit tests:**
   - Extend `admin-credit-idempotency.test.ts` to verify string amounts are accepted
   - Test `toStroops("50.0001")` === `500001000n` (exact bigint check)
   - Test `toStroops("99999.9999999")` === `999999999999n` (boundary)
   - Test that `oneOf` schema accepts both `50.0001` (number) and `"50.0001"` (string)

3. **Existing tests to preserve:**
   - All tests in `packages/backend/src/routes/admin-credit-idempotency.test.ts`
   - All credit-related assertions in `admin-audit.test.ts`

### Risk Assessment

**Risk: Negligible.** IEEE 754 float64 has 15-17 significant digits of precision. The maximum amount (100,000 XLM with 7 decimal places) requires 12 significant digits (`100000.0000001`), well within float64 range. The current `parseFloat` path produces correct results for all practical use cases. This change is a correctness improvement, not a bug fix.

---

## UI-302: Audit Log Viewer

### Current Backend Support

**Table:** `audit_logs` (defined in `packages/backend/src/db/schema/index.ts`, line ~399)

```
audit_logs
  id          BIGSERIAL PRIMARY KEY
  user_id     INTEGER REFERENCES users(id)   -- admin who performed the action
  action      VARCHAR(50) NOT NULL            -- e.g. "admin_credit", "admin_suspend"
  detail      JSONB DEFAULT '{}'              -- action-specific metadata
  ip_address  VARCHAR(45)                     -- request IP
  user_agent  TEXT                            -- request User-Agent header
  created_at  TIMESTAMP DEFAULT NOW()
```

**Write side:** Fully implemented. `auditLog()` in `packages/backend/src/lib/audit.ts` is called on every admin mutation:

| Action | Trigger |
|--------|---------|
| `admin_credit` | Credit posted to tenant |
| `admin_suspend` | Tenant suspended |
| `admin_unsuspend` | Tenant unsuspended |
| `admin_create` | New admin account created |
| `admin_deactivate` | Admin account deactivated |
| `admin_reactivate` | Admin account reactivated |
| `admin_billing_policy` | Billing policy updated |
| `admin_reset_password` | Admin password reset |

Non-admin actions are also logged: `login`, `login_failed`, `login_locked`, `register`, `logout`, `password_change`, `password_reset`, `profile_update`, `2fa_enable`, `2fa_disable`, `signing_mode_change`, `transaction_sign`, `transaction_submit`, `wallet_add`, `wallet_remove`, `api_key_create`, `api_key_revoke`, `nft_*`, `fiat_*`, `oauth_consent_*`.

**Read side:** No GET endpoint exists. This must be built.

### Required Backend Endpoint

**Endpoint:** `GET /api/v1/internal/audit-logs`

**Implementation location:** Add to `packages/backend/src/routes/admin.ts` or a new `admin-audit-read.ts` route file.

**Query logic:**

```sql
SELECT
  al.id,
  al.user_id,
  ia.name AS admin_name,
  ia.email AS admin_email,
  al.action,
  al.detail,
  al.ip_address,
  al.created_at
FROM audit_logs al
LEFT JOIN internal_admins ia ON ia.id = al.user_id
WHERE 1=1
  AND (al.user_id = :adminId OR :adminId IS NULL)
  AND (al.action = :action OR :action IS NULL)
  AND (al.created_at >= :fromDate OR :fromDate IS NULL)
  AND (al.created_at <= :toDate OR :toDate IS NULL)
  AND (al.id < :beforeId OR :beforeId IS NULL)
ORDER BY al.id DESC
LIMIT 50
```

For tenant-scoped filtering, the `detail` JSONB column must be queried:

```sql
AND (al.detail->>'tenantId' = :tenantId::text OR :tenantId IS NULL)
```

Note: This requires a GIN index on `detail` or a functional index on `(detail->>'tenantId')` for performance at scale.

### Required UI Components

1. **AuditLogPage** -- New page at route `/admin/audit-logs`
   - Navigation link added to the admin sidebar/header
   - Table view with sortable columns
   - Filter bar at the top

2. **AuditLogFilterBar** -- Filter controls
   - Admin filter: dropdown populated from `GET /api/v1/internal/admins` (existing endpoint)
   - Tenant filter: dropdown populated from `GET /api/v1/internal/tenants` (existing endpoint)
   - Action type filter: dropdown with all known action types from the `AuditAction` union type
   - Date range filter: from/to date pickers
   - "Apply" button to refresh the table with selected filters
   - "Clear filters" link to reset

3. **AuditLogTable** -- Data table
   - Columns: Timestamp, Admin Name, Action, Target (derived from `detail`), Details (expandable)
   - Each row is read-only (no edit/delete actions)
   - Timestamp formatted in the user's locale with timezone
   - Action displayed as a human-readable label (e.g., `admin_credit` -> "Credit Posted")
   - Target derived from `detail` JSONB (e.g., `detail.tenantId` -> "Tenant #2")
   - Details column: truncated preview with "Show more" to expand the full JSONB

4. **AuditLogPagination** -- Cursor-based pagination
   - "Load more" button at the bottom (same pattern as billing events in `AdminTenantDetail`)
   - Uses `beforeId` cursor pointing to the last row's `id`
   - Shows total count indicator if available (e.g., "Showing 50 of 50+")

### Authorization Requirements

- **Roles:** `super_admin` and `platform_admin` only
- **Backend enforcement:** `PRIVILEGED_ROLES` guard (same as other privileged endpoints)
- **Frontend enforcement:** Navigation link and route hidden for `account_manager` and `support_agent`
- **Data scoping:** No per-tenant scoping of audit log visibility. Privileged admins see all audit entries across all tenants and all actions (including non-admin user actions like login, 2FA changes, etc.).

### API Contract

**Request:**

```
GET /api/v1/internal/audit-logs?beforeId=500&adminId=1&action=admin_credit&tenantId=2&fromDate=2026-10-01T00:00:00Z&toDate=2026-10-20T23:59:59Z
Authorization: Bearer <admin_jwt>
```

All query parameters are optional.

| Parameter | Type | Description |
|-----------|------|-------------|
| `beforeId` | string (numeric) | Cursor: return entries with `id < beforeId`. Omit for first page. |
| `adminId` | string (numeric) | Filter by admin user ID (the `user_id` in `audit_logs`) |
| `tenantId` | string (numeric) | Filter by tenant ID (matched against `detail->>'tenantId'`) |
| `action` | string | Filter by action type (exact match) |
| `fromDate` | string (ISO 8601) | Inclusive start of date range |
| `toDate` | string (ISO 8601) | Inclusive end of date range |

**Request Schema:**

```json
{
  "type": "object",
  "properties": {
    "beforeId": { "type": "string", "pattern": "^[0-9]+$" },
    "adminId":  { "type": "string", "pattern": "^[0-9]+$" },
    "tenantId": { "type": "string", "pattern": "^[0-9]+$" },
    "action":   { "type": "string", "maxLength": 50 },
    "fromDate": { "type": "string", "format": "date-time" },
    "toDate":   { "type": "string", "format": "date-time" }
  },
  "additionalProperties": false
}
```

**Success Response (200):**

```json
{
  "entries": [
    {
      "id": 499,
      "userId": 1,
      "adminName": "Super Admin",
      "adminEmail": "sa@ammawallet.com",
      "action": "admin_credit",
      "detail": {
        "tenantId": 2,
        "eventType": "manual_topup",
        "amountXlm": "50.0001000",
        "billingEventId": 42
      },
      "ipAddress": "192.168.1.100",
      "createdAt": "2026-10-20T14:30:00.000Z"
    }
  ],
  "hasMore": true,
  "nextCursor": 499
}
```

**Response Schema:**

```json
{
  "type": "object",
  "required": ["entries", "hasMore", "nextCursor"],
  "properties": {
    "entries": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id":         { "type": "number" },
          "userId":     { "type": ["number", "null"] },
          "adminName":  { "type": ["string", "null"] },
          "adminEmail": { "type": ["string", "null"] },
          "action":     { "type": "string" },
          "detail":     { "type": "object" },
          "ipAddress":  { "type": ["string", "null"] },
          "createdAt":  { "type": "string", "format": "date-time" }
        }
      }
    },
    "hasMore":    { "type": "boolean" },
    "nextCursor": { "type": ["number", "null"] }
  }
}
```

**Error Responses:**

| Status | Body | Condition |
|--------|------|-----------|
| 400 | `{ "error": "..." }` | Invalid query parameter format |
| 401 | `{ "error": "..." }` | Missing or invalid JWT |
| 403 | `{ "error": "Forbidden: requires super_admin or platform_admin role" }` | Insufficient role |

### Validation Rules

**Query parameters:**
- `beforeId`: Must be a positive integer string if provided
- `adminId`: Must be a positive integer string if provided
- `tenantId`: Must be a positive integer string if provided
- `action`: Must be a non-empty string, max 50 characters if provided
- `fromDate` / `toDate`: Must be valid ISO 8601 timestamps if provided
- `fromDate` must be before `toDate` if both are provided (backend should return 400 if violated)

**Frontend filter validation:**
- Date range picker should prevent selecting `fromDate > toDate`
- Admin and tenant dropdowns are populated from API data (no free-text validation needed)
- Action type dropdown is limited to known `AuditAction` values

### Error Handling

1. **Network failure:** Display inline error "Network error -- could not load audit logs." with a retry button.
2. **401 Unauthorized:** Redirect to `/admin/login`.
3. **403 Forbidden:** Display "You do not have permission to view audit logs." Redirect to `/admin` after 3 seconds.
4. **400 Validation:** Display the error message from the response. Reset the offending filter to its default value.
5. **Empty result set:** Display "No audit log entries match the current filters." with a "Clear filters" action.
6. **Pagination error:** Display "Could not load more entries." below the table without clearing existing rows. Allow retry.

### Acceptance Criteria

1. `GET /api/v1/internal/audit-logs` endpoint exists and returns paginated audit log entries.
2. The endpoint supports cursor pagination via the `beforeId` query parameter, returning up to 50 entries per page.
3. The endpoint supports filtering by `adminId`, `tenantId`, `action`, `fromDate`, and `toDate`.
4. The endpoint returns `hasMore` (boolean) and `nextCursor` (number or null) for pagination state.
5. Each entry includes `adminName` and `adminEmail` resolved from a LEFT JOIN on `internal_admins`.
6. Entries for non-admin actions (e.g., user login) return `adminName: null` and `adminEmail: null`.
7. The endpoint returns 403 for `account_manager` and `support_agent` roles.
8. A new page at `/admin/audit-logs` displays a filterable, paginated table of audit log entries.
9. The navigation link to the audit log page is visible only to `super_admin` and `platform_admin`.
10. The filter bar allows filtering by admin, tenant, action type, and date range.
11. Filters are applied by clicking "Apply" and reflected in the URL query string for shareability.
12. The table displays columns: Timestamp, Admin Name, Action, Target, Details.
13. The "Details" column shows a truncated preview of the JSONB `detail` field with an expand control.
14. Clicking "Load more" fetches the next page using the cursor from the previous response.
15. The page is fully read-only: no edit, delete, or mutation controls exist.
16. All table content is accessible: proper `<table>` semantics, `<th>` scope attributes, keyboard-navigable expand controls.

### Regression Test Requirements

1. **Backend unit tests (new):**
   - GET returns 403 for `account_manager` role
   - GET returns 403 for `support_agent` role
   - GET returns 200 with entries for `super_admin`
   - Pagination: `beforeId` correctly filters to entries with `id < beforeId`
   - Pagination: `hasMore = true` when more entries exist beyond the page
   - Pagination: `hasMore = false` when all entries have been returned
   - Filter by `adminId`: only entries for that admin are returned
   - Filter by `action`: only entries matching the action are returned
   - Filter by `tenantId`: only entries with matching `detail.tenantId` are returned
   - Filter by date range: only entries within the range are returned
   - Combined filters: all filters compose correctly with AND logic
   - LEFT JOIN resolves admin name/email; null for non-admin entries
   - Empty result returns `{ "entries": [], "hasMore": false, "nextCursor": null }`

2. **Frontend unit tests (new):**
   - AuditLogPage renders filter bar and table
   - AuditLogTable renders correct columns and row data
   - Filter controls update query parameters
   - "Load more" button triggers API call with correct `beforeId`
   - Empty state message displayed when no entries match
   - Error states render correct messages
   - Navigation link hidden for non-privileged roles
   - Details expand/collapse works correctly

3. **Existing tests to preserve:**
   - All tests in `packages/backend/src/routes/admin-audit.test.ts` (write-side audit logging)
   - All tests verifying `auditLog()` calls in admin mutation handlers

### Database Considerations

- **Index recommendation:** Add `CREATE INDEX idx_audit_logs_action ON audit_logs(action)` for action-type filtering.
- **Index recommendation:** Add `CREATE INDEX idx_audit_logs_created ON audit_logs(created_at)` for date range filtering.
- **Index recommendation:** Add `CREATE INDEX idx_audit_logs_detail_tenant ON audit_logs((detail->>'tenantId'))` for tenant-scoped filtering on JSONB.
- **Retention:** No TTL or archival policy is specified. For production, consider adding a retention policy (e.g., 1 year) with a background job to archive or purge old entries. This is out of scope for the initial implementation.

---

## Implementation Priority and Dependencies

| Feature | Priority | Backend Work | Frontend Work | Blocked? |
|---------|----------|-------------|---------------|----------|
| UI-300 | P3 | None (endpoint exists) | Modal + form + confirmation | No |
| UI-301 | P3 | Schema change (`oneOf`) | One-line change | No |
| UI-302 | P3 | New GET endpoint + indexes | New page + table + filters | Backend first |

**Recommended implementation order:**

1. **UI-301** (smallest scope, lowest risk, one-line frontend change + schema update)
2. **UI-300** (frontend-only, backend fully ready)
3. **UI-302** (requires backend endpoint development before frontend can begin)

None of these features are blockers for production deployment. All existing admin functionality is tested and operational. These are enhancement opportunities for future sprints.
