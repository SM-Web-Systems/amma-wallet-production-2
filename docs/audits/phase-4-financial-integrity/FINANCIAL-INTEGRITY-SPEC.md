# FINANCIAL-INTEGRITY-SPEC: Credit Posting Financial Safety

**Date:** 2026-10-20
**Branch:** `worktree-rbac-billing-audit-2026-10-20`
**Commit:** `d9cdd79`

---

## 1. Overview

This document specifies the financial integrity controls for AmmaWallet's admin credit posting system. It covers the complete lifecycle from UI form submission through database ledger recording.

## 2. Financial Transaction Model

### 2.1 Credit Types

| Type | Description | Amount Sign | Idempotency Key |
|------|-------------|-------------|-----------------|
| `manual_topup` | Admin-initiated balance credit | Positive | Required (UUID v4) |
| `bundle_purchase` | Bundle-backed credit with product link | Positive | Required (UUID v4) |
| `manual_adjustment` | Arbitrary balance correction | Positive | Required (UUID v4) |

### 2.2 Precision

- **Storage:** `numeric(18, 7)` — 18 total digits, 7 decimal places (XLM Stellar precision)
- **Display:** `toFixed(4)` in UI (for readability), full 7 decimals in API
- **Arithmetic:** PostgreSQL `numeric` type — exact decimal arithmetic, no IEEE 754 float errors
- **Minimum amount:** Any positive value (`amountXlm > 0`, enforced by application + CHECK constraint)

### 2.3 Balance Invariant

```
tenant.prepaid_xlm_balance = initial_balance + SUM(billing_events.amount_xlm WHERE tenant_id = X)
```

This invariant is maintained by atomic `UPDATE tenants SET prepaid_xlm_balance = prepaid_xlm_balance + amount::numeric` within the same transaction as the billing_events INSERT.

## 3. Transaction Boundaries

### 3.1 Inside Transaction (atomic)

1. Idempotency SELECT (if key provided)
2. INSERT billing_events (with idempotency_key)
3. UPDATE tenants.prepaid_xlm_balance
4. (bundle_purchase only) INSERT tenant_bundle_purchases
5. (bundle_purchase only) UPDATE billing_events SET bundle_purchase_id

All 2-5 steps either all succeed or all roll back. Step 1 is read-only.

### 3.2 Outside Transaction (not atomic with credit)

- Tenant existence check (SELECT before transaction)
- Bundle catalog lookup (SELECT before transaction)
- Audit log recording (fire-and-forget after COMMIT)

### 3.3 Failure Modes

| Failure | State After | Recovery |
|---------|-------------|----------|
| INSERT fails (constraint violation) | No changes | Client retries with same idempotency key |
| UPDATE fails (tenant deleted during tx) | No changes | Client gets error, investigates |
| Network loss after COMMIT | Credit applied, response lost | Client retries → duplicate:true response |
| Process crash during tx | No changes | PostgreSQL auto-rollback |

## 4. Idempotency Protection

### 4.1 Design

- Client generates `crypto.randomUUID()` at confirmation dialog click time
- Key is scoped to `(tenant_id, idempotency_key)` — per-tenant uniqueness
- Partial unique index: `WHERE idempotency_key IS NOT NULL` — historical events unaffected
- Duplicate detection compares `eventType` and `amountXlm` only (not notes/metadata)

### 4.2 Behavior Matrix

| Scenario | Key | Amount | Type | Result |
|----------|-----|--------|------|--------|
| First request | K1 | 100 | manual_topup | 200 OK, balance +100 |
| Exact retry | K1 | 100 | manual_topup | 200 OK, duplicate:true, balance unchanged |
| Different amount | K1 | 200 | manual_topup | 409 Conflict |
| Different type | K1 | 100 | bundle_purchase | 409 Conflict |
| Different key | K2 | 100 | manual_topup | 200 OK, balance +100 (new credit) |
| Different tenant | K1 | 100 | manual_topup | 200 OK, no conflict (different scope) |
| No key (legacy) | NULL | 100 | manual_topup | 200 OK, no idempotency protection |

### 4.3 Concurrent Request Handling

Under PostgreSQL READ COMMITTED isolation:
1. Both transactions SELECT — no existing key found
2. First transaction INSERT — succeeds
3. Second transaction INSERT — UNIQUE VIOLATION
4. Second transaction ROLLBACK → new transaction → SELECT finds existing → returns duplicate

The UNIQUE INDEX is the serialization point, not application locks.

## 5. Authorization Matrix

| Role | View Tenants | View Billing | Post Credit | Suspend | Manage Admins |
|------|:---:|:---:|:---:|:---:|:---:|
| super_admin | ✓ | ✓ | ✓ | ✓ | ✓ (all) |
| platform_admin | ✓ | ✓ | ✓ | ✓ | ✓ (limited) |
| account_manager | ✓ | ✓ | ✗ | ✗ | ✗ |
| support_agent | ✓ | ✓ | ✗ | ✗ | ✗ |

Credit posting requires `super_admin` or `platform_admin`. Enforced at both backend (role guard) and frontend (UI button visibility).

## 6. Audit Trail

Every credit operation records:
- `billing_events` row: permanent ledger entry with amount, type, admin ID, timestamp, idempotency key
- `audit_logs` row: action type, admin user ID, IP address, user agent, details JSON

Duplicate requests do NOT create audit log entries (no financial state changed).

## 7. Validation Chain

| Layer | Check | Response |
|-------|-------|----------|
| Fastify schema | `amount_xlm > 0`, `amount_xlm ≤ 100000`, valid type enum | 400 |
| Route handler | `Number.isFinite(amount)`, `amount > 0` | 400 |
| `writeBillingCredit` | `toStroops(amountXlm) > 0n` | Exception |
| PostgreSQL | `chk_billing_amount_nonzero`: `amount_xlm <> 0` | Constraint violation |
| PostgreSQL | `chk_billing_event_type`: valid event types only | Constraint violation |

Four layers of validation prevent invalid credits.

## 8. Test Coverage

### 8.1 Unit Tests (mocked DB)

| Suite | Tests | Coverage |
|-------|-------|----------|
| admin-billing.test.ts | 22 | Role guards, validation, success paths |
| admin-credit-idempotency.test.ts | 11 | Idempotency key passing, duplicate handling, 409, audit log skip |
| billing.service.test.ts | 7 | Service-level idempotency, duplicate detection, changed-payload 409 |

### 8.2 Integration Tests (real PostgreSQL)

| Suite | Tests | Coverage |
|-------|-------|----------|
| admin-billing.integration.test.ts | 17 | Atomic credits, precision, idempotency (all 7 scenarios), ledger reconciliation, suspension, ordering |

### 8.3 E2E Tests (Playwright)

| Suite | Tests | Coverage |
|-------|-------|----------|
| admin-flows.spec.ts | 38 | Login, auth, dashboard, billing, credit confirmation, suspension, roles, admin mgmt, pagination, session, network, responsive |

**Note:** E2E tests require running local stack. Not executable in CI without infrastructure setup.
