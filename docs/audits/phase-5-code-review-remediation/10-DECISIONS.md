# 10-DECISIONS: Phase 5 Architecture Decision Log

**Date:** 2026-10-20

---

## D1: Docker Port Mapping and Runtime Verification

**Decision:** Runtime database identity check uses `SELECT current_database()` only, not `inet_server_port()`.

**Context:** Integration tests connect to localhost:15432, which Docker maps to container port 5432. `inet_server_port()` returns 5432 (the container-internal port), not 15432. This caused a false safety block.

**Outcome:** URL-level validation checks host, port, and database name. Runtime verification only confirms database name via `current_database()`. This is sufficient because the URL already validated we're connecting to the right host:port.

## D2: Concurrent Idempotency — Two Resolution Paths

**Decision:** Accept both resolution paths for concurrent duplicate requests.

**Context:** Under PostgreSQL READ COMMITTED, when two transactions race with the same idempotency key:
- **Path A:** Node.js event loop serializes the async operations. The second transaction's SELECT finds the already-committed event and returns `duplicate: true`. Both promises succeed.
- **Path B:** True concurrent execution. Both INSERTs race, one wins, the loser gets PostgreSQL error code 23505 (unique_violation). The failed transaction is caught and recovered.

**Outcome:** Tests accept either path. The financial invariant (exactly one credit, balance increases exactly once) is verified regardless of which path executed.

## D3: Bundle Fingerprint via JOIN, Not Column Duplication

**Decision:** Compare `bundleSlugSnapshot` and `paymentReference` by JOINing to `tenant_bundle_purchases` instead of adding columns to `billing_events`.

**Context:** The initial approach tried to read these fields directly from `billing_events`, but they don't exist there — they live in `tenant_bundle_purchases`, linked via `bundlePurchaseId` FK.

**Outcome:** The idempotency check queries the linked purchase record via FK JOIN. No schema migration needed. The comparison is correct and doesn't duplicate data.

## D4: String Pipeline for XLM Amounts

**Decision:** Send `amount_xlm` as a JSON string, not a number.

**Context:** IEEE 754 float64 cannot represent some 7-decimal Stellar amounts exactly. `parseFloat("0.1000001")` → `0.10000009999999999...` → `.toFixed(7)` → `"0.1000010"` (wrong). The billing service already had precision-safe `toStroops()` bigint arithmetic, but the string was corrupted before it reached that function.

**Outcome:** Frontend validates with regex and sends the raw string. Backend Fastify schema changed from `{ type: "number" }` to `{ type: "string", pattern: ... }`. Backend pads to 7 decimals via string split/pad. Zero float intermediaries in the credit pipeline.

## D5: Remove bundle_purchase Rather Than Build Selector

**Decision:** Remove `bundle_purchase` from the credit form dropdown rather than building a bundle catalog selector.

**Context:** The form offered bundle_purchase as a type option, but there was no bundle selector UI — every attempt would fail with "bundle_slug is required".

**Outcome:** Smallest safe fix with zero risk of accidentally posting a malformed bundle purchase. A proper bundle purchase flow with catalog selection can be built as a separate feature.

## D6: SEC-01 Deferred to Product Decision

**Decision:** Document the RBAC gap but do not implement enforcement in Phase 5.

**Context:** `admin_tenant_assignments` exists in the schema but is not enforced by any route handler. Implementing enforcement requires a product decision on whether to scope, remove roles, or accept flat access.

**Outcome:** BLOCKED — documented in `04-SECURITY-REMEDIATION.md`. No code change. Flagged for next sprint.
