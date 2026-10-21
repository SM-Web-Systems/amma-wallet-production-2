/**
 * Integration test harness for real PostgreSQL testing.
 *
 * Connects to an isolated test database (amma-db-integration-test container)
 * and provides utilities for seeding, querying, and cleaning test data.
 *
 * SAFETY: Before any destructive operation, the harness validates that the
 * connected database passes explicit isolation checks (host, port, database
 * name). This prevents accidental TRUNCATE against production databases.
 *
 * Environment: TEST_DATABASE_URL must point to the test database.
 * Fallback: postgresql://stellarwallet_test:test_only_password@localhost:15432/stellarwallet_test
 */

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema/index";
import { eq, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";

// ── Database safety validation ──────────────────────────────────────────────

/** Allowed test database configurations. Fail-closed: anything not listed is rejected. */
const ALLOWED_TEST_HOSTS = ["localhost", "127.0.0.1", "::1"];
const ALLOWED_TEST_PORTS = [15432, 15433]; // Test-only ports, never 5432
const ALLOWED_TEST_DB_NAMES = ["stellarwallet_test", "amma_test", "test"];
const PRODUCTION_DB_NAMES = ["stellarwallet", "amma", "ammawallet", "amma_wallet", "amma_production"];

export interface ParsedDbUrl {
  host: string;
  port: number;
  database: string;
  user: string;
}

/** Parse a PostgreSQL connection URL into its components. */
export function parseTestDbUrl(url: string): ParsedDbUrl {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`[db-harness] Invalid database URL format: cannot parse URL`);
  }

  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error(`[db-harness] Invalid database URL protocol: ${parsed.protocol}`);
  }

  return {
    host: parsed.hostname,
    port: parsed.port ? parseInt(parsed.port, 10) : 5432,
    database: parsed.pathname.replace(/^\//, ""),
    user: parsed.username,
  };
}

/**
 * Validate that a database URL points to a known-safe test database.
 * Throws if any check fails (fail-closed).
 */
export function validateTestDatabaseUrl(url: string): ParsedDbUrl {
  const parsed = parseTestDbUrl(url);

  // Reject production-like database names
  const dbLower = parsed.database.toLowerCase();
  if (PRODUCTION_DB_NAMES.includes(dbLower)) {
    throw new Error(
      `[db-harness] SAFETY BLOCK: database name "${parsed.database}" matches a production database name. ` +
      `Integration tests require an explicitly named test database (e.g., stellarwallet_test).`
    );
  }

  // Require allowed test database name
  if (!ALLOWED_TEST_DB_NAMES.includes(dbLower)) {
    throw new Error(
      `[db-harness] SAFETY BLOCK: database name "${parsed.database}" is not in the allowed test database list. ` +
      `Allowed: ${ALLOWED_TEST_DB_NAMES.join(", ")}. ` +
      `Add the name to ALLOWED_TEST_DB_NAMES in db-harness.ts if this is intentional.`
    );
  }

  // Reject non-localhost hosts
  if (!ALLOWED_TEST_HOSTS.includes(parsed.host)) {
    throw new Error(
      `[db-harness] SAFETY BLOCK: host "${parsed.host}" is not a recognized local test host. ` +
      `Integration tests must connect to localhost only. ` +
      `Allowed hosts: ${ALLOWED_TEST_HOSTS.join(", ")}.`
    );
  }

  // Reject production port (5432) and other non-test ports
  if (!ALLOWED_TEST_PORTS.includes(parsed.port)) {
    throw new Error(
      `[db-harness] SAFETY BLOCK: port ${parsed.port} is not an allowed test port. ` +
      `The default PostgreSQL port (5432) is blocked to prevent accidental production connections. ` +
      `Allowed ports: ${ALLOWED_TEST_PORTS.join(", ")}.`
    );
  }

  return parsed;
}

/**
 * Verify the actual connected database identity by querying PostgreSQL directly.
 * This catches misconfigurations where the URL is correct but a proxy or tunnel
 * routes the connection elsewhere.
 *
 * Note: We check current_database() only. inet_server_port() returns the
 * container-internal port (5432), not the host-mapped port (15432), so it
 * would false-positive in Docker environments. The host port is already
 * validated by validateTestDatabaseUrl() at module load time.
 */
async function verifyConnectedDatabase(client: postgres.Sql): Promise<void> {
  const [row] = await client`SELECT current_database() AS db`;
  const actualDb = row.db as string;

  if (PRODUCTION_DB_NAMES.includes(actualDb.toLowerCase())) {
    throw new Error(
      `[db-harness] SAFETY BLOCK: connected database is "${actualDb}", ` +
      `which matches a production database name. Aborting.`
    );
  }

  if (!ALLOWED_TEST_DB_NAMES.includes(actualDb.toLowerCase())) {
    throw new Error(
      `[db-harness] SAFETY BLOCK: connected database is "${actualDb}", ` +
      `which is not in the allowed test database list. Aborting.`
    );
  }
}

// ── Connection setup ────────────────────────────────────────────────────────

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://stellarwallet_test:test_only_password@localhost:15432/stellarwallet_test";

// Validate URL structure before connecting (fail-closed)
validateTestDatabaseUrl(TEST_DB_URL);

// Single connection pool for the test suite
const client = postgres(TEST_DB_URL, { max: 5 });
export const testDb = drizzle(client, { schema });

// Track whether the connected database has been verified
let _dbVerified = false;

/** Ensure the connected database passes identity checks. Call before destructive ops. */
async function ensureVerifiedTestDb(): Promise<void> {
  if (_dbVerified) return;
  await verifyConnectedDatabase(client);
  _dbVerified = true;
}

// ── Seed helpers ─────────────────────────────────────────────────────────────

export async function seedTestTenant(opts: {
  name: string;
  slug: string;
  balance?: string;
  isActive?: boolean;
}): Promise<number> {
  const [tenant] = await testDb
    .insert(schema.tenants)
    .values({
      name: opts.name,
      slug: opts.slug,
      prepaidXlmBalance: opts.balance ?? "0.0000000",
      isActive: opts.isActive ?? true,
    })
    .returning({ id: schema.tenants.id });
  return tenant.id;
}

export async function seedTestAdmin(opts: {
  email: string;
  name: string;
  role: "super_admin" | "platform_admin" | "account_manager" | "support_agent";
  password?: string;
}): Promise<number> {
  const hash = await bcrypt.hash(opts.password ?? "TestPassword12!", 10);
  const [admin] = await testDb
    .insert(schema.internalAdmins)
    .values({
      email: opts.email,
      name: opts.name,
      role: opts.role,
      passwordHash: hash,
      isActive: true,
    })
    .returning({ id: schema.internalAdmins.id });
  return admin.id;
}

export async function seedBillingPolicy(tenantId: number): Promise<number> {
  const [policy] = await testDb
    .insert(schema.tenantBillingPolicy)
    .values({
      tenantId,
      isCurrent: true,
      gracePeriodDays: 14,
      acquisitionModeEnabled: false,
      acquisitionDebtLimitXlm: "-300.0000000",
    })
    .returning({ id: schema.tenantBillingPolicy.id });
  return policy.id;
}

// ── Query helpers ────────────────────────────────────────────────────────────

export async function getTenantBalance(tenantId: number): Promise<string> {
  const [row] = await testDb
    .select({ balance: schema.tenants.prepaidXlmBalance })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId));
  return row.balance;
}

export async function countBillingEvents(tenantId: number): Promise<number> {
  const [row] = await testDb
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.billingEvents)
    .where(eq(schema.billingEvents.tenantId, tenantId));
  return row.count;
}

export async function getBillingEventByKey(
  tenantId: number,
  idempotencyKey: string,
): Promise<any | null> {
  const rows = await testDb
    .select()
    .from(schema.billingEvents)
    .where(
      sql`${schema.billingEvents.tenantId} = ${tenantId} AND ${schema.billingEvents.idempotencyKey} = ${idempotencyKey}`,
    );
  return rows[0] ?? null;
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

/** Truncate all tables. Validates database identity before executing. */
export async function truncateAll() {
  await ensureVerifiedTestDb();
  await client.unsafe(`
    TRUNCATE billing_events, tenant_bundle_purchases, monthly_maintenance_snapshots,
             tenant_billing_policy, tenant_users, internal_admins, audit_logs,
             tenants CASCADE;
  `);
}

/** Close the connection pool. Call in afterAll. */
export async function closeTestDb() {
  await client.end();
}
