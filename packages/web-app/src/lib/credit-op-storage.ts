/**
 * P52: Credit operation sessionStorage persistence (Phase 5.2 — P52-01/P52-04).
 *
 * Extracted from AdminTenantDetail for testability.
 * Storage key format: aw_pending_credit_{adminId}_{tenantId}
 */

const PENDING_CREDIT_PREFIX = "aw_pending_credit_";

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

  // Different operation: only overwrite if existing is non-terminal
  if (existing.key !== op.key) {
    if (existingPrec >= 4) return false; // existing is COMMITTED or REJECTED
    saveCreditOp(op);
    return true;
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
