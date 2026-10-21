# 00 — Baseline

## Repository
- **Org/Repo:** SM-Web-Systems/amma-wallet-production
- **Baseline commit:** `0b8ae0b84c97335917d8d833ecde673cb2d1c396`
- **Baseline branch:** `fix/phase-5-2-financial-safety`
- **Working branch:** `fix/phase-5-3-credit-lifecycle`
- **Worktree path:** `.claude/worktrees/phase-5-3`

## Files Under Assessment

| File | Role |
|------|------|
| `packages/web-app/src/pages/AdminTenantDetail.tsx` | Primary — credit posting UI + state machine |
| `packages/web-app/src/lib/credit-op-storage.ts` | Credit operation sessionStorage persistence |
| `packages/web-app/src/lib/admin-api.ts` | Admin fetch helper + identity accessor |
| `packages/backend/src/routes/admin.ts` | Backend admin routes (credit POST + credit-status GET) |
| `packages/backend/src/services/billing.service.ts` | writeBillingCredit, idempotency, fingerprint validation |

## Existing Tests
| File | Coverage |
|------|----------|
| `credit-op-storage.test.ts` | Storage key format, round-trip, admin/tenant isolation, corruption safety |
| `AdminTenantDetail.test.tsx` | Rendering, validation, confirm dialog, suspend/unsuspend, pagination, auth errors |
| `msw-server.ts` | MSW handlers for billing, credit, suspend/unsuspend, admin management |

## Scope
Only **P53-01** (financial reconciliation race) and **P53-02** (tenant/admin context safety).

## Prior Work
Phase 5.2 introduced the credit state machine (CONFIRMED → SUBMITTING → COMMITTED|UNKNOWN|REJECTED), sessionStorage persistence keyed by (adminId, tenantId), and the credit-status reconciliation endpoint.
