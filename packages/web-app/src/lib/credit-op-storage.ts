/**
 * P52: Credit operation sessionStorage persistence (Phase 5.2 — P52-01/P52-04).
 *
 * Extracted from AdminTenantDetail for testability.
 * Storage key format: aw_pending_credit_{adminId}_{tenantId}
 */

const PENDING_CREDIT_PREFIX = "aw_pending_credit_";
const CONFLICT_PREFIX = "aw_credit_conflict_";

export interface CreditOperation {
  key: string;             // UUID v4 idempotency key
  type: string;            // "manual_topup"
  amount: string;          // decimal string e.g. "100.0000000"
  notes: string;           // optional notes
  state: "CONFIRMED" | "SUBMITTING" | "UNKNOWN" | "COMMITTED" | "REJECTED";
  adminId: number;         // authenticated admin ID
  tenantId: string;        // tenant ID
  createdAt: string;       // ISO timestamp
  committedEventId?: number;  // set when COMMITTED
  rejectionReason?: string;   // set when REJECTED
}

export function storageKey(adminId: number, tenantId: string): string {
  return `${PENDING_CREDIT_PREFIX}${adminId}_${tenantId}`;
}

export function loadCreditOp(adminId: number, tenantId: string): CreditOperation | null {
  try {
    const raw = sessionStorage.getItem(storageKey(adminId, tenantId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.key === "string" &&
      typeof parsed.type === "string" &&
      typeof parsed.amount === "string" &&
      typeof parsed.state === "string" &&
      typeof parsed.adminId === "number" &&
      typeof parsed.tenantId === "string" &&
      parsed.adminId === adminId &&
      parsed.tenantId === tenantId
    ) {
      return parsed as CreditOperation;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveCreditOp(op: CreditOperation): void {
  sessionStorage.setItem(storageKey(op.adminId, op.tenantId), JSON.stringify(op));
}

/**
 * P532-02: State precedence for financial result persistence.
 * Prevents a late-arriving response from downgrading a terminal state.
 *
 * Returns true if the write was accepted, false if it was rejected.
 */
function statePrecedence(state: string): number {
  switch (state) {
    case "COMMITTED": return 5;
    case "REJECTED": return 4;
    case "UNKNOWN": return 3;
    case "SUBMITTING": return 2;
    case "CONFIRMED": return 1;
    default: return 0;
  }
}

export function safeSaveCreditOp(op: CreditOperation): boolean {
  const existing = loadCreditOp(op.adminId, op.tenantId);
  if (!existing) {
    saveCreditOp(op);
    return true;
  }

  const existingPrec = statePrecedence(existing.state);
  const incomingPrec = statePrecedence(op.state);

  // P533-01: Different operation UUID — ALWAYS reject.
  // A stale async response for a different UUID must never overwrite the active
  // operation's record. This protects UNKNOWN (uncertain financial outcome),
  // SUBMITTING (in-flight), and CONFIRMED (ready to submit) — not just terminals.
  if (existing.key !== op.key) {
    return false;
  }

  // Same operation: only allow upgrade or equal precedence
  if (incomingPrec >= existingPrec) {
    saveCreditOp(op);
    return true;
  }

  return false; // rejected: would downgrade terminal state
}

export function clearCreditOp(adminId: number, tenantId: string): void {
  sessionStorage.removeItem(storageKey(adminId, tenantId));
}

// ── P534-01: Conflict evidence preservation ─────────────────────────────
// When safeSaveCreditOp rejects a write because a different UUID occupies
// the active slot, the financial evidence (COMMITTED or UNKNOWN) must not
// be silently discarded. These functions store rejected evidence under a
// UUID-specific key for later reconciliation by the administrator.

function conflictKey(adminId: number, tenantId: string, uuid: string): string {
  return `${CONFLICT_PREFIX}${adminId}_${tenantId}_${uuid}`;
}

/**
 * Preserve financial evidence that was rejected by safeSaveCreditOp.
 * Returns true if the write succeeded, false on storage failure.
 */
export function saveConflictEvidence(op: CreditOperation): boolean {
  try {
    const key = conflictKey(op.adminId, op.tenantId, op.key);
    sessionStorage.setItem(key, JSON.stringify(op));
    return sessionStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

/**
 * Load all conflict evidence records for a given (admin, tenant) pair.
 * Skips malformed records silently.
 */
export function loadConflictEvidence(adminId: number, tenantId: string): CreditOperation[] {
  const prefix = `${CONFLICT_PREFIX}${adminId}_${tenantId}_`;
  const results: CreditOperation[] = [];
  for (let i = 0; i < sessionStorage.length; i++) {
    const k = sessionStorage.key(i);
    if (k && k.startsWith(prefix)) {
      try {
        const parsed = JSON.parse(sessionStorage.getItem(k) ?? "null");
        if (
          parsed &&
          typeof parsed.key === "string" &&
          typeof parsed.state === "string" &&
          parsed.adminId === adminId &&
          parsed.tenantId === tenantId
        ) {
          results.push(parsed as CreditOperation);
        }
      } catch { /* skip malformed */ }
    }
  }
  return results;
}

/** Remove a specific conflict evidence record. */
export function clearConflictEvidence(adminId: number, tenantId: string, uuid: string): void {
  sessionStorage.removeItem(conflictKey(adminId, tenantId, uuid));
}
