/**
 * P52-04: Credit operation storage scoping tests (Phase 5.2).
 *
 * Verifies that credit operations are correctly scoped to
 * (adminId, tenantId) pairs, that corrupted storage fails
 * safely, and that cross-admin/cross-tenant isolation holds.
 */

import { describe, expect, it, beforeEach } from "vitest";
import {
  CreditOperation,
  storageKey,
  loadCreditOp,
  saveCreditOp,
  clearCreditOp,
} from "./credit-op-storage";

function makeOp(overrides: Partial<CreditOperation> = {}): CreditOperation {
  return {
    key: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    type: "manual_topup",
    amount: "100.0000000",
    notes: "",
    state: "CONFIRMED",
    adminId: 1,
    tenantId: "42",
    createdAt: "2026-10-20T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  sessionStorage.clear();
});

// ── Storage key format ──────────────────────────────────────────────────────

describe("storageKey", () => {
  it("includes adminId and tenantId", () => {
    expect(storageKey(1, "42")).toBe("aw_pending_credit_1_42");
    expect(storageKey(7, "100")).toBe("aw_pending_credit_7_100");
  });

  it("different admins produce different keys", () => {
    expect(storageKey(1, "42")).not.toBe(storageKey(2, "42"));
  });

  it("different tenants produce different keys", () => {
    expect(storageKey(1, "42")).not.toBe(storageKey(1, "43"));
  });
});

// ── Save / load round-trip ──────────────────────────────────────────────────

describe("saveCreditOp + loadCreditOp", () => {
  it("round-trips a valid operation", () => {
    const op = makeOp();
    saveCreditOp(op);
    const loaded = loadCreditOp(1, "42");
    expect(loaded).toEqual(op);
  });

  it("returns null when nothing is stored", () => {
    expect(loadCreditOp(1, "42")).toBeNull();
  });
});

// ── Admin isolation (P52-04 core requirement) ───────────────────────────────

describe("P52-04: admin identity scoping", () => {
  it("admin A cannot load admin B's pending operation", () => {
    const opA = makeOp({ adminId: 1 });
    saveCreditOp(opA);

    // Admin B tries to load — should get null
    expect(loadCreditOp(2, "42")).toBeNull();

    // Admin A can still load their own
    expect(loadCreditOp(1, "42")).toEqual(opA);
  });

  it("two admins can have independent ops for the same tenant", () => {
    const opA = makeOp({ adminId: 1, key: "aaaa-key" });
    const opB = makeOp({ adminId: 2, key: "bbbb-key" });
    saveCreditOp(opA);
    saveCreditOp(opB);

    expect(loadCreditOp(1, "42")?.key).toBe("aaaa-key");
    expect(loadCreditOp(2, "42")?.key).toBe("bbbb-key");
  });
});

// ── Tenant isolation ────────────────────────────────────────────────────────

describe("P52-04: tenant isolation", () => {
  it("different tenants have independent operations", () => {
    const op42 = makeOp({ tenantId: "42", key: "key-42" });
    const op99 = makeOp({ tenantId: "99", key: "key-99" });
    saveCreditOp(op42);
    saveCreditOp(op99);

    expect(loadCreditOp(1, "42")?.key).toBe("key-42");
    expect(loadCreditOp(1, "99")?.key).toBe("key-99");
  });

  it("clearing one tenant does not affect another", () => {
    saveCreditOp(makeOp({ tenantId: "42" }));
    saveCreditOp(makeOp({ tenantId: "99" }));

    clearCreditOp(1, "42");
    expect(loadCreditOp(1, "42")).toBeNull();
    expect(loadCreditOp(1, "99")).not.toBeNull();
  });
});

// ── Corrupted storage safety ────────────────────────────────────────────────

describe("P52-04: corrupted storage fails safely", () => {
  it("returns null for invalid JSON", () => {
    sessionStorage.setItem("aw_pending_credit_1_42", "not-json{{{");
    expect(loadCreditOp(1, "42")).toBeNull();
  });

  it("returns null for missing required fields", () => {
    sessionStorage.setItem("aw_pending_credit_1_42", JSON.stringify({ key: "abc" }));
    expect(loadCreditOp(1, "42")).toBeNull();
  });

  it("returns null when adminId does not match (tampered data)", () => {
    const tampered = makeOp({ adminId: 999 });
    sessionStorage.setItem("aw_pending_credit_1_42", JSON.stringify(tampered));
    expect(loadCreditOp(1, "42")).toBeNull();
  });

  it("returns null when tenantId does not match (tampered data)", () => {
    const tampered = makeOp({ tenantId: "999" });
    sessionStorage.setItem("aw_pending_credit_1_42", JSON.stringify(tampered));
    expect(loadCreditOp(1, "42")).toBeNull();
  });

  it("returns null for null value in storage", () => {
    sessionStorage.setItem("aw_pending_credit_1_42", "null");
    expect(loadCreditOp(1, "42")).toBeNull();
  });

  it("returns null for empty string in storage", () => {
    sessionStorage.setItem("aw_pending_credit_1_42", "");
    expect(loadCreditOp(1, "42")).toBeNull();
  });

  it("returns null when field types are wrong", () => {
    const bad = { ...makeOp(), adminId: "1" }; // string instead of number
    sessionStorage.setItem("aw_pending_credit_1_42", JSON.stringify(bad));
    // adminId is "1" (string) but validator checks typeof === "number"
    expect(loadCreditOp(1, "42")).toBeNull();
  });
});

// ── clearCreditOp ───────────────────────────────────────────────────────────

describe("clearCreditOp", () => {
  it("removes the stored operation", () => {
    saveCreditOp(makeOp());
    clearCreditOp(1, "42");
    expect(loadCreditOp(1, "42")).toBeNull();
  });

  it("is safe to call when nothing is stored", () => {
    expect(() => clearCreditOp(1, "42")).not.toThrow();
  });
});

// ── State persistence across operations ─────────────────────────────────────

describe("P52-01: state machine persistence", () => {
  it("preserves all state transitions", () => {
    const states: CreditOperation["state"][] = [
      "CONFIRMED", "SUBMITTING", "UNKNOWN", "COMMITTED", "REJECTED",
    ];
    for (const state of states) {
      const op = makeOp({ state });
      saveCreditOp(op);
      expect(loadCreditOp(1, "42")?.state).toBe(state);
    }
  });

  it("preserves committedEventId in COMMITTED state", () => {
    const op = makeOp({ state: "COMMITTED", committedEventId: 42 });
    saveCreditOp(op);
    expect(loadCreditOp(1, "42")?.committedEventId).toBe(42);
  });

  it("preserves rejectionReason in REJECTED state", () => {
    const op = makeOp({ state: "REJECTED", rejectionReason: "409 conflict" });
    saveCreditOp(op);
    expect(loadCreditOp(1, "42")?.rejectionReason).toBe("409 conflict");
  });
});
