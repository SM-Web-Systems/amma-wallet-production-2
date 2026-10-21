# 04-P52-04: Scope Pending Operations to Admin Identity

**Finding:** P52-04 — Pending operations not scoped to authenticated admin
**Severity:** P1
**Status:** RESOLVED

---

## Problem

The Phase 5.1 sessionStorage key was only tenant-scoped:
`aw_pending_credit_{tenantId}`. If admin A started a credit operation and
admin B logged in on the same browser, admin B could inherit admin A's
pending operation — potentially completing a credit they did not initiate.

## Solution

### Storage Key Format

Changed to: `aw_pending_credit_{adminId}_{tenantId}`

This ensures:
- Admin A and admin B have independent storage slots for the same tenant
- Each admin can have independent operations for different tenants
- Clearing one admin's operation does not affect another's

### Identity Validation on Load

`loadCreditOp(adminId, tenantId)` validates:
```typescript
parsed.adminId === adminId && parsed.tenantId === tenantId
```

If the stored operation belongs to a different admin or tenant, it returns
`null` — the operation is invisible, not inherited.

### Corruption Safety

`loadCreditOp` wraps all parsing in try/catch and validates field types:
- Invalid JSON → null
- Missing fields → null
- Wrong types (e.g., adminId as string) → null
- Identity mismatch → null

### Extracted Module

Storage logic extracted to `packages/web-app/src/lib/credit-op-storage.ts`
for testability. Both the page component and tests import from this module.

## Test Evidence

21 tests in `credit-op-storage.test.ts`:

| Category | Tests |
|----------|-------|
| Storage key format | 3 |
| Save/load round-trip | 2 |
| Admin isolation (core P52-04) | 2 |
| Tenant isolation | 2 |
| Corrupted storage safety | 7 |
| Clear operations | 2 |
| State machine persistence | 3 |
