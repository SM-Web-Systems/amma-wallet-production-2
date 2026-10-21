/**
 * Tests for integration test database safety guards (Phase 5.2 — P52-02).
 *
 * These tests verify that the db-harness refuses to connect to or
 * execute destructive operations against non-test databases.
 *
 * Phase 5.2 additions:
 * - Superuser role rejection
 * - Trusted provisioning nonce verification
 * - DATABASE_URL / TEST_DATABASE_URL alignment
 * - Additional connection pool verification
 * - Seed operations gated behind verification
 * - TRUNCATE gated behind verification
 *
 * Run with: npx vitest run --config vitest.integration.config.ts
 */

import { describe, expect, it } from "vitest";
import {
  parseTestDbUrl,
  validateTestDatabaseUrl,
  verifyDatabaseUrlAlignment,
  TEST_HARNESS_CONSTANTS,
} from "./db-harness";

const {
  ALLOWED_TEST_HOSTS,
  ALLOWED_TEST_PORTS,
  ALLOWED_TEST_DB_NAMES,
  PRODUCTION_DB_NAMES,
  ALLOWED_TEST_ROLES,
  PROVISIONING_NONCE,
} = TEST_HARNESS_CONSTANTS;

// ── URL parsing ─────────────────────────────────────────────────────────────

describe("parseTestDbUrl", () => {
  it("parses a standard PostgreSQL URL", () => {
    const result = parseTestDbUrl(
      "postgresql://user:pass@localhost:15432/stellarwallet_test",
    );
    expect(result).toEqual({
      host: "localhost",
      port: 15432,
      database: "stellarwallet_test",
      user: "user",
    });
  });

  it("defaults to port 5432 when not specified", () => {
    const result = parseTestDbUrl(
      "postgresql://user:pass@localhost/stellarwallet_test",
    );
    expect(result.port).toBe(5432);
  });

  it("rejects invalid URL format", () => {
    expect(() => parseTestDbUrl("not-a-url")).toThrow("Invalid database URL format");
  });

  it("rejects non-PostgreSQL protocol", () => {
    expect(() =>
      parseTestDbUrl("mysql://user:pass@localhost:15432/test"),
    ).toThrow("Invalid database URL protocol");
  });
});

// ── Safety validation ───────────────────────────────────────────────────────

describe("validateTestDatabaseUrl", () => {
  const SAFE_URL = "postgresql://stellarwallet_test:test_only_password@localhost:15432/stellarwallet_test";

  it("accepts approved test database configuration", () => {
    const parsed = validateTestDatabaseUrl(SAFE_URL);
    expect(parsed.database).toBe("stellarwallet_test");
    expect(parsed.host).toBe("localhost");
    expect(parsed.port).toBe(15432);
  });

  it("rejects missing database URL (empty string)", () => {
    expect(() => validateTestDatabaseUrl("")).toThrow();
  });

  // ── Production database name rejection ──────────────────────────────────

  it("rejects production database name: stellarwallet", () => {
    expect(() =>
      validateTestDatabaseUrl("postgresql://u:p@localhost:15432/stellarwallet"),
    ).toThrow("SAFETY BLOCK");
    expect(() =>
      validateTestDatabaseUrl("postgresql://u:p@localhost:15432/stellarwallet"),
    ).toThrow("production database name");
  });

  it("rejects production database name: amma", () => {
    expect(() =>
      validateTestDatabaseUrl("postgresql://u:p@localhost:15432/amma"),
    ).toThrow("SAFETY BLOCK");
  });

  it("rejects production database name: ammawallet", () => {
    expect(() =>
      validateTestDatabaseUrl("postgresql://u:p@localhost:15432/ammawallet"),
    ).toThrow("SAFETY BLOCK");
  });

  it("rejects production database name: amma_wallet", () => {
    expect(() =>
      validateTestDatabaseUrl("postgresql://u:p@localhost:15432/amma_wallet"),
    ).toThrow("SAFETY BLOCK");
  });

  it("rejects production database name: amma_production", () => {
    expect(() =>
      validateTestDatabaseUrl("postgresql://u:p@localhost:15432/amma_production"),
    ).toThrow("SAFETY BLOCK");
  });

  it("rejects unknown database names not in allow-list", () => {
    expect(() =>
      validateTestDatabaseUrl("postgresql://u:p@localhost:15432/my_custom_db"),
    ).toThrow("not in the allowed test database list");
  });

  // ── Host rejection ────────────────────────────────────────────────────────

  it("rejects remote hosts", () => {
    expect(() =>
      validateTestDatabaseUrl("postgresql://u:p@db.example.com:15432/stellarwallet_test"),
    ).toThrow("SAFETY BLOCK");
    expect(() =>
      validateTestDatabaseUrl("postgresql://u:p@db.example.com:15432/stellarwallet_test"),
    ).toThrow("not a recognized local test host");
  });

  it("rejects IP addresses that aren't localhost", () => {
    expect(() =>
      validateTestDatabaseUrl("postgresql://u:p@10.0.0.5:15432/stellarwallet_test"),
    ).toThrow("SAFETY BLOCK");
  });

  it("accepts 127.0.0.1 as localhost", () => {
    const parsed = validateTestDatabaseUrl(
      "postgresql://u:p@127.0.0.1:15432/stellarwallet_test",
    );
    expect(parsed.host).toBe("127.0.0.1");
  });

  // ── Port rejection ────────────────────────────────────────────────────────

  it("rejects default PostgreSQL port 5432", () => {
    expect(() =>
      validateTestDatabaseUrl("postgresql://u:p@localhost:5432/stellarwallet_test"),
    ).toThrow("SAFETY BLOCK");
    expect(() =>
      validateTestDatabaseUrl("postgresql://u:p@localhost:5432/stellarwallet_test"),
    ).toThrow("5432");
  });

  it("rejects URLs without explicit port (defaults to 5432)", () => {
    expect(() =>
      validateTestDatabaseUrl("postgresql://u:p@localhost/stellarwallet_test"),
    ).toThrow("SAFETY BLOCK");
  });

  it("rejects arbitrary non-test ports", () => {
    expect(() =>
      validateTestDatabaseUrl("postgresql://u:p@localhost:3306/stellarwallet_test"),
    ).toThrow("SAFETY BLOCK");
  });

  it("accepts the secondary test port 15433", () => {
    const parsed = validateTestDatabaseUrl(
      "postgresql://u:p@localhost:15433/stellarwallet_test",
    );
    expect(parsed.port).toBe(15433);
  });

  // ── P52-02: Mismatched database identity ───────────────────────────────

  it("rejects database name with production suffix variations (case-insensitive)", () => {
    expect(() =>
      validateTestDatabaseUrl("postgresql://u:p@localhost:15432/AmmaWallet"),
    ).toThrow("SAFETY BLOCK");
    expect(() =>
      validateTestDatabaseUrl("postgresql://u:p@localhost:15432/AMMA"),
    ).toThrow("SAFETY BLOCK");
  });

  it("rejects malformed postgres:// protocol variant URL with bad host", () => {
    expect(() =>
      validateTestDatabaseUrl("postgres://u:p@prod-db.internal:15432/stellarwallet_test"),
    ).toThrow("SAFETY BLOCK");
  });
});

// ── P52-02: Role allow-list ─────────────────────────────────────────────────

describe("P52-02: test role restrictions", () => {
  it("does not include postgres in allowed test roles", () => {
    expect(ALLOWED_TEST_ROLES).not.toContain("postgres");
  });

  it("only allows explicitly named test roles", () => {
    expect(ALLOWED_TEST_ROLES).toEqual(["stellarwallet_test", "amma_test", "test", "aw_test_runner"]);
  });

  it("has a provisioning nonce defined", () => {
    expect(PROVISIONING_NONCE).toBeTruthy();
    expect(typeof PROVISIONING_NONCE).toBe("string");
    expect(PROVISIONING_NONCE.length).toBeGreaterThan(0);
  });
});

// ── P52-02: DATABASE_URL alignment ──────────────────────────────────────────

describe("P52-02: DATABASE_URL alignment", () => {
  it("verifyDatabaseUrlAlignment succeeds when both URLs match", () => {
    // This test runs with .env.integration which sets both to the same value.
    // If this test fails, the environment is misconfigured.
    expect(() => verifyDatabaseUrlAlignment()).not.toThrow();
  });

  it("alignment function is exported and callable", () => {
    expect(typeof verifyDatabaseUrlAlignment).toBe("function");
  });
});

// ── P52-02: Structural completeness ─────────────────────────────────────────

describe("P52-02: harness structural completeness", () => {
  it("production database name list covers known names", () => {
    const expected = ["stellarwallet", "amma", "ammawallet", "amma_wallet", "amma_production"];
    for (const name of expected) {
      expect(PRODUCTION_DB_NAMES).toContain(name);
    }
  });

  it("test port list does not include 5432", () => {
    expect(ALLOWED_TEST_PORTS).not.toContain(5432);
  });

  it("test host list only contains localhost variants", () => {
    for (const host of ALLOWED_TEST_HOSTS) {
      expect(["localhost", "127.0.0.1", "::1"]).toContain(host);
    }
  });
});
