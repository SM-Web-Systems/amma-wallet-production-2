/**
 * P534 — Behavioral regression test for evidence preservation.
 *
 * This file exists to prove that the P534-01 defect (silent discard of
 * COMMITTED evidence when another UUID occupies the active slot) is a real
 * behavioral failure on the Phase 5.3.3 baseline, NOT an import error.
 *
 * Key constraint: this file MUST NOT import any export that was added in
 * P534 (saveConflictEvidence, loadConflictEvidence, clearConflictEvidence).
 * It imports only `storageKey`, which exists on every version since Phase 5.2.
 *
 * Expected behavior:
 *   - Baseline (Phase 5.3.3): FAILS — UUID-A's COMMITTED evidence is silently
 *     discarded when safeSaveCreditOp rejects due to UUID mismatch. No
 *     sessionStorage record for UUID-A exists after the response resolves.
 *   - Phase 5.3.4: PASSES — safePersistWithConflict stores UUID-A's evidence
 *     under a conflict key (aw_credit_conflict_{admin}_{tenant}_{uuid}).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { server, mockBilling } from "../test/msw-server";
import { http, HttpResponse } from "msw";
import AdminTenantDetail from "./AdminTenantDetail";
import { storageKey } from "../lib/credit-op-storage";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

function setAuth() {
  sessionStorage.setItem("aw_admin_token", "mock-jwt");
  sessionStorage.setItem("aw_admin_info", JSON.stringify({
    id: 1, email: "admin@test.com", name: "Test Admin", role: "super_admin",
  }));
}

describe("P534 baseline behavioral regression", () => {
  function createDeferred<T = void>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => { resolve = res; });
    return { promise, resolve };
  }

  function renderNavigable(initialId = "1") {
    const router = createMemoryRouter(
      [{ path: "/admin/tenants/:id", element: <AdminTenantDetail /> }],
      { initialEntries: [`/admin/tenants/${initialId}`] },
    );
    const result = render(<RouterProvider router={router} />);
    return { ...result, router };
  }

  const flushPromises = () => new Promise(r => setTimeout(r, 0));

  function billingByTenant() {
    return http.get("/api/v1/internal/tenants/:id/billing", ({ params }) => {
      if (params.id === "2") {
        return HttpResponse.json({
          ...mockBilling, tenantId: 2, tenantName: "Beta Inc", balance: "250.0000000",
        });
      }
      return HttpResponse.json({ ...mockBilling, tenantId: Number(params.id) });
    });
  }

  /**
   * Scan sessionStorage for any record containing the given UUID whose
   * state is COMMITTED. This avoids importing P534-only helpers and instead
   * relies on raw sessionStorage inspection.
   */
  function findCommittedEvidence(uuid: string): boolean {
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (!k) continue;
      // Skip the active slot — we only want evidence preserved OUTSIDE it
      if (k.startsWith("aw_pending_credit_")) continue;
      try {
        const val = sessionStorage.getItem(k);
        if (!val) continue;
        const parsed = JSON.parse(val);
        if (parsed && parsed.key === uuid && parsed.state === "COMMITTED") {
          return true;
        }
      } catch { /* skip non-JSON */ }
    }
    return false;
  }

  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it("P534-01-BASELINE: delayed COMMITTED response for UUID-A is recoverable when UUID-B occupies active slot", async () => {
    // ──────────────────────────────────────────────────────────────────────
    // Scenario (legitimate application behavior):
    //   1. Admin submits credit for tenant 1 → UUID-A enters SUBMITTING.
    //   2. Network latency holds the response.
    //   3. Admin navigates to tenant 2 (makes response stale).
    //   4. While away, UUID-B is established in tenant 1's active slot
    //      (represents admin returning and starting a new operation, or
    //      another tab writing to the same storage).
    //   5. UUID-A's COMMITTED response arrives.
    //
    // Baseline defect: safeSaveCreditOp rejects UUID-A (different UUID),
    //   and the COMMITTED evidence is silently discarded.
    //
    // P534 fix: safePersistWithConflict stores the evidence as a conflict
    //   record under a UUID-specific key.
    // ──────────────────────────────────────────────────────────────────────
    setAuth();

    const creditDeferred = createDeferred();
    server.use(
      billingByTenant(),
      http.post("/api/v1/internal/tenants/:id/credit", async () => {
        await creditDeferred.promise;
        return HttpResponse.json({
          tenantId: 1, billingEventId: 77, newBalance: "600.0000000",
          amountCredited: "100.0000000", eventType: "manual_topup",
        });
      }),
    );

    const { router } = renderNavigable("1");
    const user = userEvent.setup();

    // Step 1: Wait for tenant 1 to load
    await waitFor(() => {
      expect(screen.getByText("ACME Corp")).toBeInTheDocument();
    });

    // Step 1: Submit credit (UUID-A generated internally)
    await user.type(screen.getByPlaceholderText("e.g. 50"), "100");
    const postBtns = screen.getAllByRole("button", { name: /post credit/i });
    await user.click(postBtns[0]);
    const dialog = screen.getByRole("dialog", { name: /confirm credit/i });
    await user.click(within(dialog).getByRole("button", { name: /post credit/i }));

    await waitFor(() => {
      expect(screen.getByText("Posting credit…")).toBeInTheDocument();
    });

    // Capture UUID-A from the active storage slot
    const opA = JSON.parse(sessionStorage.getItem(storageKey(1, "1"))!);
    expect(opA.state).toBe("SUBMITTING");
    const uuidA = opA.key;
    expect(uuidA).toBeTruthy();

    // Step 2: Network holds the response (creditDeferred not resolved yet)

    // Step 3: Navigate away — makes the response stale via generation counter
    await act(async () => { router.navigate("/admin/tenants/2"); });
    await waitFor(() => {
      expect(screen.getByText("Beta Inc")).toBeInTheDocument();
    });

    // Step 4: Establish UUID-B as the active operation in tenant 1's slot.
    // This represents the admin returning to tenant 1 and starting a new
    // credit operation, or another tab writing to the same storage key.
    const conflictOp = {
      ...opA,
      key: "uuid-B-new-operation",
      state: "UNKNOWN",
      amount: "200.0000000",
    };
    sessionStorage.setItem(storageKey(1, "1"), JSON.stringify(conflictOp));

    // Step 5: Release UUID-A's COMMITTED response
    await act(async () => {
      creditDeferred.resolve();
      await flushPromises();
    });

    // Verify: UUID-B must remain the active operation (same on both baseline and P534)
    const activeAfter = JSON.parse(sessionStorage.getItem(storageKey(1, "1"))!);
    expect(activeAfter.key).toBe("uuid-B-new-operation");
    expect(activeAfter.state).toBe("UNKNOWN");

    // Verify: Tenant 2's UI must NOT show tenant 1's COMMITTED result
    expect(screen.queryByText("Credit posted successfully")).not.toBeInTheDocument();
    expect(screen.getByText("Beta Inc")).toBeInTheDocument();

    // ── THE BEHAVIORAL ASSERTION ──
    // UUID-A's COMMITTED evidence (billingEventId 77) must be recoverable
    // SOMEWHERE in sessionStorage, outside the active slot.
    //
    // Baseline: safeSaveCreditOp rejects → evidence discarded → FALSE → FAIL
    // P534:     safePersistWithConflict → saveConflictEvidence → TRUE → PASS
    const evidenceRecoverable = findCommittedEvidence(uuidA);
    expect(evidenceRecoverable).toBe(true);
  });
});
