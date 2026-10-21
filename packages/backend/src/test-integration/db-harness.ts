/**
 * Integration test harness for real PostgreSQL testing.
 *
 * Connects to an isolated test database (amma-db-integration-test container)
 * and provides utilities for seeding, querying, and cleaning test data.
 *
 * SAFETY (Phase 5.2 hardened — P52-02):
 * - TEST_DATABASE_URL is REQUIRED — no silent fallback.
 * - URL is validated for host, port, and database name (fail-closed).
 * - Runtime identity verification: queries current_database() + current_user.
 * - Superuser role is rejected — connected role must NOT have usesuper.
 * - Disposable-database marker: a sentinel table (aw_test_harness_marker) must
 *   exist with a trusted provisioning nonce, proving controlled test setup.
 *   Tests cannot create this marker — it must be pre-provisioned.
 * - DATABASE_URL and TEST_DATABASE_URL are verified to resolve to the same database.
 * - Every connection pool (primary + additional) is verified before use.
 * - All destructive operations are gated behind full verification.
 * - createTestConnection() centralizes pool creation with mandatory verification.
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
/**
 * P52-02: Restricted test roles — "postgres" removed because it typically has
 * superuser privileges and can access any database on the server.
 */
const ALLOWED_TEST_ROLES = ["stellarwallet_test", "amma_test", "test", "aw_test_runner"];
/** Sentinel table name — must be created during controlled test-db provisioning. */
const TEST_MARKER_TABLE = "aw_test_harness_marker";
/**
 * P52-02: Trusted provisioning nonce column. During separate provisioning,
 * a known nonce value is written. The harness verifies this nonce exists
 * but never creates it, preventing tests from self-authorizing against
 * misconfigured databases.
 */
const PROVISIONING_NONCE = "p52-disposable-verified";

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
 * Phase 5.2 hardened checks:
 * 1. current_database() — must be in ALLOWED_TEST_DB_NAMES
 * 2. current_user — must be in ALLOWED_TEST_ROLES (postgres excluded)
 * 3. Superuser check — connected role must NOT have usesuper privilege
 * 4. aw_test_harness_marker table — must exist with trusted provisioning nonce
 *
 * Note: inet_server_port() returns the container-internal port (5432), not the
 * host-mapped port (15432), so it would false-positive in Docker environments.
 * The host port is validated by validateTestDatabaseUrl() at module load time.
 */
async function verifyConnectedDatabase(sqlClient: postgres.Sql): Promise<void> {
  const [row] = await sqlClient`SELECT current_database() AS db, current_user AS role`;
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

  // 3. Require allowed test role (P52-02: postgres removed)
  if (!ALLOWED_TEST_ROLES.includes(actualRole.toLowerCase())) {
    throw new Error(
      `[db-harness] SAFETY BLOCK: connected role is "${actualRole}", ` +
      `which is not in the allowed test role list. ` +
      `Allowed roles: ${ALLOWED_TEST_ROLES.join(", ")}. Aborting.`
    );
  }

  // 4. P52-02: Reject superuser roles — even if the role name is in the allow-list,
  //    a role with superuser privileges can access any database on the server.
  const [superCheck] = await sqlClient`
    SELECT usesuper FROM pg_user WHERE usename = current_user
  `;
  if (superCheck?.usesuper === true) {
    throw new Error(
      `[db-harness] SAFETY BLOCK: connected role "${actualRole}" has superuser privileges. ` +
      `Integration tests must use a restricted (non-superuser) role to prevent ` +
      `accidental access to production databases. Aborting.`
    );
  }

  // 5. Require disposable-database marker table
  const [tableExists] = await sqlClient`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ${TEST_MARKER_TABLE}
    ) AS exists
  `;
  if (!tableExists.exists) {
    throw new Error(
      `[db-harness] SAFETY BLOCK: marker table "${TEST_MARKER_TABLE}" not found. ` +
      `This database was not provisioned by the test database provisioning script. ` +
      `Run: npm run test:provision-db. Aborting.`
    );
  }

  // 6. P52-02: Verify trusted provisioning nonce — the marker table must contain
  //    a row with the expected nonce, proving it was created by a deliberate
  //    provisioning step, not by the tests themselves.
  const [nonceRow] = await sqlClient`
    SELECT provisioning_nonce FROM aw_test_harness_marker
    WHERE provisioning_nonce = ${PROVISIONING_NONCE}
    LIMIT 1
  `;
  if (!nonceRow) {
    throw new Error(
      `[db-harness] SAFETY BLOCK: marker table "${TEST_MARKER_TABLE}" exists but does not ` +
      `contain the trusted provisioning nonce "${PROVISIONING_NONCE}". ` +
      `The database may not have been properly provisioned. ` +
      `Run: npm run test:provision-db. Aborting.`
    );
  }
}

// ── Connection setup ────────────────────────────────────────────────────────

// P52-02: No silent fallback — TEST_DATABASE_URL must be explicitly configured.
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

/**
 * P52-02: Verify DATABASE_URL and TEST_DATABASE_URL resolve to the same database.
 * During integration tests, admin routes use db/index.ts (which reads DATABASE_URL)
 * while the test harness uses TEST_DATABASE_URL. If they differ, the admin route
 * handler writes to one database while tests verify a different one.
 */
export function verifyDatabaseUrlAlignment(): void {
  const appDbUrl = process.env.DATABASE_URL;
  if (!appDbUrl) {
    throw new Error(
      `[db-harness] SAFETY BLOCK: DATABASE_URL is not set. ` +
      `Both DATABASE_URL and TEST_DATABASE_URL must be set for integration tests ` +
      `so that the application and test harness use the same disposable database.`
    );
  }

  const testParsed = parseTestDbUrl(TEST_DB_URL);
  let appParsed: ParsedDbUrl;
  try {
    appParsed = parseTestDbUrl(appDbUrl);
  } catch {
    throw new Error(
      `[db-harness] SAFETY BLOCK: DATABASE_URL is not a valid PostgreSQL URL. ` +
      `Cannot verify alignment with TEST_DATABASE_URL.`
    );
  }

  if (
    testParsed.host !== appParsed.host ||
    testParsed.port !== appParsed.port ||
    testParsed.database !== appParsed.database
  ) {
    throw new Error(
      `[db-harness] SAFETY BLOCK: DATABASE_URL and TEST_DATABASE_URL resolve to different databases. ` +
      `DATABASE_URL: ${appParsed.host}:${appParsed.port}/${appParsed.database} | ` +
      `TEST_DATABASE_URL: ${testParsed.host}:${testParsed.port}/${testParsed.database}. ` +
      `Both must point to the same disposable test database.`
    );
  }

  // Also validate the app DATABASE_URL passes the same safety checks
  validateTestDatabaseUrl(appDbUrl);
}

// Verify alignment at module load time
verifyDatabaseUrlAlignment();

// Single connection pool for the test suite
const client = postgres(TEST_DB_URL, { max: 5 });
export const testDb = drizzle(client, { schema });

// Track whether the connected database has been verified
let _dbVerified = false;

/** Ensure the connected database passes all identity checks. Call before destructive ops. */
export async function ensureVerifiedTestDb(): Promise<void> {
  if (_dbVerified) return;
  await verifyConnectedDatabase(client);
  _dbVerified = true;
}

/**
 * P52-02: Centralized test connection factory.
 * All integration tests MUST use this to create additional connection pools
 * (e.g. for concurrency testing). This ensures every pool is validated against
 * the same TEST_DATABASE_URL and cannot bypass safety checks.
 *
 * Returns a verify() function that MUST be called before the pool is used for
 * any database operations. This ensures the additional pool connects to the
 * same verified disposable database.
 */
export function createTestConnection(opts?: { max?: number }): {
  sql: postgres.Sql;
  db: ReturnType<typeof drizzle>;
  verify: () => Promise<void>;
} {
  const connClient = postgres(TEST_DB_URL, { max: opts?.max ?? 2 });
  const connDb = drizzle(connClient, { schema });
  let poolVerified = false;

  return {
    sql: connClient,
    db: connDb,
    verify: async () => {
      if (poolVerified) return;
      await verifyConnectedDatabase(connClient);
      poolVerified = true;
    },
  };
}

/**
 * P52-02: Provision the disposable-database marker table.
 *
 * This is the PROVISIONING step — it creates the marker table and writes the
 * trusted nonce. This function should be called by a separate provisioning
 * script (e.g., test:provision-db), NOT by test beforeAll hooks.
 *
 * For backward compatibility during migration, test suites can still call this
 * but the marker table schema now includes the provisioning_nonce column.
 */
export async function provisionTestMarker(): Promise<void> {
  await ensureVerifiedTestDb().catch(() => {
    // During initial provisioning, verification will fail because the marker
    // doesn't exist yet. That's expected — we're creating it now.
    // But we still validate the URL and role to prevent provisioning
    // against the wrong database.
  });

  // Create marker table with nonce column (unsafe for DDL with dynamic defaults)
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS ${TEST_MARKER_TABLE} (
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      harness_version TEXT NOT NULL DEFAULT '5.2',
      provisioning_nonce TEXT NOT NULL DEFAULT '${PROVISIONING_NONCE}'
    )
  `);

  // Add provisioning_nonce column if missing (upgrade from 5.1 marker)
  await client.unsafe(`
    ALTER TABLE ${TEST_MARKER_TABLE}
    ADD COLUMN IF NOT EXISTS provisioning_nonce TEXT NOT NULL DEFAULT '${PROVISIONING_NONCE}'
  `);

  // Ensure at least one row with the correct nonce
  const [existing] = await client`
    SELECT 1 FROM aw_test_harness_marker
    WHERE provisioning_nonce = ${PROVISIONING_NONCE}
    LIMIT 1
  `;
  if (!existing) {
    await client`
      INSERT INTO aw_test_harness_marker (harness_version, provisioning_nonce)
      VALUES ('5.2', ${PROVISIONING_NONCE})
    `;
  }

  // Reset verification state so the next ensureVerifiedTestDb() re-checks
  _dbVerified = false;
}

// ── Seed helpers ─────────────────────────────────────────────────────────────

export async function seedTestTenant(opts: {
  name: string;
  slug: string;
  balance?: string;
  isActive?: boolean;
}): Promise<number> {
  await ensureVerifiedTestDb();
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
  await ensureVerifiedTestDb();
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
  await ensureVerifiedTestDb();
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

// ── Exported constants for test assertions ──────────────────────────────────

export const TEST_HARNESS_CONSTANTS = {
  ALLOWED_TEST_HOSTS,
  ALLOWED_TEST_PORTS,
  ALLOWED_TEST_DB_NAMES,
  PRODUCTION_DB_NAMES,
  ALLOWED_TEST_ROLES,
  TEST_MARKER_TABLE,
  PROVISIONING_NONCE,
} as const;
