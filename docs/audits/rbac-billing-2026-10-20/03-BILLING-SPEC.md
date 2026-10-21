# 03-BILLING-SPEC: Billing System Specification

**Date:** 2026-10-20  
**Commit:** `a65e19c`  
**Status:** Current implementation (as-built)

---

## 1. Financial Arithmetic

### 1.1 Stroop-Based Decimal Arithmetic

All monetary values in the billing system are represented as **decimal strings** (e.g. `"3.0000000"`) and manipulated via BigInt stroop arithmetic. No floating-point operations are used in financial computation paths.

**Core constants** (`billing.service.ts:29-30`):

```
STELLAR_DECIMALS = 7
SCALE = 10_000_000n   (10^7)
```

**Conversion functions** (`billing.service.ts:33-49`):

| Function | Signature | Behaviour |
|----------|-----------|-----------|
| `toStroops(s)` | `string -> bigint` | Parses decimal string to BigInt stroops. Handles negative values via sign prefix. Pads/truncates fractional part to exactly 7 digits. |
| `fromStroops(stroops)` | `bigint -> string` | Formats BigInt stroops back to a 7-decimal-place string. Pads fractional part with leading zeros. |

**Arithmetic functions** (`billing.service.ts:52-70`):

| Function | Location | Operation |
|----------|----------|-----------|
| `addDecimalStrings(a, b)` | :52 | `fromStroops(toStroops(a) + toStroops(b))` |
| `mulDecimalStrings(amount, count)` | :57 | `fromStroops(toStroops(amount) * BigInt(count))` -- multiplies by integer only |
| `negateDecimalString(s)` | :62 | `fromStroops(-toStroops(s))` |
| `compareDecimalStrings(a, b)` | :67 | Returns `-1`, `0`, or `1` based on BigInt diff |

All four are `export`ed and consumed by both `billing.service.ts` and `auto-suspension.ts` (import at `auto-suspension.ts:24`).

### 1.2 Precision Guarantees

- **Application layer:** 7 decimal places, enforced by the `STELLAR_DECIMALS` constant and `padEnd`/`padStart` in conversion functions.
- **Database layer:** `NUMERIC(18, 7)` for `tenants.prepaid_xlm_balance` (`schema/index.ts:480`), `billing_events.amount_xlm` (`:945`), and all fee/amount columns.
- **Policy fee columns:** `NUMERIC(7, 4)` for per-unit fees (e.g. `wallet_funding_xlm`, `new_wallet_platform_fee_xlm`) at `schema/index.ts:515-528`.
- **Balance updates:** Performed atomically in SQL via `prepaid_xlm_balance + ${amountXlm}::numeric` (`billing.service.ts:489, 550`). The `::numeric` cast ensures PostgreSQL uses arbitrary-precision decimal arithmetic, not floating-point.
- **No IEEE 754 in financial paths:** The only known exception is `maybeNotifyDeficit()` at `billing.service.ts:770` which uses `parseFloat(newBalance).toFixed(4)` for display purposes only (email body formatting, after the transaction has committed).

---

## 2. Billing Data Model

### 2.1 Core Tables

**`tenants`** (`schema/index.ts:473-500`)

The root billing entity. Key billing columns:

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `prepaid_xlm_balance` | `NUMERIC(18,7)` | `"0"` | Running balance. No floor CHECK -- negative values are allowed by design (acquisition mode). |
| `low_balance_threshold_xlm` | `NUMERIC(18,7)` | `"300.0000000"` | Alert threshold (used in notifications). |
| `is_active` | `boolean` | `true` | `false` = hard-suspended (blocks everything). |
| `suspended_at` | `timestamptz` | `NULL` | Non-NULL = soft-suspended (blocks activations/onboardings). |
| `suspension_reason` | `text` | `NULL` | CHECK constraint: `NULL`, `'debt_limit'`, `'maintenance_grace_expired'`, or `'manual'`. |

The `suspension_reason` CHECK is at `schema/index.ts:495-498`.

**`billing_events`** (`schema/index.ts:939-984`)

Append-only ledger. Every balance change (debit or credit) is recorded here. Key columns:

| Column | Type | Notes |
|--------|------|-------|
| `tenant_id` | FK -> tenants | NOT NULL |
| `event_type` | text | CHECK constrained (see Section 2.2) |
| `amount_xlm` | `NUMERIC(18,7)` | Negative for debits, positive for credits. CHECK: `amount_xlm <> 0` (`:982`). |
| `policy_version_id` | FK -> tenant_billing_policy | NULL for credits |
| `wallet_funding_snapshot` | `NUMERIC(7,4)` | Captured at debit time for new_wallet_activation |
| `platform_fee_snapshot` | `NUMERIC(7,4)` | Captured at debit time for new_wallet_activation |
| `onboarding_fee_snapshot` | `NUMERIC(7,4)` | Captured at debit time for existing_user_onboarding |
| `billing_period` | text | `'YYYY-MM'` for monthly_maintenance_charge |
| `active_user_count_snapshot` | integer | Captured at maintenance run time |
| `fee_per_user_snapshot` | `NUMERIC(7,4)` | Captured at maintenance run time |
| `bundle_purchase_id` | FK -> tenant_bundle_purchases | Back-reference for bundle credits |
| `created_by` | text | `"api"`, `"system"`, or `"admin:{id}"` |

**`tenant_billing_policy`** (`schema/index.ts:506-549`)

Versioned pricing parameters. Only one row per tenant has `is_current = true` at any time (enforced by a manual DEFERRABLE UNIQUE constraint `uq_tenant_policy_current` noted at `:546-547`, not expressible in Drizzle).

Key CHECK constraints:
- `chk_funding_mode`: `wallet_funding_mode IN ('auto', 'manual', 'batch')` (`:540`)
- `chk_policy_fees`: all fees >= 0, platform_fee > 0 (`:541-544`)
- `chk_debt_limit`: `acquisition_debt_limit_xlm <= 0` (`:545`)

Versioning columns: `version` (integer, UNIQUE per tenant), `effective_from`, `effective_until`, `is_current`.

**`monthly_maintenance_snapshots`** (`schema/index.ts:1080-1098`)

Immutable record of each monthly billing run. The UNIQUE constraint `uq_maintenance_snapshot ON (tenant_id, billing_period)` at `:1094` is the primary idempotency mechanism preventing double-charging.

| Column | Type | Notes |
|--------|------|-------|
| `tenant_id` | FK -> tenants | NOT NULL |
| `billing_period` | text | `'YYYY-MM'` |
| `active_user_count` | integer | Snapshot of counted users |
| `fee_per_user_xlm` | `NUMERIC(7,4)` | From policy at run time |
| `total_charged_xlm` | `NUMERIC(18,7)` | = fee * count |
| `billing_event_id` | FK -> billing_events | Links to the ledger entry |
| `activity_window_days` | integer | From policy at run time |

**`tenant_bundle_purchases`** (`schema/index.ts:891-911`)

Immutable commercial record of each bundle purchase. Created by `writeBillingCredit()` when `eventType === "bundle_purchase"`. Has bidirectional FK relationship with `billing_events` (`:901` and `:965`).

**`system_config`** (`schema/index.ts:1102-1108`)

Key-value store with `text` primary key. Used by billing for:
- `deficit_email_cooldown_mins` -- global notification cooldown (default 60 if absent)
- `deficit_email_last_sent.{tenantId}` -- per-tenant last-sent timestamp
- `maintenance_grace_started_at.{tenantId}` -- grace period start for suspension timing

### 2.2 Event Types

The `chk_billing_event_type` CHECK constraint (`schema/index.ts:979-981`) defines exactly 9 event types:

| Event Type | Direction | Source | Description |
|-----------|-----------|--------|-------------|
| `new_wallet_activation` | Debit (negative) | API | First wallet for a user; charged walletFunding + platformFee |
| `existing_user_onboarding` | Debit (negative) | API | Additional wallet for existing user; charged onboardingFee |
| `monthly_maintenance_charge` | Debit (negative) | System cron | Monthly per-active-user charge |
| `tenant_referral_reward` | Debit (negative) | System | Referral reward deducted from tenant balance |
| `bundle_purchase` | Credit (positive) | Admin | Tenant buys a named bundle; creates bundle_purchase record |
| `manual_topup` | Credit (positive) | Admin | Ad-hoc balance credit by admin |
| `manual_adjustment` | Credit (positive) | Admin | Correction or refund |
| `unallocated_deposit_allocated` | Credit (positive) | Admin | Allocation of previously-received deposit |
| `stellar_tx_refund` | Credit (positive) | System | Refund of a failed Stellar transaction |

The `chk_billing_amount_nonzero` CHECK (`schema/index.ts:982`) ensures no zero-amount events exist.

### 2.3 Balance Invariants

**Atomic update pattern** (used in both `writeBillingDebit` at `:489` and `writeBillingCredit` at `:550`):

```sql
UPDATE tenants SET prepaid_xlm_balance = prepaid_xlm_balance + $amount::numeric
WHERE id = $tenantId
RETURNING prepaid_xlm_balance
```

- The `+ amount::numeric` arithmetic happens in PostgreSQL, not the application.
- For debits, `amount` is already negative (negated by `negateDecimalString` in the caller).
- For credits, `amount` is positive (validated at `billing.service.ts:532`).
- **No application-level floor**: the balance can go negative. The `tenants` table has no `CHECK (prepaid_xlm_balance >= 0)` constraint (`schema/index.ts:473`, comment at `:472`). Negative balances are permitted by design for acquisition mode.
- **Debt is allowed**: in acquisition mode, debits proceed as long as `balance > acquisitionDebtLimitXlm`. Outside acquisition mode, the application-level check at `billing.service.ts:266-270` rejects debits when `balance <= 0`, but this is a pre-flight check, not a DB constraint.

---

## 3. Transaction Boundaries

### 3.1 Wallet Activation Flow

The wallet activation billing flow (`wallets.ts:155-264`) uses a two-phase pattern:

**Phase 1: Pre-flight check (read-only, no locks)**

```
checkWalletBilling({ tenantId, userId })       // billing.service.ts:222-313
  -> getBillingPolicy(tenantId)                 // :116-128
  -> getTenantBillingState(tenantId)            // :131-146
  -> countUserWallets(userId)                   // :149-155
  -> [if existing user] isActiveTenantUser()    // :161-190
```

Returns a discriminated union `BillingCheckResult` (`billing.service.ts:102-111`):
- `{ ok: true, eventType, amountXlm, policy }` -- proceed with billing
- `{ ok: true, eventType: "no_billing" }` -- no tenant context or onboarding disabled
- `{ ok: true, eventType: "idempotent_skip" }` -- already active tenant_user
- `{ ok: false, httpStatus: 402|403|503, message }` -- reject

**Phase 2: Transaction (locks + writes)**

```
db.transaction(async (tx) => {
  1. checkWalletBillingTx(tx, { tenantId, userId })   // billing.service.ts:322-429
     -> SELECT tenants ... FOR UPDATE                  // :331-338 (row lock)
     -> getBillingPolicy(tenantId)                     // :355 (NOT using tx -- see FIND-BILL-003)
     -> countUserWallets(userId)                       // :365 (NOT using tx)
     -> Re-validate all conditions
  2. Deactivate other wallets                          // wallets.ts:189-192
  3. INSERT user_wallets                               // wallets.ts:195-205
  4. writeBillingDebit(tx, ...)                         // wallets.ts:219-236
     -> INSERT billing_events                          // billing.service.ts:465-483
     -> UPDATE tenants.balance atomically              // billing.service.ts:485-495
  5. upsertTenantUser(tx, tenantId, userId)            // wallets.ts:240 (ON CONFLICT DO NOTHING)
  COMMIT
})
```

After commit (`wallets.ts:262-264`):
```
maybeNotifyDeficit(tenantId, debitNewBalance).catch(() => {})  // fire-and-forget
```

**Note:** The current wallet activation route (`wallets.ts`) does NOT perform any Stellar on-chain operations (no Horizon calls, no `funding_events` inserts). The `funding_events` table (`schema/index.ts:601-633`) and on-chain funding are handled by a separate mechanism. The billing debit records the platform's internal charge for the activation; the actual Stellar account creation is a distinct concern.

Reference: `diagrams/wallet-activation-billing-sequence.mmd` (architectural intent; the actual code path omits the Stellar step within the wallet route).

### 3.2 Credit Application

`writeBillingCredit()` (`billing.service.ts:505-586`) is called from `admin.ts:494-508` within a `db.transaction()`.

**Validation** (`:531-534`):
```typescript
const amountStroops = toStroops(amountXlm);
if (amountStroops <= 0n) {
  throw new Error("amountXlm must be a positive value");
}
```

**Steps within the caller-provided transaction:**

1. INSERT `billing_events` with positive `amount_xlm` (`:537-546`)
2. UPDATE `tenants.prepaid_xlm_balance` atomically (`:549-556`)
3. If `eventType === "bundle_purchase"` and `bundleSlugSnapshot` is truthy:
   - INSERT `tenant_bundle_purchases` with `billingEventId` reference (`:560-574`)
   - UPDATE `billing_events` to set `bundle_purchase_id` back-reference (`:577-579`)
   - Returns `{ billingEventId, newBalance, bundlePurchaseId }`

**Observed:** `writeBillingCredit` does NOT set `policyVersionId` on the `billing_events` insert (`:537-546`). Credits are not linked to a billing policy version, unlike debits which always carry `policyVersionId`.

**Route-level validations** (`admin.ts:450-454`):
- `amount_xlm` must be a positive finite number (application guard)
- Fastify JSON schema enforces `maximum: 100000` at the route level
- `writeBillingCredit` itself only validates `> 0` (no upper bound) -- see FIND-BILL-005

### 3.3 Monthly Maintenance

`runMonthlyMaintenanceForTenant()` (`billing.service.ts:609-682`):

**Idempotency check** (`:614-624`): Read `monthly_maintenance_snapshots` for the `(tenantId, billingPeriod)` pair. If exists, return `null` immediately.

**Data gathering** (outside transaction):
1. `getBillingPolicy(tenantId)` -- skip if `!monthlyMaintenanceEnabled` (`:626-627`)
2. `getActiveUserCount(tenantId, activityWindowDays)` -- skip if 0 (`:629-630`)
3. Compute: `totalCharge = mulDecimalStrings(monthlyFeePerActiveUser, activeUserCount)` (`:632`)

**Transaction** (`:637-662`):
```
db.transaction(async (tx) => {
  1. writeBillingDebit(tx, {
       eventType: "monthly_maintenance_charge",
       amountXlm: negateDecimalString(totalCharge),
       policyVersionId: policy.id,
       billingPeriod,
       activeUserCountSnapshot: activeUserCount,
       feePerUserSnapshot: monthlyFeePerActiveUser,
       createdBy: "system"
     })
  2. INSERT monthly_maintenance_snapshots
     -> UNIQUE(tenant_id, billing_period) prevents double-insert
  COMMIT
})
```

**Post-commit actions** (`:664-679`):
1. `maybeNotifyDeficit()` -- fire-and-forget (`:665`)
2. If new balance < 0: INSERT `system_config` key `maintenance_grace_started_at.{tenantId}` with `ON CONFLICT DO NOTHING` (`:668-679`). First occurrence wins -- subsequent negative months do not reset the grace start.

**Batch runner** `runMonthlyMaintenanceAllTenants()` (`:685-705`): Selects all `is_active = true` tenants and calls `runMonthlyMaintenanceForTenant` sequentially. Errors are caught per-tenant (`:700-703`) so one failure does not abort the batch.

**Scheduling** (`monthly-maintenance.ts:1-36`): Called from `server.ts` hourly. Calls `getBillingPeriod()` (`:708-712`, formats current UTC date as `YYYY-MM`) then `runMonthlyMaintenanceAllTenants(billingPeriod)`. Idempotent -- after the first successful run each month, all subsequent calls return immediately via the snapshot check.

---

## 4. TOCTOU Protection

The billing system uses a **pre-flight + transactional re-check** pattern to guard against time-of-check/time-of-use (TOCTOU) races on concurrent wallet activations.

**Pre-flight** (`checkWalletBilling`, `billing.service.ts:222-313`):
- Read-only, no locks
- Uses global `db` connection
- Validates: tenant exists, is_active, not suspended, policy exists, balance sufficient
- Returns the billing action to take (event type + amount)

**Transactional re-check** (`checkWalletBillingTx`, `billing.service.ts:322-429`):
- Called inside `db.transaction()` on the `tx` object
- Acquires `SELECT ... FOR UPDATE` lock on `tenants` row (`:331-338`)
- Re-validates all conditions under lock
- Returns the same `BillingCheckResult` union

**Why both:** The pre-flight check (`wallets.ts:160-166`) avoids entering a transaction and acquiring a row lock for requests that are guaranteed to fail (e.g. suspended tenant, zero balance without acquisition mode). This reduces lock contention and unnecessary transaction overhead.

**Known gap (FIND-BILL-003):** `checkWalletBillingTx` acquires `FOR UPDATE` on the `tenants` row, but then calls `getBillingPolicy(tenantId)` at `:355` using the global `db` connection, not the `tx` object. The policy read occurs outside the lock scope. A concurrent admin policy update between the row lock and the policy read could cause the activation to use stale fee parameters. Similarly, `countUserWallets(userId)` at `:365` also reads outside the transaction. Practical risk is low (policy changes are rare admin operations).

---

## 5. Billing Policy

### 5.1 Policy Fields

The `BillingPolicy` interface (`billing.service.ts:74-89`) and the `tenant_billing_policy` table (`schema/index.ts:506-549`) define the following parameters:

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `walletFundingEnabled` | boolean | `true` | Whether platform funds the new wallet with XLM |
| `walletFundingXlm` | `NUMERIC(7,4)` | `"1.0000"` | XLM sent to new wallet (Stellar min balance) |
| `newWalletPlatformFeeXlm` | `NUMERIC(7,4)` | `"2.0000"` | Platform fee per new wallet activation |
| `walletFundingMode` | text | `"auto"` | `'auto'`, `'manual'`, or `'batch'` |
| `onboardingEnabled` | boolean | `true` | Whether existing-user onboarding is billable |
| `onboardingFeeXlm` | `NUMERIC(7,4)` | `"1.0000"` | Fee per existing-user onboarding |
| `monthlyMaintenanceEnabled` | boolean | `true` | Whether monthly per-user charge applies |
| `monthlyFeePerActiveUser` | `NUMERIC(7,4)` | `"0.1000"` | Per-active-user monthly fee |
| `activityWindowDays` | integer | `90` | Users active within this window count for maintenance |
| `gracePeriodDays` | integer | `14` | Days of negative balance before suspension |
| `acquisitionModeEnabled` | boolean | `true` | Whether debt is allowed for new activations |
| `acquisitionDebtLimitXlm` | `NUMERIC(18,7)` | `"-300.0000000"` | Maximum debt allowed (negative number; CHECK: `<= 0`) |

**Default total debit per new wallet** (with defaults): `walletFundingXlm + newWalletPlatformFeeXlm = 1.0 + 2.0 = 3.0 XLM`

The wallet funding component is only included when `walletFundingEnabled && walletFundingMode === "auto"` (`billing.service.ts:276-279, 388-391`). If funding is disabled or mode is not `"auto"`, only the platform fee is charged.

### 5.2 Acquisition Mode

When `acquisitionModeEnabled = true`:

- **New wallet activations**: proceed even if `balance < 0`, as long as `balance > acquisitionDebtLimitXlm` (`billing.service.ts:256-264, 368-377`).
- **Existing user onboardings**: ALWAYS blocked at `balance <= 0`, regardless of acquisition mode (`billing.service.ts:298-303, 414-419`). Acquisition mode does not apply.
- **Monthly maintenance charges**: always run, even past zero. Maintenance accrues as debt by design (`billing.service.ts:14-18`).

The comparison uses `compareDecimalStrings(balance, debtLimit) <= 0` to detect the limit. Because `debtLimit` is a negative number (e.g. `"-300.0000000"`), the check is: reject if balance has dropped to or below the limit.

### 5.3 Policy Versioning

- Each tenant has one `is_current = true` policy at any time.
- `getBillingPolicy()` (`billing.service.ts:116-128`) queries `WHERE tenant_id = $id AND is_current = true LIMIT 1`.
- The `UNIQUE(tenant_id, version)` index (`schema/index.ts:539`) prevents duplicate version numbers.
- A manual DEFERRABLE UNIQUE constraint `uq_tenant_policy_current` (`:546-547`) is applied via SQL patch to enforce that at most one row per tenant has `is_current = true`. This constraint is DEFERRABLE INITIALLY DEFERRED to allow atomic flip (set old row `is_current = false`, insert new row `is_current = true`) within a single transaction.
- The Drizzle schema cannot express DEFERRABLE constraints natively; the constraint is maintained as a manual SQL patch.

---

## 6. Auto-Suspension System

### 6.1 Four-Pass Architecture

`checkAndRunAutoSuspension()` (`auto-suspension.ts:326-345`) runs four sequential passes in fixed order:

| Pass | Function | Location | Action |
|------|----------|----------|--------|
| 1 | `enforceDebtLimit()` | `:161-195` | Suspend tenants at or below debt limit |
| 2 | `enforceMaintGrace()` | `:199-248` | Suspend tenants whose grace period expired |
| 3 | `recoverMaintenanceGrace()` | `:252-279` | Unsuspend grace-expired tenants with positive balance |
| 4 | `recoverDebtLimit()` | `:283-319` | Unsuspend debt-limit tenants above recovery threshold |

The ordering matters: enforcement runs before recovery, so a tenant cannot oscillate between suspended and active in a single run.

**Pass 1 -- `enforceDebtLimit()`** (`:161-195`):
- Selects: `is_active = true AND suspended_at IS NULL AND acquisition_mode_enabled = true` (joined with `tenant_billing_policy WHERE is_current = true`)
- Condition: `compareDecimalStrings(balance, debtLimit) <= 0`
- Action: `softSuspend(tenantId, "debt_limit")`

**Pass 2 -- `enforceMaintGrace()`** (`:199-248`):
- Selects: `is_active = true AND suspended_at IS NULL` (joined with current billing policy)
- Filters: `balance < 0` (via `compareDecimalStrings`)
- Looks up `maintenance_grace_started_at.{tenantId}` in `system_config`
- Condition: `Date.now() - graceStartMs > gracePeriodDays * 86_400_000`
- Action: `softSuspend(tenantId, "maintenance_grace_expired")`

**Pass 3 -- `recoverMaintenanceGrace()`** (`:252-279`):
- Selects: `is_active = true AND suspended_at IS NOT NULL AND suspension_reason = 'maintenance_grace_expired'`
- Condition: `compareDecimalStrings(balance, "0") > 0` (strictly positive)
- Action: `unsuspend(tenantId)` + `clearGraceKey(tenantId)` (deletes the `maintenance_grace_started_at` key)

**Pass 4 -- `recoverDebtLimit()`** (`:283-319`):
- Selects: `is_active = true AND suspended_at IS NOT NULL AND suspension_reason = 'debt_limit'` (joined with current billing policy)
- Condition: `compareDecimalStrings(mulDecimalStrings(balance, 2), debtLimit) > 0` -- i.e. `2 * balance > debtLimit`, which is equivalent to `balance > debtLimit / 2`
- Action: `unsuspend(tenantId)`

### 6.2 Suspension States

Reference: `diagrams/suspension-state-machine.mmd`

| State | `is_active` | `suspended_at` | `suspension_reason` | Effect |
|-------|-------------|-----------------|---------------------|--------|
| Active | `true` | `NULL` | `NULL` | Normal operation |
| SoftSuspended_DebtLimit | `true` | set | `"debt_limit"` | Blocks wallet activation + onboarding; allows SSO, reads, maintenance accrual |
| SoftSuspended_GraceExpired | `true` | set | `"maintenance_grace_expired"` | Blocks wallet activation + onboarding; allows SSO, reads |
| SoftSuspended_Manual | `true` | set | `"manual"` | Blocks wallet activation + onboarding; allows SSO, reads. **Never auto-cleared.** |
| HardSuspended | `false` | set | `"manual"` | Blocks everything except SSO reads. **Never auto-cleared.** |

**Transition rules:**

- Auto-suspension only writes `suspension_reason = 'debt_limit'` or `'maintenance_grace_expired'` (`auto-suspension.ts:33-34`).
- Auto-recovery only clears suspensions where `suspension_reason IN ('debt_limit', 'maintenance_grace_expired')` (`auto-suspension.ts:60`).
- Manual suspensions (`suspension_reason = 'manual'`) are set by admin endpoints and are never touched by the auto-suspension job.
- Hard suspensions (`is_active = false`) are invisible to the auto-suspension job: all four passes filter on `is_active = true`.

**Soft-suspend implementation** (`auto-suspension.ts:32-46`):
```sql
UPDATE tenants
SET suspended_at = now, suspension_reason = $reason, updated_at = now
WHERE id = $tenantId AND suspended_at IS NULL  -- idempotency guard
```

**Unsuspend implementation** (`auto-suspension.ts:51-63`):
```sql
UPDATE tenants
SET suspended_at = NULL, suspension_reason = NULL, updated_at = now
WHERE id = $tenantId
  AND suspended_at IS NOT NULL
  AND suspension_reason IN ('debt_limit', 'maintenance_grace_expired')  -- never touch manual
```

### 6.3 Recovery Thresholds

| Suspension Type | Recovery Condition | Rationale |
|-----------------|-------------------|-----------|
| `debt_limit` | `balance > debtLimit / 2` | Hysteresis -- prevents thrashing near the limit boundary. Example: if `debtLimit = -300`, recovery occurs when `balance > -150`. |
| `maintenance_grace_expired` | `balance > 0` (strictly positive) | Full deficit recovery required. |

The debt-limit recovery threshold uses `mulDecimalStrings(balance, 2)` compared to `debtLimit` (`auto-suspension.ts:310`), which is mathematically equivalent to `balance > debtLimit / 2` without requiring BigInt division.

### 6.4 Idempotency and Concurrency

**Module-level concurrency guard** (`auto-suspension.ts:27`):

```typescript
let isRunning = false;
```

The `checkAndRunAutoSuspension()` entry point checks this flag at `:327` and returns immediately if another invocation is already in progress. The flag is reset in a `finally` block (`:344`).

**Limitation (FIND-BILL-006):** This is a process-local in-memory boolean. In multi-process deployments (e.g. PM2 cluster), parallel runs can occur. However, the DB-level guards make this safe:

- `softSuspend` WHERE clause requires `suspended_at IS NULL` -- prevents double-suspend
- `unsuspend` WHERE clause requires `suspended_at IS NOT NULL AND suspension_reason IN (...)` -- prevents double-unsuspend
- Monthly maintenance UNIQUE constraint prevents double-charging

**Error isolation:** The top-level try/catch at `:338-343` catches errors from any pass and logs them. However, an error within a specific pass (e.g. a `ReferenceError` in `recoverDebtLimit`) terminates the current pass and all subsequent iterations for that pass. The remaining passes are also skipped because they are sequentially awaited.

---

## 7. Notifications

### 7.1 Deficit Notification

`maybeNotifyDeficit()` (`billing.service.ts:726-810`):

**Trigger:** Called after transaction commit whenever a billing debit produces a negative balance. Called from:
- `wallets.ts:262-264` (after wallet activation debit)
- `billing.service.ts:665` (after monthly maintenance debit)

Always invoked as fire-and-forget: `.catch(() => {})`.

**Cooldown mechanism:**
1. Read `system_config.deficit_email_cooldown_mins` (default: 60 minutes if absent) -- `:733-740`
2. Read `system_config.deficit_email_last_sent.{tenantId}` -- `:744-754`
3. If within cooldown window, return silently
4. Fetch `tenants.contact_email` -- `:758-766`
5. Send email via `sendEmail()` -- `:783`
6. On successful delivery, UPSERT the `deficit_email_last_sent.{tenantId}` key with current timestamp -- `:792-803`
7. On failed delivery, do NOT update cooldown (next debit will retry) -- `:785-788`

**Email content** (`:772-779`): HTML-formatted alert with tenant name and current balance (formatted to 4 decimal places via `parseFloat().toFixed(4)` -- display only).

### 7.2 Suspension/Recovery Emails

**`notifyAutoSuspension()`** (`auto-suspension.ts:78-122`):

Recipients: `tenants.contact_email` UNION `internal_admins` WHERE `is_active = true AND role IN ('super_admin', 'platform_admin')` (`:84-103`). Emails sent individually to each recipient (`:115-117`), each fire-and-forget.

Called after `softSuspend()` in passes 1 and 2 (`:188, 242`).

**`notifyAutoUnsuspend()`** (`auto-suspension.ts:128-157`):

Recipient: `tenants.contact_email` only (`:134-138`). Admin staff are NOT notified of recovery events.

Called after `unsuspend()` in passes 3 and 4 (`:273, 314`).

Both notification functions wrap their entire body in try/catch (`:84/134`) and log errors to console. Failures never propagate to the caller.

---

## 8. Identified Issues

The following billing-related findings are documented in `04-SECURITY-FINDINGS.md` with full evidence and recommendations:

| Finding ID | Severity | Summary | Notes |
|-----------|----------|---------|-------|
| FIND-BILL-001 | HIGH | Undefined `threshold` variable in `recoverDebtLimit()` log message | The finding references `auto-suspension.ts:317`. In the current code at commit `a65e19c`, line 317 uses `t.debtLimit`, not `threshold`. This may have been fixed since the finding was written, or the finding references a different commit. Verify against the finding's commit reference. |
| FIND-BILL-002 | MEDIUM | `parseFloat` used for monetary balance comparison in `enforceMaintGrace` | The finding references `auto-suspension.ts:224` and `:269`. In the current code, both lines use `compareDecimalStrings()`, not `parseFloat()`. Same version caveat as FIND-BILL-001. |
| FIND-BILL-003 | MEDIUM | `checkWalletBillingTx` reads billing policy outside the transaction lock | `getBillingPolicy()` at `billing.service.ts:355` uses the global `db` connection, not the `tx` parameter. TOCTOU window for concurrent policy updates during wallet activation. |
| FIND-BILL-004 | MEDIUM | Env-var API keys bypass scope validation and rate limiting | `tenant-api-key.ts` env-var keys have `source: "env"`, `tenantId: null` -- billing is skipped entirely. |
| FIND-BILL-005 | LOW | No upper-bound validation on credit amounts at service level | `writeBillingCredit` validates `> 0` but has no maximum. Route-level schema enforces `maximum: 100000`. Defense-in-depth gap. |
| FIND-BILL-006 | LOW | Auto-suspension concurrency guard is process-local | `let isRunning` is in-memory only. DB-level idempotency guards (WHERE clauses, UNIQUE constraints) ensure correctness in multi-process scenarios. |
