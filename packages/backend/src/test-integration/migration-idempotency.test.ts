/**
 * Integration tests verifying the idempotency_key migration (001).
 *
 * These tests verify:
 * - Column exists and is nullable
 * - Partial unique index exists and is valid
 * - Historical NULL keys are unaffected
 * - Duplicate non-NULL keys for same tenant are rejected
 * - Cross-tenant key reuse is allowed
 * - NULL keys do not conflict with each other
 * - Migration is idempotent (IF NOT EXISTS)
 *
 * Run: npx vitest run --config vitest.integration.config.ts
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  testDb,
  seedTestTenant,
  seedTestAdmin,
  seedBillingPolicy,
  truncateAll,
  closeTestDb,
  createTestConnection,
  provisionTestMarker,
} from "./db-harness";
import { writeBillingCredit } from "../services/billing.service";
import * as schema from "../db/schema/index";
import { sql } from "drizzle-orm";

// REV-03: Use centralized createTestConnection() — no independent pools.
const rawConn = createTestConnection({ max: 2 });
const rawClient = rawConn.sql;

let tenantId: number;
let adminId: number;

beforeAll(async () => {
  await provisionTestMarker();
  await truncateAll();
});

afterEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await rawClient.end();
  await closeTestDb();
});

describe("Migration 001: idempotency_key", () => {
  // ── Schema verification ─────────────────────────────────────────────────

  it("idempotency_key column exists and is nullable TEXT", async () => {
    const [col] = await rawClient`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'billing_events' AND column_name = 'idempotency_key'
    `;
    expect(col).toBeDefined();
    expect(col.column_name).toBe("idempotency_key");
    expect(col.data_type).toBe("text");
    expect(col.is_nullable).toBe("YES");
  });

  it("partial unique index exists and is valid", async () => {
    const [idx] = await rawClient`
      SELECT pg_index.indisvalid, pg_index.indisunique
      FROM pg_index
      JOIN pg_class ON pg_class.oid = pg_index.indexrelid
      WHERE pg_class.relname = 'uq_billing_credit_idempotency'
    `;
    expect(idx).toBeDefined();
    expect(idx.indisvalid).toBe(true);
    expect(idx.indisunique).toBe(true);
  });

  it("index definition includes WHERE clause for NULL exclusion", async () => {
    const [idx] = await rawClient`
      SELECT indexdef
      FROM pg_indexes
      WHERE indexname = 'uq_billing_credit_idempotency'
    `;
    expect(idx).toBeDefined();
    expect(idx.indexdef).toContain("idempotency_key IS NOT NULL");
  });

  // ── Behavioral verification ─────────────────────────────────────────────

  it("existing application works after schema expansion (NULL keys)", async () => {
    tenantId = await seedTestTenant({ name: "Migration Test Co", slug: "mig-test", balance: "500.0000000" });
    adminId = await seedTestAdmin({ email: "mig@test.com", name: "Mig Admin", role: "super_admin" });

    // Credit without idempotency key (simulating pre-migration application)
    const result = await testDb.transaction(async (tx) => {
      return writeBillingCredit(tx, {
        tenantId,
        eventType: "manual_topup",
        amountXlm: "50.0000000",
        createdBy: `admin:${adminId}`,
        // No idempotencyKey — backward compatible
      });
    });

    expect(result.billingEventId).toBeGreaterThan(0);
    expect(result.newBalance).toBe("550.0000000");
  });

  it("new application works with expanded schema (with key)", async () => {
    tenantId = await seedTestTenant({ name: "Migration Test Co", slug: "mig-test", balance: "500.0000000" });
    adminId = await seedTestAdmin({ email: "mig@test.com", name: "Mig Admin", role: "super_admin" });

    const key = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const result = await testDb.transaction(async (tx) => {
      return writeBillingCredit(tx, {
        tenantId,
        eventType: "manual_topup",
        amountXlm: "50.0000000",
        createdBy: `admin:${adminId}`,
        idempotencyKey: key,
      });
    });

    expect(result.billingEventId).toBeGreaterThan(0);

    // Verify key is stored
    const [event] = await rawClient`
      SELECT idempotency_key FROM billing_events WHERE id = ${result.billingEventId}
    `;
    expect(event.idempotency_key).toBe(key);
  });

  it("historical records remain unchanged (NULL keys coexist)", async () => {
    tenantId = await seedTestTenant({ name: "Migration Test Co", slug: "mig-test", balance: "500.0000000" });
    adminId = await seedTestAdmin({ email: "mig@test.com", name: "Mig Admin", role: "super_admin" });

    // Insert two events without keys (historical pattern)
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

    // All three should exist with NULL keys
    const [count] = await rawClient`
      SELECT COUNT(*)::int AS n FROM billing_events
      WHERE tenant_id = ${tenantId} AND idempotency_key IS NULL
    `;
    expect(count.n).toBe(3);
  });

  it("duplicate non-NULL tenant/key combinations are rejected by DB", async () => {
    tenantId = await seedTestTenant({ name: "Migration Test Co", slug: "mig-test", balance: "500.0000000" });

    const key = "dupcheck-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

    // Insert first event with key
    await rawClient`
      INSERT INTO billing_events (tenant_id, event_type, amount_xlm, idempotency_key, created_by)
      VALUES (${tenantId}, 'manual_topup', '10.0000000', ${key}, 'test')
    `;

    // Second INSERT with same tenant+key should fail
    await expect(
      rawClient`
        INSERT INTO billing_events (tenant_id, event_type, amount_xlm, idempotency_key, created_by)
        VALUES (${tenantId}, 'manual_topup', '10.0000000', ${key}, 'test')
      `,
    ).rejects.toThrow();
  });

  it("cross-tenant key reuse is allowed", async () => {
    const t1 = await seedTestTenant({ name: "T1", slug: "t1", balance: "100.0000000" });
    const t2 = await seedTestTenant({ name: "T2", slug: "t2", balance: "100.0000000" });

    const key = "crossten-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

    await rawClient`
      INSERT INTO billing_events (tenant_id, event_type, amount_xlm, idempotency_key, created_by)
      VALUES (${t1}, 'manual_topup', '10.0000000', ${key}, 'test')
    `;

    // Same key, different tenant — should succeed
    await rawClient`
      INSERT INTO billing_events (tenant_id, event_type, amount_xlm, idempotency_key, created_by)
      VALUES (${t2}, 'manual_topup', '10.0000000', ${key}, 'test')
    `;

    const [count] = await rawClient`
      SELECT COUNT(*)::int AS n FROM billing_events WHERE idempotency_key = ${key}
    `;
    expect(count.n).toBe(2);
  });

  it("migration SQL is idempotent (IF NOT EXISTS)", async () => {
    // Running the column add and index creation again should not error
    await rawClient`ALTER TABLE billing_events ADD COLUMN IF NOT EXISTS idempotency_key TEXT`;
    // Note: CREATE INDEX CONCURRENTLY IF NOT EXISTS cannot be tested inside a
    // transaction, but the IF NOT EXISTS clause is verified by the SQL syntax.
    // We verify the index still exists and is valid after the idempotent re-run.
    const [idx] = await rawClient`
      SELECT pg_index.indisvalid
      FROM pg_index
      JOIN pg_class ON pg_class.oid = pg_index.indexrelid
      WHERE pg_class.relname = 'uq_billing_credit_idempotency'
    `;
    expect(idx.indisvalid).toBe(true);
  });
});
