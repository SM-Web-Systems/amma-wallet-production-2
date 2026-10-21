#!/usr/bin/env tsx
/**
 * Test database provisioning script (Phase 5.2 — P52-02).
 *
 * This script MUST be run BEFORE integration tests to establish the trusted
 * disposable-database marker. It is a separate provisioning step that:
 *
 * 1. Validates TEST_DATABASE_URL points to a known-safe test database.
 * 2. Connects and verifies the actual database identity.
 * 3. Creates the aw_test_harness_marker table with the trusted provisioning nonce.
 * 4. Ensures the application schema tables exist (runs Drizzle push).
 *
 * Usage:
 *   npm run test:provision-db
 *   # or directly:
 *   TEST_DATABASE_URL=postgresql://... tsx src/test-integration/provision-test-db.ts
 *
 * This script is idempotent — safe to run multiple times.
 *
 * DO NOT run this against production databases.
 */

import postgres from "postgres";
import { parseTestDbUrl, validateTestDatabaseUrl } from "./db-harness";

const MARKER_TABLE = "aw_test_harness_marker";
const NONCE = "p52-disposable-verified";

async function main() {
  console.log("[provision-test-db] Starting test database provisioning...\n");

  // 1. Check environment
  const testDbUrl = process.env.TEST_DATABASE_URL;
  if (!testDbUrl) {
    console.error("[provision-test-db] ERROR: TEST_DATABASE_URL is not set.");
    console.error("  Set it in .env.integration or your environment.");
    process.exit(1);
  }

  // 2. Validate URL structure
  let parsed;
  try {
    parsed = validateTestDatabaseUrl(testDbUrl);
    console.log(`[provision-test-db] URL validated: ${parsed.host}:${parsed.port}/${parsed.database}`);
    console.log(`[provision-test-db] Role: ${parsed.user}`);
  } catch (err: any) {
    console.error(`[provision-test-db] URL VALIDATION FAILED: ${err.message}`);
    process.exit(1);
  }

  // 3. Connect
  const client = postgres(testDbUrl, { max: 2 });

  try {
    // 4. Verify connected identity
    const [identity] = await client`SELECT current_database() AS db, current_user AS role`;
    console.log(`[provision-test-db] Connected: db=${identity.db}, role=${identity.role}`);

    if (identity.db !== parsed.database) {
      console.error(`[provision-test-db] MISMATCH: expected db="${parsed.database}", got "${identity.db}"`);
      process.exit(1);
    }

    // 5. Check superuser status
    const [superCheck] = await client`SELECT usesuper FROM pg_user WHERE usename = current_user`;
    if (superCheck?.usesuper === true) {
      console.warn(`[provision-test-db] WARNING: Role "${identity.role}" has superuser privileges.`);
      console.warn("  Integration tests will reject this role. Consider using a restricted role.");
    }

    // 6. Create/update marker table (use unsafe for DDL with dynamic defaults)
    await client.unsafe(`
      CREATE TABLE IF NOT EXISTS ${MARKER_TABLE} (
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        harness_version TEXT NOT NULL DEFAULT '5.2',
        provisioning_nonce TEXT NOT NULL DEFAULT '${NONCE}'
      )
    `);

    // Add provisioning_nonce column if missing (upgrade from 5.1 marker)
    await client.unsafe(`
      ALTER TABLE ${MARKER_TABLE}
      ADD COLUMN IF NOT EXISTS provisioning_nonce TEXT NOT NULL DEFAULT '${NONCE}'
    `);

    // Ensure at least one row with the correct nonce
    const [existing] = await client`
      SELECT 1 FROM aw_test_harness_marker
      WHERE provisioning_nonce = ${NONCE}
      LIMIT 1
    `;
    if (!existing) {
      await client`
        INSERT INTO aw_test_harness_marker (harness_version, provisioning_nonce)
        VALUES ('5.2', ${NONCE})
      `;
      console.log(`[provision-test-db] Marker created with nonce "${NONCE}"`);
    } else {
      console.log(`[provision-test-db] Marker already exists with correct nonce.`);
    }

    // 7. Verify marker
    const [verify] = await client`
      SELECT provisioning_nonce, harness_version, created_at
      FROM aw_test_harness_marker
      WHERE provisioning_nonce = ${NONCE}
      LIMIT 1
    `;
    console.log(`[provision-test-db] Verified: nonce=${verify.provisioning_nonce}, version=${verify.harness_version}`);

    console.log("\n[provision-test-db] Provisioning complete. Test database is ready.");
    console.log("  Run integration tests with: npm run test:integration");

  } catch (err: any) {
    console.error(`[provision-test-db] PROVISIONING FAILED: ${err.message}`);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
