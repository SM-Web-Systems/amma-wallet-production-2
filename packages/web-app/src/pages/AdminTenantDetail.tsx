/**
 * AW-007/AW-009 — Admin tenant detail page (/admin/tenants/:id)
 *
 * Shows billing summary + recent billing events for a single tenant.
 * Uses admin JWT from sessionStorage['aw_admin_token'].
 *
 * P52: Financial safety — credit posting uses a full state machine to prevent
 * double-credits and ensure safe handling of ambiguous outcomes.
 */
import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import {
  ShieldCheck, LogOut, ArrowLeft, RefreshCw, AlertCircle,
  CheckCircle, XCircle, X, Loader2, TrendingUp, TrendingDown, Wallet,
  PlusCircle, Ban, RotateCcw, HelpCircle,
} from "lucide-react";

interface BillingEvent {
  id: number;
  eventType: string;
  amountXlm: string;
  billingPeriod: string | null;
  userId: number | null;
  createdAt: string;
  notes?: string | null;
}

interface TenantBilling {
  tenantId: number;
  tenantName: string | null;
  tenantSlug: string;
  balance: string;
  isActive: boolean;
  suspendedAt: string | null;
  suspensionReason: string | null;
  debtLimit: string | null;
  acquisitionModeEnabled: boolean | null;
  gracePeriodDays: number | null;
  recentEvents: BillingEvent[];
  eventsHasMore: boolean;
  eventsNextCursor: number | null;
}

import { adminFetch, getAdminInfo } from "../lib/admin-api";
import {
  type CreditOperation,
  loadCreditOp,
  saveCreditOp,
  safeSaveCreditOp,
  clearCreditOp,
  saveConflictEvidence,
  loadConflictEvidence,
  clearConflictEvidence,
} from "../lib/credit-op-storage";

function eventTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    new_wallet_activation:    "Wallet activation",
    monthly_maintenance:      "Monthly maintenance",
    manual_topup:             "Manual top-up",
    bundle_purchase:          "Bundle purchase",
    wallet_funding:           "Wallet funding",
    refund:                   "Refund",
  };
  return labels[type] ?? type.replace(/_/g, " ");
}

function amountColor(amount: string): string {
  const n = parseFloat(amount);
  if (n > 0) return "text-emerald-600";
  if (n < 0) return "text-red-600";
  return "text-neutral-500";
}

export default function AdminTenantDetail() {
  const { id } = useParams<{ id: string }>();

  // P53-R01: Track current tenant ID for storage-scoping operations.
  // P532-01: generationRef is the authoritative staleness check (not idRef).
  // idRef is retained for operation-scoping but not for async freshness detection.
  const idRef = useRef(id);

  // P532-01: Monotonically increasing request generation counter.
  // Unlike idRef, this distinguishes A→B→A from a fresh A load because
  // the generation increments on every id change, even back to the same id.
  // After each await, compare the captured generation to generationRef.current.
  const generationRef = useRef(0);

  // P533-02: Per-request freshness counter for read operations.
  // Increments on every call to load(), ensuring overlapping same-tenant
  // requests can be distinguished even without route navigation.
  // Financial handlers (handlePostCredit, handleCheckStatus) do NOT use this —
  // they rely on generationRef alone because a refresh must not invalidate
  // an in-flight credit POST.
  const loadSeqRef = useRef(0);

  useEffect(() => {
    idRef.current = id;
    generationRef.current += 1;
  }, [id]);

  const [data, setData] = useState<TenantBilling | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  // NM-D1: Post Credit form state — raw inputs (only usable when no op is in-flight)
  // UI-01: bundle_purchase removed — requires bundle catalog selector (not yet built).
  const [creditType, setCreditType] = useState<"manual_topup">("manual_topup");
  const [creditAmount, setCreditAmount] = useState("");
  const [creditNotes, setCreditNotes] = useState("");
  const [creditError, setCreditError] = useState<string | null>(null);
  const [creditConfirmOpen, setCreditConfirmOpen] = useState(false);

  // P52: Current credit operation (state machine). null = IDLE.
  // Persisted to sessionStorage keyed by adminId+tenantId.
  const [creditOp, setCreditOp] = useState<CreditOperation | null>(null);
  // Track reconciliation in-progress separately (doesn't change op.state until done)
  const [reconciling, setReconciling] = useState(false);
  const [reconcileError, setReconcileError] = useState<string | null>(null);

  // P534-01: Conflict evidence — preserved financial results that could not be
  // stored in the active operation slot due to UUID mismatch.
  const [conflictEvidence, setConflictEvidence] = useState<CreditOperation[]>([]);

  // NM-D2: Suspend/Unsuspend state
  const [suspendBusy, setSuspendBusy] = useState(false);
  const [suspendError, setSuspendError] = useState<string | null>(null);

  // AW-ADMIN-005: Pagination state for billing events
  const [allEvents, setAllEvents] = useState<BillingEvent[]>([]);
  const [eventsHasMore, setEventsHasMore] = useState(false);
  const [eventsNextCursor, setEventsNextCursor] = useState<number | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  type SuspendIntent =
    | { action: 'suspend'; suspendType: 'hard' | 'soft' }
    | { action: 'unsuspend' };
  const [statusModal, setStatusModal] = useState<SuspendIntent | null>(null);

  const logout = () => {
    sessionStorage.removeItem("aw_admin_token");
    sessionStorage.removeItem("aw_admin_info");
    navigate("/admin/login");
  };

  // P532-02: Only log out if the session token hasn't changed since the request started.
  // Prevents a stale 401 (from admin A's expired token) from logging out admin B.
  const safeLogout = (capturedToken: string | null) => {
    const currentToken = sessionStorage.getItem("aw_admin_token");
    if (currentToken && currentToken === capturedToken) {
      logout();
    }
  };

  // P533-02: Helper to check if a read response is still current.
  // Combines route generation, per-request sequence, and admin identity.
  const isReadStale = (gen: number, seq: number, capturedAdminId: number | undefined) => {
    if (gen !== generationRef.current) return true;
    if (seq !== loadSeqRef.current) return true;
    const currentAdmin = getAdminInfo();
    if (capturedAdminId !== currentAdmin?.id) return true;
    return false;
  };

  const load = useCallback(async () => {
    if (!id) return;
    // P532-01: capture generation and session at request start
    const gen = generationRef.current;
    // P533-02: per-request freshness + admin identity
    loadSeqRef.current += 1;
    const seq = loadSeqRef.current;
    const capturedAdminId = getAdminInfo()?.id;
    const capturedToken = sessionStorage.getItem("aw_admin_token");
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(`/api/v1/internal/tenants/${id}/billing`);
      // P533-02: discard stale response (generation + sequence + admin identity)
      if (isReadStale(gen, seq, capturedAdminId)) return;
      // P532-02: session-aware 401 handling
      if (res.status === 401) { safeLogout(capturedToken); return; }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        if (isReadStale(gen, seq, capturedAdminId)) return;
        setError(d.error ?? `Server error ${res.status}`);
        return;
      }
      const json = await res.json();
      if (isReadStale(gen, seq, capturedAdminId)) return;
      setData(json);
      // AW-ADMIN-005: reset pagination state on every full reload
      setAllEvents(json.recentEvents ?? []);
      setEventsHasMore(json.eventsHasMore ?? false);
      setEventsNextCursor(json.eventsNextCursor ?? null);
      setOlderError(null);
      // P533-02: reset loadingOlder to prevent orphaned flag when Refresh
      // supersedes an in-flight loadOlderEvents (whose stale finally block
      // will skip setLoadingOlder(false) because isReadStale returns true).
      setLoadingOlder(false);
    } catch {
      if (isReadStale(gen, seq, capturedAdminId)) return;
      setError("Network error — could not load billing data.");
    } finally {
      if (!isReadStale(gen, seq, capturedAdminId)) setLoading(false);
    }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!sessionStorage.getItem("aw_admin_token")) { navigate("/admin/login"); return; }
    load();
  }, [load, navigate]);

  // P52/P53-02: Restore pending credit operation from sessionStorage on mount or tenant change.
  // P53-02 FIX: ALWAYS clear stale state first to prevent a previous tenant's operation
  // from persisting in React state when navigating between tenants.
  useEffect(() => {
    if (!id) return;

    // P53-02: Clear stale operation state BEFORE attempting restoration.
    // Without this, navigating from tenant A to tenant B leaves tenant A's
    // creditOp in React state, which can be submitted against tenant B.
    setCreditOp(null);
    setCreditError(null);
    setReconcileError(null);

    // P532-02: Reset loading indicators that may be orphaned by navigation.
    // A stale async response's finally block will see gen !== generationRef.current
    // and skip the reset, so we must clear them here.
    setReconciling(false);
    setSuspendBusy(false);
    setLoadingOlder(false);
    setOlderError(null);
    setSuspendError(null);

    const adminInfo = getAdminInfo();
    if (!adminInfo || typeof adminInfo.id !== "number") {
      // Cannot safely scope the operation — do not restore
      return;
    }
    const restored = loadCreditOp(adminInfo.id, id);
    if (restored) {
      setCreditOp(restored);
      // Pre-populate inputs for display (inputs are locked while op is in-flight)
      setCreditType(restored.type as "manual_topup");
      setCreditAmount(restored.amount);
      setCreditNotes(restored.notes ?? "");
    }

    // P534-01: Load any conflict evidence for this (admin, tenant) pair
    setConflictEvidence(loadConflictEvidence(adminInfo.id, id));
  }, [id]);

  // Helper: persist op state and update React state atomically
  const updateCreditOp = useCallback((next: CreditOperation) => {
    saveCreditOp(next);
    setCreditOp(next);
  }, []);

  // Helper: discard the current op and return to IDLE
  const discardCreditOp = useCallback(() => {
    if (!id) return;
    const adminInfo = getAdminInfo();
    if (adminInfo && typeof adminInfo.id === "number") {
      clearCreditOp(adminInfo.id, id);
    }
    setCreditOp(null);
    setCreditError(null);
    setReconcileError(null);
  }, [id]);

  // NM-D1: Validate + confirm credit
  // FI-06: Validate as string to avoid IEEE 754 precision loss on amounts like "0.1000001".
  // P52: IDLE → CONFIRMED transition. Generates idempotency key once per logical operation.
  const handleCreditClick = () => {
    // If there's an existing op in a terminal state, require explicit acknowledgment first
    if (creditOp && (creditOp.state === "COMMITTED" || creditOp.state === "REJECTED")) {
      // Should not reach here — UI hides the form in those states — but guard anyway
      return;
    }
    // If there's an UNKNOWN op, block new operation until resolved
    if (creditOp && creditOp.state === "UNKNOWN") {
      setCreditError("Previous operation outcome is unknown. Check status before starting a new one.");
      return;
    }

    const trimmed = creditAmount.trim();
    if (!trimmed || !/^\d+(\.\d{1,7})?$/.test(trimmed) || !/[1-9]/.test(trimmed)) {
      setCreditError("Amount must be a positive number (up to 7 decimal places).");
      return;
    }
    setCreditError(null);

    // P52: If a CONFIRMED op already exists with the same key (retry path), just reopen dialog
    if (creditOp && creditOp.state === "CONFIRMED") {
      setCreditConfirmOpen(true);
      return;
    }

    // IDLE → CONFIRMED: generate a new idempotency key
    const adminInfo = getAdminInfo();
    if (!adminInfo || typeof adminInfo.id !== "number") {
      setCreditError("Cannot verify admin identity — please log in again.");
      return;
    }
    if (!id) return;

    const newOp: CreditOperation = {
      key: crypto.randomUUID(),
      type: creditType,
      amount: trimmed,
      notes: creditNotes,
      state: "CONFIRMED",
      adminId: adminInfo.id,
      tenantId: id,
      createdAt: new Date().toISOString(),
    };
    updateCreditOp(newOp);
    setCreditConfirmOpen(true);
  };

  // NM-D1: Submit credit (called from confirmation dialog or UNKNOWN retry)
  // P52: CONFIRMED|UNKNOWN → SUBMITTING → (COMMITTED | UNKNOWN | REJECTED)
  const handlePostCredit = async () => {
    setCreditConfirmOpen(false);
    if (!creditOp || (creditOp.state !== "CONFIRMED" && creditOp.state !== "UNKNOWN")) {
      setCreditError("No confirmed operation to submit.");
      return;
    }

    // P53-02: Identity guard — verify operation matches current context before any network call.
    // Prevents cross-tenant submission if stale React state survives a navigation.
    if (creditOp.tenantId !== id) {
      setCreditError("Operation belongs to a different tenant. Please navigate to the correct tenant.");
      return;
    }
    const currentAdmin = getAdminInfo();
    if (!currentAdmin || currentAdmin.id !== creditOp.adminId) {
      setCreditError("Operation belongs to a different administrator. Please log in again.");
      return;
    }

    // P532-01/02: capture generation and session at request start
    const gen = generationRef.current;
    const capturedToken = sessionStorage.getItem("aw_admin_token");
    // P533-02: capture admin identity for post-response verification
    const capturedAdminId = currentAdmin.id;

    // CONFIRMED|UNKNOWN → SUBMITTING
    const submittingOp: CreditOperation = { ...creditOp, state: "SUBMITTING" };
    updateCreditOp(submittingOp);
    setCreditError(null);
    setReconcileError(null);

    try {
      const res = await adminFetch(`/api/v1/internal/tenants/${id}/credit`, {
        method: "POST",
        body: JSON.stringify({
          type: creditOp.type,
          amount_xlm: creditOp.amount,
          notes: creditOp.notes || undefined,
          idempotency_key: creditOp.key,
        }),
      });

      // P532-01: Check generation staleness before processing response.
      // P533-02: Also check admin identity — admin may have changed without navigation.
      // P534-02: Now a closure so it can be re-evaluated after each async boundary.
      // P534-R02: Also check authentication token — same admin ID with a different
      // session (logout + re-login) must be treated as stale.
      const isFinStale = () =>
        gen !== generationRef.current ||
        capturedAdminId !== getAdminInfo()?.id ||
        capturedToken !== sessionStorage.getItem("aw_admin_token");

      // P534-01: Helper to persist financial evidence with conflict fallback.
      // If safeSaveCreditOp rejects the write (different UUID in slot), preserve
      // the evidence as a conflict record rather than silently discarding it.
      // P534-R03: Check saveConflictEvidence return value and surface warning
      // on genuine storage failure when the context is still current.
      const safePersistWithConflict = (op: CreditOperation): boolean => {
        const accepted = safeSaveCreditOp(op);
        if (accepted) return true;
        if (op.state === "COMMITTED" || op.state === "UNKNOWN") {
          const evidenceSafe = saveConflictEvidence(op);
          if (!evidenceSafe && !isFinStale()) {
            setCreditError(
              `Financial evidence could not be preserved in browser storage. ` +
              `Use idempotency key to verify with the server: ${op.key}`
            );
          }
          return evidenceSafe;
        }
        return false;
      };

      if (isFinStale()) {
        if (res.status === 401) {
          // Stale 401 on financial POST: preserve as UNKNOWN, do NOT logout
          safePersistWithConflict({ ...submittingOp, state: "UNKNOWN" });
        }
        // For non-401 stale responses, attempt to persist the financial result
        // using safeSaveCreditOp which respects state precedence
        if (res.ok) {
          const d = await res.json().catch(() => ({}));
          safePersistWithConflict({
            ...submittingOp, state: "COMMITTED",
            committedEventId: d.billingEventId ?? undefined,
          });
        } else if (res.status >= 500) {
          safePersistWithConflict({ ...submittingOp, state: "UNKNOWN" });
        }
        return;
      }

      // P532-02: session-aware 401 handling
      if (res.status === 401) { safeLogout(capturedToken); return; }
      const d = await res.json();

      // P534-02: Re-evaluate staleness after res.json() — context may have
      // changed during response-body parsing. If stale, persist the financial
      // evidence but do NOT update React state.
      if (isFinStale()) {
        if (res.ok) {
          safePersistWithConflict({
            ...submittingOp, state: "COMMITTED",
            committedEventId: d.billingEventId ?? undefined,
          });
        } else if (res.status >= 500) {
          safePersistWithConflict({ ...submittingOp, state: "UNKNOWN" });
        }
        return;
      }

      if (!res.ok) {
        if (res.status >= 400 && res.status < 500 && res.status !== 401) {
          // P52: 4xx (except 401) = proven no-write. SUBMITTING → REJECTED.
          const rejectedOp: CreditOperation = {
            ...submittingOp,
            state: "REJECTED",
            rejectionReason: d.error ?? `Error ${res.status}`,
          };
          // P532-02: Use conditional persistence to respect state precedence.
          // P533-01: Only update React state if persistence was accepted.
          const rejAccepted = safeSaveCreditOp(rejectedOp);
          if (!isFinStale() && rejAccepted) setCreditOp(rejectedOp);
        } else {
          // P52: 5xx or other — outcome uncertain. SUBMITTING → UNKNOWN.
          const unknownOp: CreditOperation = { ...submittingOp, state: "UNKNOWN" };
          // P533-01: Only update React state if persistence was accepted.
          // P534-01: Preserve conflict evidence if rejected.
          const unkAccepted = safePersistWithConflict(unknownOp);
          if (!isFinStale() && unkAccepted) setCreditOp(unknownOp);
        }
        return;
      }

      // HTTP 200 — SUBMITTING → COMMITTED
      const committedOp: CreditOperation = {
        ...submittingOp,
        state: "COMMITTED",
        committedEventId: d.billingEventId ?? undefined,
      };
      // P532-02: Conditional persistence — COMMITTED always wins via precedence.
      // P533-01: Only update React state if persistence was accepted.
      // P534-01: Preserve conflict evidence if rejected.
      // P534-R03: On storage failure in current context, still show COMMITTED
      // (the admin needs to know the credit was applied) and surface the storage warning.
      const comAccepted = safePersistWithConflict(committedOp);
      if (!isFinStale()) {
        if (comAccepted) {
          setCreditOp(committedOp);
          load();
        } else {
          // Storage failed but we know it committed — show COMMITTED state to admin
          setCreditOp(committedOp);
        }
      }
    } catch {
      // P52: Network error / timeout — outcome uncertain. SUBMITTING → UNKNOWN.
      const unknownOp: CreditOperation = { ...submittingOp, state: "UNKNOWN" };
      // P533-01: Only update React state if persistence was accepted.
      // P534-01: Preserve conflict evidence if rejected.
      // P534-R03: Check saveConflictEvidence return value.
      const catchAccepted = safeSaveCreditOp(unknownOp);
      let catchEvidenceSafe = catchAccepted;
      if (!catchAccepted && unknownOp.state === "UNKNOWN") {
        catchEvidenceSafe = saveConflictEvidence(unknownOp);
      }
      // P533-02 + P534-R02: re-evaluate staleness (includes admin identity + session token)
      const catchStale = gen !== generationRef.current || capturedAdminId !== getAdminInfo()?.id || capturedToken !== sessionStorage.getItem("aw_admin_token");
      if (!catchStale) {
        if (catchAccepted) {
          setCreditOp(unknownOp);
        } else if (!catchEvidenceSafe) {
          setCreditError(
            `Financial evidence could not be preserved in browser storage. ` +
            `Use idempotency key to verify with the server: ${unknownOp.key}`
          );
        }
      }
    }
  };

  // P52/P53-01: Reconciliation — check status of UNKNOWN operation
  // UNKNOWN → COMMITTED on "committed"; stays UNKNOWN on "not_found".
  // P53-01 FIX: "not_found" does NOT prove the transaction never committed —
  // a concurrent INSERT may not yet be visible under READ COMMITTED isolation.
  // The operation retains its original idempotency key for future retry or re-check.
  const handleCheckStatus = async () => {
    if (!creditOp || creditOp.state !== "UNKNOWN" || !id) return;

    // P53-02: Identity guard — verify operation matches current context
    if (creditOp.tenantId !== id) {
      setReconcileError("Operation belongs to a different tenant.");
      return;
    }
    const currentAdmin = getAdminInfo();
    if (!currentAdmin || currentAdmin.id !== creditOp.adminId) {
      setReconcileError("Operation belongs to a different administrator.");
      return;
    }

    // P532-01/02: capture generation and session at request start
    const gen = generationRef.current;
    const capturedToken = sessionStorage.getItem("aw_admin_token");
    // P533-02: capture admin identity for post-response verification
    const capturedAdminId = currentAdmin.id;

    setReconciling(true);
    setReconcileError(null);
    try {
      const res = await adminFetch(
        `/api/v1/internal/tenants/${id}/credit-status?idempotency_key=${encodeURIComponent(creditOp.key)}`
      );
      // P532-01 + P533-02 + P534-R02: generation + admin identity + session token staleness check
      const reconStale = () =>
        gen !== generationRef.current ||
        capturedAdminId !== getAdminInfo()?.id ||
        capturedToken !== sessionStorage.getItem("aw_admin_token");
      if (reconStale()) {
        // Stale but may carry financial evidence — persist committed if present
        // P534-01: Use conflict evidence fallback if safeSaveCreditOp rejects.
        if (res.ok) {
          const d = await res.json().catch(() => ({}));
          if (d.status === "committed") {
            const reconOp: CreditOperation = {
              ...creditOp,
              state: "COMMITTED",
              committedEventId: d.billingEventId ?? undefined,
            };
            const accepted = safeSaveCreditOp(reconOp);
            // P534-R03: Check conflict evidence return value (stale context — cannot surface warning)
            if (!accepted) saveConflictEvidence(reconOp);
          }
        }
        return;
      }
      // P532-02: session-aware 401 handling
      if (res.status === 401) { safeLogout(capturedToken); return; }
      const d = await res.json();
      // P532-01 + P533-02: re-check after second await
      const stale = reconStale();
      if (!res.ok) {
        if (!stale) setReconcileError(d.error ?? `Status check failed (${res.status})`);
        return;
      }
      if (d.status === "committed") {
        const committedOp: CreditOperation = {
          ...creditOp,
          state: "COMMITTED",
          committedEventId: d.billingEventId ?? undefined,
        };
        // P532-02: Conditional persistence — COMMITTED always wins.
        // P533-01: Only update React state if persistence was accepted.
        // P534-01: Preserve conflict evidence if rejected.
        // P534-R03: Check conflict evidence return value.
        const reconAccepted = safeSaveCreditOp(committedOp);
        if (!reconAccepted) {
          const reconEvidenceSafe = saveConflictEvidence(committedOp);
          if (!stale && !reconEvidenceSafe) {
            setReconcileError(
              `Financial evidence could not be preserved in browser storage. ` +
              `Use idempotency key to verify: ${committedOp.key}`
            );
          }
        }
        if (!stale && reconAccepted) {
          setCreditOp(committedOp);
          load();
        }
      } else if (d.status === "not_found") {
        // P53-01 FIX: Do NOT transition to REJECTED. The absence of a committed
        // record does not prove the original transaction will never commit.
        // Stay in UNKNOWN and inform the admin.
        if (!stale) {
          setReconcileError(
            "Credit not found in ledger yet. The transaction may still be processing. " +
            "You can retry the submission (safe — uses the same idempotency key) or check again later."
          );
        }
      } else {
        if (!stale) setReconcileError(`Unexpected status: ${d.status}`);
      }
    } catch {
      const catchReconStale = gen !== generationRef.current || capturedAdminId !== getAdminInfo()?.id || capturedToken !== sessionStorage.getItem("aw_admin_token");
      if (!catchReconStale) {
        setReconcileError("Network error — could not check credit status. Try again.");
      }
    } finally {
      const finalReconStale = gen !== generationRef.current || capturedAdminId !== getAdminInfo()?.id || capturedToken !== sessionStorage.getItem("aw_admin_token");
      if (!finalReconStale) setReconciling(false);
    }
  };

  // P52: Acknowledge COMMITTED or REJECTED result and return to IDLE
  const handleAcknowledge = () => {
    discardCreditOp();
    setCreditAmount("");
    setCreditNotes("");
    setCreditType("manual_topup");
  };

  // P52: Discard a CONFIRMED op (user changed mind before submitting)
  // Safe because CONFIRMED state means the HTTP request was never sent.
  const handleDiscardConfirmed = () => {
    discardCreditOp();
    setCreditAmount("");
    setCreditNotes("");
  };

  // AW-ADMIN-005: Cursor-paginated "Load older" events
  const loadOlderEvents = async () => {
    if (!eventsNextCursor || loadingOlder) return;
    // P532-01/02: capture generation and session at request start
    const gen = generationRef.current;
    // P533-02: capture load sequence (NOT incremented — inherits from load)
    const seq = loadSeqRef.current;
    const capturedAdminId = getAdminInfo()?.id;
    const capturedToken = sessionStorage.getItem("aw_admin_token");
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const res = await adminFetch(`/api/v1/internal/tenants/${id}/events?beforeId=${eventsNextCursor}`);
      if (isReadStale(gen, seq, capturedAdminId)) return; // P533-02: stale
      if (res.status === 401) { safeLogout(capturedToken); return; }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        if (isReadStale(gen, seq, capturedAdminId)) return;
        setOlderError(d.error ?? `Error ${res.status}`);
        return;
      }
      const page = await res.json();
      if (isReadStale(gen, seq, capturedAdminId)) return; // P533-02: stale
      setAllEvents(prev => [...prev, ...page.events]);
      setEventsHasMore(page.hasMore);
      setEventsNextCursor(page.nextCursor);
    } catch {
      if (isReadStale(gen, seq, capturedAdminId)) return;
      setOlderError("Network error — could not load older events.");
    } finally {
      if (!isReadStale(gen, seq, capturedAdminId)) setLoadingOlder(false);
    }
  };

  // NM-D2 / AW-ADMIN-007: Suspend / Unsuspend — open modal only
  const handleSuspend = () => setStatusModal({ action: 'suspend', suspendType: 'hard' });
  const handleUnsuspend = () => setStatusModal({ action: 'unsuspend' });
  const setSuspendType = (t: 'hard' | 'soft') =>
    setStatusModal(prev => prev?.action === 'suspend' ? { ...prev, suspendType: t } : prev);

  const submitStatusAction = async (action: 'suspend' | 'unsuspend') => {
    // AW-ADMIN-007: capture suspendType before clearing modal state
    const suspendType = statusModal?.action === 'suspend' ? statusModal.suspendType : 'hard';
    setStatusModal(null);
    // P532-01/02: capture generation and session at request start
    const gen = generationRef.current;
    // P533-02: capture load sequence and admin identity
    const seq = loadSeqRef.current;
    const capturedAdminId = getAdminInfo()?.id;
    const capturedToken = sessionStorage.getItem("aw_admin_token");
    setSuspendBusy(true);
    setSuspendError(null);
    try {
      const res = await adminFetch(
        `/api/v1/internal/tenants/${id}/${action}`,
        action === 'suspend'
          ? { method: "PATCH", body: JSON.stringify({ type: suspendType }) }
          : { method: "PATCH" }
      );
      if (isReadStale(gen, seq, capturedAdminId)) return; // P533-02: stale
      if (res.status === 401) { safeLogout(capturedToken); return; }
      const d = await res.json();
      if (isReadStale(gen, seq, capturedAdminId)) return; // P533-02: re-check after second await
      if (!res.ok) { setSuspendError(d.error ?? `Error ${res.status}`); return; }
      load();
    } catch {
      if (!isReadStale(gen, seq, capturedAdminId)) setSuspendError(`Network error — could not ${action} tenant.`);
    } finally {
      if (!isReadStale(gen, seq, capturedAdminId)) setSuspendBusy(false);
    }
  };

  const balance = data ? parseFloat(data.balance) : 0;

  // P52: Derive display state
  const opState = creditOp?.state ?? null;
  // Inputs are disabled in all non-IDLE states — the op's amount/type/notes are immutable
  // once the key is generated (CONFIRMED) and certainly once the request is in-flight.
  const inputsDisabled = creditOp !== null;

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* AW-ADMIN-001/007: Suspend/Unsuspend confirmation modal */}
      {statusModal !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="status-modal-title"
          onKeyDown={(e) => e.key === 'Escape' && setStatusModal(null)}
        >
          <div
            className="absolute inset-0 bg-neutral-900/50 backdrop-blur-sm"
            aria-hidden
            onClick={() => setStatusModal(null)}
          />
          <div className="relative w-full max-w-sm bg-white rounded-2xl border border-neutral-200 shadow-xl flex flex-col">
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-neutral-100">
              <h2 id="status-modal-title" className="text-base font-bold text-neutral-900">
                {statusModal.action === 'suspend'
                  ? statusModal.suspendType === 'hard' ? 'Hard suspend tenant?' : 'Soft suspend tenant?'
                  : 'Unsuspend tenant?'}
              </h2>
              <button
                type="button"
                onClick={() => setStatusModal(null)}
                className="shrink-0 p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {/* AW-ADMIN-007: suspend type radio group */}
            {statusModal.action === 'suspend' && (
              <div className="px-5 pt-4 pb-1 flex flex-col gap-2" role="radiogroup" aria-label="Suspend type">
                <label className={`flex items-start gap-3 cursor-pointer p-3 rounded-xl border transition-colors ${
                  statusModal.suspendType === 'hard'
                    ? 'border-red-300 bg-red-50'
                    : 'border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50'
                }`}>
                  <input
                    type="radio"
                    name="suspendType"
                    value="hard"
                    checked={statusModal.suspendType === 'hard'}
                    onChange={() => setSuspendType('hard')}
                    className="mt-0.5 accent-red-600"
                  />
                  <div>
                    <span className="text-sm font-semibold text-neutral-900">Hard suspend</span>
                    <p className="text-xs text-neutral-500 mt-0.5">Deactivates the account. Blocks wallets, transfers, and API access immediately.</p>
                  </div>
                </label>
                <label className={`flex items-start gap-3 cursor-pointer p-3 rounded-xl border transition-colors ${
                  statusModal.suspendType === 'soft'
                    ? 'border-amber-300 bg-amber-50'
                    : 'border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50'
                }`}>
                  <input
                    type="radio"
                    name="suspendType"
                    value="soft"
                    checked={statusModal.suspendType === 'soft'}
                    onChange={() => setSuspendType('soft')}
                    className="mt-0.5 accent-amber-600"
                  />
                  <div>
                    <span className="text-sm font-semibold text-neutral-900">Soft suspend</span>
                    <p className="text-xs text-neutral-500 mt-0.5">Blocks new activations and onboardings only. Existing wallets and SSO reads stay live.</p>
                  </div>
                </label>
              </div>
            )}
            <p className="px-5 py-4 text-sm text-neutral-600 leading-relaxed">
              {statusModal.action === 'suspend'
                ? statusModal.suspendType === 'hard'
                  ? 'All wallet operations will be blocked and the tenant account will be deactivated (isActive = false). New wallets, XLM transfers, and API access are blocked. SSO reads remain. Reversible.'
                  : 'New activations and onboardings will be blocked, but existing wallets and SSO reads remain live (isActive stays true). Reversible.'
                : 'Full wallet and API access will be restored immediately.'}
            </p>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-neutral-100">
              <button
                type="button"
                onClick={() => setStatusModal(null)}
                className="text-sm font-medium text-neutral-600 border border-neutral-200 hover:bg-neutral-50 rounded-lg px-4 py-2 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => submitStatusAction(statusModal.action)}
                className={`text-sm font-medium text-white rounded-lg px-4 py-2 transition ${
                  statusModal.action === 'suspend'
                    ? statusModal.suspendType === 'hard'
                      ? 'bg-red-600 hover:bg-red-700'
                      : 'bg-amber-600 hover:bg-amber-700'
                    : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                {statusModal.action === 'suspend'
                  ? statusModal.suspendType === 'hard' ? 'Hard suspend tenant' : 'Soft suspend tenant'
                  : 'Unsuspend tenant'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* P52: Credit posting confirmation modal — shown when op is CONFIRMED */}
      {creditConfirmOpen && creditOp && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="credit-confirm-title"
          onKeyDown={(e) => e.key === 'Escape' && setCreditConfirmOpen(false)}
        >
          <div
            className="absolute inset-0 bg-neutral-900/50 backdrop-blur-sm"
            aria-hidden
            onClick={() => setCreditConfirmOpen(false)}
          />
          <div className="relative w-full max-w-sm bg-white rounded-2xl border border-neutral-200 shadow-xl flex flex-col">
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-neutral-100">
              <h2 id="credit-confirm-title" className="text-base font-bold text-neutral-900 flex items-center gap-2">
                <PlusCircle className="h-4 w-4 text-violet-600" aria-hidden />
                Confirm credit
              </h2>
              <button
                type="button"
                onClick={() => setCreditConfirmOpen(false)}
                className="shrink-0 p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-sm text-neutral-600 leading-relaxed">
                Post a <strong className="font-semibold text-neutral-900">{creditOp.amount} XLM</strong> credit
                ({creditOp.type === 'manual_topup' ? 'manual top-up' : 'bundle purchase'}) to{' '}
                <strong className="font-semibold text-neutral-900">{data?.tenantName ?? data?.tenantSlug ?? `Tenant #${id}`}</strong>?
              </p>
              {creditOp.notes && (
                <p className="text-xs text-neutral-500">Notes: {creditOp.notes}</p>
              )}
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                This action is irreversible. The credit will be applied immediately to the tenant balance.
              </p>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-neutral-100">
              <button
                type="button"
                onClick={() => setCreditConfirmOpen(false)}
                className="text-sm font-medium text-neutral-600 border border-neutral-200 hover:bg-neutral-50 rounded-lg px-4 py-2 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handlePostCredit}
                className="text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 rounded-lg px-4 py-2 transition flex items-center gap-2"
              >
                <PlusCircle className="h-4 w-4" aria-hidden />
                Post credit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top nav */}
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-violet-600" aria-hidden />
            <span className="font-semibold text-neutral-900 text-sm">AmmaWallet Admin</span>
          </div>
          <button
            type="button"
            onClick={logout}
            className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-800 transition"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden />
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2">
          <Link
            to="/admin"
            className="flex items-center gap-1.5 text-sm text-violet-600 hover:text-violet-800 font-medium transition"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            All tenants
          </Link>
          {data && (
            <>
              <span className="text-neutral-300">/</span>
              <span className="text-sm text-neutral-600">
                {data.tenantName ?? data.tenantSlug ?? `Tenant #${data.tenantId}`}
              </span>
            </>
          )}
        </div>

        {error && (
          <div className="flex gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
            {error}
          </div>
        )}

        {loading ? (
          <div className="py-24 flex items-center justify-center text-neutral-400 gap-2">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            <span className="text-sm">Loading billing data…</span>
          </div>
        ) : data ? (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Balance */}
              <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <Wallet className="h-4 w-4 text-neutral-400" aria-hidden />
                  <p className="text-xs text-neutral-500 font-medium uppercase tracking-wide">Prepaid balance</p>
                </div>
                <p className={`text-3xl font-bold tabular-nums mt-1 ${
                  balance < 0 ? "text-red-600" : balance < 5 ? "text-amber-600" : "text-violet-700"
                }`}>
                  {balance.toFixed(4)}
                </p>
                <p className="text-xs text-neutral-400 mt-0.5">XLM</p>
              </div>

              {/* Status — NM-D2: suspend/unsuspend */}
              <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
                <p className="text-xs text-neutral-500 font-medium uppercase tracking-wide mb-2">Status</p>
                <div className="flex items-center gap-2">
                  {data.isActive && !data.suspendedAt
                    ? <CheckCircle className="h-5 w-5 text-emerald-500" aria-hidden />
                    : <XCircle className="h-5 w-5 text-red-400" aria-hidden />}
                  <span className={`text-sm font-semibold ${data.isActive && !data.suspendedAt ? "text-emerald-700" : "text-red-600"}`}>
                    {data.isActive && !data.suspendedAt ? "Active" : data.isActive ? "Soft-suspended" : "Suspended"}
                  </span>
                </div>
                {data.suspensionReason && (
                  <p className="text-xs text-red-500 mt-1 truncate" title={data.suspensionReason}>
                    {data.suspensionReason}
                  </p>
                )}
                {suspendError && (
                  <p className="text-xs text-red-600 mt-1">{suspendError}</p>
                )}
                <div className="mt-3 flex gap-2">
                  {(!data.suspendedAt) ? (
                    <button
                      type="button"
                      onClick={handleSuspend}
                      disabled={suspendBusy}
                      className="flex items-center gap-1.5 text-xs font-medium text-red-600 border border-red-200 hover:bg-red-50 rounded-lg px-3 py-1.5 transition disabled:opacity-50"
                    >
                      <Ban className="h-3 w-3" aria-hidden />
                      {suspendBusy ? "Suspending…" : "Suspend"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleUnsuspend}
                      disabled={suspendBusy}
                      className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 border border-emerald-200 hover:bg-emerald-50 rounded-lg px-3 py-1.5 transition disabled:opacity-50"
                    >
                      <RotateCcw className="h-3 w-3" aria-hidden />
                      {suspendBusy ? "Unsuspending…" : "Unsuspend"}
                    </button>
                  )}
                </div>
              </div>

              {/* Policy */}
              <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
                <p className="text-xs text-neutral-500 font-medium uppercase tracking-wide mb-2">Policy</p>
                <div className="space-y-1 text-xs text-neutral-700">
                  <div className="flex justify-between">
                    <span className="text-neutral-400">Debt limit</span>
                    <span className="font-medium">{data.debtLimit ? `${data.debtLimit} XLM` : "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-400">Acquisition mode</span>
                    <span className="font-medium">{data.acquisitionModeEnabled ? "On" : "Off"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-400">Grace period</span>
                    <span className="font-medium">{data.gracePeriodDays != null ? `${data.gracePeriodDays}d` : "—"}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Recent events */}
            <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-neutral-900">
                  Recent billing events ({allEvents.length}{eventsHasMore ? "+" : ""})
                </h2>
                <button
                  type="button"
                  onClick={load}
                  disabled={loading}
                  className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-800 border border-neutral-200 rounded-lg px-3 py-1.5 transition"
                >
                  <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} aria-hidden />
                  Refresh
                </button>
              </div>

              {allEvents.length === 0 ? (
                <div className="py-12 text-center text-sm text-neutral-400">No billing events yet.</div>
              ) : (
                <div className="divide-y divide-neutral-100">
                  {allEvents.map((event) => {
                    const amount = parseFloat(event.amountXlm);
                    const isCredit = amount > 0;
                    return (
                      <div key={event.id} className="flex items-center gap-4 px-5 py-3">
                        {/* Direction icon */}
                        <div className={`shrink-0 rounded-full p-1.5 ${isCredit ? "bg-emerald-50" : "bg-red-50"}`}>
                          {isCredit
                            ? <TrendingUp className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
                            : <TrendingDown className="h-3.5 w-3.5 text-red-500" aria-hidden />}
                        </div>

                        {/* Event info */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-neutral-800 capitalize">{eventTypeLabel(event.eventType)}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-neutral-400 tabular-nums">
                              {new Date(event.createdAt).toLocaleString()}
                            </span>
                            {event.billingPeriod && (
                              <span className="text-[10px] bg-neutral-100 text-neutral-500 px-1.5 py-0.5 rounded">
                                {event.billingPeriod}
                              </span>
                            )}
                            {event.userId && (
                              <span className="text-[10px] text-neutral-400">user #{event.userId}</span>
                            )}
                          </div>
                          {event.notes && (
                            <p
                              className="text-xs text-neutral-500 mt-0.5 truncate"
                              title={event.notes}
                            >
                              {event.notes}
                            </p>
                          )}
                        </div>

                        {/* Amount */}
                        <span className={`text-sm font-bold tabular-nums shrink-0 ${amountColor(event.amountXlm)}`}>
                          {amount > 0 ? "+" : ""}{amount.toFixed(4)} XLM
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
              {/* AW-ADMIN-005: Load older button */}
              {(eventsHasMore || olderError) && (
                <div className="px-5 py-4 border-t border-neutral-100 flex flex-col items-center gap-2">
                  {olderError && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 w-full text-center">
                      {olderError}
                    </p>
                  )}
                  {eventsHasMore && (
                    <button
                      type="button"
                      onClick={loadOlderEvents}
                      disabled={loadingOlder}
                      className="text-sm font-medium text-violet-700 border border-violet-200 hover:bg-violet-50 rounded-lg px-4 py-2 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      {loadingOlder
                        ? <><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />Loading…</>
                        : "Load older"}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* NM-D1: Post Credit — P52 state machine UI */}
            <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-neutral-100 flex items-center gap-2">
                <PlusCircle className="h-4 w-4 text-violet-600" aria-hidden />
                <h2 className="text-sm font-semibold text-neutral-900">Post Credit</h2>
              </div>

              {/* P52: UNKNOWN state — outcome uncertain, must reconcile before proceeding */}
              {opState === "UNKNOWN" && creditOp && (
                <div className="px-5 py-4 space-y-3">
                  <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" aria-hidden />
                    <div className="flex-1 min-w-0 space-y-1">
                      <p className="text-sm font-semibold text-amber-900">Credit outcome unknown</p>
                      <p className="text-xs text-amber-800 leading-relaxed">
                        The network request for <strong>{creditOp.amount} XLM</strong> did not return a
                        definitive result. The credit may or may not have been applied. Do not post a new
                        credit until the status is confirmed.
                      </p>
                      <p className="text-[11px] text-amber-700 font-mono truncate" title={creditOp.key}>
                        Key: {creditOp.key}
                      </p>
                    </div>
                  </div>
                  {reconcileError && (
                    <p className="text-xs text-red-600 flex items-center gap-1">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      {reconcileError}
                    </p>
                  )}
                  <div className="flex gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={handleCheckStatus}
                      disabled={reconciling}
                      className="flex items-center gap-2 text-sm font-medium bg-amber-600 hover:bg-amber-700 text-white rounded-xl px-4 py-2 transition disabled:opacity-50"
                    >
                      {reconciling
                        ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Checking…</>
                        : <><HelpCircle className="h-4 w-4" aria-hidden />Check credit status</>}
                    </button>
                    <button
                      type="button"
                      onClick={handlePostCredit}
                      disabled={reconciling || opState !== "UNKNOWN"}
                      className="flex items-center gap-2 text-sm font-medium border border-violet-300 text-violet-700 hover:bg-violet-50 rounded-xl px-4 py-2 transition disabled:opacity-50"
                    >
                      <RefreshCw className="h-4 w-4" aria-hidden />
                      Retry submission
                    </button>
                  </div>
                  <p className="text-[11px] text-neutral-400">
                    &ldquo;Retry submission&rdquo; resends with the same idempotency key — safe to use if the
                    credit was not applied. Use &ldquo;Check credit status&rdquo; first to confirm.
                  </p>
                </div>
              )}

              {/* P52: SUBMITTING state — request in-flight */}
              {opState === "SUBMITTING" && creditOp && (
                <div className="px-5 py-4">
                  <div className="flex items-center gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3">
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-violet-600" aria-hidden />
                    <div>
                      <p className="text-sm font-semibold text-violet-900">Posting credit…</p>
                      <p className="text-xs text-violet-700 mt-0.5">
                        Submitting {creditOp.amount} XLM — do not close this tab.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* P52: COMMITTED state — success, require acknowledgment */}
              {opState === "COMMITTED" && creditOp && (
                <div className="px-5 py-4 space-y-3">
                  <div className="flex items-start gap-3 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3">
                    <CheckCircle className="h-4 w-4 shrink-0 mt-0.5 text-emerald-600" aria-hidden />
                    <div className="flex-1 space-y-1">
                      <p className="text-sm font-semibold text-emerald-900">Credit posted successfully</p>
                      <p className="text-xs text-emerald-800">
                        +{creditOp.amount} XLM applied to {data?.tenantName ?? data?.tenantSlug ?? `Tenant #${id}`}.
                        {creditOp.committedEventId != null && (
                          <> Event #{creditOp.committedEventId}.</>
                        )}
                      </p>
                    </div>
                  </div>
                  {/* P534-R03: Storage failure warning — shown when financial evidence
                      could not be preserved in browser storage */}
                  {creditError && (
                    <p className="text-xs text-red-600 flex items-center gap-1">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      {creditError}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={handleAcknowledge}
                    className="flex items-center gap-2 text-sm font-medium border border-neutral-200 text-neutral-700 hover:bg-neutral-50 rounded-xl px-4 py-2 transition"
                  >
                    Post another credit
                  </button>
                </div>
              )}

              {/* P52: REJECTED state — definitive failure, require acknowledgment */}
              {opState === "REJECTED" && creditOp && (
                <div className="px-5 py-4 space-y-3">
                  <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                    <XCircle className="h-4 w-4 shrink-0 mt-0.5 text-red-500" aria-hidden />
                    <div className="flex-1 space-y-1">
                      <p className="text-sm font-semibold text-red-900">Credit rejected — not applied</p>
                      <p className="text-xs text-red-700">
                        {creditOp.rejectionReason ?? "The credit was rejected by the server and was not applied."}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleAcknowledge}
                    className="flex items-center gap-2 text-sm font-medium border border-neutral-200 text-neutral-700 hover:bg-neutral-50 rounded-xl px-4 py-2 transition"
                  >
                    Try a new credit
                  </button>
                </div>
              )}

              {/* P52: IDLE or CONFIRMED — show input form */}
              {(opState === null || opState === "CONFIRMED") && (
                <div className="px-5 py-4 space-y-3">
                  {/* P52: CONFIRMED banner — op is locked in, inputs are read-only */}
                  {opState === "CONFIRMED" && creditOp && (
                    <div className="flex items-start gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5 text-xs text-violet-800">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden />
                      <span>
                        Operation confirmed and ready to submit. Inputs are locked.{" "}
                        <button
                          type="button"
                          onClick={handleDiscardConfirmed}
                          className="underline font-medium hover:text-violet-900"
                        >
                          Discard and start fresh
                        </button>
                      </span>
                    </div>
                  )}
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="flex-1 space-y-1">
                      <label className="text-xs font-medium text-neutral-600">Type</label>
                      <select
                        value={creditType}
                        onChange={(e) => setCreditType(e.target.value as "manual_topup")}
                        disabled={inputsDisabled}
                        className="w-full text-sm border border-neutral-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-violet-400 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <option value="manual_topup">Manual top-up</option>
                        {/* UI-01: bundle_purchase requires a bundle catalog selector (not yet built) */}
                      </select>
                    </div>
                    <div className="flex-1 space-y-1">
                      <label className="text-xs font-medium text-neutral-600">Amount (XLM)</label>
                      <input
                        type="number"
                        min="0.0001"
                        step="0.01"
                        placeholder="e.g. 50"
                        value={creditAmount}
                        onChange={(e) => setCreditAmount(e.target.value)}
                        disabled={inputsDisabled}
                        className="w-full text-sm border border-neutral-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-400 disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-neutral-600">Notes (optional)</label>
                    <input
                      type="text"
                      placeholder="Reference or reason"
                      value={creditNotes}
                      onChange={(e) => setCreditNotes(e.target.value)}
                      disabled={inputsDisabled}
                      className="w-full text-sm border border-neutral-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-400 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </div>
                  {creditError && (
                    <p className="text-xs text-red-600 flex items-center gap-1">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      {creditError}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={handleCreditClick}
                    disabled={!creditAmount || inputsDisabled}
                    className="flex items-center gap-2 text-sm font-medium bg-violet-600 hover:bg-violet-700 text-white rounded-xl px-4 py-2 transition disabled:opacity-50"
                  >
                    <PlusCircle className="h-4 w-4" aria-hidden />
                    {opState === "CONFIRMED" ? "Review and post credit" : "Post credit"}
                  </button>
                </div>
              )}
            </div>

            {/* P534-01: Conflict evidence banner — shows when financial evidence
                was preserved outside the active operation slot */}
            {conflictEvidence.length > 0 && (
              <div className="bg-white rounded-2xl border border-amber-300 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-amber-200 flex items-center gap-2 bg-amber-50">
                  <AlertCircle className="h-4 w-4 text-amber-600" aria-hidden />
                  <h2 className="text-sm font-semibold text-amber-900">
                    Unresolved financial evidence
                  </h2>
                </div>
                <div className="px-5 py-4 space-y-3">
                  <p className="text-xs text-amber-800 leading-relaxed">
                    The following operation(s) have outcomes that could not be recorded in the
                    active operation slot. This is browser-side recovery evidence — verify with
                    the server using the idempotency key.
                  </p>
                  {conflictEvidence.map((ce) => (
                    <div key={ce.key} className="flex items-start justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-amber-900">
                          {ce.state === "COMMITTED" ? "Confirmed" : "Uncertain"}: {ce.amount} XLM
                          {ce.committedEventId != null && <> (Event #{ce.committedEventId})</>}
                        </p>
                        <p className="text-[11px] text-amber-700 font-mono truncate" title={ce.key}>
                          Key: {ce.key}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const adminInfo = getAdminInfo();
                          if (adminInfo && id) {
                            clearConflictEvidence(adminInfo.id, id, ce.key);
                            setConflictEvidence(prev => prev.filter(c => c.key !== ce.key));
                          }
                        }}
                        className="shrink-0 text-xs text-amber-600 hover:text-amber-800 underline"
                      >
                        Dismiss
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : null}
      </main>
    </div>
  );
}
