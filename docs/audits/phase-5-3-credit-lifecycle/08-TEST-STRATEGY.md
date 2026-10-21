# 08 — Test Strategy

## Testing Framework

- **Runner:** Vitest 4.x
- **Environment:** jsdom
- **Component testing:** @testing-library/react + @testing-library/user-event
- **Network mocking:** MSW (Mock Service Worker) 2.x
- **Config:** `packages/web-app/vitest.config.ts`
- **Setup:** `packages/web-app/src/test/setup.ts` (jest-dom matchers, MSW server lifecycle)

## Test Organization

All new tests added to existing test files alongside existing tests.

### P53-01 Tests (AdminTenantDetail.test.tsx)

| Test | Demonstrates | Expected Pre-Fix | Expected Post-Fix |
|------|-------------|------------------|-------------------|
| `not_found` keeps op in UNKNOWN | INV-2, INV-3 | FAIL (transitions to REJECTED) | PASS |
| UUID preserved after `not_found` | INV-1 | FAIL (key accessible but op rejected) | PASS |
| Retry after `not_found` uses original UUID | INV-1, INV-8 | FAIL (can acknowledge → new key) | PASS |
| `committed` resolves to COMMITTED | Existing correct behavior | PASS | PASS |
| Network error on status check stays UNKNOWN | INV-7 | PASS | PASS |
| Reload preserves UNKNOWN op | INV-1 | PASS | PASS |
| Reconciliation is read-only (no POST) | INV-6 | PASS | PASS |

### P53-02 Tests (AdminTenantDetail.test.tsx)

| Test | Demonstrates | Expected Pre-Fix | Expected Post-Fix |
|------|-------------|------------------|-------------------|
| Tenant navigation clears stale op | INV-11, INV-4 | FAIL (stale op persists) | PASS |
| Cannot POST credit to wrong tenant | INV-4 | FAIL (no guard) | PASS |
| Cannot reconcile against wrong tenant | INV-4 | FAIL (no guard) | PASS |
| Navigate back restores correct op | INV-11 | PASS (storage is correct) | PASS |
| Admin B cannot see admin A's op | INV-5 | PASS (storage scoped) | PASS |
| Missing admin identity blocks actions | INV-5 | PASS (existing guard) | PASS |

### Existing credit-op-storage.test.ts

No changes needed. Existing tests cover storage scoping, corruption safety, and state persistence. They remain valid and should continue passing.

## MSW Handler Additions

The existing MSW server has no handler for `GET /api/v1/internal/tenants/:id/credit-status`. A handler must be added for reconciliation tests.

```typescript
// Added to msw-server.ts handlers:
http.get("/api/v1/internal/tenants/:id/credit-status", ({ request, params }) => {
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const key = url.searchParams.get("idempotency_key");
  return HttpResponse.json({
    status: "not_found",
    billingEventId: null,
    amountXlm: null,
    eventType: null,
    createdAt: null,
    tenantId: Number(params.id),
    idempotencyKey: key,
  });
});
```

Individual tests override this handler via `server.use(...)` to return `"committed"` or `"not_found"` as needed.

## Test Quality Requirements

1. Tests exercise the real AdminTenantDetail component rendered with MemoryRouter.
2. Network responses are mocked via MSW (not by stubbing fetch directly).
3. State transitions are verified by observing UI changes (text content, button state, error messages).
4. No arbitrary delays — use `waitFor` for async assertions.
5. Each regression test must fail for the expected reason against the baseline code.
6. Removing the fix must cause the regression test to fail again.

## Async Testing Pattern

For P53-02 rapid navigation tests, use controlled promises to simulate delayed responses:

```typescript
// Create a deferred promise to control when the fetch resolves
let resolveCredit: () => void;
const creditPromise = new Promise<void>(r => { resolveCredit = r; });

server.use(
  http.post("/api/v1/internal/tenants/:id/credit", async () => {
    await creditPromise; // Hold the response
    return HttpResponse.json({ ... });
  })
);
```

## Test Execution Commands

```bash
# Run all frontend tests
cd packages/web-app && npx vitest run

# Run only the files under test
cd packages/web-app && npx vitest run src/pages/AdminTenantDetail.test.tsx src/lib/credit-op-storage.test.ts

# Run with verbose output
cd packages/web-app && npx vitest run --reporter=verbose
```
