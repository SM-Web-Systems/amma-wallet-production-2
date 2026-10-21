/**
 * Tests for FIND-005-A/B/C — 2FA consistency in login flow.
 *
 * 2FA-LOGIN-1: Login TOTP window must be 1 (not 2)
 * 2FA-LOGIN-2: Login static code must use timingSafeCompare
 * 2FA-LOGIN-3: Login backup code must use timingSafeCompare (via findIndex)
 * 2FA-LOGIN-4: timingSafeCompare import must be present
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const authSource = readFileSync(resolve(__dirname, "auth.ts"), "utf-8");

describe("2FA consistency in login flow (FIND-005-A/B/C)", () => {
  it("2FA-LOGIN-1: Login TOTP uses window: 1 (not window: 2)", () => {
    // There should be NO window: 2 anywhere in auth.ts
    const badMatches = authSource.match(/window:\s*2/g);
    expect(badMatches).toBeNull();
  });

  it("2FA-LOGIN-2: Static code comparison uses timingSafeCompare", () => {
    // Should find timingSafeCompare used with twoFaStaticCode
    expect(authSource).toContain("timingSafeCompare(user.twoFaStaticCode");
  });

  it("2FA-LOGIN-3: Backup code comparison uses findIndex + timingSafeCompare", () => {
    // Should use findIndex with timingSafeCompare, not indexOf
    expect(authSource).toContain("findIndex");
    expect(authSource).toContain("timingSafeCompare(c, hashedInput)");
    // Should NOT have storedCodes.indexOf(hashedInput)
    expect(authSource).not.toContain("storedCodes.indexOf(hashedInput)");
  });

  it("2FA-LOGIN-4: timingSafeCompare is imported", () => {
    expect(authSource).toContain('import { timingSafeCompare }');
  });
});
