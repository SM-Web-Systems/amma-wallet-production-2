import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

// Default mock data
export const mockAdmin = {
  id: 1,
  email: "admin@test.com",
  name: "Test Admin",
  role: "super_admin",
};

export const mockTenants = [
  {
    id: 1,
    slug: "acme",
    name: "ACME Corp",
    contactEmail: "admin@acme.com",
    prepaidXlmBalance: "500.0000000",
    isActive: true,
    suspendedAt: null,
    suspensionReason: null,
  },
  {
    id: 2,
    slug: "beta",
    name: "Beta Inc",
    contactEmail: null,
    prepaidXlmBalance: "2.5000000",
    isActive: true,
    suspendedAt: "2026-10-01T00:00:00Z",
    suspensionReason: "manual",
  },
];

export const mockBilling = {
  tenantId: 1,
  tenantName: "ACME Corp",
  tenantSlug: "acme",
  balance: "500.0000000",
  isActive: true,
  suspendedAt: null,
  suspensionReason: null,
  debtLimit: "-100.0000000",
  acquisitionModeEnabled: true,
  gracePeriodDays: 30,
  recentEvents: [
    {
      id: 10,
      eventType: "manual_topup",
      amountXlm: "100.0000000",
      billingPeriod: null,
      userId: null,
      createdAt: "2026-10-15T10:00:00Z",
      notes: "Initial credit",
    },
  ],
  eventsHasMore: false,
  eventsNextCursor: null,
};

export const mockAdmins = [
  { id: 1, email: "super@test.com", name: "Super Admin", role: "super_admin", isActive: true, createdAt: "2026-01-01T00:00:00Z" },
  { id: 2, email: "platform@test.com", name: "Platform Admin", role: "platform_admin", isActive: true, createdAt: "2026-02-01T00:00:00Z" },
  { id: 3, email: "support@test.com", name: "Support Agent", role: "support_agent", isActive: false, createdAt: "2026-03-01T00:00:00Z" },
];

// Default handlers — happy path
export const handlers = [
  http.post("/api/v1/internal/auth/login", async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string };
    if (body.email === "admin@test.com" && body.password === "correctPassword") {
      return HttpResponse.json({
        token: "mock-jwt-token",
        expiresIn: 3600,
        admin: mockAdmin,
      });
    }
    return HttpResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }),

  http.get("/api/v1/internal/tenants", ({ request }) => {
    const auth = request.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) {
      return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return HttpResponse.json({ tenants: mockTenants });
  }),

  http.get("/api/v1/internal/tenants/:id/billing", ({ request, params }) => {
    const auth = request.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) {
      return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return HttpResponse.json({ ...mockBilling, tenantId: Number(params.id) });
  }),

  http.post("/api/v1/internal/tenants/:id/credit", async ({ request, params }) => {
    const auth = request.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) {
      return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = (await request.json()) as { type: string; amount_xlm: string; notes?: string };
    // REV-06: amount_xlm is now a string (FI-06 precision fix). Pad to 7 decimals.
    const [whole, frac = ""] = body.amount_xlm.split(".");
    const paddedAmount = `${whole}.${frac.padEnd(7, "0").slice(0, 7)}`;
    return HttpResponse.json({
      tenantId: Number(params.id),
      billingEventId: 42,
      bundlePurchaseId: null,
      newBalance: "600.0000000",
      amountCredited: paddedAmount,
      eventType: body.type,
    });
  }),

  http.patch("/api/v1/internal/tenants/:id/suspend", async ({ request, params }) => {
    const auth = request.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) {
      return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = (await request.json()) as { type: string };
    return HttpResponse.json({
      tenantId: Number(params.id),
      type: body.type,
      isActive: body.type === "soft",
      suspendedAt: "2026-10-20T00:00:00Z",
      suspensionReason: "manual",
    });
  }),

  http.patch("/api/v1/internal/tenants/:id/unsuspend", ({ request, params }) => {
    const auth = request.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) {
      return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return HttpResponse.json({
      tenantId: Number(params.id),
      isActive: true,
      suspendedAt: null,
      suspensionReason: null,
    });
  }),

  // P53-01: credit-status reconciliation endpoint — default returns not_found
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
  }),

  http.get("/api/v1/internal/tenants/:id/events", ({ request }) => {
    const auth = request.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) {
      return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return HttpResponse.json({
      events: [],
      hasMore: false,
      nextCursor: null,
    });
  }),

  http.get("/api/v1/internal/admins", ({ request }) => {
    const auth = request.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) {
      return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return HttpResponse.json({ admins: mockAdmins });
  }),

  http.post("/api/v1/internal/admins", async ({ request }) => {
    const auth = request.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) {
      return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = (await request.json()) as { email: string; name: string; role: string; password: string };
    return HttpResponse.json(
      { adminId: 99, email: body.email, name: body.name, role: body.role, isActive: true, createdAt: new Date().toISOString() },
      { status: 201 },
    );
  }),

  http.patch("/api/v1/internal/admins/:id/deactivate", ({ request, params }) => {
    const auth = request.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) {
      return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return HttpResponse.json({ adminId: Number(params.id), email: "user@test.com", role: "support_agent", isActive: false });
  }),

  http.patch("/api/v1/internal/admins/:id/reactivate", ({ request, params }) => {
    const auth = request.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) {
      return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return HttpResponse.json({ adminId: Number(params.id), email: "user@test.com", role: "support_agent", isActive: true });
  }),

  http.post("/api/v1/internal/admins/:id/reset-password", ({ request, params }) => {
    const auth = request.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) {
      return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return HttpResponse.json({ adminId: Number(params.id), email: "user@test.com", role: "support_agent" });
  }),
];

export const server = setupServer(...handlers);
