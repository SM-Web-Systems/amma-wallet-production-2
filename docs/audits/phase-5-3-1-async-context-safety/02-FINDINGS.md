# 02 — Findings

## P53-R01: Delayed Async Responses Modify State After Context Change

| Field | Value |
|-------|-------|
| **Severity** | HIGH |
| **Category** | Async state safety / UI integrity |
| **Component** | `AdminTenantDetail.tsx` |
| **Root cause** | Async functions capture `id` and state in closures; after `await`, they call React state setters (`setCreditOp`, `setData`, etc.) that modify shared component state regardless of current tenant context |

### Description

When an admin navigates from tenant A to tenant B while an async operation is in-flight:

1. The in-flight async function holds a **stale closure** containing tenant A's `id`
2. The `useEffect([id])` fires and clears state for the new tenant (P53-02 fix)
3. The stale response arrives and calls state setters (`setData`, `setCreditOp`, `setAllEvents`, etc.)
4. These setters are **not tenant-scoped** — they overwrite the freshly-initialized state for tenant B with tenant A's data

### Affected Functions

| Function | Lines | State Setters After Await |
|----------|-------|---------------------------|
| `load()` | 114-138 | `setData`, `setAllEvents`, `setEventsHasMore`, `setEventsNextCursor`, `setLoading`, `setError` |
| `handlePostCredit()` | 243-313 | `setCreditOp` (via `updateCreditOp`), `load()` |
| `handleCheckStatus()` | 321-371 | `setCreditOp` (via `updateCreditOp`), `setReconcileError`, `setReconciling`, `load()` |
| `loadOlderEvents()` | 390-411 | `setAllEvents`, `setEventsHasMore`, `setEventsNextCursor`, `setLoadingOlder` |
| `submitStatusAction()` | 419-441 | `setSuspendBusy`, `setSuspendError`, `load()` |

### Financial Impact

- **Direct:** None — `saveCreditOp()` uses the operation's own `tenantId`/`adminId`, so storage writes are always correctly scoped
- **Indirect:** HIGH — Admin sees wrong tenant's data/status, which could lead to incorrect operational decisions (e.g., posting a credit to the wrong tenant after seeing stale balance data)

### Existing Mitigations

- P53-02 pre-flight identity guards block outgoing requests for wrong tenant
- Storage layer is correctly scoped by `(adminId, tenantId)`
- Idempotency key prevents duplicate credits even if retry is attempted

### What Mitigations Do NOT Cover

- **Incoming** response state writes after navigation
- `setCreditOp()` called from `updateCreditOp` after a stale response
- `load()` called from async handlers using a closure-captured reference
- `setData()` from a stale `load()` execution

---

## P53-R02: Phase 5.3 Tests Mask Same-Component Navigation Races

| Field | Value |
|-------|-------|
| **Severity** | MEDIUM |
| **Category** | Test coverage gap |
| **Component** | `AdminTenantDetail.test.tsx` |
| **Root cause** | Tests use unmount/remount pattern (separate MemoryRouter renders) instead of same-component React Router navigation |

### Description

The Phase 5.3 P53-02 tests (L624-877) validate tenant isolation by:

1. Rendering component for tenant A
2. Performing actions
3. **Unmounting** the component
4. Rendering a **new** component instance for tenant B

This unmount/remount pattern naturally resets ALL React state (useState hooks return initial values on mount), which makes the tests pass regardless of whether the identity guards or state-clearing logic exists.

In production, React Router **reuses** the component instance — navigation from `/admin/tenants/1` to `/admin/tenants/2` only changes the `id` param, keeping all existing state. The P53-R01 defect is invisible to these tests.

### Specific Tests Affected

| Test | Pattern Used | Why It Doesn't Catch P53-R01 |
|------|-------------|-------------------------------|
| "navigating to different tenant clears stale credit operation" | unmount + re-render | State naturally cleared by unmount |
| "blocks credit submission when operation belongs to different tenant" | fresh render for tenant 2 | No stale async response possible |
| "blocks reconciliation against wrong tenant" | fresh render for tenant 2 | Same |
| "navigating back to original tenant restores its operation" | fresh render | State restored from storage (correct) but no async race |
| "admin B cannot see admin A's pending operation" | fresh render as admin B | Correct storage scoping, no async component |

### Required Test Pattern

Tests must use **same-component navigation** with deferred promises:

1. Render with `MemoryRouter` containing routes
2. Start async operation on tenant A
3. **Control** when the response resolves using a deferred promise
4. Navigate to tenant B **within the same MemoryRouter** (programmatic or Link click)
5. Resolve the deferred promise (tenant A's response arrives)
6. Assert: tenant B's display is NOT corrupted by tenant A's response
