import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { server, mockBilling } from "../test/msw-server";
import { http, HttpResponse } from "msw";
import AdminTenantDetail from "./AdminTenantDetail";

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
});
