/**
 * P52-04: Credit operation storage scoping tests (Phase 5.2).
 *
 * Verifies that credit operations are correctly scoped to
 * (adminId, tenantId) pairs, that corrupted storage fails
 * safely, and that cross-admin/cross-tenant isolation holds.
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  CreditOperation,
  storageKey,
  loadCreditOp,
  saveCreditOp,
  safeSaveCreditOp,
  clearCreditOp,
  saveConflictEvidence,
  loadConflictEvidence,
  clearConflictEvidence,
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

// ── P533-01: Strict operation identity matching ────────────────────────────
// These tests verify that safeSaveCreditOp rejects different-UUID writes
// and that callers can rely on the return value for React state consistency.

describe("P533-01: different UUID cannot overwrite active operations", () => {
  const UUID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const UUID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  it("different UUID cannot overwrite active UNKNOWN operation", () => {
    // UUID-A in UNKNOWN state (financial outcome uncertain)
    saveCreditOp(makeOp({ key: UUID_A, state: "UNKNOWN" }));

    // UUID-B tries to overwrite
    const result = safeSaveCreditOp(makeOp({ key: UUID_B, state: "COMMITTED", committedEventId: 99 }));

    // Must be REJECTED — UUID-A's uncertain evidence is protected
    expect(result).toBe(false);
    const stored = loadCreditOp(1, "42");
    expect(stored?.key).toBe(UUID_A);
    expect(stored?.state).toBe("UNKNOWN");
  });

  it("different UUID cannot overwrite active SUBMITTING operation", () => {
    saveCreditOp(makeOp({ key: UUID_A, state: "SUBMITTING" }));

    const result = safeSaveCreditOp(makeOp({ key: UUID_B, state: "COMMITTED", committedEventId: 99 }));

    expect(result).toBe(false);
    expect(loadCreditOp(1, "42")?.key).toBe(UUID_A);
    expect(loadCreditOp(1, "42")?.state).toBe("SUBMITTING");
  });

  it("different UUID cannot overwrite active CONFIRMED operation", () => {
    saveCreditOp(makeOp({ key: UUID_A, state: "CONFIRMED" }));

    const result = safeSaveCreditOp(makeOp({ key: UUID_B, state: "UNKNOWN" }));

    expect(result).toBe(false);
    expect(loadCreditOp(1, "42")?.key).toBe(UUID_A);
    expect(loadCreditOp(1, "42")?.state).toBe("CONFIRMED");
  });

  it("different UUID cannot overwrite active COMMITTED operation", () => {
    saveCreditOp(makeOp({ key: UUID_A, state: "COMMITTED", committedEventId: 42 }));

    const result = safeSaveCreditOp(makeOp({ key: UUID_B, state: "COMMITTED", committedEventId: 99 }));

    expect(result).toBe(false);
    expect(loadCreditOp(1, "42")?.key).toBe(UUID_A);
    expect(loadCreditOp(1, "42")?.committedEventId).toBe(42);
  });

  it("different UUID cannot overwrite active REJECTED operation", () => {
    saveCreditOp(makeOp({ key: UUID_A, state: "REJECTED", rejectionReason: "conflict" }));

    const result = safeSaveCreditOp(makeOp({ key: UUID_B, state: "COMMITTED", committedEventId: 99 }));

    expect(result).toBe(false);
    expect(loadCreditOp(1, "42")?.key).toBe(UUID_A);
    expect(loadCreditOp(1, "42")?.state).toBe("REJECTED");
  });

  it("older response cannot overwrite newer UUID operation", () => {
    // UUID-B is the newer active operation
    saveCreditOp(makeOp({ key: UUID_B, state: "SUBMITTING", amount: "200.0000000" }));

    // UUID-A (older) stale response tries to save
    const result = safeSaveCreditOp(makeOp({ key: UUID_A, state: "COMMITTED", amount: "100.0000000" }));

    expect(result).toBe(false);
    const stored = loadCreditOp(1, "42");
    expect(stored?.key).toBe(UUID_B);
    expect(stored?.amount).toBe("200.0000000");
  });

  it("immutable financial payload cannot change through a stale response", () => {
    saveCreditOp(makeOp({ key: UUID_A, state: "UNKNOWN", amount: "100.0000000", notes: "original" }));

    // Different UUID tries to change payload
    const result = safeSaveCreditOp(makeOp({
      key: UUID_B, state: "COMMITTED", amount: "999.0000000", notes: "tampered",
    }));

    expect(result).toBe(false);
    const stored = loadCreditOp(1, "42");
    expect(stored?.amount).toBe("100.0000000");
    expect(stored?.notes).toBe("original");
  });
});

describe("P533-01: same UUID valid state progressions", () => {
  const UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  it("same UUID CONFIRMED → SUBMITTING accepted", () => {
    saveCreditOp(makeOp({ key: UUID, state: "CONFIRMED" }));
    const result = safeSaveCreditOp(makeOp({ key: UUID, state: "SUBMITTING" }));
    expect(result).toBe(true);
    expect(loadCreditOp(1, "42")?.state).toBe("SUBMITTING");
  });

  it("same UUID SUBMITTING → COMMITTED accepted", () => {
    saveCreditOp(makeOp({ key: UUID, state: "SUBMITTING" }));
    const result = safeSaveCreditOp(makeOp({ key: UUID, state: "COMMITTED", committedEventId: 42 }));
    expect(result).toBe(true);
    expect(loadCreditOp(1, "42")?.state).toBe("COMMITTED");
  });

  it("same UUID SUBMITTING → UNKNOWN accepted", () => {
    saveCreditOp(makeOp({ key: UUID, state: "SUBMITTING" }));
    const result = safeSaveCreditOp(makeOp({ key: UUID, state: "UNKNOWN" }));
    expect(result).toBe(true);
    expect(loadCreditOp(1, "42")?.state).toBe("UNKNOWN");
  });

  it("same UUID SUBMITTING → REJECTED accepted", () => {
    saveCreditOp(makeOp({ key: UUID, state: "SUBMITTING" }));
    const result = safeSaveCreditOp(makeOp({ key: UUID, state: "REJECTED", rejectionReason: "4xx" }));
    expect(result).toBe(true);
    expect(loadCreditOp(1, "42")?.state).toBe("REJECTED");
  });

  it("same UUID UNKNOWN → COMMITTED accepted", () => {
    saveCreditOp(makeOp({ key: UUID, state: "UNKNOWN" }));
    const result = safeSaveCreditOp(makeOp({ key: UUID, state: "COMMITTED", committedEventId: 42 }));
    expect(result).toBe(true);
    expect(loadCreditOp(1, "42")?.state).toBe("COMMITTED");
  });

  it("COMMITTED cannot be downgraded to UNKNOWN (same UUID)", () => {
    saveCreditOp(makeOp({ key: UUID, state: "COMMITTED", committedEventId: 42 }));
    const result = safeSaveCreditOp(makeOp({ key: UUID, state: "UNKNOWN" }));
    expect(result).toBe(false);
    expect(loadCreditOp(1, "42")?.state).toBe("COMMITTED");
  });

  it("COMMITTED cannot be downgraded to REJECTED (same UUID)", () => {
    saveCreditOp(makeOp({ key: UUID, state: "COMMITTED", committedEventId: 42 }));
    const result = safeSaveCreditOp(makeOp({ key: UUID, state: "REJECTED" }));
    expect(result).toBe(false);
    expect(loadCreditOp(1, "42")?.state).toBe("COMMITTED");
  });

  it("empty slot accepts new evidence", () => {
    // No existing record
    const result = safeSaveCreditOp(makeOp({ key: UUID, state: "COMMITTED", committedEventId: 77 }));
    expect(result).toBe(true);
    expect(loadCreditOp(1, "42")?.state).toBe("COMMITTED");
    expect(loadCreditOp(1, "42")?.committedEventId).toBe(77);
  });
});

// ── P534-01: Conflict evidence preservation ─────────────────────────────
// These tests verify that when safeSaveCreditOp rejects a COMMITTED write
// due to UUID mismatch, the evidence can be preserved via conflict records.

describe("P534-01: conflict evidence preservation", () => {
  const UUID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const UUID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  it("S01: saveConflictEvidence stores under UUID-specific key", () => {
    const op = makeOp({ key: UUID_A, state: "COMMITTED", committedEventId: 42 });
    const result = saveConflictEvidence(op);
    expect(result).toBe(true);

    // Verify it's stored under a key containing the UUID
    const stored = sessionStorage.getItem(`aw_credit_conflict_1_42_${UUID_A}`);
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.key).toBe(UUID_A);
    expect(parsed.state).toBe("COMMITTED");
    expect(parsed.committedEventId).toBe(42);
  });

  it("S02: loadConflictEvidence retrieves matching records", () => {
    saveConflictEvidence(makeOp({ key: UUID_A, state: "COMMITTED", committedEventId: 42 }));
    saveConflictEvidence(makeOp({ key: UUID_B, state: "UNKNOWN" }));

    const records = loadConflictEvidence(1, "42");
    expect(records.length).toBe(2);
    const keys = records.map(r => r.key).sort();
    expect(keys).toEqual([UUID_A, UUID_B].sort());
  });

  it("S03: clearConflictEvidence removes specific record", () => {
    saveConflictEvidence(makeOp({ key: UUID_A, state: "COMMITTED" }));
    saveConflictEvidence(makeOp({ key: UUID_B, state: "UNKNOWN" }));

    clearConflictEvidence(1, "42", UUID_A);

    const records = loadConflictEvidence(1, "42");
    expect(records.length).toBe(1);
    expect(records[0].key).toBe(UUID_B);
  });

  it("S04: duplicate saves overwrite same key (no accumulation)", () => {
    saveConflictEvidence(makeOp({ key: UUID_A, state: "UNKNOWN" }));
    saveConflictEvidence(makeOp({ key: UUID_A, state: "COMMITTED", committedEventId: 99 }));

    const records = loadConflictEvidence(1, "42");
    expect(records.length).toBe(1);
    expect(records[0].state).toBe("COMMITTED");
    expect(records[0].committedEventId).toBe(99);
  });

  it("S05: malformed conflict records skipped on load", () => {
    saveConflictEvidence(makeOp({ key: UUID_A, state: "COMMITTED" }));
    // Write malformed data under a conflict key
    sessionStorage.setItem(`aw_credit_conflict_1_42_${UUID_B}`, "not-valid-json{{{");

    const records = loadConflictEvidence(1, "42");
    expect(records.length).toBe(1);
    expect(records[0].key).toBe(UUID_A);
  });

  it("S06: storage failure returns false", () => {
    // Mock sessionStorage to throw on setItem
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });

    try {
      const result = saveConflictEvidence(makeOp({ key: UUID_A, state: "COMMITTED" }));
      expect(result).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("S07: conflict records isolated by admin/tenant", () => {
    // Admin 1, Tenant 42
    saveConflictEvidence(makeOp({ key: UUID_A, adminId: 1, tenantId: "42", state: "COMMITTED" }));
    // Admin 2, Tenant 42
    saveConflictEvidence(makeOp({ key: UUID_B, adminId: 2, tenantId: "42", state: "UNKNOWN" }));
    // Admin 1, Tenant 99
    saveConflictEvidence(makeOp({ key: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", adminId: 1, tenantId: "99", state: "COMMITTED" }));

    expect(loadConflictEvidence(1, "42").length).toBe(1);
    expect(loadConflictEvidence(1, "42")[0].key).toBe(UUID_A);
    expect(loadConflictEvidence(2, "42").length).toBe(1);
    expect(loadConflictEvidence(2, "42")[0].key).toBe(UUID_B);
    expect(loadConflictEvidence(1, "99").length).toBe(1);
  });
});

// ── P534-R01: Monotonic conflict evidence preservation ──────────────────
// These tests verify that saveConflictEvidence respects state precedence
// and cannot downgrade authoritative financial evidence.

describe("P534-R01: monotonic conflict evidence", () => {
  const UUID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const UUID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  it("R01-S01: UNKNOWN → COMMITTED upgrade succeeds", () => {
    saveConflictEvidence(makeOp({ key: UUID_A, state: "UNKNOWN" }));
    const result = saveConflictEvidence(makeOp({ key: UUID_A, state: "COMMITTED", committedEventId: 42 }));
    expect(result).toBe(true);

    const records = loadConflictEvidence(1, "42");
    expect(records.length).toBe(1);
    expect(records[0].state).toBe("COMMITTED");
    expect(records[0].committedEventId).toBe(42);
  });

  it("R01-S02: COMMITTED → UNKNOWN rejected, existing preserved", () => {
    saveConflictEvidence(makeOp({ key: UUID_A, state: "COMMITTED", committedEventId: 42 }));
    const result = saveConflictEvidence(makeOp({ key: UUID_A, state: "UNKNOWN" }));

    // Must return true (evidence IS protected — by the existing stronger record)
    expect(result).toBe(true);

    const records = loadConflictEvidence(1, "42");
    expect(records.length).toBe(1);
    expect(records[0].state).toBe("COMMITTED");
    expect(records[0].committedEventId).toBe(42);
  });

  it("R01-S03: COMMITTED → REJECTED cannot downgrade", () => {
    saveConflictEvidence(makeOp({ key: UUID_A, state: "COMMITTED", committedEventId: 42 }));
    const result = saveConflictEvidence(makeOp({ key: UUID_A, state: "REJECTED", rejectionReason: "conflict" }));

    expect(result).toBe(true); // protected by existing
    const records = loadConflictEvidence(1, "42");
    expect(records[0].state).toBe("COMMITTED");
  });

  it("R01-S04: duplicate COMMITTED preserves correct eventId", () => {
    saveConflictEvidence(makeOp({ key: UUID_A, state: "COMMITTED", committedEventId: 42 }));
    const result = saveConflictEvidence(makeOp({ key: UUID_A, state: "COMMITTED", committedEventId: 42 }));

    expect(result).toBe(true);
    const records = loadConflictEvidence(1, "42");
    expect(records[0].committedEventId).toBe(42);
  });

  it("R01-S05: COMMITTED without eventId cannot erase existing eventId", () => {
    saveConflictEvidence(makeOp({ key: UUID_A, state: "COMMITTED", committedEventId: 42 }));
    // Incoming COMMITTED with no eventId (e.g., from a res.json() parse failure)
    const result = saveConflictEvidence(makeOp({ key: UUID_A, state: "COMMITTED" }));

    expect(result).toBe(true);
    const records = loadConflictEvidence(1, "42");
    expect(records[0].committedEventId).toBe(42);
  });

  it("R01-S06: altered immutable financial fields cannot silently replace original", () => {
    saveConflictEvidence(makeOp({ key: UUID_A, state: "COMMITTED", amount: "100.0000000", committedEventId: 42 }));
    // Incoming has same UUID and state but different amount — conflict
    const result = saveConflictEvidence(makeOp({ key: UUID_A, state: "COMMITTED", amount: "999.0000000", committedEventId: 42 }));

    // Should be rejected — existing evidence protected
    expect(result).toBe(true);
    const records = loadConflictEvidence(1, "42");
    expect(records[0].amount).toBe("100.0000000");
  });

  it("R01-S07: different UUIDs remain isolated in conflict evidence", () => {
    saveConflictEvidence(makeOp({ key: UUID_A, state: "COMMITTED", committedEventId: 42 }));
    saveConflictEvidence(makeOp({ key: UUID_B, state: "UNKNOWN" }));

    const records = loadConflictEvidence(1, "42");
    expect(records.length).toBe(2);
    const recordA = records.find(r => r.key === UUID_A)!;
    const recordB = records.find(r => r.key === UUID_B)!;
    expect(recordA.state).toBe("COMMITTED");
    expect(recordA.committedEventId).toBe(42);
    expect(recordB.state).toBe("UNKNOWN");
  });

  it("R01-S08: delayed network error cannot overwrite committed conflict record", () => {
    // COMMITTED evidence stored first
    saveConflictEvidence(makeOp({ key: UUID_A, state: "COMMITTED", committedEventId: 77 }));

    // Delayed catch handler produces UNKNOWN for same UUID
    const result = saveConflictEvidence(makeOp({ key: UUID_A, state: "UNKNOWN" }));

    // Existing COMMITTED must survive
    expect(result).toBe(true);
    const records = loadConflictEvidence(1, "42");
    expect(records[0].state).toBe("COMMITTED");
    expect(records[0].committedEventId).toBe(77);
  });

  it("R01-S09: malformed existing record treated as overwritable", () => {
    // Write malformed data directly
    sessionStorage.setItem(`aw_credit_conflict_1_42_${UUID_A}`, "not-valid-json{{{");

    const result = saveConflictEvidence(makeOp({ key: UUID_A, state: "COMMITTED", committedEventId: 99 }));
    expect(result).toBe(true);

    const records = loadConflictEvidence(1, "42");
    expect(records[0].state).toBe("COMMITTED");
    expect(records[0].committedEventId).toBe(99);
  });
});
