/**
 * Integration test harness for real PostgreSQL testing.
 *
 * Connects to an isolated test database (amma-db-integration-test container)
 * and provides utilities for seeding, querying, and cleaning test data.
 *
 * SAFETY (REV-03 hardened):
 * - TEST_DATABASE_URL is REQUIRED — no silent fallback.
 * - URL is validated for host, port, and database name (fail-closed).
 * - Runtime identity verification: queries current_database() + current_user.
 * - Disposable-database marker: a sentinel table (aw_test_harness_marker) must
 *   exist in the connected database, proving controlled test setup.
 * - Role verification: the connected role must match a test-only user.
 * - All destructive operations are gated behind full verification.
 * - createTestConnection() centralizes pool creation so no test can bypass safety.
 *
 * Environment: TEST_DATABASE_URL must be explicitly set.
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
const ALLOWED_TEST_ROLES = ["stellarwallet_test", "amma_test", "test", "postgres"];
/** Sentinel table name — must be created during controlled test-db provisioning. */
const TEST_MARKER_TABLE = "aw_test_harness_marker";

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
 * REV-03 hardened checks:
 * 1. current_database() — must be in ALLOWED_TEST_DB_NAMES
 * 2. current_user — must be in ALLOWED_TEST_ROLES
 * 3. aw_test_harness_marker table — must exist (proves controlled provisioning)
 *
 * Note: inet_server_port() returns the container-internal port (5432), not the
 * host-mapped port (15432), so it would false-positive in Docker environments.
 * The host port is validated by validateTestDatabaseUrl() at module load time.
 */
async function verifyConnectedDatabase(client: postgres.Sql): Promise<void> {
  const [row] = await client`SELECT current_database() AS db, current_user AS role`;
  const actualDb = row.db as string;
  const actualRole = row.role as string;

  // 1. Reject production database names
  if (PRODUCTION_DB_NAMES.includes(actualDb.toLowerCase())) {
    throw new Error(
      `[db-harness] SAFETY BLOCK: connected database is "${actualDb}", ` +
      `which matches a production database name. Aborting.`
    );
  }

  // 2. Require allowed test database name
  if (!ALLOWED_TEST_DB_NAMES.includes(actualDb.toLowerCase())) {
    throw new Error(
      `[db-harness] SAFETY BLOCK: connected database is "${actualDb}", ` +
      `which is not in the allowed test database list. Aborting.`
    );
  }

  // 3. Require allowed test role
  if (!ALLOWED_TEST_ROLES.includes(actualRole.toLowerCase())) {
    throw new Error(
      `[db-harness] SAFETY BLOCK: connected role is "${actualRole}", ` +
      `which is not in the allowed test role list. ` +
      `Allowed roles: ${ALLOWED_TEST_ROLES.join(", ")}. Aborting.`
    );
  }

  // 4. Require disposable-database marker table
  const [marker] = await client`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ${TEST_MARKER_TABLE}
    ) AS exists
  `;
  if (!marker.exists) {
    throw new Error(
      `[db-harness] SAFETY BLOCK: marker table "${TEST_MARKER_TABLE}" not found. ` +
      `This database was not provisioned by the test harness setup. ` +
      `Run the test database provisioning script first. Aborting.`
    );
  }
}

// ── Connection setup ────────────────────────────────────────────────────────

// REV-03: No silent fallback — TEST_DATABASE_URL must be explicitly configured.
if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    `[db-harness] SAFETY BLOCK: TEST_DATABASE_URL environment variable is not set. ` +
    `Integration tests require an explicitly configured test database connection. ` +
    `Set TEST_DATABASE_URL in .env.integration or your environment.`
  );
}
const TEST_DB_URL = process.env.TEST_DATABASE_URL;

// Validate URL structure before connecting (fail-closed)
validateTestDatabaseUrl(TEST_DB_URL);

// Single connection pool for the test suite
const client = postgres(TEST_DB_URL, { max: 5 });
export const testDb = drizzle(client, { schema });

// Track whether the connected database has been verified
let _dbVerified = false;

/** Ensure the connected database passes all identity checks. Call before destructive ops. */
async function ensureVerifiedTestDb(): Promise<void> {
  if (_dbVerified) return;
  await verifyConnectedDatabase(client);
  _dbVerified = true;
}

/**
 * REV-03: Centralized test connection factory.
 * All integration tests MUST use this to create additional connection pools
 * (e.g. for concurrency testing). This ensures every pool is validated against
 * the same TEST_DATABASE_URL and cannot bypass safety checks.
 */
export function createTestConnection(opts?: { max?: number }): {
  sql: postgres.Sql;
  db: ReturnType<typeof drizzle>;
} {
  const connClient = postgres(TEST_DB_URL, { max: opts?.max ?? 2 });
  const connDb = drizzle(connClient, { schema });
  return { sql: connClient, db: connDb };
}

/**
 * REV-03: Provision the disposable-database marker table.
 * Called once during test setup to mark the database as test-controlled.
 * This is idempotent — safe to call multiple times.
 */
export async function provisionTestMarker(): Promise<void> {
  await client`
    CREATE TABLE IF NOT EXISTS ${client(TEST_MARKER_TABLE)} (
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      harness_version TEXT NOT NULL DEFAULT '5.1'
    )
  `;
  // Ensure at least one row
  const [existing] = await client`SELECT 1 FROM ${client(TEST_MARKER_TABLE)} LIMIT 1`;
  if (!existing) {
    await client`INSERT INTO ${client(TEST_MARKER_TABLE)} (harness_version) VALUES ('5.1')`;
  }
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
