# 02-FINANCIAL-IDEMPOTENCY-SPEC: Credit Posting Idempotency Design

**Date:** 2026-10-20
**Findings addressed:** FI-01 (A2), FI-02 (A3), FI-03 (A4), FI-05 (A5)

---

## 1. Problem

Manual credit posting (top-up, bundle purchase) lacked idempotency protection. A network timeout followed by a retry could result in a double credit — a direct financial loss.

## 2. Design

### 2.1 Idempotency Key

Each credit request carries a UUID v4 `idempotency_key`. The key is:
- **Generated once** at user confirmation (not at form render).
- **Persisted in React state** (`pendingCreditKey`) across retries.
- **Cleared only on confirmed success** (or when the user changes the amount/type).

### 2.2 Database Enforcement

```
billing_events
├── idempotency_key  TEXT (nullable)
└── UNIQUE INDEX uq_billing_credit_idempotency
    ON (tenant_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL
```

- **Nullable:** Historical events and auto-generated events (wallet activation, maintenance) have NULL keys and are unaffected.
- **Partial index:** Only enforced when `idempotency_key IS NOT NULL`.
- **Tenant-scoped:** The same key can be used by different tenants without conflict.

### 2.3 Application-Level Check (SELECT-then-INSERT)

Inside `writeBillingCredit`, before INSERT:

```
1. SELECT existing FROM billing_events
   WHERE tenant_id = ? AND idempotency_key = ?
2. If found:
   a. Compare immutable fingerprint (eventType, amountXlm, bundleSlug, paymentRef)
   b. If match → return { duplicate: true, billingEventId, newBalance }
   c. If mismatch → throw 409 Conflict
3. If not found → proceed with INSERT
```

### 2.4 Concurrent Conflict Recovery (23505)

Under PostgreSQL READ COMMITTED, two transactions can both pass the SELECT check and race to INSERT. The loser gets error code 23505 (unique_violation). Recovery:

```
catch (err) {
  if (err.code === "23505" && idempotency_key) {
    // Failed tx is rolled back. Re-read the committed event:
    const committed = SELECT ... WHERE idempotency_key = ?
    // Verify fingerprint match, return idempotent result.
  }
}
```

### 2.5 Immutable Fingerprint (FI-05)

The changed-payload check compares:

| Field | Source | Compared for |
|-------|--------|-------------|
| `eventType` | `billing_events.event_type` | All credit types |
| `amountXlm` | `billing_events.amount_xlm` | All credit types |
| `bundleSlugSnapshot` | `tenant_bundle_purchases.bundle_slug_snapshot` | bundle_purchase only |
| `paymentReference` | `tenant_bundle_purchases.payment_reference` | bundle_purchase only |

Bundle fields are fetched via JOIN through `billing_events.bundle_purchase_id` FK.

**Not compared** (mutable metadata): `notes`, `createdBy`.

## 3. Precision Pipeline (FI-06)

The amount string flows without float conversion:

```
Frontend input "0.1000001"
  → JSON: { "amount_xlm": "0.1000001" }     (string, not number)
  → Fastify schema: type: "string", pattern   (regex validation)
  → Handler: string split/pad → "0.1000001"  (7 decimal places)
  → writeBillingCredit: toStroops() → 1000001n (bigint)
  → PostgreSQL: numeric(18,7) → exact storage
```

No `parseFloat` or `Number()` intermediary.

## 4. Migration Strategy

See `03-DATABASE-MIGRATION-PLAN.md` for deployment steps. Key points:
- Column add: instant (nullable, no default)
- Index: `CREATE UNIQUE INDEX CONCURRENTLY` (no write locks)
- Backward compatible: old code ignores the column
- Rollback: `DROP INDEX` + `DROP COLUMN`

## 5. Test Coverage

| Aspect | Tests | File |
|--------|-------|------|
| Unit: duplicate detection | 8 | billing.service.test.ts |
| Unit: fingerprint expansion | 5 | billing.service.test.ts |
| Unit: route handler idempotency | 14 | admin-credit-idempotency.test.ts |
| Integration: migration | 9 | migration-idempotency.test.ts |
| Integration: concurrent race | 6 | concurrent-idempotency.test.ts |
| **Total** | **42** | |
