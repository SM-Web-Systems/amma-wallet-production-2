/**
 * Concurrent idempotency integration tests.
 *
 * These tests use real PostgreSQL with two independent connections to verify
 * that concurrent duplicate credit requests are handled safely.
 *
 * The key behavior: when two transactions race with the same idempotency key,
 * exactly one credit is applied and the other gets a deterministic response.
 *
 * Run: npx vitest run --config vitest.integration.config.ts
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeBillingCredit } from "../services/billing.service";
import {
  testDb,
  seedTestTenant,
  seedTestAdmin,
  seedBillingPolicy,
  getTenantBalance,
  countBillingEvents,
  truncateAll,
  closeTestDb,
  createTestConnection,
  provisionTestMarker,
} from "./db-harness";

// REV-03: Use centralized createTestConnection() — no independent pools.
// This ensures both connections go through the same validated TEST_DATABASE_URL.
const connA = createTestConnection({ max: 2 });
const connB = createTestConnection({ max: 2 });
const dbA = connA.db;
const dbB = connB.db;

let tenantId: number;
let adminId: number;

beforeEach(async () => {
  await provisionTestMarker();
  await truncateAll();
  tenantId = await seedTestTenant({ name: "Concurrent Test Co", slug: "conc-test", balance: "500.0000000" });
  adminId = await seedTestAdmin({ email: "conc@test.com", name: "Conc Admin", role: "super_admin" });
  await seedBillingPolicy(tenantId);
});

afterEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await connA.sql.end();
  await connB.sql.end();
  await closeTestDb();
});

describe("Concurrent idempotency (real DB, two connections)", () => {
  const KEY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

  it("exactly one credit applied when two identical requests race", async () => {
    // Launch two transactions concurrently with the same idempotency key.
    // One will succeed, the other will hit the UNIQUE constraint.
    const creditOpts = {
      tenantId,
      eventType: "manual_topup" as const,
      amountXlm: "100.0000000",
      createdBy: `admin:${adminId}`,
      idempotencyKey: KEY,
    };

    const results = await Promise.allSettled([
      dbA.transaction(async (txA) => writeBillingCredit(txA, creditOpts)),
      dbB.transaction(async (txB) => writeBillingCredit(txB, creditOpts)),
    ]);

    // Classify results
    const successes = results.filter((r) => r.status === "fulfilled");
    const failures = results.filter((r) => r.status === "rejected");

    // At least one should succeed
    expect(successes.length).toBeGreaterThanOrEqual(1);

    // Critical financial invariant: exactly one credit in the ledger
    const count = await countBillingEvents(tenantId);
    expect(count).toBe(1);

    // Critical financial invariant: balance increased exactly once
    const balance = await getTenantBalance(tenantId);
    expect(balance).toBe("600.0000000");

    // Resolution path depends on timing:
    // A) Both succeed: one wins the INSERT, the other detects duplicate via SELECT
    // B) One fails with 23505: the other wins, the loser must be caught upstream
    if (successes.length === 2) {
      const r0 = (successes[0] as PromiseFulfilledResult<any>).value;
      const r1 = (successes[1] as PromiseFulfilledResult<any>).value;
      // One should be the original, other should be a duplicate
      const duplicates = [r0.duplicate, r1.duplicate].filter(Boolean);
      expect(duplicates.length).toBe(1);
    } else if (failures.length > 0) {
      // Unique violation from the racing INSERT — postgres.js wraps
      // the error differently; check for the constraint indicator
      const err = (failures[0] as PromiseRejectedResult).reason;
      // postgres.js error objects use different property names
      const pgCode = err.code ?? err.cause?.code ?? "";
      expect(
        pgCode === "23505" || err.message?.includes("unique") || err.message?.includes("duplicate"),
        `Expected unique_violation but got: ${err.message} (code=${err.code}, keys=${Object.keys(err).join(",")})`,
      ).toBe(true);
    }
  });

  it("sequential identical requests return duplicate:true after concurrent race", async () => {
    // First: create the credit
    await dbA.transaction(async (txA) =>
      writeBillingCredit(txA, {
        tenantId,
        eventType: "manual_topup",
        amountXlm: "100.0000000",
        createdBy: `admin:${adminId}`,
        idempotencyKey: KEY,
      }),
    );

    // Second: sequential retry should find the committed event
    const retry = await dbB.transaction(async (txB) =>
      writeBillingCredit(txB, {
        tenantId,
        eventType: "manual_topup",
        amountXlm: "100.0000000",
        createdBy: `admin:${adminId}`,
        idempotencyKey: KEY,
      }),
    );

    expect(retry.duplicate).toBe(true);
    expect(retry.newBalance).toBe("600.0000000");

    // Still exactly one credit
    const count = await countBillingEvents(tenantId);
    expect(count).toBe(1);
  });

  it("concurrent requests with different payloads but same key: one succeeds, other detects conflict", async () => {
    const results = await Promise.allSettled([
      dbA.transaction(async (txA) =>
        writeBillingCredit(txA, {
          tenantId,
          eventType: "manual_topup",
          amountXlm: "100.0000000",
          createdBy: `admin:${adminId}`,
          idempotencyKey: KEY,
        }),
      ),
      dbB.transaction(async (txB) =>
        writeBillingCredit(txB, {
          tenantId,
          eventType: "manual_topup",
          amountXlm: "200.0000000", // different amount!
          createdBy: `admin:${adminId}`,
          idempotencyKey: KEY,
        }),
      ),
    ]);

    // At least one succeeds
    const successes = results.filter((r) => r.status === "fulfilled");
    expect(successes.length).toBeGreaterThanOrEqual(1);

    // Exactly one credit in ledger
    const count = await countBillingEvents(tenantId);
    expect(count).toBe(1);
  });

  it("different keys for same tenant create independent credits concurrently", async () => {
    const KEY_X = "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx";
    const KEY_Y = "yyyyyyyy-yyyy-4yyy-8yyy-yyyyyyyyyyyy";

    const [resultX, resultY] = await Promise.all([
      dbA.transaction(async (txA) =>
        writeBillingCredit(txA, {
          tenantId,
          eventType: "manual_topup",
          amountXlm: "50.0000000",
          createdBy: `admin:${adminId}`,
          idempotencyKey: KEY_X,
        }),
      ),
      dbB.transaction(async (txB) =>
        writeBillingCredit(txB, {
          tenantId,
          eventType: "manual_topup",
          amountXlm: "50.0000000",
          createdBy: `admin:${adminId}`,
          idempotencyKey: KEY_Y,
        }),
      ),
    ]);

    // Both should succeed (different keys)
    expect(resultX.billingEventId).toBeGreaterThan(0);
    expect(resultY.billingEventId).toBeGreaterThan(0);
    expect(resultX.billingEventId).not.toBe(resultY.billingEventId);

    // Two credits in ledger
    const count = await countBillingEvents(tenantId);
    expect(count).toBe(2);

    // Balance increased by 100 total
    const balance = await getTenantBalance(tenantId);
    expect(balance).toBe("600.0000000");
  });

  it("same key for different tenants creates independent credits concurrently", async () => {
    const tenant2Id = await seedTestTenant({ name: "Conc T2", slug: "conc-t2", balance: "300.0000000" });

    const [r1, r2] = await Promise.all([
      dbA.transaction(async (txA) =>
        writeBillingCredit(txA, {
          tenantId,
          eventType: "manual_topup",
          amountXlm: "100.0000000",
          createdBy: `admin:${adminId}`,
          idempotencyKey: KEY,
        }),
      ),
      dbB.transaction(async (txB) =>
        writeBillingCredit(txB, {
          tenantId: tenant2Id,
          eventType: "manual_topup",
          amountXlm: "100.0000000",
          createdBy: `admin:${adminId}`,
          idempotencyKey: KEY,
        }),
      ),
    ]);

    expect(r1.billingEventId).toBeGreaterThan(0);
    expect(r2.billingEventId).toBeGreaterThan(0);

    const b1 = await getTenantBalance(tenantId);
    const b2 = await getTenantBalance(tenant2Id);
    expect(b1).toBe("600.0000000");
    expect(b2).toBe("400.0000000");
  });

  it("tenant balance increases exactly once after concurrent duplicate race", async () => {
    const balanceBefore = await getTenantBalance(tenantId);
    expect(balanceBefore).toBe("500.0000000");

    // Fire both and collect whatever succeeds/fails
    await Promise.allSettled([
      dbA.transaction(async (txA) =>
        writeBillingCredit(txA, {
          tenantId,
          eventType: "manual_topup",
          amountXlm: "75.0000000",
          createdBy: `admin:${adminId}`,
          idempotencyKey: KEY,
        }),
      ),
      dbB.transaction(async (txB) =>
        writeBillingCredit(txB, {
          tenantId,
          eventType: "manual_topup",
          amountXlm: "75.0000000",
          createdBy: `admin:${adminId}`,
          idempotencyKey: KEY,
        }),
      ),
    ]);

    // Regardless of which won/lost, balance must be exactly +75
    const balanceAfter = await getTenantBalance(tenantId);
    expect(balanceAfter).toBe("575.0000000");

    const count = await countBillingEvents(tenantId);
    expect(count).toBe(1);
  });
});
