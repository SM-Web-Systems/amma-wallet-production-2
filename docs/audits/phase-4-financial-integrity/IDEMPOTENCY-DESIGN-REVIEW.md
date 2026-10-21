# IDEMPOTENCY-DESIGN-REVIEW: FIND-UI-004 / UI-224 — Credit Posting Idempotency

**Date:** 2026-10-20
**Reviewer:** Phase 4 automated audit
**Source spec:** `docs/audits/rbac-billing-ui-2026-10-20/13-CREDIT-IDEMPOTENCY-SPEC.md`

---

## 1. Design Review Summary

The Phase 3 idempotency spec proposes adding a `TEXT idempotency_key` column to `billing_events` with a partial unique index `(tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL`. This review evaluates the spec against seven required behaviors.

### Verdict: **APPROVED WITH NOTES**

The design is sound. Minor refinements noted below.

---

## 2. Required Behavior Evaluation

### 2.1 Repeated identical requests must not produce additional credits

**Spec coverage:** Yes. Section 3.4 describes a pre-INSERT `SELECT` check within the transaction. If a matching `(tenant_id, idempotency_key)` exists, the function returns the original result without writing.

**Assessment:** Correct. The SELECT + early return pattern is standard for idempotency. The `duplicate: true` flag in the 200 response allows the client to differentiate.

### 2.2 Concurrent identical requests must not double-credit

**Spec coverage:** Yes. Section 3.4, final paragraph: the `UNIQUE INDEX` catches races where two transactions both pass the SELECT check. The second INSERT fails with a unique constraint violation, triggering a ROLLBACK and retry-read.

**Assessment:** Correct. PostgreSQL's unique index enforcement is serialized even under READ COMMITTED. The ROLLBACK → re-read pattern is the established concurrency-safe approach. However, the spec should specify that the catch block re-reads within a **new** transaction (the failed one cannot continue after a constraint violation under PostgreSQL).

**Refinement:** After catching the unique violation, open a new read-only transaction to fetch the original event. Do not attempt to continue the failed transaction.

### 2.3 Reusing a key with different parameters must be rejected

**Spec coverage:** Yes. Section 3.6 specifies HTTP 409 Conflict when the key matches but amount/type differs.

**Assessment:** Correct. The comparison should check `eventType` and `amountXlm` (the two parameters that define the credit operation). Notes and payment_reference are metadata and should NOT trigger a conflict — reasonable for retry scenarios where the client might attach slightly different metadata.

**Refinement:** Define explicitly which fields are compared: `eventType` and `amountXlm` only. Document that `notes` and `payment_reference` are NOT part of the conflict check.

### 2.4 Network retries must preserve the original operation identity

**Spec coverage:** Yes. Section 3.7 shows the frontend generating a UUID once per user action (at dialog confirmation) and reusing it on retry.

**Assessment:** Correct. `crypto.randomUUID()` generates a cryptographically random UUID v4. Generating at confirmation-click time (not at form-open time) ensures that a new dialog = new key.

### 2.5 Credit posting and idempotency recording must be atomic

**Spec coverage:** Yes. The `idempotency_key` is stored on the `billing_events` row itself — the INSERT that creates the credit IS the idempotency record. No separate table needed.

**Assessment:** Excellent. This is simpler and more reliable than a two-table approach. The billing event and its idempotency key are created in the same INSERT within the same transaction. There is zero window for inconsistency.

### 2.6 Failed transactions must not create inconsistent ledger records

**Spec coverage:** Implicit. PostgreSQL transactions are atomic — if the balance UPDATE fails after the billing_events INSERT, both are rolled back.

**Assessment:** Correct. The existing `db.transaction()` wrapper ensures atomicity. No partial state is possible.

### 2.7 Financial audit logs must remain accurate

**Spec coverage:** Section 3.5 notes that the `auditLog()` call fires after the transaction commits (line 510 in admin.ts). For duplicate requests, the audit log should record the duplicate detection, not a new credit.

**Assessment:** Minor gap. The current `auditLog("admin_credit", ...)` call at line 510 fires regardless of whether the credit was new or duplicate. For duplicates, it should either:
- Not fire (since no financial state changed), or
- Fire with a different action (e.g., `admin_credit_duplicate`) to distinguish

**Recommendation:** Add a `duplicate` field to the audit log detail for duplicate requests, or skip the audit log entirely for duplicates (preferred — no state changed).

---

## 3. Schema Review

### 3.1 Column Addition

```sql
ALTER TABLE billing_events ADD COLUMN idempotency_key TEXT;
```

**Safe:** Adding a nullable column does not lock the table or rewrite rows (PostgreSQL fast-add for nullable columns). No default needed.

### 3.2 Partial Unique Index

```sql
CREATE UNIQUE INDEX CONCURRENTLY uq_billing_credit_idempotency
  ON billing_events (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

**Safe:** `CONCURRENTLY` avoids write locks during index creation. The `WHERE NOT NULL` clause ensures:
- Historical events (NULL key) are unaffected
- Auto-generated events (maintenance, activation) don't need keys
- Only explicit credit operations with keys are deduplicated

### 3.3 Backward Compatibility

- Existing API clients that don't send `idempotency_key`: The spec makes the key **required**. This is a breaking change.
- **Recommendation:** Make `idempotency_key` optional in the schema validation. If omitted, proceed without idempotency protection (legacy behavior). This allows gradual rollout.
- The partial unique index (`WHERE NOT NULL`) already supports this — NULL keys are not constrained.

### 3.4 Rollback Plan

```sql
DROP INDEX CONCURRENTLY uq_billing_credit_idempotency;
ALTER TABLE billing_events DROP COLUMN idempotency_key;
```

**Safe:** Both operations are non-destructive to existing data. The column drop removes the stored keys but doesn't affect balances or event history.

---

## 4. Transaction Behavior Under READ COMMITTED

The spec uses PostgreSQL's default READ COMMITTED isolation. Under this level:

1. **SELECT returns committed data** at statement start — two concurrent SELECTs can both see "no match" for the same key
2. **INSERT with UNIQUE constraint** — only one succeeds; the other gets a unique violation error
3. **The failed transaction must ROLLBACK** — it cannot continue (PostgreSQL aborts the transaction on constraint violation)

This behavior is exactly what the spec relies on. The UNIQUE index serves as the serialization point.

**Alternative considered:** Using `SELECT ... FOR UPDATE` to lock the tenant row before checking for duplicates. This would serialize credit requests per-tenant but is heavier and introduces potential deadlocks. The UNIQUE index approach is lighter and equally correct.

---

## 5. Drizzle ORM Implementation Notes

The schema change requires adding the column to the Drizzle table definition:

```typescript
// In billingEvents table definition:
idempotencyKey: text("idempotency_key"),
```

And the unique index in the table's extra config:

```typescript
// In the (table) => [...] section:
uniqueIndex("uq_billing_credit_idempotency")
  .on(table.tenantId, table.idempotencyKey)
  .where(sql`${table.idempotencyKey} IS NOT NULL`),
```

The `writeBillingCredit` function signature adds an optional `idempotencyKey` parameter.

---

## 6. Comparison to Existing Patterns

The monthly maintenance system has established idempotency:

| Aspect | Maintenance | Credit (Proposed) |
|--------|------------|-------------------|
| Table | `monthlyMaintenanceSnapshots` | `billing_events` (same table) |
| Key | `(tenant_id, billing_period)` | `(tenant_id, idempotency_key)` |
| Index type | Full unique | Partial unique (WHERE NOT NULL) |
| Pre-check | SELECT before INSERT (line 615) | SELECT before INSERT |
| Conflict | Application-level early return | Application + DB constraint catch |

The credit approach is slightly more complex because of the concurrent race handling, but follows the same fundamental pattern.

---

## 7. Implementation Plan

### Step 1: Schema change (Drizzle)
Add `idempotencyKey` column and partial unique index to `billingEvents` table definition.

### Step 2: `writeBillingCredit` modification
Add optional `idempotencyKey` parameter. If provided:
- Pre-INSERT: SELECT for existing event with same (tenantId, idempotencyKey)
- If found: compare eventType and amountXlm; return duplicate or 409
- If not found: INSERT as normal with idempotencyKey
- On UNIQUE violation: catch, re-read in new transaction, return duplicate

### Step 3: Route handler update
- Add `idempotency_key` to schema validation (optional string, UUID format)
- Pass through to `writeBillingCredit`
- Handle duplicate response (skip audit log for duplicates)

### Step 4: Frontend change
- Generate `crypto.randomUUID()` at confirmation-click time
- Include in POST body
- Handle `duplicate: true` in response

### Step 5: Unit tests (8 cases from spec section 5)

### Step 6: DB migration
- `drizzle-kit push` or manual SQL migration
- **GATED: requires explicit approval**

---

## 8. Approval Status

| Item | Status |
|------|--------|
| Design review | **APPROVED** |
| Schema change design | **APPROVED** |
| Unit test preparation | **APPROVED — proceed** |
| Code implementation | **APPROVED — proceed in worktree** |
| DB migration execution | **GATED — requires explicit approval** |
| Production deployment | **GATED — requires explicit approval** |
