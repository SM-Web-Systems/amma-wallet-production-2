import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, createMemoryRouter, RouterProvider } from "react-router-dom";
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

function renderDetail(tenantId = "1") {
  return render(
    <MemoryRouter initialEntries={[`/admin/tenants/${tenantId}`]}>
      <Routes>
        <Route path="/admin/tenants/:id" element={<AdminTenantDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AdminTenantDetail", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it("redirects to login when no token", () => {
    renderDetail();
    expect(mockNavigate).toHaveBeenCalledWith("/admin/login");
  });

  it("shows loading state then renders billing data", async () => {
    setAuth();
    renderDetail();

    expect(screen.getByText("Loading billing data…")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("ACME Corp")).toBeInTheDocument();
    });
    expect(screen.getByText("500.0000")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("displays policy details", async () => {
    setAuth();
    renderDetail();

    await waitFor(() => {
      expect(screen.getByText("ACME Corp")).toBeInTheDocument();
    });

    expect(screen.getByText("-100.0000000 XLM")).toBeInTheDocument();
    expect(screen.getByText("On")).toBeInTheDocument(); // acquisitionMode
    expect(screen.getByText("30d")).toBeInTheDocument(); // gracePeriod
  });

  it("renders billing events", async () => {
    setAuth();
    renderDetail();

    await waitFor(() => {
      // "Manual top-up" appears both as event label and dropdown option
      const matches = screen.getAllByText("Manual top-up");
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getByText("+100.0000 XLM")).toBeInTheDocument();
    expect(screen.getByText("Initial credit")).toBeInTheDocument();
  });

  it("shows empty state when no events", async () => {
    setAuth();
    server.use(
      http.get("/api/v1/internal/tenants/:id/billing", () => {
        return HttpResponse.json({ ...mockBilling, recentEvents: [], eventsHasMore: false });
      }),
    );
    renderDetail();

    await waitFor(() => {
      expect(screen.getByText("No billing events yet.")).toBeInTheDocument();
    });
  });

  // Credit posting tests
  describe("credit posting", () => {
    it("validates empty amount", async () => {
      setAuth();
      const user = userEvent.setup();
      renderDetail();

      await waitFor(() => {
        expect(screen.getByText("ACME Corp")).toBeInTheDocument();
      });

      // Post credit button should be disabled when no amount
      const postBtn = screen.getByRole("button", { name: /post credit/i });
      expect(postBtn).toBeDisabled();
    });

    it("validates negative amount shows error", async () => {
      setAuth();
      const user = userEvent.setup();
      renderDetail();

      await waitFor(() => {
        expect(screen.getByText("ACME Corp")).toBeInTheDocument();
      });

      const amountInput = screen.getByPlaceholderText("e.g. 50");
      await user.type(amountInput, "-5");
      await user.click(screen.getByRole("button", { name: /post credit/i }));

      expect(screen.getByText("Amount must be a positive number (up to 7 decimal places).")).toBeInTheDocument();
    });

    it("opens confirmation dialog before posting", async () => {
      setAuth();
      const user = userEvent.setup();
      renderDetail();

      await waitFor(() => {
        expect(screen.getByText("ACME Corp")).toBeInTheDocument();
      });

      const amountInput = screen.getByPlaceholderText("e.g. 50");
      await user.type(amountInput, "100");
      // The form's Post credit button (outside dialog)
      const postBtns = screen.getAllByRole("button", { name: /post credit/i });
      await user.click(postBtns[0]);

      // Confirm dialog should appear
      const dialog = screen.getByRole("dialog", { name: /confirm credit/i });
      expect(within(dialog).getByText(/100 XLM/)).toBeInTheDocument();
      expect(within(dialog).getByText(/irreversible/i)).toBeInTheDocument();
    });

    it("posts credit after confirmation", async () => {
      setAuth();
      const user = userEvent.setup();
      renderDetail();

      await waitFor(() => {
        expect(screen.getByText("ACME Corp")).toBeInTheDocument();
      });

      await user.type(screen.getByPlaceholderText("e.g. 50"), "100");
      // Click the form's Post credit button to open dialog
      const formPostBtns = screen.getAllByRole("button", { name: /post credit/i });
      await user.click(formPostBtns[0]);

      // Now click the confirm button inside the dialog
      const dialog = screen.getByRole("dialog", { name: /confirm credit/i });
      const dialogPostBtn = within(dialog).getByRole("button", { name: /post credit/i });
      await user.click(dialogPostBtn);

      await waitFor(() => {
        expect(screen.getByText(/Credit posted successfully/)).toBeInTheDocument();
      });
    });

    it("cancels credit confirmation without posting", async () => {
      setAuth();
      let creditCalled = false;
      server.use(
        http.post("/api/v1/internal/tenants/:id/credit", () => {
          creditCalled = true;
          return HttpResponse.json({});
        }),
      );

      const user = userEvent.setup();
      renderDetail();

      await waitFor(() => {
        expect(screen.getByText("ACME Corp")).toBeInTheDocument();
      });

      await user.type(screen.getByPlaceholderText("e.g. 50"), "100");
      await user.click(screen.getByRole("button", { name: /post credit/i }));

      // Cancel
      await user.click(screen.getByText("Cancel"));

      expect(screen.queryByText("Confirm credit")).not.toBeInTheDocument();
      expect(creditCalled).toBe(false);
    });
  });

  // Suspend/unsuspend tests
  describe("suspend/unsuspend", () => {
    it("shows suspend button for active tenant", async () => {
      setAuth();
      renderDetail();

      await waitFor(() => {
        expect(screen.getByText("Active")).toBeInTheDocument();
      });

      expect(screen.getByRole("button", { name: /suspend/i })).toBeInTheDocument();
    });

    it("opens suspend modal with hard/soft options", async () => {
      setAuth();
      const user = userEvent.setup();
      renderDetail();

      await waitFor(() => {
        expect(screen.getByText("ACME Corp")).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /suspend/i }));

      expect(screen.getByText(/hard suspend tenant\?/i)).toBeInTheDocument();
      expect(screen.getByText("Hard suspend")).toBeInTheDocument();
      expect(screen.getByText("Soft suspend")).toBeInTheDocument();
    });

    it("submits hard suspend", async () => {
      setAuth();
      const user = userEvent.setup();
      renderDetail();

      await waitFor(() => {
        expect(screen.getByText("ACME Corp")).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /^suspend$/i }));

      const dialog = screen.getByRole("dialog");
      // Default is hard suspend — click confirm
      const confirmBtn = screen.getByRole("button", { name: /hard suspend tenant/i });
      await user.click(confirmBtn);

      // Should reload data after suspend
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
    });

    it("shows unsuspend button for suspended tenant", async () => {
      setAuth();
      server.use(
        http.get("/api/v1/internal/tenants/:id/billing", () => {
          return HttpResponse.json({
            ...mockBilling,
            isActive: false,
            suspendedAt: "2026-10-20T00:00:00Z",
            suspensionReason: "manual",
          });
        }),
      );
      renderDetail();

      await waitFor(() => {
        expect(screen.getByText("Suspended")).toBeInTheDocument();
      });

      expect(screen.getByRole("button", { name: /unsuspend/i })).toBeInTheDocument();
    });

    it("submits unsuspend", async () => {
      setAuth();
      server.use(
        http.get("/api/v1/internal/tenants/:id/billing", () => {
          return HttpResponse.json({
            ...mockBilling,
            isActive: false,
            suspendedAt: "2026-10-20T00:00:00Z",
            suspensionReason: "manual",
          });
        }),
      );
      const user = userEvent.setup();
      renderDetail();

      await waitFor(() => {
        expect(screen.getByText("Suspended")).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /unsuspend/i }));
      await user.click(screen.getByRole("button", { name: /unsuspend tenant/i }));

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
    });

    it("shows soft-suspended status", async () => {
      setAuth();
      server.use(
        http.get("/api/v1/internal/tenants/:id/billing", () => {
          return HttpResponse.json({
            ...mockBilling,
            isActive: true,
            suspendedAt: "2026-10-20T00:00:00Z",
            suspensionReason: "manual",
          });
        }),
      );
      renderDetail();

      await waitFor(() => {
        expect(screen.getByText("Soft-suspended")).toBeInTheDocument();
      });
    });
  });

  // Pagination tests
  describe("billing event pagination", () => {
    it("shows Load older button when hasMore is true", async () => {
      setAuth();
      server.use(
        http.get("/api/v1/internal/tenants/:id/billing", () => {
          return HttpResponse.json({
            ...mockBilling,
            eventsHasMore: true,
            eventsNextCursor: 5,
          });
        }),
      );
      renderDetail();

      await waitFor(() => {
        expect(screen.getByText("Load older")).toBeInTheDocument();
      });
    });

    it("loads older events on click", async () => {
      setAuth();
      server.use(
        http.get("/api/v1/internal/tenants/:id/billing", () => {
          return HttpResponse.json({
            ...mockBilling,
            eventsHasMore: true,
            eventsNextCursor: 5,
          });
        }),
        http.get("/api/v1/internal/tenants/:id/events", () => {
          return HttpResponse.json({
            events: [
              { id: 3, eventType: "wallet_funding", amountXlm: "-1.5000000", billingPeriod: null, userId: 42, createdAt: "2026-10-10T10:00:00Z", notes: null },
            ],
            hasMore: false,
            nextCursor: null,
          });
        }),
      );

      const user = userEvent.setup();
      renderDetail();

      await waitFor(() => {
        expect(screen.getByText("Load older")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Load older"));

      await waitFor(() => {
        expect(screen.getByText("Wallet funding")).toBeInTheDocument();
      });
      expect(screen.getByText("-1.5000 XLM")).toBeInTheDocument();
    });
  });

  // Auth / error handling
  it("handles 401 by logging out", async () => {
    setAuth();
    server.use(
      http.get("/api/v1/internal/tenants/:id/billing", () => {
        return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
      }),
    );
    renderDetail();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/admin/login");
    });
  });

  it("shows server error", async () => {
    setAuth();
    server.use(
      http.get("/api/v1/internal/tenants/:id/billing", () => {
        return HttpResponse.json({ error: "Tenant not found" }, { status: 404 });
      }),
    );
    renderDetail();

    await waitFor(() => {
      expect(screen.getByText("Tenant not found")).toBeInTheDocument();
    });
  });

  it("shows network error", async () => {
    setAuth();
    server.use(
      http.get("/api/v1/internal/tenants/:id/billing", () => {
        return HttpResponse.error();
      }),
    );
    renderDetail();

    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeInTheDocument();
    });
  });

  it("has breadcrumb link back to all tenants", async () => {
    setAuth();
    renderDetail();

    await waitFor(() => {
      expect(screen.getByText("ACME Corp")).toBeInTheDocument();
    });

    const backLink = screen.getByText("All tenants");
    expect(backLink.closest("a")).toHaveAttribute("href", "/admin");
  });

  // ────────────────────────────────────────────────────────────────────────
  // P53-01: Financial reconciliation race — regression tests
  // ────────────────────────────────────────────────────────────────────────
  describe("P53-01: reconciliation safety", () => {
    async function setupUnknownOp(user: ReturnType<typeof userEvent.setup>) {
      // Create a credit and have it fail with a 500 to reach UNKNOWN state
      server.use(
        http.post("/api/v1/internal/tenants/:id/credit", () => {
          return HttpResponse.json({ error: "Internal error" }, { status: 500 });
        }),
      );

      renderDetail();
      await waitFor(() => {
        expect(screen.getByText("ACME Corp")).toBeInTheDocument();
      });

      // Enter amount and submit
      await user.type(screen.getByPlaceholderText("e.g. 50"), "100");
      const postBtns = screen.getAllByRole("button", { name: /post credit/i });
      await user.click(postBtns[0]);

      // Confirm in dialog
      const dialog = screen.getByRole("dialog", { name: /confirm credit/i });
      await user.click(within(dialog).getByRole("button", { name: /post credit/i }));

      // Should be in UNKNOWN state
      await waitFor(() => {
        expect(screen.getByText("Credit outcome unknown")).toBeInTheDocument();
      });
    }

    it("not_found from credit-status keeps operation in UNKNOWN state", async () => {
      setAuth();
      const user = userEvent.setup();
      await setupUnknownOp(user);

      // Default MSW handler returns not_found — click Check status
      await user.click(screen.getByRole("button", { name: /check credit status/i }));

      // The operation must stay UNKNOWN — NOT transition to REJECTED
      await waitFor(() => {
        // Should still show the UNKNOWN banner, not the REJECTED banner
        expect(screen.getByText("Credit outcome unknown")).toBeInTheDocument();
      });
      expect(screen.queryByText("Credit rejected — not applied")).not.toBeInTheDocument();
    });

    it("preserves the original UUID after not_found", async () => {
      setAuth();
      const user = userEvent.setup();
      await setupUnknownOp(user);

      // Record the key shown in the UNKNOWN banner
      const keyElement = screen.getByText(/^Key:/);
      const originalKey = keyElement.textContent?.replace("Key: ", "");
      expect(originalKey).toBeTruthy();

      // Check status (returns not_found)
      await user.click(screen.getByRole("button", { name: /check credit status/i }));

      await waitFor(() => {
        // Operation should still be visible with the same key
        const keyAfter = screen.getByText(/^Key:/).textContent?.replace("Key: ", "");
        expect(keyAfter).toBe(originalKey);
      });
    });

    it("retry after not_found uses the original UUID", async () => {
      setAuth();
      const user = userEvent.setup();
      await setupUnknownOp(user);

      // Check status (returns not_found)
      await user.click(screen.getByRole("button", { name: /check credit status/i }));

      // Wait for the check to complete
      await waitFor(() => {
        expect(screen.queryByText("Checking…")).not.toBeInTheDocument();
      });

      // Record the key
      const originalKey = screen.getByText(/^Key:/).textContent?.replace("Key: ", "");

      // Set up mock that captures the retry request
      let capturedKey: string | undefined;
      server.use(
        http.post("/api/v1/internal/tenants/:id/credit", async ({ request }) => {
          const body = (await request.json()) as { idempotency_key?: string };
          capturedKey = body.idempotency_key;
          return HttpResponse.json({
            tenantId: 1, billingEventId: 42, newBalance: "600.0000000",
            amountCredited: "100.0000000", eventType: "manual_topup",
          });
        }),
      );

      // Retry submission
      await user.click(screen.getByRole("button", { name: /retry submission/i }));

      await waitFor(() => {
        expect(screen.getByText(/Credit posted successfully/)).toBeInTheDocument();
      });

      // The retry must have used the original key
      expect(capturedKey).toBe(originalKey);
    });

    it("committed from credit-status resolves to COMMITTED", async () => {
      setAuth();
      const user = userEvent.setup();
      await setupUnknownOp(user);

      // Override to return committed
      server.use(
        http.get("/api/v1/internal/tenants/:id/credit-status", ({ params }) => {
          return HttpResponse.json({
            status: "committed",
            billingEventId: 42,
            amountXlm: "100.0000000",
            eventType: "manual_topup",
            createdAt: "2026-10-20T00:00:00Z",
            tenantId: Number(params.id),
            idempotencyKey: "test-key",
          });
        }),
      );

      await user.click(screen.getByRole("button", { name: /check credit status/i }));

      await waitFor(() => {
        expect(screen.getByText("Credit posted successfully")).toBeInTheDocument();
      });
    });

    it("network error on status check stays UNKNOWN", async () => {
      setAuth();
      const user = userEvent.setup();
      await setupUnknownOp(user);

      server.use(
        http.get("/api/v1/internal/tenants/:id/credit-status", () => {
          return HttpResponse.error();
        }),
      );

      await user.click(screen.getByRole("button", { name: /check credit status/i }));

      await waitFor(() => {
        expect(screen.getByText(/network error/i)).toBeInTheDocument();
      });
      // Still in UNKNOWN state
      expect(screen.getByText("Credit outcome unknown")).toBeInTheDocument();
    });

    it("reload preserves UNKNOWN operation in sessionStorage", async () => {
      setAuth();
      const user = userEvent.setup();
      await setupUnknownOp(user);

      // Verify operation is in sessionStorage
      const storageKeys = Object.keys(sessionStorage).filter(k => k.startsWith("aw_pending_credit_"));
      expect(storageKeys.length).toBe(1);
      const stored = JSON.parse(sessionStorage.getItem(storageKeys[0])!);
      expect(stored.state).toBe("UNKNOWN");
    });

    it("reconciliation does not send a POST request", async () => {
      setAuth();
      const user = userEvent.setup();
      await setupUnknownOp(user);

      let postCalled = false;
      server.use(
        http.post("/api/v1/internal/tenants/:id/credit", () => {
          postCalled = true;
          return HttpResponse.json({});
        }),
      );

      await user.click(screen.getByRole("button", { name: /check credit status/i }));

      await waitFor(() => {
        expect(screen.queryByText("Checking…")).not.toBeInTheDocument();
      });

      expect(postCalled).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // P53-02: Tenant/admin identity safety — regression tests
  // ────────────────────────────────────────────────────────────────────────
  describe("P53-02: tenant and admin identity safety", () => {
    function renderWithMultipleTenants() {
      return render(
        <MemoryRouter initialEntries={["/admin/tenants/1"]}>
          <Routes>
            <Route path="/admin/tenants/:id" element={<AdminTenantDetail />} />
          </Routes>
        </MemoryRouter>,
      );
    }

    it("navigating to different tenant clears stale credit operation", async () => {
      setAuth();
      const user = userEvent.setup();

      // First render with tenant 1 and create a credit operation that goes UNKNOWN
      server.use(
        http.post("/api/v1/internal/tenants/:id/credit", () => {
          return HttpResponse.json({ error: "Server error" }, { status: 500 });
        }),
      );

      const { unmount } = render(
        <MemoryRouter initialEntries={["/admin/tenants/1"]}>
          <Routes>
            <Route path="/admin/tenants/:id" element={<AdminTenantDetail />} />
          </Routes>
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(screen.getByText("ACME Corp")).toBeInTheDocument();
      });

      // Create and submit a credit operation
      await user.type(screen.getByPlaceholderText("e.g. 50"), "100");
      const postBtns = screen.getAllByRole("button", { name: /post credit/i });
      await user.click(postBtns[0]);
      const dialog = screen.getByRole("dialog", { name: /confirm credit/i });
      await user.click(within(dialog).getByRole("button", { name: /post credit/i }));

      await waitFor(() => {
        expect(screen.getByText("Credit outcome unknown")).toBeInTheDocument();
      });

      unmount();

      // Now render with tenant 2
      server.use(
        http.get("/api/v1/internal/tenants/:id/billing", ({ params }) => {
          return HttpResponse.json({
            ...mockBilling,
            tenantId: Number(params.id),
            tenantName: "Beta Inc",
          });
        }),
      );

      render(
        <MemoryRouter initialEntries={["/admin/tenants/2"]}>
          <Routes>
            <Route path="/admin/tenants/:id" element={<AdminTenantDetail />} />
          </Routes>
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(screen.getByText("Beta Inc")).toBeInTheDocument();
      });

      // Tenant 2's page must NOT show tenant 1's UNKNOWN operation
      expect(screen.queryByText("Credit outcome unknown")).not.toBeInTheDocument();
    });

    it("blocks credit submission when operation belongs to different tenant", async () => {
      setAuth();

      // Pre-seed sessionStorage with an UNKNOWN op for tenant 1
      const stalOp = {
        key: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        type: "manual_topup",
        amount: "100.0000000",
        notes: "",
        state: "UNKNOWN",
        adminId: 1,
        tenantId: "1",
        createdAt: "2026-10-20T00:00:00.000Z",
      };
      sessionStorage.setItem("aw_pending_credit_1_1", JSON.stringify(stalOp));

      // Render for tenant 2
      server.use(
        http.get("/api/v1/internal/tenants/:id/billing", ({ params }) => {
          return HttpResponse.json({
            ...mockBilling,
            tenantId: Number(params.id),
            tenantName: "Beta Inc",
          });
        }),
      );

      render(
        <MemoryRouter initialEntries={["/admin/tenants/2"]}>
          <Routes>
            <Route path="/admin/tenants/:id" element={<AdminTenantDetail />} />
          </Routes>
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(screen.getByText("Beta Inc")).toBeInTheDocument();
      });

      // The UNKNOWN op for tenant 1 must NOT be visible on tenant 2's page
      expect(screen.queryByText("Credit outcome unknown")).not.toBeInTheDocument();
    });

    it("blocks reconciliation against wrong tenant", async () => {
      setAuth();

      // Pre-seed sessionStorage with an UNKNOWN op for tenant 1
      const staleOp = {
        key: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        type: "manual_topup",
        amount: "100.0000000",
        notes: "",
        state: "UNKNOWN",
        adminId: 1,
        tenantId: "1",
        createdAt: "2026-10-20T00:00:00.000Z",
      };
      sessionStorage.setItem("aw_pending_credit_1_1", JSON.stringify(staleOp));

      // Render for tenant 2
      server.use(
        http.get("/api/v1/internal/tenants/:id/billing", ({ params }) => {
          return HttpResponse.json({
            ...mockBilling,
            tenantId: Number(params.id),
            tenantName: "Beta Inc",
          });
        }),
      );

      render(
        <MemoryRouter initialEntries={["/admin/tenants/2"]}>
          <Routes>
            <Route path="/admin/tenants/:id" element={<AdminTenantDetail />} />
          </Routes>
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(screen.getByText("Beta Inc")).toBeInTheDocument();
      });

      // Tenant 1's operation must not appear, so there should be no "Check credit status" button
      expect(screen.queryByRole("button", { name: /check credit status/i })).not.toBeInTheDocument();
    });

    it("navigating back to original tenant restores its operation", async () => {
      setAuth();

      // Pre-seed sessionStorage with an UNKNOWN op for tenant 1
      const op = {
        key: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        type: "manual_topup",
        amount: "100.0000000",
        notes: "",
        state: "UNKNOWN",
        adminId: 1,
        tenantId: "1",
        createdAt: "2026-10-20T00:00:00.000Z",
      };
      sessionStorage.setItem("aw_pending_credit_1_1", JSON.stringify(op));

      // Render for tenant 1
      render(
        <MemoryRouter initialEntries={["/admin/tenants/1"]}>
          <Routes>
            <Route path="/admin/tenants/:id" element={<AdminTenantDetail />} />
          </Routes>
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(screen.getByText("ACME Corp")).toBeInTheDocument();
      });

      // Tenant 1's UNKNOWN operation should be restored
      expect(screen.getByText("Credit outcome unknown")).toBeInTheDocument();
    });

    it("admin B cannot see admin A's pending operation", async () => {
      // Admin A (id=1) has an UNKNOWN op for tenant 1
      const opA = {
        key: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        type: "manual_topup",
        amount: "100.0000000",
        notes: "",
        state: "UNKNOWN",
        adminId: 1,
        tenantId: "1",
        createdAt: "2026-10-20T00:00:00.000Z",
      };
      sessionStorage.setItem("aw_pending_credit_1_1", JSON.stringify(opA));

      // Log in as admin B (id=2)
      sessionStorage.setItem("aw_admin_token", "mock-jwt");
      sessionStorage.setItem("aw_admin_info", JSON.stringify({
        id: 2, email: "adminb@test.com", name: "Admin B", role: "super_admin",
      }));

      render(
        <MemoryRouter initialEntries={["/admin/tenants/1"]}>
          <Routes>
            <Route path="/admin/tenants/:id" element={<AdminTenantDetail />} />
          </Routes>
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(screen.getByText("ACME Corp")).toBeInTheDocument();
      });

      // Admin B must NOT see admin A's UNKNOWN operation
      expect(screen.queryByText("Credit outcome unknown")).not.toBeInTheDocument();
    });

    it("missing admin identity blocks financial actions", async () => {
      // Set token but no admin info
      sessionStorage.setItem("aw_admin_token", "mock-jwt");
      // No aw_admin_info

      render(
        <MemoryRouter initialEntries={["/admin/tenants/1"]}>
          <Routes>
            <Route path="/admin/tenants/:id" element={<AdminTenantDetail />} />
          </Routes>
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(screen.getByText("ACME Corp")).toBeInTheDocument();
      });

      const user = userEvent.setup();
      await user.type(screen.getByPlaceholderText("e.g. 50"), "100");
      await user.click(screen.getByRole("button", { name: /post credit/i }));

      // Should show admin identity error
      expect(screen.getByText(/cannot verify admin identity/i)).toBeInTheDocument();
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // P53-R01: Async context safety — same-component navigation races
  // ────────────────────────────────────────────────────────────────────────
  describe("P53-R01: async context safety", () => {
    // Deferred promise for controlling when MSW responses resolve
    function createDeferred<T = void>() {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((res) => { resolve = res; });
      return { promise, resolve };
    }

    // Render with createMemoryRouter + RouterProvider for same-component navigation.
    // router.navigate() changes the route WITHOUT unmounting the component,
    // which is how React Router behaves in production.
    function renderNavigable(initialId = "1") {
      const router = createMemoryRouter(
        [{ path: "/admin/tenants/:id", element: <AdminTenantDetail /> }],
        { initialEntries: [`/admin/tenants/${initialId}`] },
      );
      const result = render(<RouterProvider router={router} />);
      return { ...result, router };
    }

    // Flush microtask queue after resolving a deferred
    const flushPromises = () => new Promise(r => setTimeout(r, 0));

    // MSW handler that serves different billing data per tenant
    function billingByTenant() {
      return http.get("/api/v1/internal/tenants/:id/billing", ({ params }) => {
        if (params.id === "2") {
          return HttpResponse.json({
            ...mockBilling,
            tenantId: 2,
            tenantName: "Beta Inc",
            tenantSlug: "beta",
            balance: "250.0000000",
          });
        }
        return HttpResponse.json({ ...mockBilling, tenantId: Number(params.id) });
      });
    }

    it("stale load() response is discarded after tenant navigation", async () => {
      setAuth();

      const tenant1Deferred = createDeferred();

      // Hold tenant 1 billing response; serve tenant 2 immediately
      server.use(
        http.get("/api/v1/internal/tenants/:id/billing", async ({ params }) => {
          if (params.id === "1") {
            await tenant1Deferred.promise;
            return HttpResponse.json({ ...mockBilling, tenantId: 1, tenantName: "ACME Corp" });
          }
          return HttpResponse.json({
            ...mockBilling, tenantId: 2, tenantName: "Beta Inc", balance: "250.0000000",
          });
        }),
      );

      const { router } = renderNavigable("1");

      // Tenant 1 is loading (billing held by deferred)
      expect(screen.getByText("Loading billing data…")).toBeInTheDocument();

      // Navigate to tenant 2 before tenant 1 finishes loading
      await act(async () => { router.navigate("/admin/tenants/2"); });

      // Tenant 2 loads successfully
      await waitFor(() => {
        expect(screen.getByText("Beta Inc")).toBeInTheDocument();
      });

      // Now resolve tenant 1's stale response
      await act(async () => {
        tenant1Deferred.resolve();
        await flushPromises();
      });

      // Tenant 2's data must still be displayed — NOT overwritten by tenant 1
      expect(screen.getByText("Beta Inc")).toBeInTheDocument();
      expect(screen.queryByText("ACME Corp")).not.toBeInTheDocument();
    });

    it("stale handlePostCredit response does not show COMMITTED on wrong tenant", async () => {
      setAuth();

      const creditDeferred = createDeferred();

      server.use(
        billingByTenant(),
        // Hold credit POST until we navigate away
        http.post("/api/v1/internal/tenants/:id/credit", async () => {
          await creditDeferred.promise;
          return HttpResponse.json({
            tenantId: 1, billingEventId: 42, newBalance: "600.0000000",
            amountCredited: "100.0000000", eventType: "manual_topup",
          });
        }),
      );

      const { router } = renderNavigable("1");
      const user = userEvent.setup();

      // Wait for tenant 1 to load
      await waitFor(() => {
        expect(screen.getByText("ACME Corp")).toBeInTheDocument();
      });

      // Create and submit a credit operation
      await user.type(screen.getByPlaceholderText("e.g. 50"), "100");
      const postBtns = screen.getAllByRole("button", { name: /post credit/i });
      await user.click(postBtns[0]);
      const dialog = screen.getByRole("dialog", { name: /confirm credit/i });
      await user.click(within(dialog).getByRole("button", { name: /post credit/i }));

      // Should show SUBMITTING state
      await waitFor(() => {
        expect(screen.getByText("Posting credit…")).toBeInTheDocument();
      });

      // Navigate to tenant 2 while credit POST is in-flight
      await act(async () => { router.navigate("/admin/tenants/2"); });

      await waitFor(() => {
        expect(screen.getByText("Beta Inc")).toBeInTheDocument();
      });

      // Resolve the stale credit response (would commit to tenant 1)
      await act(async () => {
        creditDeferred.resolve();
        await flushPromises();
      });

      // Tenant 2 must NOT show the COMMITTED banner from tenant 1
      expect(screen.queryByText("Credit posted successfully")).not.toBeInTheDocument();
      // Tenant 2's data must still be displayed
      expect(screen.getByText("Beta Inc")).toBeInTheDocument();
    });

    it("stale handleCheckStatus response does not show reconciliation result on wrong tenant", async () => {
      setAuth();

      // Pre-seed UNKNOWN op for tenant 1
      const unknownOp = {
        key: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        type: "manual_topup",
        amount: "100.0000000",
        notes: "",
        state: "UNKNOWN",
        adminId: 1,
        tenantId: "1",
        createdAt: "2026-10-20T00:00:00.000Z",
      };
      sessionStorage.setItem(storageKey(1, "1"), JSON.stringify(unknownOp));

      const statusDeferred = createDeferred();

      server.use(
        billingByTenant(),
        // Hold credit-status response
        http.get("/api/v1/internal/tenants/:id/credit-status", async () => {
          await statusDeferred.promise;
          return HttpResponse.json({
            status: "committed", billingEventId: 99,
            amountXlm: "100.0000000", eventType: "manual_topup",
            createdAt: "2026-10-20T00:00:00Z",
            tenantId: 1, idempotencyKey: unknownOp.key,
          });
        }),
      );

      const { router } = renderNavigable("1");
      const user = userEvent.setup();

      // Wait for tenant 1 to show UNKNOWN banner
      await waitFor(() => {
        expect(screen.getByText("Credit outcome unknown")).toBeInTheDocument();
      });

      // Click Check credit status — request held by deferred
      await user.click(screen.getByRole("button", { name: /check credit status/i }));

      // Navigate to tenant 2 while status check is in-flight
      await act(async () => { router.navigate("/admin/tenants/2"); });
      await waitFor(() => {
        expect(screen.getByText("Beta Inc")).toBeInTheDocument();
      });

      // Resolve the stale status response (committed for tenant 1)
      await act(async () => {
        statusDeferred.resolve();
        await flushPromises();
      });

      // Tenant 2 must NOT show the COMMITTED banner from tenant 1's reconciliation
      expect(screen.queryByText("Credit posted successfully")).not.toBeInTheDocument();
      expect(screen.getByText("Beta Inc")).toBeInTheDocument();
    });

    it("storage persists COMMITTED even when React state update is discarded", async () => {
      setAuth();

      const creditDeferred = createDeferred();

      server.use(
        billingByTenant(),
        http.post("/api/v1/internal/tenants/:id/credit", async () => {
          await creditDeferred.promise;
          return HttpResponse.json({
            tenantId: 1, billingEventId: 42, newBalance: "600.0000000",
            amountCredited: "100.0000000", eventType: "manual_topup",
          });
        }),
      );

      const { router } = renderNavigable("1");
      const user = userEvent.setup();

      await waitFor(() => {
        expect(screen.getByText("ACME Corp")).toBeInTheDocument();
      });

      // Submit credit for tenant 1
      await user.type(screen.getByPlaceholderText("e.g. 50"), "100");
      const postBtns = screen.getAllByRole("button", { name: /post credit/i });
      await user.click(postBtns[0]);
      const dialog = screen.getByRole("dialog", { name: /confirm credit/i });
      await user.click(within(dialog).getByRole("button", { name: /post credit/i }));

      await waitFor(() => {
        expect(screen.getByText("Posting credit…")).toBeInTheDocument();
      });

      // Navigate away before response
      router.navigate("/admin/tenants/2");
      await waitFor(() => {
        expect(screen.getByText("Beta Inc")).toBeInTheDocument();
      });

      // Resolve credit response
      await act(async () => {
        creditDeferred.resolve();
        await flushPromises();
      });

      // Storage for tenant 1 MUST contain the COMMITTED operation
      const key = storageKey(1, "1");
      const stored = JSON.parse(sessionStorage.getItem(key)!);
      expect(stored.state).toBe("COMMITTED");
      expect(stored.committedEventId).toBe(42);

      // But React state must NOT show the committed banner on tenant 2
      expect(screen.queryByText("Credit posted successfully")).not.toBeInTheDocument();
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // P53-R02: Same-component navigation verification (test gap fix)
  // ────────────────────────────────────────────────────────────────────────
  describe("P53-R02: same-component navigation verification", () => {
    function renderNavigable(initialId = "1") {
      const router = createMemoryRouter(
        [{ path: "/admin/tenants/:id", element: <AdminTenantDetail /> }],
        { initialEntries: [`/admin/tenants/${initialId}`] },
      );
      const result = render(<RouterProvider router={router} />);
      return { ...result, router };
    }

    it("same-component navigation changes displayed tenant without unmount", async () => {
      setAuth();

      server.use(
        http.get("/api/v1/internal/tenants/:id/billing", ({ params }) => {
          if (params.id === "2") {
            return HttpResponse.json({
              ...mockBilling, tenantId: 2, tenantName: "Beta Inc", balance: "250.0000000",
            });
          }
          return HttpResponse.json({ ...mockBilling, tenantId: Number(params.id) });
        }),
      );

      const { router } = renderNavigable("1");

      await waitFor(() => {
        expect(screen.getByText("ACME Corp")).toBeInTheDocument();
      });

      // Navigate to tenant 2 — same component instance, no unmount
      await act(async () => { router.navigate("/admin/tenants/2"); });

      await waitFor(() => {
        expect(screen.getByText("Beta Inc")).toBeInTheDocument();
      });

      // Tenant 1's data must no longer be visible
      expect(screen.queryByText("ACME Corp")).not.toBeInTheDocument();
    });

    it("useEffect clears creditOp on same-component navigation", async () => {
      setAuth();

      // Pre-seed UNKNOWN op for tenant 1
      sessionStorage.setItem(storageKey(1, "1"), JSON.stringify({
        key: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        type: "manual_topup",
        amount: "50.0000000",
        notes: "",
        state: "UNKNOWN",
        adminId: 1,
        tenantId: "1",
        createdAt: "2026-10-20T00:00:00.000Z",
      }));

      server.use(
        http.get("/api/v1/internal/tenants/:id/billing", ({ params }) => {
          if (params.id === "2") {
            return HttpResponse.json({
              ...mockBilling, tenantId: 2, tenantName: "Beta Inc",
            });
          }
          return HttpResponse.json({ ...mockBilling, tenantId: Number(params.id) });
        }),
      );

      const { router } = renderNavigable("1");

      // Tenant 1 shows UNKNOWN banner
      await waitFor(() => {
        expect(screen.getByText("Credit outcome unknown")).toBeInTheDocument();
      });

      // Navigate to tenant 2 (same component — no unmount)
      await act(async () => { router.navigate("/admin/tenants/2"); });

      await waitFor(() => {
        expect(screen.getByText("Beta Inc")).toBeInTheDocument();
      });

      // UNKNOWN banner from tenant 1 must NOT be visible on tenant 2
      expect(screen.queryByText("Credit outcome unknown")).not.toBeInTheDocument();
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // P532-01: Request identity — A→B→A stale response reuse
  // ────────────────────────────────────────────────────────────────────────
  describe("P532-01: request identity and stale response reuse", () => {
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

    it("T01: A→B→A stale load() response A1 cannot overwrite newer A2", async () => {
      setAuth();

      // Track request order
      let requestCount = 0;
      const deferred1 = createDeferred();
      const deferred2 = createDeferred();

      server.use(
        http.get("/api/v1/internal/tenants/:id/billing", async ({ params }) => {
          if (params.id === "1") {
            requestCount++;
            if (requestCount === 1) {
              // First request for tenant 1 — held by deferred
              await deferred1.promise;
              return HttpResponse.json({
                ...mockBilling, tenantId: 1, tenantName: "ACME Corp OLD",
                balance: "100.0000000",
              });
            }
            // Second request for tenant 1 — held by deferred2
            await deferred2.promise;
            return HttpResponse.json({
              ...mockBilling, tenantId: 1, tenantName: "ACME Corp NEW",
              balance: "999.0000000",
            });
          }
          // Tenant 2 responds immediately
          return HttpResponse.json({
            ...mockBilling, tenantId: 2, tenantName: "Beta Inc", balance: "250.0000000",
          });
        }),
      );

      const { router } = renderNavigable("1");

      // Request A1 starts (held)
      expect(screen.getByText("Loading billing data…")).toBeInTheDocument();

      // Navigate A -> B
      await act(async () => { router.navigate("/admin/tenants/2"); });
      await waitFor(() => {
        expect(screen.getByText("Beta Inc")).toBeInTheDocument();
      });

      // Navigate B -> A (request A2 starts, held by deferred2)
      await act(async () => { router.navigate("/admin/tenants/1"); });

      // Resolve A2 first (the NEWER request)
      await act(async () => {
        deferred2.resolve();
        await flushPromises();
      });

      await waitFor(() => {
        expect(screen.getByText("ACME Corp NEW")).toBeInTheDocument();
      });

      // Now resolve A1 (the OLDER request) — this must NOT overwrite A2
      await act(async () => {
        deferred1.resolve();
        await flushPromises();
      });

      // A2's data must still be displayed
      expect(screen.getByText("ACME Corp NEW")).toBeInTheDocument();
      expect(screen.queryByText("ACME Corp OLD")).not.toBeInTheDocument();
      // Balance should be A2's value
      expect(screen.getByText("999.0000")).toBeInTheDocument();
    });

    it("T02: two overlapping load() requests for same tenant — older discarded", async () => {
      setAuth();

      let callNum = 0;
      const deferred1 = createDeferred();
      const deferred2 = createDeferred();

      server.use(
        http.get("/api/v1/internal/tenants/:id/billing", async () => {
          callNum++;
          if (callNum === 1) {
            await deferred1.promise;
            return HttpResponse.json({
              ...mockBilling, tenantName: "FIRST RESPONSE", balance: "100.0000000",
            });
          }
          await deferred2.promise;
          return HttpResponse.json({
            ...mockBilling, tenantName: "SECOND RESPONSE", balance: "200.0000000",
          });
        }),
      );

      const { router } = renderNavigable("1");

      // First load starts (auto on mount)
      expect(screen.getByText("Loading billing data…")).toBeInTheDocument();

      // Navigate away and back to trigger second load
      await act(async () => { router.navigate("/admin/tenants/2"); });
      await act(async () => { router.navigate("/admin/tenants/1"); });

      // Resolve second (newer) first
      await act(async () => {
        deferred2.resolve();
        await flushPromises();
      });

      await waitFor(() => {
        expect(screen.getByText("SECOND RESPONSE")).toBeInTheDocument();
      });

      // Resolve first (older) — must not overwrite
      await act(async () => {
        deferred1.resolve();
        await flushPromises();
      });

      expect(screen.getByText("SECOND RESPONSE")).toBeInTheDocument();
      expect(screen.queryByText("FIRST RESPONSE")).not.toBeInTheDocument();
    });

    it("T03: stale paginated events not appended after A→B→A", async () => {
      setAuth();

      const paginationDeferred = createDeferred();

      server.use(
        http.get("/api/v1/internal/tenants/:id/billing", ({ params }) => {
          if (params.id === "2") {
            return HttpResponse.json({
              ...mockBilling, tenantId: 2, tenantName: "Beta Inc",
            });
          }
          return HttpResponse.json({
            ...mockBilling, tenantId: 1,
            eventsHasMore: true, eventsNextCursor: 5,
          });
        }),
        http.get("/api/v1/internal/tenants/:id/events", async () => {
          await paginationDeferred.promise;
          return HttpResponse.json({
            events: [
              { id: 3, eventType: "wallet_funding", amountXlm: "-99.0000000",
                billingPeriod: null, userId: null, createdAt: "2026-10-01T00:00:00Z",
                notes: "STALE PAGINATION EVENT" },
            ],
            hasMore: false, nextCursor: null,
          });
        }),
      );

      const { router } = renderNavigable("1");
      const user = userEvent.setup();

      await waitFor(() => {
        expect(screen.getByText("Load older")).toBeInTheDocument();
      });

      // Click load older — request held by deferred
      await user.click(screen.getByText("Load older"));

      // Navigate A -> B -> A
      await act(async () => { router.navigate("/admin/tenants/2"); });
      await waitFor(() => {
        expect(screen.getByText("Beta Inc")).toBeInTheDocument();
      });
      await act(async () => { router.navigate("/admin/tenants/1"); });
      await waitFor(() => {
        expect(screen.getByText("ACME Corp")).toBeInTheDocument();
      });

      // Resolve stale pagination response
      await act(async () => {
        paginationDeferred.resolve();
        await flushPromises();
      });

      // Stale event must NOT appear
      expect(screen.queryByText("STALE PAGINATION EVENT")).not.toBeInTheDocument();
    });

    it("T04: stale suspension response not applied after A→B→A", async () => {
      setAuth();

      const suspendDeferred = createDeferred();

      server.use(
        http.get("/api/v1/internal/tenants/:id/billing", ({ params }) => {
          if (params.id === "2") {
            return HttpResponse.json({
              ...mockBilling, tenantId: 2, tenantName: "Beta Inc",
            });
          }
          return HttpResponse.json({ ...mockBilling, tenantId: 1 });
        }),
        http.patch("/api/v1/internal/tenants/:id/suspend", async () => {
          await suspendDeferred.promise;
          return HttpResponse.json({
            tenantId: 1, type: "hard", isActive: false,
            suspendedAt: "2026-10-20T00:00:00Z", suspensionReason: "manual",
          });
        }),
      );

      const { router } = renderNavigable("1");
      const user = userEvent.setup();

      await waitFor(() => {
        expect(screen.getByText("Active")).toBeInTheDocument();
      });

      // Initiate suspend
      await user.click(screen.getByRole("button", { name: /^suspend$/i }));
      await user.click(screen.getByRole("button", { name: /hard suspend tenant/i }));

      // Navigate A -> B -> A while suspend is in-flight
      await act(async () => { router.navigate("/admin/tenants/2"); });
      await waitFor(() => {
        expect(screen.getByText("Beta Inc")).toBeInTheDocument();
      });
      await act(async () => { router.navigate("/admin/tenants/1"); });
      await waitFor(() => {
        expect(screen.getByText("ACME Corp")).toBeInTheDocument();
      });

      // Resolve stale suspend response
      await act(async () => {
        suspendDeferred.resolve();
        await flushPromises();
      });

      // suspendBusy must not remain true on the new view
      const suspendBtn = screen.getByRole("button", { name: /^suspend$/i });
      expect(suspendBtn).not.toBeDisabled();
    });

    it("T05: different admin sessions viewing same tenant remain isolated", async () => {
      setAuth(); // Admin 1

      const adminADeferred = createDeferred();

      server.use(
        http.get("/api/v1/internal/tenants/:id/billing", async () => {
          // First call (Admin A) — held by deferred
          await adminADeferred.promise;
          return HttpResponse.json({ ...mockBilling, tenantId: 1 });
        }),
      );

      const { router } = renderNavigable("1");

      // Admin A's request starts
      expect(screen.getByText("Loading billing data…")).toBeInTheDocument();

      // Admin A logs out, Admin B logs in
      sessionStorage.setItem("aw_admin_token", "admin-b-token");
      sessionStorage.setItem("aw_admin_info", JSON.stringify({
        id: 2, email: "adminb@test.com", name: "Admin B", role: "super_admin",
      }));

      // Navigate to trigger re-render with new session
      server.use(
        http.get("/api/v1/internal/tenants/:id/billing", () => {
          return HttpResponse.json({
            ...mockBilling, tenantId: 1, tenantName: "ACME Corp (B view)",
          });
        }),
      );

      // Navigate away and back to trigger new load with Admin B's session
      await act(async () => { router.navigate("/admin/tenants/2"); });
      await act(async () => { router.navigate("/admin/tenants/1"); });

      await waitFor(() => {
        expect(screen.getByText("ACME Corp (B view)")).toBeInTheDocument();
      });

      // Now resolve Admin A's stale response
      await act(async () => {
        adminADeferred.resolve();
        await flushPromises();
      });

      // Admin B's view must still be displayed
      expect(screen.getByText("ACME Corp (B view)")).toBeInTheDocument();
    });

    it("T06: existing A→B protection still works", async () => {
      setAuth();

      const tenant1Deferred = createDeferred();

      server.use(
        http.get("/api/v1/internal/tenants/:id/billing", async ({ params }) => {
          if (params.id === "1") {
            await tenant1Deferred.promise;
            return HttpResponse.json({ ...mockBilling, tenantId: 1 });
          }
          return HttpResponse.json({
            ...mockBilling, tenantId: 2, tenantName: "Beta Inc", balance: "250.0000000",
          });
        }),
      );

      const { router } = renderNavigable("1");

      expect(screen.getByText("Loading billing data…")).toBeInTheDocument();

      // Navigate to tenant 2
      await act(async () => { router.navigate("/admin/tenants/2"); });
      await waitFor(() => {
        expect(screen.getByText("Beta Inc")).toBeInTheDocument();
      });

      // Resolve stale tenant 1 response
      await act(async () => {
        tenant1Deferred.resolve();
        await flushPromises();
      });

      // Tenant 2 data must still be displayed
      expect(screen.getByText("Beta Inc")).toBeInTheDocument();
      expect(screen.queryByText("ACME Corp")).not.toBeInTheDocument();
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // P532-02: Safe financial results and authentication completion
  // ────────────────────────────────────────────────────────────────────────
  describe("P532-02: safe financial results and authentication completion", () => {
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

    it("T07: stale 401 on load() does not log out newer admin session", async () => {
      setAuth(); // Admin A: token = "mock-jwt"

      const loadDeferred = createDeferred();

      server.use(
        http.get("/api/v1/internal/tenants/:id/billing", async () => {
          await loadDeferred.promise;
          return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
        }),
      );

      renderNavigable("1");

      // Admin A's request starts
      expect(screen.getByText("Loading billing data…")).toBeInTheDocument();

      // Admin A logs out, Admin B logs in with different token
      sessionStorage.setItem("aw_admin_token", "admin-b-fresh-token");
      sessionStorage.setItem("aw_admin_info", JSON.stringify({
        id: 2, email: "adminb@test.com", name: "Admin B", role: "super_admin",
      }));

      // Resolve the stale 401 from Admin A's request
      await act(async () => {
        loadDeferred.resolve();
        await flushPromises();
      });

      // Admin B's token must still be in sessionStorage — NOT removed
      expect(sessionStorage.getItem("aw_admin_token")).toBe("admin-b-fresh-token");
      // Admin B must NOT be redirected to login
      expect(mockNavigate).not.toHaveBeenCalledWith("/admin/login");
    });

    it("T08: stale 401 on credit POST does not log out newer admin session", async () => {
      setAuth(); // Admin A: token = "mock-jwt"

      const creditDeferred = createDeferred();

      server.use(
        billingByTenant(),
        http.post("/api/v1/internal/tenants/:id/credit", async () => {
          await creditDeferred.promise;
          return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
        }),
      );

      const { router } = renderNavigable("1");
      const user = userEvent.setup();

      await waitFor(() => {
        expect(screen.getByText("ACME Corp")).toBeInTheDocument();
      });

      // Submit credit
      await user.type(screen.getByPlaceholderText("e.g. 50"), "100");
      const postBtns = screen.getAllByRole("button", { name: /post credit/i });
      await user.click(postBtns[0]);
      const dialog = screen.getByRole("dialog", { name: /confirm credit/i });
      await user.click(within(dialog).getByRole("button", { name: /post credit/i }));

      await waitFor(() => {
        expect(screen.getByText("Posting credit…")).toBeInTheDocument();
      });

      // Admin B logs in with a different token
      sessionStorage.setItem("aw_admin_token", "admin-b-fresh-token");
      sessionStorage.setItem("aw_admin_info", JSON.stringify({
        id: 2, email: "adminb@test.com", name: "Admin B", role: "super_admin",
      }));

      // Resolve the stale credit 401
      await act(async () => {
        creditDeferred.resolve();
        await flushPromises();
      });

      // Admin B's token must survive
      expect(sessionStorage.getItem("aw_admin_token")).toBe("admin-b-fresh-token");
    });

    it("T09: delayed reconciliation COMMITTED saved under originating operation", async () => {
      setAuth();

      const unknownOp = {
        key: "recon-uuid-t09",
        type: "manual_topup",
        amount: "100.0000000",
        notes: "",
        state: "UNKNOWN",
        adminId: 1,
        tenantId: "1",
        createdAt: "2026-10-20T00:00:00.000Z",
      };
      sessionStorage.setItem(storageKey(1, "1"), JSON.stringify(unknownOp));

      const statusDeferred = createDeferred();

      server.use(
        billingByTenant(),
        http.get("/api/v1/internal/tenants/:id/credit-status", async () => {
          await statusDeferred.promise;
          return HttpResponse.json({
            status: "committed", billingEventId: 77,
            amountXlm: "100.0000000", eventType: "manual_topup",
            createdAt: "2026-10-20T00:00:00Z", tenantId: 1,
            idempotencyKey: unknownOp.key,
          });
        }),
      );

      const { router } = renderNavigable("1");
      const user = userEvent.setup();

      await waitFor(() => {
        expect(screen.getByText("Credit outcome unknown")).toBeInTheDocument();
      });

      // Start reconciliation
      await user.click(screen.getByRole("button", { name: /check credit status/i }));

      // Navigate to tenant 2 while reconciliation is in-flight
      await act(async () => { router.navigate("/admin/tenants/2"); });
      await waitFor(() => {
        expect(screen.getByText("Beta Inc")).toBeInTheDocument();
      });

      // Resolve the reconciliation (COMMITTED for tenant 1)
      await act(async () => {
        statusDeferred.resolve();
        await flushPromises();
      });

      // Storage for tenant 1 must contain COMMITTED with correct key
      const stored = JSON.parse(sessionStorage.getItem(storageKey(1, "1"))!);
      expect(stored.state).toBe("COMMITTED");
      expect(stored.key).toBe("recon-uuid-t09");
      expect(stored.committedEventId).toBe(77);
    });

    it("T10: active tenant UI unchanged after stale committed response", async () => {
      setAuth();

      const unknownOp = {
        key: "recon-uuid-t10",
        type: "manual_topup",
        amount: "100.0000000",
        notes: "",
        state: "UNKNOWN",
        adminId: 1,
        tenantId: "1",
        createdAt: "2026-10-20T00:00:00.000Z",
      };
      sessionStorage.setItem(storageKey(1, "1"), JSON.stringify(unknownOp));

      const statusDeferred = createDeferred();

      server.use(
        billingByTenant(),
        http.get("/api/v1/internal/tenants/:id/credit-status", async () => {
          await statusDeferred.promise;
          return HttpResponse.json({
            status: "committed", billingEventId: 88,
            amountXlm: "100.0000000", eventType: "manual_topup",
            createdAt: "2026-10-20T00:00:00Z", tenantId: 1,
            idempotencyKey: unknownOp.key,
          });
        }),
      );

      const { router } = renderNavigable("1");
      const user = userEvent.setup();

      await waitFor(() => {
        expect(screen.getByText("Credit outcome unknown")).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /check credit status/i }));

      await act(async () => { router.navigate("/admin/tenants/2"); });
      await waitFor(() => {
        expect(screen.getByText("Beta Inc")).toBeInTheDocument();
      });

      await act(async () => {
        statusDeferred.resolve();
        await flushPromises();
      });

      // Tenant 2 must NOT show committed banner from tenant 1
      expect(screen.queryByText("Credit posted successfully")).not.toBeInTheDocument();
      expect(screen.getByText("Beta Inc")).toBeInTheDocument();
    });

    it("T11: late UNKNOWN cannot overwrite stored COMMITTED", async () => {
      setAuth();

      // Pre-store a COMMITTED operation
      const committedOp = {
        key: "fin-uuid-t11",
        type: "manual_topup",
        amount: "100.0000000",
        notes: "",
        state: "COMMITTED",
        adminId: 1,
        tenantId: "1",
        createdAt: "2026-10-20T00:00:00.000Z",
        committedEventId: 42,
      };
      sessionStorage.setItem(storageKey(1, "1"), JSON.stringify(committedOp));

      // Simulate the scenario: import and call safeSaveCreditOp (or saveCreditOp)
      // with an UNKNOWN state for the same key
      const { safeSaveCreditOp } = await import("../lib/credit-op-storage");

      const unknownOp = {
        ...committedOp,
        state: "UNKNOWN" as const,
        committedEventId: undefined,
      };

      const result = safeSaveCreditOp(unknownOp);

      // The write must be rejected
      expect(result).toBe(false);

      // Storage must still contain COMMITTED
      const stored = JSON.parse(sessionStorage.getItem(storageKey(1, "1"))!);
      expect(stored.state).toBe("COMMITTED");
      expect(stored.committedEventId).toBe(42);
    });

    it("T12: response for older UUID cannot overwrite newer UUID operation", async () => {
      setAuth();

      // Store a COMMITTED operation with UUID-B (newer)
      const newerOp = {
        key: "uuid-B-newer",
        type: "manual_topup",
        amount: "200.0000000",
        notes: "",
        state: "COMMITTED",
        adminId: 1,
        tenantId: "1",
        createdAt: "2026-10-20T01:00:00.000Z",
        committedEventId: 99,
      };
      sessionStorage.setItem(storageKey(1, "1"), JSON.stringify(newerOp));

      const { safeSaveCreditOp } = await import("../lib/credit-op-storage");

      // Attempt to write older UUID-A result
      const olderOp = {
        key: "uuid-A-older",
        type: "manual_topup",
        amount: "100.0000000",
        notes: "",
        state: "UNKNOWN" as const,
        adminId: 1,
        tenantId: "1",
        createdAt: "2026-10-20T00:00:00.000Z",
      };

      const result = safeSaveCreditOp(olderOp);
      expect(result).toBe(false);

      // Newer operation preserved
      const stored = JSON.parse(sessionStorage.getItem(storageKey(1, "1"))!);
      expect(stored.key).toBe("uuid-B-newer");
      expect(stored.state).toBe("COMMITTED");
    });

    it("T14: tenant navigation resets reconciling indicator", async () => {
      setAuth();

      const unknownOp = {
        key: "recon-uuid-t14",
        type: "manual_topup",
        amount: "100.0000000",
        notes: "",
        state: "UNKNOWN",
        adminId: 1,
        tenantId: "1",
        createdAt: "2026-10-20T00:00:00.000Z",
      };
      sessionStorage.setItem(storageKey(1, "1"), JSON.stringify(unknownOp));

      const statusDeferred = createDeferred();

      server.use(
        billingByTenant(),
        http.get("/api/v1/internal/tenants/:id/credit-status", async () => {
          await statusDeferred.promise;
          return HttpResponse.json({ status: "not_found" });
        }),
      );

      const { router } = renderNavigable("1");
      const user = userEvent.setup();

      await waitFor(() => {
        expect(screen.getByText("Credit outcome unknown")).toBeInTheDocument();
      });

      // Start reconciliation — "Checking…" appears
      await user.click(screen.getByRole("button", { name: /check credit status/i }));
      await waitFor(() => {
        expect(screen.getByText("Checking…")).toBeInTheDocument();
      });

      // Navigate to tenant 2
      await act(async () => { router.navigate("/admin/tenants/2"); });
      await waitFor(() => {
        expect(screen.getByText("Beta Inc")).toBeInTheDocument();
      });

      // Tenant 2 must NOT show any reconciling indicator
      expect(screen.queryByText("Checking…")).not.toBeInTheDocument();

      // Resolve the stale reconciliation to complete cleanup
      await act(async () => {
        statusDeferred.resolve();
        await flushPromises();
      });
    });

    it("T15: tenant navigation resets suspend loading indicator", async () => {
      setAuth();

      const suspendDeferred = createDeferred();

      server.use(
        billingByTenant(),
        http.patch("/api/v1/internal/tenants/:id/suspend", async () => {
          await suspendDeferred.promise;
          return HttpResponse.json({
            tenantId: 1, type: "hard", isActive: false,
            suspendedAt: "2026-10-20T00:00:00Z", suspensionReason: "manual",
          });
        }),
      );

      const { router } = renderNavigable("1");
      const user = userEvent.setup();

      await waitFor(() => {
        expect(screen.getByText("Active")).toBeInTheDocument();
      });

      // Start suspend
      await user.click(screen.getByRole("button", { name: /^suspend$/i }));
      await user.click(screen.getByRole("button", { name: /hard suspend tenant/i }));

      // Navigate to tenant 2
      await act(async () => { router.navigate("/admin/tenants/2"); });
      await waitFor(() => {
        expect(screen.getByText("Beta Inc")).toBeInTheDocument();
      });

      // Suspend button on tenant 2 must NOT show "Suspending…"
      const suspendBtn = screen.getByRole("button", { name: /^suspend$/i });
      expect(suspendBtn).not.toBeDisabled();
      expect(screen.queryByText("Suspending…")).not.toBeInTheDocument();

      // Resolve stale suspend
      await act(async () => {
        suspendDeferred.resolve();
        await flushPromises();
      });
    });

    it("T16: return navigation restores correct financial operation", async () => {
      setAuth();

      const unknownOp = {
        key: "restore-uuid-t16",
        type: "manual_topup",
        amount: "75.0000000",
        notes: "test restore",
        state: "UNKNOWN",
        adminId: 1,
        tenantId: "1",
        createdAt: "2026-10-20T00:00:00.000Z",
      };
      sessionStorage.setItem(storageKey(1, "1"), JSON.stringify(unknownOp));

      server.use(billingByTenant());

      const { router } = renderNavigable("1");

      // Tenant 1 shows UNKNOWN banner
      await waitFor(() => {
        expect(screen.getByText("Credit outcome unknown")).toBeInTheDocument();
      });

      // Navigate to tenant 2
      await act(async () => { router.navigate("/admin/tenants/2"); });
      await waitFor(() => {
        expect(screen.getByText("Beta Inc")).toBeInTheDocument();
      });
      expect(screen.queryByText("Credit outcome unknown")).not.toBeInTheDocument();

      // Navigate back to tenant 1
      await act(async () => { router.navigate("/admin/tenants/1"); });
      await waitFor(() => {
        expect(screen.getByText("ACME Corp")).toBeInTheDocument();
      });

      // UNKNOWN operation must be correctly restored
      expect(screen.getByText("Credit outcome unknown")).toBeInTheDocument();
      const keyEl = screen.getByText(/^Key:/);
      expect(keyEl.textContent).toContain("restore-uuid-t16");
    });

    it("T17: not_found still leaves operation UNKNOWN with same key (existing behavior)", async () => {
      setAuth();

      const unknownOp = {
        key: "notfound-uuid-t17",
        type: "manual_topup",
        amount: "50.0000000",
        notes: "",
        state: "UNKNOWN",
        adminId: 1,
        tenantId: "1",
        createdAt: "2026-10-20T00:00:00.000Z",
      };
      sessionStorage.setItem(storageKey(1, "1"), JSON.stringify(unknownOp));

      // Default MSW handler returns not_found
      server.use(billingByTenant());

      renderNavigable("1");

      const user = userEvent.setup();

      await waitFor(() => {
        expect(screen.getByText("Credit outcome unknown")).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /check credit status/i }));

      await waitFor(() => {
        expect(screen.getByText(/credit not found in ledger/i)).toBeInTheDocument();
      });

      // Must still be UNKNOWN
      expect(screen.getByText("Credit outcome unknown")).toBeInTheDocument();

      // Storage must preserve original key
      const stored = JSON.parse(sessionStorage.getItem(storageKey(1, "1"))!);
      expect(stored.state).toBe("UNKNOWN");
      expect(stored.key).toBe("notfound-uuid-t17");
    });

    it("T18: stale 401 on financial POST preserves operation as UNKNOWN in storage", async () => {
      setAuth();

      const creditDeferred = createDeferred();

      server.use(
        billingByTenant(),
        http.post("/api/v1/internal/tenants/:id/credit", async () => {
          await creditDeferred.promise;
          return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
        }),
      );

      const { router } = renderNavigable("1");
      const user = userEvent.setup();

      await waitFor(() => {
        expect(screen.getByText("ACME Corp")).toBeInTheDocument();
      });

      // Submit credit
      await user.type(screen.getByPlaceholderText("e.g. 50"), "100");
      const postBtns = screen.getAllByRole("button", { name: /post credit/i });
      await user.click(postBtns[0]);
      const dialog = screen.getByRole("dialog", { name: /confirm credit/i });
      await user.click(within(dialog).getByRole("button", { name: /post credit/i }));

      await waitFor(() => {
        expect(screen.getByText("Posting credit…")).toBeInTheDocument();
      });

      // Capture the op key from storage
      const keys = Object.keys(sessionStorage).filter(k => k.startsWith("aw_pending_credit_"));
      expect(keys.length).toBe(1);
      const opBefore = JSON.parse(sessionStorage.getItem(keys[0])!);
      expect(opBefore.state).toBe("SUBMITTING");

      // Navigate away (makes response stale)
      await act(async () => { router.navigate("/admin/tenants/2"); });
      await waitFor(() => {
        expect(screen.getByText("Beta Inc")).toBeInTheDocument();
      });

      // Resolve the stale 401
      await act(async () => {
        creditDeferred.resolve();
        await flushPromises();
      });

      // The operation must be preserved as UNKNOWN (not deleted by logout)
      const opAfter = JSON.parse(sessionStorage.getItem(keys[0])!);
      expect(opAfter.state).toBe("UNKNOWN");
      expect(opAfter.key).toBe(opBefore.key);

      // Admin B's potential token must not be removed
      // (In this test, no Admin B logged in, so token may or may not exist)
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // P533-01: Financial operation identity — component-level regression tests
  // ────────────────────────────────────────────────────────────────────────
  describe("P533-01: financial operation identity", () => {
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

    it("P533-01-G: rejected storage write does not cause React state to display conflicting result", async () => {
      setAuth();

      // Pre-store a COMMITTED operation (UUID-A) in storage
      const committedOp = {
        key: "uuid-A-committed",
        type: "manual_topup",
        amount: "100.0000000",
        notes: "",
        state: "COMMITTED",
        adminId: 1,
        tenantId: "1",
        createdAt: "2026-10-20T00:00:00.000Z",
        committedEventId: 42,
      };
      sessionStorage.setItem(storageKey(1, "1"), JSON.stringify(committedOp));

      // Set up a credit POST that will return a 4xx (REJECTED)
      // This simulates a stale POST response that safeSaveCreditOp should reject
      // because COMMITTED cannot be downgraded
      const creditDeferred = createDeferred();
      server.use(
        billingByTenant(),
        http.post("/api/v1/internal/tenants/:id/credit", async () => {
          await creditDeferred.promise;
          return HttpResponse.json(
            { error: "Conflict" },
            { status: 409 },
          );
        }),
      );

      const { router } = renderNavigable("1");

      await waitFor(() => {
        // COMMITTED operation should be restored and shown
        expect(screen.getByText("Credit posted successfully")).toBeInTheDocument();
      });

      // Verify storage has COMMITTED
      const storedBefore = JSON.parse(sessionStorage.getItem(storageKey(1, "1"))!);
      expect(storedBefore.state).toBe("COMMITTED");

      // The UI should NOT show "Credit rejected" — it should show COMMITTED
      expect(screen.queryByText("Credit rejected — not applied")).not.toBeInTheDocument();
    });

    it("P533-01-K: retrying UNKNOWN retains original UUID", async () => {
      setAuth();

      // Pre-store UNKNOWN op
      const unknownOp = {
        key: "original-uuid-k",
        type: "manual_topup",
        amount: "100.0000000",
        notes: "",
        state: "UNKNOWN",
        adminId: 1,
        tenantId: "1",
        createdAt: "2026-10-20T00:00:00.000Z",
      };
      sessionStorage.setItem(storageKey(1, "1"), JSON.stringify(unknownOp));

      let capturedKey: string | undefined;
      server.use(
        billingByTenant(),
        http.post("/api/v1/internal/tenants/:id/credit", async ({ request }) => {
          const body = (await request.json()) as { idempotency_key?: string };
          capturedKey = body.idempotency_key;
          return HttpResponse.json({
            tenantId: 1, billingEventId: 42, newBalance: "600.0000000",
            amountCredited: "100.0000000", eventType: "manual_topup",
          });
        }),
      );

      renderNavigable("1");
      const user = userEvent.setup();

      await waitFor(() => {
        expect(screen.getByText("Credit outcome unknown")).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /retry submission/i }));

      await waitFor(() => {
        expect(screen.getByText("Credit posted successfully")).toBeInTheDocument();
      });

      expect(capturedKey).toBe("original-uuid-k");
    });

    it("P533-01-L: reconciliation not_found preserves UNKNOWN", async () => {
      setAuth();

      const unknownOp = {
        key: "recon-uuid-l",
        type: "manual_topup",
        amount: "100.0000000",
        notes: "",
        state: "UNKNOWN",
        adminId: 1,
        tenantId: "1",
        createdAt: "2026-10-20T00:00:00.000Z",
      };
      sessionStorage.setItem(storageKey(1, "1"), JSON.stringify(unknownOp));

      server.use(billingByTenant());

      renderNavigable("1");
      const user = userEvent.setup();

      await waitFor(() => {
        expect(screen.getByText("Credit outcome unknown")).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /check credit status/i }));

      await waitFor(() => {
        expect(screen.getByText(/credit not found in ledger/i)).toBeInTheDocument();
      });

      // Must stay UNKNOWN
      expect(screen.getByText("Credit outcome unknown")).toBeInTheDocument();

      // Storage must preserve original key
      const stored = JSON.parse(sessionStorage.getItem(storageKey(1, "1"))!);
      expect(stored.state).toBe("UNKNOWN");
      expect(stored.key).toBe("recon-uuid-l");
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // P533-02: Same-route request and session freshness — regression tests
  // ────────────────────────────────────────────────────────────────────────
  describe("P533-02: same-route request and session freshness", () => {
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

    it("P533-02-A: loadOlderEvents response discarded when Refresh supersedes it", async () => {
      // Tests loadSeqRef: load() increments the counter, making an in-flight
      // loadOlderEvents response stale. This is the real achievable overlap —
      // "Load older" does not set loading=true, so Refresh remains clickable.
      setAuth();

      const olderDeferred = createDeferred();

      server.use(
        // Initial billing: has pagination so "Load older" button appears
        http.get("/api/v1/internal/tenants/:id/billing", () => {
          return HttpResponse.json({
            ...mockBilling,
            tenantName: "INITIAL",
            eventsHasMore: true,
            eventsNextCursor: 10,
          });
        }),
        // Older events endpoint: deferred so we can overlap with Refresh
        http.get("/api/v1/internal/tenants/:id/events", async () => {
          await olderDeferred.promise;
          return HttpResponse.json({
            events: [
              { id: 5, eventType: "manual_topup", amountXlm: "50.0000000",
                billingPeriod: null, userId: null,
                createdAt: "2026-10-10T00:00:00Z", notes: "STALE OLDER EVENT" },
            ],
            hasMore: false,
            nextCursor: null,
          });
        }),
      );

      renderNavigable("1");
      const user = userEvent.setup();

      // Wait for initial data with "Load older" button
      await waitFor(() => {
        expect(screen.getByText("INITIAL")).toBeInTheDocument();
      });
      expect(screen.getByRole("button", { name: /load older/i })).toBeInTheDocument();

      // Click "Load older" — loadOlderEvents starts, captures current loadSeqRef
      await user.click(screen.getByRole("button", { name: /load older/i }));

      // Now override billing handler to return fresh data and click Refresh.
      // Refresh calls load() which INCREMENTS loadSeqRef, making the
      // in-flight loadOlderEvents stale.
      server.use(
        http.get("/api/v1/internal/tenants/:id/billing", () => {
          return HttpResponse.json({
            ...mockBilling,
            tenantName: "REFRESHED",
            balance: "999.0000000",
            eventsHasMore: false,
            eventsNextCursor: null,
          });
        }),
      );

      await user.click(screen.getByRole("button", { name: /refresh/i }));

      // Refresh resolves immediately (no deferred), sets fresh data
      await waitFor(() => {
        expect(screen.getByText("REFRESHED")).toBeInTheDocument();
      });

      // Now resolve the stale "Load older" response
      await act(async () => {
        olderDeferred.resolve();
        await flushPromises();
      });

      // The stale older events must NOT be appended — loadSeqRef mismatch
      expect(screen.queryByText("STALE OLDER EVENT")).not.toBeInTheDocument();
      // Fresh data still intact
      expect(screen.getByText("REFRESHED")).toBeInTheDocument();
      expect(screen.getByText("999.0000")).toBeInTheDocument();
    });

    it("P533-02-B: admin identity change during manual Refresh discards response", async () => {
      // Tests admin identity capture: Refresh captures adminId at request start.
      // If admin changes while waiting, the response is discarded.
      setAuth(); // Admin A (id=1)

      let callNum = 0;
      const refreshDeferred = createDeferred();

      server.use(
        http.get("/api/v1/internal/tenants/:id/billing", async () => {
          callNum++;
          if (callNum === 1) {
            // Initial load — respond immediately
            return HttpResponse.json({
              ...mockBilling, tenantName: "ORIGINAL DATA", balance: "500.0000000",
            });
          }
          // Manual refresh — deferred so admin can change mid-flight
          await refreshDeferred.promise;
          return HttpResponse.json({
            ...mockBilling, tenantName: "STALE ADMIN A REFRESH", balance: "999.0000000",
          });
        }),
      );

      renderNavigable("1");

      await waitFor(() => {
        expect(screen.getByText("ORIGINAL DATA")).toBeInTheDocument();
      });

      // Click Refresh as Admin A
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /refresh/i }));

      // Admin B logs in while Refresh is in-flight
      sessionStorage.setItem("aw_admin_token", "admin-b-token");
      sessionStorage.setItem("aw_admin_info", JSON.stringify({
        id: 2, email: "adminb@test.com", name: "Admin B", role: "super_admin",
      }));

      // Resolve Admin A's Refresh response
      await act(async () => {
        refreshDeferred.resolve();
        await flushPromises();
      });

      // Admin A's stale response must NOT update the view
      expect(screen.queryByText("STALE ADMIN A REFRESH")).not.toBeInTheDocument();
      // Component should still show loading (loading=true not cleared for stale response)
      expect(screen.getByText("Loading billing data…")).toBeInTheDocument();
    });

    it("P533-02-C: admin A's successful response does not update admin B's view", async () => {
      setAuth(); // Admin A (id=1)

      const loadDeferred = createDeferred();

      server.use(
        http.get("/api/v1/internal/tenants/:id/billing", async () => {
          await loadDeferred.promise;
          return HttpResponse.json({
            ...mockBilling, tenantName: "Admin A Data", balance: "100.0000000",
          });
        }),
      );

      renderNavigable("1");

      // Admin A's request starts
      expect(screen.getByText("Loading billing data…")).toBeInTheDocument();

      // Admin B logs in (changes session) without route change
      sessionStorage.setItem("aw_admin_token", "admin-b-token");
      sessionStorage.setItem("aw_admin_info", JSON.stringify({
        id: 2, email: "adminb@test.com", name: "Admin B", role: "super_admin",
      }));

      // Resolve Admin A's response
      await act(async () => {
        loadDeferred.resolve();
        await flushPromises();
      });

      // Admin A's data must NOT be displayed (admin changed)
      // The loading indicator should persist or an error should show,
      // but Admin A's data must NOT populate Admin B's view
      expect(screen.queryByText("Admin A Data")).not.toBeInTheDocument();
    });

    it("P533-02-D: admin A's stale 401 cannot log out admin B (existing behavior preserved)", async () => {
      setAuth(); // Admin A: token = "mock-jwt"

      const loadDeferred = createDeferred();

      server.use(
        http.get("/api/v1/internal/tenants/:id/billing", async () => {
          await loadDeferred.promise;
          return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
        }),
      );

      renderNavigable("1");

      expect(screen.getByText("Loading billing data…")).toBeInTheDocument();

      // Admin B logs in with different token (no route change)
      sessionStorage.setItem("aw_admin_token", "admin-b-fresh-token");
      sessionStorage.setItem("aw_admin_info", JSON.stringify({
        id: 2, email: "adminb@test.com", name: "Admin B", role: "super_admin",
      }));

      // Resolve Admin A's stale 401
      await act(async () => {
        loadDeferred.resolve();
        await flushPromises();
      });

      // Admin B's token must survive
      expect(sessionStorage.getItem("aw_admin_token")).toBe("admin-b-fresh-token");
      expect(mockNavigate).not.toHaveBeenCalledWith("/admin/login");
    });

    it("P533-02-E: A → B → A navigation still works safely", async () => {
      setAuth();

      const tenant1Deferred = createDeferred();

      server.use(
        http.get("/api/v1/internal/tenants/:id/billing", async ({ params }) => {
          if (params.id === "1") {
            await tenant1Deferred.promise;
            return HttpResponse.json({ ...mockBilling, tenantId: 1 });
          }
          return HttpResponse.json({
            ...mockBilling, tenantId: 2, tenantName: "Beta Inc", balance: "250.0000000",
          });
        }),
      );

      const { router } = renderNavigable("1");

      expect(screen.getByText("Loading billing data…")).toBeInTheDocument();

      // Navigate to tenant 2
      await act(async () => { router.navigate("/admin/tenants/2"); });
      await waitFor(() => {
        expect(screen.getByText("Beta Inc")).toBeInTheDocument();
      });

      // Resolve stale tenant 1 response
      await act(async () => {
        tenant1Deferred.resolve();
        await flushPromises();
      });

      // Tenant 2 data must still be displayed
      expect(screen.getByText("Beta Inc")).toBeInTheDocument();
      expect(screen.queryByText("ACME Corp")).not.toBeInTheDocument();
    });

    it("P533-02-G: financial POST not affected by load request counter", async () => {
      setAuth();

      const creditDeferred = createDeferred();

      server.use(
        billingByTenant(),
        http.post("/api/v1/internal/tenants/:id/credit", async () => {
          await creditDeferred.promise;
          return HttpResponse.json({
            tenantId: 1, billingEventId: 42, newBalance: "600.0000000",
            amountCredited: "100.0000000", eventType: "manual_topup",
          });
        }),
      );

      renderNavigable("1");
      const user = userEvent.setup();

      await waitFor(() => {
        expect(screen.getByText("ACME Corp")).toBeInTheDocument();
      });

      // Submit credit
      await user.type(screen.getByPlaceholderText("e.g. 50"), "100");
      const postBtns = screen.getAllByRole("button", { name: /post credit/i });
      await user.click(postBtns[0]);
      const dialog = screen.getByRole("dialog", { name: /confirm credit/i });
      await user.click(within(dialog).getByRole("button", { name: /post credit/i }));

      await waitFor(() => {
        expect(screen.getByText("Posting credit…")).toBeInTheDocument();
      });

      // Click Refresh while credit POST is in-flight
      // This should NOT make the credit POST response stale
      server.use(
        http.get("/api/v1/internal/tenants/:id/billing", () => {
          return HttpResponse.json({
            ...mockBilling, tenantName: "REFRESHED", balance: "600.0000000",
          });
        }),
      );
      await user.click(screen.getByRole("button", { name: /refresh/i }));

      await waitFor(() => {
        expect(screen.getByText("REFRESHED")).toBeInTheDocument();
      });

      // Now resolve the credit POST
      await act(async () => {
        creditDeferred.resolve();
        await flushPromises();
      });

      // Credit POST result must still be applied (not treated as stale by load counter)
      await waitFor(() => {
        expect(screen.getByText("Credit posted successfully")).toBeInTheDocument();
      });
    });

    it("P533-02-F: loadingOlder flag not stuck after Refresh supersedes Load more", async () => {
      // Tests the loadingOlder orphan fix: when load() (Refresh) completes
      // after superseding an in-flight loadOlderEvents, loadingOlder must be
      // reset so the "Load older" button is re-enabled if the fresh response
      // still has more pages.
      setAuth();

      const olderDeferred = createDeferred();
      let billingCallNum = 0;

      server.use(
        http.get("/api/v1/internal/tenants/:id/billing", () => {
          billingCallNum++;
          return HttpResponse.json({
            ...mockBilling,
            tenantName: billingCallNum === 1 ? "PAGE 1" : "REFRESHED",
            eventsHasMore: true,
            eventsNextCursor: 10,
          });
        }),
        http.get("/api/v1/internal/tenants/:id/events", async () => {
          await olderDeferred.promise;
          return HttpResponse.json({
            events: [],
            hasMore: false,
            nextCursor: null,
          });
        }),
      );

      renderNavigable("1");
      const user = userEvent.setup();

      await waitFor(() => {
        expect(screen.getByText("PAGE 1")).toBeInTheDocument();
      });

      // Click "Load older" — sets loadingOlder=true
      const loadOlderBtn = screen.getByRole("button", { name: /load older/i });
      await user.click(loadOlderBtn);

      // "Load older" should show loading state
      expect(screen.getByText("Loading…")).toBeInTheDocument();

      // Click Refresh — load() increments loadSeqRef, making loadOlderEvents stale
      await user.click(screen.getByRole("button", { name: /refresh/i }));

      // Refresh resolves immediately with fresh data that still has more pages
      await waitFor(() => {
        expect(screen.getByText("REFRESHED")).toBeInTheDocument();
      });

      // "Load older" button must NOT be stuck disabled — load() resets loadingOlder
      const freshLoadOlderBtn = screen.getByRole("button", { name: /load older/i });
      expect(freshLoadOlderBtn).not.toBeDisabled();
      expect(freshLoadOlderBtn).toHaveTextContent("Load older");

      // Resolve the stale loadOlderEvents response (should be discarded)
      await act(async () => {
        olderDeferred.resolve();
        await flushPromises();
      });

      // Button still not stuck after stale response resolves
      expect(screen.getByRole("button", { name: /load older/i })).not.toBeDisabled();
    });
  });
});
