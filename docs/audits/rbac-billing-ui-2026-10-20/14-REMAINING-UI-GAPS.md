# 14-REMAINING-UI-GAPS: UI-300, UI-301, UI-302 Assessment

**Date:** 2026-10-20
**Branch:** `worktree-rbac-billing-audit-2026-10-20`

---

## UI-300: Billing Policy Edit Form

**Current state:** Read-only display in `AdminTenantDetail.tsx` shows debt limit, acquisition mode, and grace period.

**Backend capability:** `PATCH /api/v1/internal/tenants/:id/billing-policy` exists and accepts 9 optional fields: `gracePeriodDays`, `acquisitionModeEnabled`, `acquisitionDebtLimitXlm`, `monthlyMaintenanceEnabled`, `monthlyFeePerActiveUser`, `activityWindowDays`, `onboardingFeeXlm`, `walletFundingEnabled`, `walletFundingMode`.

**Dependencies:**
- Design decisions: Which fields should be editable via UI? Some (e.g., `walletFundingMode`) have operational implications
- Validation rules: What ranges are acceptable? Backend accepts any numeric value
- Confirmation UX: Policy changes affect billing for all tenant users
- Role restriction: Already enforced (super_admin / platform_admin only)

**Risk:** Low. Admins can currently modify policies via API/curl. Adding UI improves usability but doesn't change capabilities.

**Acceptance criteria:**
1. Form displays current policy values as editable fields
2. Only changed fields are sent in PATCH request
3. Confirmation modal before saving (policy affects all tenant users)
4. Success/error feedback
5. Field validation matches backend constraints

**Decision required:** Product owner must specify which of the 9 policy fields to expose and what validation constraints to apply. **BLOCKED on design decision.**

---

## UI-301: Credit Amount as String

**Current state:** Credit amount is sent as `parseFloat(creditAmount)` — a JSON number. Backend receives it and converts via `toStroops()`.

**Risk:** Negligible for amounts up to 100,000 XLM. IEEE 754 float64 has 15-17 significant digits; `100000.0001` is exactly representable. The `toStroops()` function handles the conversion correctly.

**Proposed change:** Send `amount_xlm` as a string instead of number:
```typescript
// Current
body: JSON.stringify({ type, amount_xlm: parseFloat(creditAmount), ... })
// Proposed
body: JSON.stringify({ type, amount_xlm: creditAmount, ... })
```

**Dependencies:**
- Backend schema change: `amount_xlm` would need to accept `{ type: "string" }` or `{ oneOf: [{ type: "number" }, { type: "string" }] }`
- Backend parsing: `toStroops()` already accepts strings

**Decision:** This is a low-priority correctness improvement. The current float path works for all practical use cases. **NOT REQUIRED for production readiness.**

---

## UI-302: Audit Log Viewer

**Current state:** The `audit_logs` table exists and is populated by `auditLog()` on every admin write operation. However:
- No backend `GET /api/v1/internal/audit-logs` endpoint exists
- No frontend UI for viewing audit history

**Dependencies:**
- Backend: Create `GET /api/v1/internal/audit-logs` with pagination, filtering by admin/tenant/action
- Design: Table view with columns for timestamp, admin, action, target, details
- Access control: Which roles can view audit logs? Likely super_admin + platform_admin

**Risk:** Medium. Lack of audit visibility means admins cannot review actions taken by other admins. The data exists in the database and can be queried directly, but this is not a sustainable workflow.

**Acceptance criteria:**
1. `GET /api/v1/internal/audit-logs` endpoint with cursor pagination
2. Filter by: admin ID, tenant ID, action type, date range
3. UI table showing: timestamp, admin name, action, target entity, details
4. Accessible to super_admin and platform_admin roles
5. Read-only (no edit/delete)

**Decision:** Requires backend endpoint development. **BLOCKED on backend work.** Can be implemented independently of the credit idempotency spec.

---

## Summary

| Feature | Required for Production? | Blocker | Priority |
|---------|------------------------|---------|----------|
| UI-300 Billing policy edit | No (API access exists) | Design decisions from product owner | P3 |
| UI-301 Credit as string | No (float works correctly) | Backend schema acceptance | P3 |
| UI-302 Audit log viewer | Recommended | Backend GET endpoint needed | P3 |

None of these features are blockers for production deployment of the current admin functionality. All existing features are tested and working. These are enhancement opportunities for future sprints.
