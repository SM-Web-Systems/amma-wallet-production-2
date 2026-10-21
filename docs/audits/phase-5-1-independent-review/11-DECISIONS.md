# 11-DECISIONS: Architectural and Design Decisions

---

## D1: String-Only amount_xlm (REV-06)

**Decision:** Keep strict `type: "string"` schema. Do not add numeric coercion.

**Rationale:** The only known consumer sends strings. Coercion reintroduces
IEEE 754 precision loss. The endpoint is internal-only (admin JWT required).

**Trade-off:** Any undiscovered external client sending numeric amounts will
break with HTTP 400.

**Mitigation:** If external clients are later found, add API versioning
(`X-API-Version`) rather than silently coercing.

---

## D2: sessionStorage vs localStorage (REV-01)

**Decision:** Use `sessionStorage` for pending credit key persistence.

**Rationale:**
- `sessionStorage` is scoped to the browser tab/window — closing the tab
  clears it, which is appropriate for a pending operation.
- `localStorage` would persist across browser restarts, potentially presenting
  stale pending operations days later.
- The threat model is "admin refreshes page during a network error" — same
  session, same tab.

**Trade-off:** Closing and reopening the browser loses the pending key.
Acceptable because server-side idempotency still prevents double-credits from
the original request.

---

## D3: Preserve Column on Application Rollback (REV-05)

**Decision:** Do NOT drop `idempotency_key` column when rolling back the
application to the pre-idempotency version.

**Rationale:** Once live credit operations use idempotency keys, the column
contains financial audit data. Dropping it destroys evidence of which credits
were duplicate-protected.

**Trade-off:** The old application ignores the column (it doesn't reference it
in any query), so preserving it has zero operational impact.

---

## D4: Fail-Closed Bundle Fingerprint (REV-04)

**Decision:** If a bundle_purchase duplicate is detected but the linked
`tenantBundlePurchases` record is missing or belongs to a different tenant,
return 409 (conflict) rather than 200 (duplicate accepted).

**Rationale:** A missing or mismatched record indicates data inconsistency.
Accepting the duplicate without verification could mask a real problem.

**Trade-off:** A legitimate duplicate where the bundle purchase record was
somehow deleted would be rejected. This is extremely unlikely and the safer
default.

---

## D5: SEC-01 Tenant-Scoped RBAC (Deferred)

**Decision:** Document the recommendation but do not implement.

**Rationale:** Currently, any `super_admin` or `platform_admin` can post
credits to any tenant. Restricting to assigned tenants is a product-level
authorization decision, not a bug fix.

**Action required:** Product owner must authorize the scope change before
implementation.

---

## D6: Schema Expansion Timing (REV-05)

**Decision:** Expand-then-deploy. Run the migration before deploying the new
application.

**Rationale:**
- Old application + expanded schema = safe (column ignored).
- New application + old schema = fails (column referenced but missing).
- Therefore: schema expansion must precede application deployment.

**Alternative considered:** Contract-then-deploy (deploy app first, which
handles missing column gracefully). Rejected because the idempotency INSERT
would fail without the column.
