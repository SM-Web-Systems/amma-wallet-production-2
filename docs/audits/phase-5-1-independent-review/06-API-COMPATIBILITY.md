# 06-API-COMPATIBILITY: Credit API Numeric-to-String Migration (REV-06)

**Finding:** REV-06 — Numeric-to-string credit API transition may break clients
**Severity:** MEDIUM
**Status:** VERIFIED — documented with test evidence

---

## 1. Change Summary

Commit `22e45e6` (B1/FI-06) changed the `amount_xlm` field in the POST
`/api/v1/internal/tenants/:id/credit` request body from:

```json
{ "type": "number", "exclusiveMinimum": 0, "maximum": 100000 }
```

to:

```json
{ "type": "string", "pattern": "^\\d+(\\.\\d{1,7})?$", "maxLength": 30 }
```

This is a **breaking change** for any client that sends a JSON number.

## 2. Motivation

IEEE 754 double-precision floating-point cannot represent all 7-decimal Stellar
amounts exactly. For example, `0.1000001` becomes `0.10000009999999999` in
JavaScript `Number`. Sending the amount as a JSON string preserves exact
decimal representation through the entire pipeline:

```
Frontend string → JSON string → Fastify string → bigint stroops → PostgreSQL numeric
```

No floating-point conversion occurs at any stage.

## 3. Client Discovery

### 3.1 Known Consumers

| Consumer | File | Sends String? | Status |
|----------|------|---------------|--------|
| Admin credit form | `packages/web-app/src/pages/AdminTenantDetail.tsx:243` | Yes | Compatible |
| Integration tests | `packages/backend/src/test-integration/api-credit-concurrency.test.ts` | Yes | Compatible |
| Integration tests | `packages/backend/src/test-integration/admin-billing.integration.test.ts` | Yes | Compatible |

### 3.2 External Consumers

The credit endpoint path is `/api/v1/internal/tenants/:id/credit`. The `internal`
path segment and the `verifyInternalAdmin` middleware indicate this is **not a
public API**. Access requires:

1. A valid admin JWT signed with `ADMIN_JWT_SECRET`.
2. The admin must have `super_admin` or `platform_admin` role.
3. The admin must be active (`isActive = true`).

No external API clients, SDK wrappers, scripts, or third-party integrations
were found in the repository. The endpoint is consumed exclusively by the
admin web UI.

### 3.3 Stale Test Fixtures

| File | Issue | Impact |
|------|-------|--------|
| `packages/backend/src/routes/admin-billing.test.ts` | Inlined handler copy still uses `Number(amount_xlm)`. All 17+ test cases send `amount_xlm` as a number. | Tests pass but exercise the old handler, not the real route. Does not affect production. |
| `packages/web-app/src/test/msw-server.ts` | ~~Type annotation said `amount_xlm: number`~~ (fixed in this remediation). | MSW mock now correctly types as `string` with string-based padding. |

The stale `admin-billing.test.ts` inlined handler is a pre-existing issue
outside the scope of this remediation. It should be refactored in a follow-up
to either test the real route (via `app.inject()`) or update the inlined copy
to match the current string-based validation.

### 3.4 Limitations

Consumer discovery is limited to this repository. If external automation or
scripts exist outside the codebase that call this endpoint with numeric
`amount_xlm`, they will receive HTTP 400 after this change.

## 4. Compatibility Strategy

### Current: Strict String-Only (Chosen)

The Fastify JSON Schema enforces `type: "string"` with a pattern. Numeric
values are rejected at the schema validation layer with HTTP 400 before
reaching the handler.

**Rationale:** The only known consumer already sends strings. Accepting both
types would require coercion logic that reintroduces the precision risk the
change was designed to eliminate.

### Alternative: Coercion (Not Recommended)

Accepting `oneOf: [{ type: "string" }, { type: "number" }]` and coercing
numbers to strings would maintain backward compatibility but:

- Reintroduces IEEE 754 precision loss for amounts like `0.1000001`.
- Adds complexity to distinguish "safe" integers from unsafe decimals.
- Provides false assurance — the coerced string may differ from the intended
  amount.

**Decision: Do not add numeric coercion. The strict string contract is correct.**

## 5. Schema Contract (Canonical)

```
POST /api/v1/internal/tenants/:id/credit
Authorization: Bearer <admin-jwt>
Content-Type: application/json

{
  "type": "manual_topup" | "bundle_purchase",
  "amount_xlm": "<string: /^\\d+(\\.\\d{1,7})?$/  maxLength 30>",
  "idempotency_key": "<uuid-v4: /^[0-9a-f]{8}-...-[0-9a-f]{12}$/>",
  "notes": "<optional string, maxLength 500>",
  "bundle_slug": "<optional string, maxLength 100>",
  "payment_reference": "<optional string, maxLength 200>"
}

additionalProperties: false
```

### Accepted Formats

| Input | Accepted? | Notes |
|-------|-----------|-------|
| `"100"` | Yes | Whole number as string |
| `"100.0000000"` | Yes | Full 7-decimal precision |
| `"0.1000001"` | Yes | Sub-stroops precision preserved |
| `100` | **No** | Numeric — HTTP 400 |
| `"100.12345678"` | **No** | 8 decimals — exceeds pattern |
| `"-50"` | **No** | Negative — pattern requires `\d+` |
| `""` | **No** | Empty — does not match pattern |

## 6. Test Evidence

7 integration tests in `api-credit-concurrency.test.ts` verify the schema:

| Test | Expected | Result |
|------|----------|--------|
| Numeric `amount_xlm: 100` rejected | 400 | PASS |
| Excessive decimals `"100.12345678"` rejected | 400 | PASS |
| Negative `"-50.0000000"` rejected | 400 | PASS |
| Valid string `"0.1000001"` accepted | 200 | PASS |
| Whole number string `"50"` accepted | 200 | PASS |
| Missing `amount_xlm` rejected | 400 | PASS |
| Unknown property rejected | 400 | PASS |

## 7. Recommendation

No code change required. The string-only contract is correct and all known
consumers are compatible. If external clients are later discovered that send
numeric amounts, add an API version header (`X-API-Version: 2`) rather than
silently coercing numbers to strings.
