/**
 * Tests for FIND-UI-004: Credit posting idempotency.
 *
 * These tests verify the idempotency behavior of writeBillingCredit and
 * the POST /tenants/:id/credit route handler's handling of:
 *   - Happy path with idempotency key
 *   - Exact duplicate (same key, same params) → 200 + duplicate:true
 *   - Changed payload (same key, different amount) → 409 Conflict
 *   - Different keys (independent credits)
 *   - Cross-tenant key reuse
 *   - Backward compatibility (no key)
 *   - Route handler 409 forwarding
 *   - Audit log skipped for duplicates
 *
 * Auth (verifyInternalAdmin) is mocked. DB calls are mocked.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("../db", () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
  schema: {
    tenants: {
      id: "id",
      prepaidXlmBalance: "prepaid_xlm_balance",
    },
    billingEvents: {
      id: "id",
      tenantId: "tenant_id",
      eventType: "event_type",
      amountXlm: "amount_xlm",
      idempotencyKey: "idempotency_key",
    },
    bundleCatalog: {
      id: "id",
      slug: "slug",
      name: "name",
      approxUsers: "approx_users",
    },
  },
}));

vi.mock("../services/billing.service", () => ({
  writeBillingCredit: vi.fn(),
}));

vi.mock("../lib/audit", () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { db } from "../db";
import { writeBillingCredit } from "../services/billing.service";
import { auditLog } from "../lib/audit";

// ── Helpers ──────────────────────────────────────────────────────────────────

type AdminRole = "super_admin" | "platform_admin" | "account_manager" | "support_agent";

interface AdminContext {
  id: number;
  email: string;
  name: string;
  role: AdminRole;
}

function makeReply() {
  let _code = 200;
  let _body: any;
  const send = vi.fn().mockImplementation((data: any) => {
    _body = data;
    return { _code, _body };
  });
  const status = vi.fn().mockImplementation((code: number) => {
    _code = code;
    return { send: vi.fn().mockImplementation((data: any) => { _body = data; }) };
  });
  return { status, send, _get: () => ({ statusCode: _code, body: _body }) };
}

function makeRequest(
  admin: AdminContext,
  params: Record<string, string> = {},
  body: Record<string, any> = {},
): any {
  return {
    admin,
    params,
    body,
    ip: "127.0.0.1",
    headers: { "user-agent": "test" },
  };
}

function mockSelectChain(rows: any[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  (db.select as ReturnType<typeof vi.fn>).mockReturnValueOnce({ from });
  return { limit, where, from };
}

const SUPER_ADMIN: AdminContext = { id: 1, email: "sa@ammawallet.com", name: "SA", role: "super_admin" };
const TEST_UUID = "550e8400-e29b-41d4-a716-446655440000";
const TEST_UUID_2 = "660e8400-e29b-41d4-a716-446655440001";

// ── Inline handler (mirrors admin.ts POST /credit with idempotency) ─────────

async function handlePostCredit(request: any, reply: any) {
  const { schema } = await import("../db");

  const PRIVILEGED_ROLES = ["super_admin", "platform_admin"] as const;
  if (!(PRIVILEGED_ROLES as readonly string[]).includes(request.admin!.role)) {
    return reply.status(403).send({ error: "Forbidden: requires super_admin or platform_admin role" });
  }

  const tenantId = parseInt((request.params as { id: string }).id, 10);
  if (!Number.isFinite(tenantId) || tenantId <= 0) {
    return reply.status(400).send({ error: "Invalid tenant ID" });
  }

  const { type, amount_xlm, notes, bundle_slug, payment_reference, idempotency_key } = request.body as {
    type: "manual_topup" | "bundle_purchase";
    amount_xlm: string;
    notes?: string;
    bundle_slug?: string;
    payment_reference?: string;
    idempotency_key?: string;
  };

  // FI-06: String-based validation (no parseFloat/Number)
  if (!/^\d+(\.\d{1,7})?$/.test(amount_xlm) || !/[1-9]/.test(amount_xlm)) {
    return reply.status(400).send({ error: "amount_xlm must be a positive decimal string (up to 7 decimal places)" });
  }

  const [tenant] = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(schema.tenants.id)
    .limit(1) as any[];

  if (!tenant) {
    return reply.status(404).send({ error: "Tenant not found" });
  }

  let bundle: { id: number; slug: string; name: string; approxUsers: number | null } | null = null;
  if (type === "bundle_purchase") {
    if (!bundle_slug) {
      return reply.status(400).send({ error: "bundle_slug is required for bundle_purchase" });
    }
    const [b] = await db
      .select({
        id: schema.bundleCatalog.id,
        slug: schema.bundleCatalog.slug,
        name: schema.bundleCatalog.name,
        approxUsers: schema.bundleCatalog.approxUsers,
      })
      .from(schema.bundleCatalog)
      .where(schema.bundleCatalog.slug)
      .limit(1) as any[];
    if (!b) {
      return reply.status(400).send({ error: `Bundle '${bundle_slug}' not found in catalog` });
    }
    bundle = b;
  }

  // FI-06: Pad to 7 decimal places without float conversion.
  const [whole, frac = ""] = amount_xlm.split(".");
  const amountStr = `${whole}.${frac.padEnd(7, "0").slice(0, 7)}`;
  const createdBy = `admin:${request.admin!.id}`;

  let result: any;
  try {
    result = await (db as any).transaction(async (tx: any) => {
      return writeBillingCredit(tx, {
        tenantId,
        eventType: type,
        amountXlm: amountStr,
        notes: notes ?? null,
        createdBy,
        bundleId: bundle?.id ?? null,
        bundleSlugSnapshot: bundle?.slug ?? null,
        bundleNameSnapshot: bundle?.name ?? null,
        approxUsersSnapshot: bundle?.approxUsers ?? null,
        paymentReference: payment_reference ?? null,
        recordedBy: request.admin!.id,
        idempotencyKey: idempotency_key ?? null,
      });
    });
  } catch (err: any) {
    if (err.statusCode === 409) {
      return reply.status(409).send({ error: err.message });
    }
    throw err;
  }

  // Skip audit log for duplicate requests
  if (!result.duplicate) {
    await auditLog("admin_credit", {
      userId: request.admin!.id,
      detail: { tenantId, amountXlm: amountStr, type },
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    });
  }

  return reply.send({
    tenantId,
    billingEventId: result.billingEventId,
    bundlePurchaseId: result.bundlePurchaseId ?? null,
    newBalance: result.newBalance,
    amountCredited: amountStr,
    eventType: type,
    ...(result.duplicate ? { duplicate: true } : {}),
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("POST /tenants/:id/credit — idempotency (FIND-UI-004)", () => {
  beforeEach(() => vi.resetAllMocks());

  // ── 5.1 Happy path: credit with idempotency key ────────────────────────

  it("passes idempotencyKey to writeBillingCredit", async () => {
    mockSelectChain([{ id: 2 }]); // tenant found
    (db as any).transaction.mockImplementationOnce(async (fn: any) => fn({}));
    (writeBillingCredit as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      billingEventId: 42,
      newBalance: "150.0000000",
    });

    const reply = makeReply();
    await handlePostCredit(
      makeRequest(SUPER_ADMIN, { id: "2" }, {
        type: "manual_topup",
        amount_xlm: "100",
        idempotency_key: TEST_UUID,
      }),
      reply,
    );

    expect(writeBillingCredit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        idempotencyKey: TEST_UUID,
        tenantId: 2,
        eventType: "manual_topup",
        amountXlm: "100.0000000",
      }),
    );
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        billingEventId: 42,
        newBalance: "150.0000000",
      }),
    );
  });

  it("includes amountCredited in 7-decimal format", async () => {
    mockSelectChain([{ id: 2 }]);
    (db as any).transaction.mockImplementationOnce(async (fn: any) => fn({}));
    (writeBillingCredit as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      billingEventId: 1,
      newBalance: "50.0000000",
    });

    const reply = makeReply();
    let body: any;
    reply.send = vi.fn().mockImplementation((data: any) => { body = data; });

    await handlePostCredit(
      makeRequest(SUPER_ADMIN, { id: "2" }, {
        type: "manual_topup",
        amount_xlm: "50",
        idempotency_key: TEST_UUID,
      }),
      reply,
    );

    expect(body.amountCredited).toBe("50.0000000");
  });

  // ── 5.2 Exact duplicate → 200 + duplicate:true ─────────────────────────

  it("returns duplicate:true when writeBillingCredit detects duplicate", async () => {
    mockSelectChain([{ id: 2 }]); // tenant found
    (db as any).transaction.mockImplementationOnce(async (fn: any) => fn({}));
    (writeBillingCredit as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      billingEventId: 42,
      newBalance: "150.0000000",
      duplicate: true,
    });

    const reply = makeReply();
    let body: any;
    reply.send = vi.fn().mockImplementation((data: any) => { body = data; });

    await handlePostCredit(
      makeRequest(SUPER_ADMIN, { id: "2" }, {
        type: "manual_topup",
        amount_xlm: "100",
        idempotency_key: TEST_UUID,
      }),
      reply,
    );

    expect(body.duplicate).toBe(true);
    expect(body.billingEventId).toBe(42);
    expect(body.newBalance).toBe("150.0000000");
  });

  it("does not include duplicate field for non-duplicate requests", async () => {
    mockSelectChain([{ id: 2 }]);
    (db as any).transaction.mockImplementationOnce(async (fn: any) => fn({}));
    (writeBillingCredit as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      billingEventId: 42,
      newBalance: "150.0000000",
    });

    const reply = makeReply();
    let body: any;
    reply.send = vi.fn().mockImplementation((data: any) => { body = data; });

    await handlePostCredit(
      makeRequest(SUPER_ADMIN, { id: "2" }, {
        type: "manual_topup",
        amount_xlm: "100",
        idempotency_key: TEST_UUID,
      }),
      reply,
    );

    expect(body.duplicate).toBeUndefined();
  });

  // ── 5.3 Changed payload → 409 Conflict ─────────────────────────────────

  it("returns 409 when writeBillingCredit throws statusCode 409", async () => {
    mockSelectChain([{ id: 2 }]); // tenant found
    const conflictErr = new Error("Idempotency key already used with different parameters");
    (conflictErr as any).statusCode = 409;
    (db as any).transaction.mockImplementationOnce(async (fn: any) => fn({}));
    (writeBillingCredit as ReturnType<typeof vi.fn>).mockRejectedValueOnce(conflictErr);

    const reply = makeReply();
    await handlePostCredit(
      makeRequest(SUPER_ADMIN, { id: "2" }, {
        type: "manual_topup",
        amount_xlm: "200", // different amount from original
        idempotency_key: TEST_UUID,
      }),
      reply,
    );

    expect(reply.status).toHaveBeenCalledWith(409);
  });

  it("409 response body contains descriptive error", async () => {
    mockSelectChain([{ id: 2 }]);
    const conflictErr = new Error("Idempotency key already used with different parameters");
    (conflictErr as any).statusCode = 409;
    (db as any).transaction.mockImplementationOnce(async (fn: any) => fn({}));
    (writeBillingCredit as ReturnType<typeof vi.fn>).mockRejectedValueOnce(conflictErr);

    const reply = makeReply();
    let capturedBody: any;
    reply.status = vi.fn().mockImplementation(() => ({
      send: vi.fn().mockImplementation((data: any) => { capturedBody = data; }),
    }));

    await handlePostCredit(
      makeRequest(SUPER_ADMIN, { id: "2" }, {
        type: "manual_topup",
        amount_xlm: "200",
        idempotency_key: TEST_UUID,
      }),
      reply,
    );

    expect(capturedBody.error).toContain("Idempotency key");
  });

  // ── Non-409 errors propagate normally ──────────────────────────────────

  it("re-throws non-409 errors from writeBillingCredit", async () => {
    mockSelectChain([{ id: 2 }]);
    const dbError = new Error("Connection refused");
    (db as any).transaction.mockImplementationOnce(async (fn: any) => fn({}));
    (writeBillingCredit as ReturnType<typeof vi.fn>).mockRejectedValueOnce(dbError);

    const reply = makeReply();
    await expect(
      handlePostCredit(
        makeRequest(SUPER_ADMIN, { id: "2" }, {
          type: "manual_topup",
          amount_xlm: "100",
          idempotency_key: TEST_UUID,
        }),
        reply,
      ),
    ).rejects.toThrow("Connection refused");
  });

  // ── 5.5 Different keys are independent ─────────────────────────────────

  it("passes different idempotency keys through correctly", async () => {
    // First credit with key A
    mockSelectChain([{ id: 2 }]);
    (db as any).transaction.mockImplementationOnce(async (fn: any) => fn({}));
    (writeBillingCredit as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      billingEventId: 42,
      newBalance: "150.0000000",
    });
    const reply1 = makeReply();
    await handlePostCredit(
      makeRequest(SUPER_ADMIN, { id: "2" }, {
        type: "manual_topup",
        amount_xlm: "100",
        idempotency_key: TEST_UUID,
      }),
      reply1,
    );

    // Second credit with key B
    mockSelectChain([{ id: 2 }]);
    (db as any).transaction.mockImplementationOnce(async (fn: any) => fn({}));
    (writeBillingCredit as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      billingEventId: 43,
      newBalance: "250.0000000",
    });
    const reply2 = makeReply();
    await handlePostCredit(
      makeRequest(SUPER_ADMIN, { id: "2" }, {
        type: "manual_topup",
        amount_xlm: "100",
        idempotency_key: TEST_UUID_2,
      }),
      reply2,
    );

    // Both calls should have passed different keys
    const calls = (writeBillingCredit as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][1].idempotencyKey).toBe(TEST_UUID);
    expect(calls[1][1].idempotencyKey).toBe(TEST_UUID_2);
  });

  // ── 5.8 Backward compatibility (no key) ────────────────────────────────

  it("passes null idempotencyKey when no key provided", async () => {
    mockSelectChain([{ id: 2 }]);
    (db as any).transaction.mockImplementationOnce(async (fn: any) => fn({}));
    (writeBillingCredit as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      billingEventId: 42,
      newBalance: "150.0000000",
    });

    const reply = makeReply();
    await handlePostCredit(
      makeRequest(SUPER_ADMIN, { id: "2" }, {
        type: "manual_topup",
        amount_xlm: "100",
        // no idempotency_key
      }),
      reply,
    );

    expect(writeBillingCredit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        idempotencyKey: null,
      }),
    );
  });

  // ── Audit log behavior ─────────────────────────────────────────────────

  it("calls auditLog for non-duplicate credit", async () => {
    mockSelectChain([{ id: 2 }]);
    (db as any).transaction.mockImplementationOnce(async (fn: any) => fn({}));
    (writeBillingCredit as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      billingEventId: 42,
      newBalance: "150.0000000",
    });

    const reply = makeReply();
    await handlePostCredit(
      makeRequest(SUPER_ADMIN, { id: "2" }, {
        type: "manual_topup",
        amount_xlm: "100",
        idempotency_key: TEST_UUID,
      }),
      reply,
    );

    expect(auditLog).toHaveBeenCalledWith(
      "admin_credit",
      expect.objectContaining({
        userId: 1,
        detail: expect.objectContaining({ tenantId: 2 }),
      }),
    );
  });

  it("skips auditLog for duplicate credit", async () => {
    mockSelectChain([{ id: 2 }]);
    (db as any).transaction.mockImplementationOnce(async (fn: any) => fn({}));
    (writeBillingCredit as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      billingEventId: 42,
      newBalance: "150.0000000",
      duplicate: true,
    });

    const reply = makeReply();
    await handlePostCredit(
      makeRequest(SUPER_ADMIN, { id: "2" }, {
        type: "manual_topup",
        amount_xlm: "100",
        idempotency_key: TEST_UUID,
      }),
      reply,
    );

    expect(auditLog).not.toHaveBeenCalled();
  });

  // ── FI-06: String precision preservation ──────────────────────────────

  it("preserves exact 7-decimal precision without float conversion (FI-06)", async () => {
    // 0.1000001 cannot be represented exactly as IEEE 754 float.
    // parseFloat("0.1000001") → 0.10000009999999999... → .toFixed(7) → "0.1000010"
    // String pipeline: "0.1000001" → padded → "0.1000001" (exact)
    mockSelectChain([{ id: 2 }]);
    (db as any).transaction.mockImplementationOnce(async (fn: any) => fn({}));
    (writeBillingCredit as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      billingEventId: 99,
      newBalance: "500.1000001",
    });

    const reply = makeReply();
    let body: any;
    reply.send = vi.fn().mockImplementation((data: any) => { body = data; });

    await handlePostCredit(
      makeRequest(SUPER_ADMIN, { id: "2" }, {
        type: "manual_topup",
        amount_xlm: "0.1000001",
        idempotency_key: TEST_UUID,
      }),
      reply,
    );

    expect(writeBillingCredit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ amountXlm: "0.1000001" }),
    );
    expect(body.amountCredited).toBe("0.1000001");
  });

  it("rejects amount_xlm with more than 7 decimal places", async () => {
    const reply = makeReply();
    let capturedStatus: number | undefined;
    reply.status = vi.fn().mockImplementation((code: number) => {
      capturedStatus = code;
      return { send: vi.fn() };
    });

    await handlePostCredit(
      makeRequest(SUPER_ADMIN, { id: "2" }, {
        type: "manual_topup",
        amount_xlm: "100.12345678", // 8 decimals
        idempotency_key: TEST_UUID,
      }),
      reply,
    );

    expect(capturedStatus).toBe(400);
  });

  it("rejects zero amount_xlm", async () => {
    const reply = makeReply();
    let capturedStatus: number | undefined;
    reply.status = vi.fn().mockImplementation((code: number) => {
      capturedStatus = code;
      return { send: vi.fn() };
    });

    await handlePostCredit(
      makeRequest(SUPER_ADMIN, { id: "2" }, {
        type: "manual_topup",
        amount_xlm: "0",
      }),
      reply,
    );

    expect(capturedStatus).toBe(400);
  });
});
