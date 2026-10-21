# 01-INDEPENDENT-FINDINGS: ChatGPT Review Summary

**Reviewer:** ChatGPT (independent AI review)
**Reviewed commit:** `400574e6a0572b990f0cb031ce301cc8bf29b1af`
**Date of review:** 2026-10-20

---

## Findings

### REV-01 — Pending Credit Key Lost on Page Reload (HIGH)

**Problem:** `pendingCreditKey` lives only in React state (`useState`). If the
admin confirms a credit, gets a network error, and reloads the page, a new UUID
is generated. The original request may have committed, and the retry with a new
key creates a double-credit.

**Root cause:** No durable persistence of the operation identity.

**Resolution:** Persist key + immutable payload to sessionStorage scoped by
tenant ID. Restore on mount. Clear on success/definitive rejection. Keep on
network error.

**Commit:** `91a8a10`

---

### REV-02 — 23505 Recovery Untested at API Level (CRITICAL)

**Problem:** The concurrent idempotency recovery path (23505 unique_violation
catch in admin.ts) was only tested by calling `writeBillingCredit()` directly.
No test exercised the actual Fastify HTTP route.

**Discovery during remediation:** The recovery path was **fundamentally broken**
at the HTTP layer. Drizzle ORM wraps postgres.js errors — `err.code` is
`undefined` on the outer error. The actual PG error with `code: "23505"` and
`constraint_name: "uq_billing_credit_idempotency"` is on `err.cause`.

**Root cause:** `db.transaction()` error wrapping not accounted for.

**Resolution:** Unwrap via `const pgError = err.cause ?? err` before checking
code and constraint_name. Added 10 API-level integration tests.

**Commit:** `6c52bd5`

---

### REV-03 — Destructive Test Database Isolation Not Fully Enforced (HIGH)

**Problem:** Test harness silently fell back to a default database URL.
Integration test files created independent database connection pools bypassing
the safety validator. Marker table verification was absent.

**Resolution:**
- Require explicit `TEST_DATABASE_URL` (no silent fallback)
- Centralize all connections through `createTestConnection()`
- Add marker table (`aw_test_harness_marker`) verification
- Add role verification against allow-list
- Update all test files to use centralized connections

**Commit:** `3117aac`

---

### REV-04 — Bundle Fingerprint Accepts Missing Relationships (MEDIUM)

**Problem:** The idempotency fingerprint check for `bundle_purchase` credits
did inline field comparison without verifying that the linked bundle purchase
record actually exists and belongs to the correct tenant.

**Resolution:** Extract `validateIdempotencyFingerprint()` function that:
- Requires `bundlePurchaseId` for bundle_purchase events (fail-closed)
- Loads the linked record and verifies tenant ownership
- Compares `bundleSlugSnapshot` and `paymentReference`

**Commit:** `969e812`

---

### REV-05 — Migration Documentation and Rollback Are Unsafe (HIGH)

**Problem:**
- Documentation described `ALTER TABLE ADD COLUMN` as "lock-free" — it actually
  takes a brief `AccessExclusiveLock`.
- Rollback plan suggested dropping the column, which destroys financial audit
  data (idempotency keys for live credit operations).
- Documentation did not clarify that the migration must be run via manual SQL
  (not drizzle-kit push/migrate).

**Resolution:** Complete rewrite of migration runbook with corrected lock
behavior, execution method, conditional rollback plan, and verification
checklist.

**Commit:** `8054359`

---

### REV-06 — Numeric-to-String Credit API Transition May Break Clients (MEDIUM)

**Problem:** Phase 5 changed `amount_xlm` from JSON number to JSON string.
The Fastify schema now rejects numeric values with HTTP 400.

**Resolution:** Analyzed all known consumers (only the admin web UI, which
already sends strings). Documented the canonical API contract. Added 7 schema
validation integration tests. No code change needed — the strict string
contract is correct.

**Commit:** `8054359`

---

### REV-07 — PostgreSQL 23505 Classification Is Too Permissive (MEDIUM)

**Problem:** The 23505 catch block accepted an empty constraint name
(`constraintName === ""`) alongside the expected constraint. This could
misclassify unrelated unique violations as idempotency duplicates.

**Resolution:** Remove the empty-name acceptance. Only match
`constraintName === "uq_billing_credit_idempotency"`.

**Commit:** `969e812`
