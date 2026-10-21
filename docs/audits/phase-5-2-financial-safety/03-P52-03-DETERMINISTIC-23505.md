# 03-P52-03: Deterministic 23505 Recovery Verification

**Finding:** P52-03 — 23505 recovery path not deterministically tested
**Severity:** P1
**Status:** RESOLVED

---

## Problem

Phase 5.1 tested the 23505 (unique_violation) recovery path through
`Promise.all` races — two concurrent requests with the same idempotency key.
This approach is non-deterministic: the race may or may not trigger the specific
code path depending on timing.

## Solution

### Deterministic Pre-Insert Strategy

Instead of relying on timing, the test directly inserts a billing event into
the database with a known idempotency key using the test harness's `testDb`,
then calls the Fastify route with the same key. This guarantees the route's
`INSERT` attempt hits the `uq_billing_credit_idempotency` unique constraint.

### What This Proves

1. **Drizzle error unwrapping**: postgres.js errors are wrapped by Drizzle ORM
   in `err.cause`. The catch block correctly checks `err.cause.code === "23505"`.
2. **Constraint name verification**: The recovery only triggers for
   `uq_billing_credit_idempotency`, not unrelated unique violations.
3. **Re-read correctness**: After catching 23505, the route re-reads the
   committed event and returns its data.
4. **Fingerprint validation**: If the retry has different parameters, the route
   returns 409 even through the 23505 path.
5. **Exactly-once billing**: No new billing event is created by the recovery.
6. **Reconciliation integration**: The reconciliation endpoint finds the
   pre-inserted event after 23505 recovery.

## Tests Added

In `api-credit-concurrency.test.ts`, describe block `P52-03: deterministic 23505 recovery`:

| Test | What it proves |
|------|---------------|
| route recovers from 23505 and returns duplicate:true | Full recovery path works |
| exactly one billing event exists after recovery | No double-credit |
| 23505 recovery rejects fingerprint mismatch | Different amount → 409 |
| 23505 recovery preserves Drizzle error unwrapping | err.cause chain works |
| reconciliation finds pre-inserted event after recovery | End-to-end integration |

## Technical Detail

```typescript
// Pre-insert billing event directly (bypassing the route)
await testDb.insert(schema.billingEvents).values({
  tenantId, eventType: "manual_topup", amountXlm: "100.0000000",
  idempotencyKey: key, createdBy: `admin:${adminId}`,
}).returning({ id: schema.billingEvents.id });

// Update tenant balance to match
await testDb.update(schema.tenants).set({
  prepaidXlmBalance: sql`... + amount`,
}).where(...);

// Now call the route — guaranteed 23505
const res = await creditRequest(key, "100.0000000");
expect(res.statusCode).toBe(200);
expect(res.json().duplicate).toBe(true);
```
