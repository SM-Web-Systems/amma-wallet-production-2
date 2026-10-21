/**
 * Real PostgreSQL integration tests for admin billing operations.
 *
 * These tests run against an isolated test database (amma-db-integration-test)
 * to verify actual DB behavior: transactions, constraints, idempotency,
 * balance arithmetic, and concurrent operations.
 *
 * NOT mocked — real Drizzle ORM queries against real PostgreSQL.
 *
 * Run: DATABASE_URL=... npx vitest run src/test-integration/
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  testDb,
  seedTestTenant,
  seedTestAdmin,
  seedBillingPolicy,
  getTenantBalance,
  countBillingEvents,
  getBillingEventByKey,
  truncateAll,
  closeTestDb,
} from "./db-harness";
import { writeBillingCredit } from "../services/billing.service";
import * as schema from "../db/schema/index";
import { eq, sql } from "drizzle-orm";

// ── Setup ────────────────────────────────────────────────────────────────────

let tenantId: number;
let adminId: number;

beforeAll(async () => {
  await truncateAll();
});

beforeEach(async () => {
  await truncateAll();
  tenantId = await seedTestTenant({ name: "Integration Test Co", slug: "int-test", balance: "500.0000000" });
  adminId = await seedTestAdmin({ email: "admin@test.com", name: "Test Admin", role: "super_admin" });
  await seedBillingPolicy(tenantId);
});

afterEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await closeTestDb();
});

// ── Credit posting ───────────────────────────────────────────────────────────

describe("Credit posting (real DB)", () => {
  it("credits tenant balance atomically", async () => {
    const result = await testDb.transaction(async (tx) => {
      return writeBillingCredit(tx, {
        tenantId,
        eventType: "manual_topup",
        amountXlm: "100.0000000",
        notes: "integration test",
        createdBy: `admin:${adminId}`,
      });
    });

    expect(result.billingEventId).toBeGreaterThan(0);
    expect(result.newBalance).toBe("600.0000000");

    // Verify DB state
    const balance = await getTenantBalance(tenantId);
    expect(balance).toBe("600.0000000");
    const count = await countBillingEvents(tenantId);
    expect(count).toBe(1);
  });

  it("stores amount with 7-decimal precision", async () => {
    await testDb.transaction(async (tx) => {
      return writeBillingCredit(tx, {
        tenantId,
        eventType: "manual_topup",
        amountXlm: "0.0000001",
        createdBy: `admin:${adminId}`,
      });
    });

    const balance = await getTenantBalance(tenantId);
    expect(balance).toBe("500.0000001");
  });

  it("supports sequential credits to same tenant", async () => {
    for (let i = 0; i < 3; i++) {
      await testDb.transaction(async (tx) => {
        return writeBillingCredit(tx, {
          tenantId,
          eventType: "manual_topup",
          amountXlm: "10.0000000",
          createdBy: `admin:${adminId}`,
        });
      });
    }

    const balance = await getTenantBalance(tenantId);
    expect(balance).toBe("530.0000000");
    const count = await countBillingEvents(tenantId);
    expect(count).toBe(3);
  });

  it("rejects zero amount (CHECK constraint)", async () => {
    await expect(
      testDb.transaction(async (tx) => {
        return writeBillingCredit(tx, {
          tenantId,
          eventType: "manual_topup",
          amountXlm: "0.0000000",
          createdBy: `admin:${adminId}`,
        });
      }),
    ).rejects.toThrow();
  });
});

// ── Idempotency (FIND-UI-004) ───────────────────────────────────────────────

describe("Credit idempotency (real DB)", () => {
  const KEY = "11111111-1111-4111-8111-111111111111";

  it("stores idempotency key in billing_events", async () => {
    await testDb.transaction(async (tx) => {
      return writeBillingCredit(tx, {
        tenantId,
        eventType: "manual_topup",
        amountXlm: "100.0000000",
        createdBy: `admin:${adminId}`,
        idempotencyKey: KEY,
      });
    });

    const event = await getBillingEventByKey(tenantId, KEY);
    expect(event).not.toBeNull();
    expect(event.idempotencyKey).toBe(KEY);
    expect(event.amountXlm).toBe("100.0000000");
  });

  it("returns duplicate:true for exact retry", async () => {
    // First call
    const first = await testDb.transaction(async (tx) => {
      return writeBillingCredit(tx, {
        tenantId,
        eventType: "manual_topup",
        amountXlm: "100.0000000",
        createdBy: `admin:${adminId}`,
        idempotencyKey: KEY,
      });
    });

    expect(first.duplicate).toBeUndefined();
    expect(first.newBalance).toBe("600.0000000");

    // Retry with same key and params
    const second = await testDb.transaction(async (tx) => {
      return writeBillingCredit(tx, {
        tenantId,
        eventType: "manual_topup",
        amountXlm: "100.0000000",
        createdBy: `admin:${adminId}`,
        idempotencyKey: KEY,
      });
    });

    expect(second.duplicate).toBe(true);
    expect(second.billingEventId).toBe(first.billingEventId);

    // Balance credited only once
    const balance = await getTenantBalance(tenantId);
    expect(balance).toBe("600.0000000");
    const count = await countBillingEvents(tenantId);
    expect(count).toBe(1);
  });

  it("rejects changed payload (different amount) with 409", async () => {
    await testDb.transaction(async (tx) => {
      return writeBillingCredit(tx, {
        tenantId,
        eventType: "manual_topup",
        amountXlm: "100.0000000",
        createdBy: `admin:${adminId}`,
        idempotencyKey: KEY,
      });
    });

    // Retry with different amount
    const err = await testDb
      .transaction(async (tx) => {
        return writeBillingCredit(tx, {
          tenantId,
          eventType: "manual_topup",
          amountXlm: "200.0000000", // different!
          createdBy: `admin:${adminId}`,
          idempotencyKey: KEY,
        });
      })
      .catch((e: any) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(409);

    // Balance unchanged
    const balance = await getTenantBalance(tenantId);
    expect(balance).toBe("600.0000000");
  });

  it("rejects changed payload (different type) with 409", async () => {
    await testDb.transaction(async (tx) => {
      return writeBillingCredit(tx, {
        tenantId,
        eventType: "manual_topup",
        amountXlm: "100.0000000",
        createdBy: `admin:${adminId}`,
        idempotencyKey: KEY,
      });
    });

    const err = await testDb
      .transaction(async (tx) => {
        return writeBillingCredit(tx, {
          tenantId,
          eventType: "manual_adjustment", // different type!
          amountXlm: "100.0000000",
          createdBy: `admin:${adminId}`,
          idempotencyKey: KEY,
        });
      })
      .catch((e: any) => e);

    expect(err.statusCode).toBe(409);
  });

  it("allows different keys for same tenant (independent credits)", async () => {
    const KEY_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const KEY_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

    await testDb.transaction(async (tx) => {
      return writeBillingCredit(tx, {
        tenantId,
        eventType: "manual_topup",
        amountXlm: "50.0000000",
        createdBy: `admin:${adminId}`,
        idempotencyKey: KEY_A,
      });
    });

    await testDb.transaction(async (tx) => {
      return writeBillingCredit(tx, {
        tenantId,
        eventType: "manual_topup",
        amountXlm: "50.0000000",
        createdBy: `admin:${adminId}`,
        idempotencyKey: KEY_B,
      });
    });

    const balance = await getTenantBalance(tenantId);
    expect(balance).toBe("600.0000000");
    const count = await countBillingEvents(tenantId);
    expect(count).toBe(2);
  });

  it("allows same key for different tenants (cross-tenant reuse)", async () => {
    const tenant2Id = await seedTestTenant({ name: "Other Co", slug: "other-co", balance: "200.0000000" });

    await testDb.transaction(async (tx) => {
      return writeBillingCredit(tx, {
        tenantId,
        eventType: "manual_topup",
        amountXlm: "100.0000000",
        createdBy: `admin:${adminId}`,
        idempotencyKey: KEY,
      });
    });

    await testDb.transaction(async (tx) => {
      return writeBillingCredit(tx, {
        tenantId: tenant2Id,
        eventType: "manual_topup",
        amountXlm: "100.0000000",
        createdBy: `admin:${adminId}`,
        idempotencyKey: KEY, // same key, different tenant
      });
    });

    const balance1 = await getTenantBalance(tenantId);
    expect(balance1).toBe("600.0000000");
    const balance2 = await getTenantBalance(tenant2Id);
    expect(balance2).toBe("300.0000000");
  });

  it("supports credits without idempotency key (backward compat)", async () => {
    // Two credits without keys — both should succeed
    await testDb.transaction(async (tx) => {
      return writeBillingCredit(tx, {
        tenantId,
        eventType: "manual_topup",
        amountXlm: "50.0000000",
        createdBy: `admin:${adminId}`,
        // no idempotencyKey
      });
    });

    await testDb.transaction(async (tx) => {
      return writeBillingCredit(tx, {
        tenantId,
        eventType: "manual_topup",
        amountXlm: "50.0000000",
        createdBy: `admin:${adminId}`,
        // no idempotencyKey
      });
    });

    const balance = await getTenantBalance(tenantId);
    expect(balance).toBe("600.0000000");
    const count = await countBillingEvents(tenantId);
    expect(count).toBe(2);
  });
});

// ── Ledger reconciliation ────────────────────────────────────────────────────

describe("Ledger reconciliation (real DB)", () => {
  it("sum of billing_events equals balance change", async () => {
    const initialBalance = await getTenantBalance(tenantId);

    await testDb.transaction(async (tx) => {
      return writeBillingCredit(tx, {
        tenantId,
        eventType: "manual_topup",
        amountXlm: "100.0000000",
        createdBy: `admin:${adminId}`,
      });
    });

    await testDb.transaction(async (tx) => {
      return writeBillingCredit(tx, {
        tenantId,
        eventType: "manual_topup",
        amountXlm: "50.5000000",
        createdBy: `admin:${adminId}`,
      });
    });

    // Sum all events
    const [eventSum] = await testDb
      .select({ total: sql<string>`sum(amount_xlm)` })
      .from(schema.billingEvents)
      .where(eq(schema.billingEvents.tenantId, tenantId));

    const finalBalance = await getTenantBalance(tenantId);

    // Balance should be initial + sum(events)
    const expected = (parseFloat(initialBalance) + parseFloat(eventSum.total)).toFixed(7);
    expect(finalBalance).toBe(expected);
  });
});

// ── Admin authentication ─────────────────────────────────────────────────────

describe("Admin data integrity (real DB)", () => {
  it("stores admin with correct role and hashed password", async () => {
    const [admin] = await testDb
      .select()
      .from(schema.internalAdmins)
      .where(eq(schema.internalAdmins.id, adminId));

    expect(admin.role).toBe("super_admin");
    expect(admin.isActive).toBe(true);
    expect(admin.passwordHash).toBeTruthy();
    // Password hash should NOT equal the plaintext
    expect(admin.passwordHash).not.toBe("TestPassword12!");
  });

  it("enforces unique admin email", async () => {
    await expect(
      seedTestAdmin({ email: "admin@test.com", name: "Dupe", role: "platform_admin" }),
    ).rejects.toThrow();
  });
});

// ── Suspension ───────────────────────────────────────────────────────────────

describe("Tenant suspension (real DB)", () => {
  it("can suspend and unsuspend a tenant", async () => {
    // Suspend (valid reason: 'manual' per chk_suspension_reason)
    await testDb
      .update(schema.tenants)
      .set({
        suspendedAt: new Date(),
        suspensionReason: "manual",
        isActive: false,
      })
      .where(eq(schema.tenants.id, tenantId));

    const [suspended] = await testDb
      .select({
        isActive: schema.tenants.isActive,
        suspendedAt: schema.tenants.suspendedAt,
        suspensionReason: schema.tenants.suspensionReason,
      })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenantId));

    expect(suspended.isActive).toBe(false);
    expect(suspended.suspendedAt).toBeTruthy();
    expect(suspended.suspensionReason).toBe("manual");

    // Unsuspend
    await testDb
      .update(schema.tenants)
      .set({
        suspendedAt: null,
        suspensionReason: null,
        isActive: true,
      })
      .where(eq(schema.tenants.id, tenantId));

    const [unsuspended] = await testDb
      .select({
        isActive: schema.tenants.isActive,
        suspendedAt: schema.tenants.suspendedAt,
      })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenantId));

    expect(unsuspended.isActive).toBe(true);
    expect(unsuspended.suspendedAt).toBeNull();
  });

  it("credits still work on suspended tenant (admin override)", async () => {
    // Suspend tenant first (valid reason: 'manual' per chk_suspension_reason)
    await testDb
      .update(schema.tenants)
      .set({ suspendedAt: new Date(), suspensionReason: "manual", isActive: false })
      .where(eq(schema.tenants.id, tenantId));

    // Credit should still succeed (admin operation)
    const result = await testDb.transaction(async (tx) => {
      return writeBillingCredit(tx, {
        tenantId,
        eventType: "manual_topup",
        amountXlm: "100.0000000",
        createdBy: `admin:${adminId}`,
      });
    });

    expect(result.newBalance).toBe("600.0000000");
  });
});

// ── Billing event pagination ─────────────────────────────────────────────────

describe("Billing event ordering (real DB)", () => {
  it("events are returned in insertion order by ID", async () => {
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) {
      const result = await testDb.transaction(async (tx) => {
        return writeBillingCredit(tx, {
          tenantId,
          eventType: "manual_topup",
          amountXlm: `${(i + 1) * 10}.0000000`,
          createdBy: `admin:${adminId}`,
        });
      });
      ids.push(result.billingEventId);
    }

    // Query events in descending order (as the pagination API would)
    const events = await testDb
      .select({ id: schema.billingEvents.id, amountXlm: schema.billingEvents.amountXlm })
      .from(schema.billingEvents)
      .where(eq(schema.billingEvents.tenantId, tenantId))
      .orderBy(sql`id DESC`);

    expect(events.length).toBe(5);
    // Newest first
    expect(events[0].amountXlm).toBe("50.0000000");
    expect(events[4].amountXlm).toBe("10.0000000");
    // IDs are strictly ascending
    for (let i = 0; i < ids.length - 1; i++) {
      expect(ids[i]).toBeLessThan(ids[i + 1]);
    }
  });
});
