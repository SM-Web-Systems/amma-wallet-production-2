/**
 * Tests for FIND-009-A — SEP-10 network passphrase validation.
 *
 * SEP10-1: moneygram.ts validates remote network_passphrase against config
 * SEP10-2: moneygram.ts uses server-configured passphrase (not remote fallback)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const source = readFileSync(resolve(__dirname, "moneygram.ts"), "utf-8");

describe("SEP-10 Network Passphrase Validation (FIND-009-A)", () => {
  it("SEP10-1: Validates remote network_passphrase matches expected", () => {
    expect(source).toContain("network_passphrase mismatch");
    expect(source).toContain("network_passphrase !== expectedPassphrase");
  });

  it("SEP10-2: Uses expectedPassphrase (not remote) for XDR parsing", () => {
    // Should use expectedPassphrase in fromXDR, not network_passphrase
    expect(source).toContain("expectedPassphrase,");
    expect(source).toMatch(/fromXDR\(\s*\n\s*transaction,\s*\n\s*expectedPassphrase,/);
  });

  it("SEP10-3: Does not use remote network_passphrase as fallback in fromXDR", () => {
    // The old pattern used network_passphrase || (...) — should be gone
    expect(source).not.toMatch(/fromXDR\(\s*transaction,\s*network_passphrase\s*\|\|/);
  });
});
