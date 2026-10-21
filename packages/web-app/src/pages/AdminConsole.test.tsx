import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { server, mockTenants } from "../test/msw-server";
import { http, HttpResponse } from "msw";
import AdminConsole from "./AdminConsole";

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

function renderConsole() {
  return render(
    <MemoryRouter initialEntries={["/admin"]}>
      <AdminConsole />
    </MemoryRouter>,
  );
}

describe("AdminConsole", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it("redirects to login when no token", () => {
    renderConsole();
    expect(mockNavigate).toHaveBeenCalledWith("/admin/login");
  });

  it("renders tenant list after loading", async () => {
    setAuth();
    renderConsole();

    // Loading state first
    expect(screen.getByText("Loading tenants…")).toBeInTheDocument();

    // Wait for tenant data
    await waitFor(() => {
      expect(screen.getByText("ACME Corp")).toBeInTheDocument();
    });
    expect(screen.getByText("Beta Inc")).toBeInTheDocument();
  });

  it("displays summary cards with correct counts", async () => {
    setAuth();
    renderConsole();

    await waitFor(() => {
      expect(screen.getByText("ACME Corp")).toBeInTheDocument();
    });

    // Both summary cards show "2" (total=2, active=2 since both isActive:true)
    const allTwos = screen.getAllByText("2");
    expect(allTwos).toHaveLength(2);
    // Total balance = 500 + 2.5 = 502.5
    expect(screen.getByText("502.5000")).toBeInTheDocument();
  });

  it("displays admin name and role badge", async () => {
    setAuth();
    renderConsole();

    await waitFor(() => {
      expect(screen.getByText("ACME Corp")).toBeInTheDocument();
    });

    expect(screen.getByText("Test Admin")).toBeInTheDocument();
    expect(screen.getByText("super_admin")).toBeInTheDocument();
  });

  it("logs out and clears session on Sign out click", async () => {
    setAuth();
    const user = userEvent.setup();
    renderConsole();

    await waitFor(() => {
      expect(screen.getByText("ACME Corp")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Sign out"));

    expect(sessionStorage.getItem("aw_admin_token")).toBeNull();
    expect(sessionStorage.getItem("aw_admin_info")).toBeNull();
    expect(mockNavigate).toHaveBeenCalledWith("/admin/login");
  });

  it("handles 401 response by logging out", async () => {
    setAuth();
    server.use(
      http.get("/api/v1/internal/tenants", () => {
        return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
      }),
    );

    renderConsole();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/admin/login");
    });
  });

  it("shows error on server error", async () => {
    setAuth();
    server.use(
      http.get("/api/v1/internal/tenants", () => {
        return HttpResponse.json({ error: "Internal error" }, { status: 500 });
      }),
    );

    renderConsole();

    await waitFor(() => {
      expect(screen.getByText(/server error 500/i)).toBeInTheDocument();
    });
  });

  it("shows network error on fetch failure", async () => {
    setAuth();
    server.use(
      http.get("/api/v1/internal/tenants", () => {
        return HttpResponse.error();
      }),
    );

    renderConsole();

    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeInTheDocument();
    });
  });

  it("shows empty state when no tenants", async () => {
    setAuth();
    server.use(
      http.get("/api/v1/internal/tenants", () => {
        return HttpResponse.json({ tenants: [] });
      }),
    );

    renderConsole();

    await waitFor(() => {
      expect(screen.getByText("No tenants found.")).toBeInTheDocument();
    });
  });

  it("refreshes tenant list on Refresh click", async () => {
    setAuth();
    let callCount = 0;
    server.use(
      http.get("/api/v1/internal/tenants", () => {
        callCount++;
        return HttpResponse.json({
          tenants: callCount === 1 ? mockTenants : [mockTenants[0]],
        });
      }),
    );

    const user = userEvent.setup();
    renderConsole();

    await waitFor(() => {
      expect(screen.getByText("ACME Corp")).toBeInTheDocument();
    });
    expect(screen.getByText("Beta Inc")).toBeInTheDocument();

    await user.click(screen.getByText("Refresh"));

    await waitFor(() => {
      expect(screen.queryByText("Beta Inc")).not.toBeInTheDocument();
    });
  });

  it("links to Staff accounts page", async () => {
    setAuth();
    renderConsole();

    await waitFor(() => {
      expect(screen.getByText("ACME Corp")).toBeInTheDocument();
    });

    const link = screen.getByText("Staff accounts");
    expect(link.closest("a")).toHaveAttribute("href", "/admin/admins");
  });

  it("color-codes low balances in amber", async () => {
    setAuth();
    renderConsole();

    await waitFor(() => {
      expect(screen.getByText("ACME Corp")).toBeInTheDocument();
    });

    // Beta Inc has balance 2.5 which is < 5, should be amber
    const betaBalance = screen.getByText("2.5000");
    expect(betaBalance.className).toContain("amber");
  });
});
