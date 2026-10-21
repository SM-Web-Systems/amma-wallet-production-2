import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { server, mockAdmins } from "../test/msw-server";
import { http, HttpResponse } from "msw";
import AdminAdmins from "./AdminAdmins";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

function setAuth(role = "super_admin", adminId = 1) {
  sessionStorage.setItem("aw_admin_token", "mock-jwt");
  sessionStorage.setItem("aw_admin_info", JSON.stringify({
    id: adminId, email: "admin@test.com", name: "Test Admin", role,
  }));
}

function renderAdmins() {
  return render(
    <MemoryRouter initialEntries={["/admin/admins"]}>
      <AdminAdmins />
    </MemoryRouter>,
  );
}

describe("AdminAdmins", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it("redirects to login when no token", () => {
    renderAdmins();
    expect(mockNavigate).toHaveBeenCalledWith("/admin/login");
  });

  it("renders admin list after loading", async () => {
    setAuth();
    renderAdmins();

    expect(screen.getByText("Loading admins…")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Super Admin")).toBeInTheDocument();
    });
    expect(screen.getByText("Platform Admin")).toBeInTheDocument();
    expect(screen.getByText("Support Agent")).toBeInTheDocument();
  });

  it("displays role badges", async () => {
    setAuth();
    renderAdmins();

    await waitFor(() => {
      expect(screen.getByText("Super Admin")).toBeInTheDocument();
    });

    expect(screen.getByText("super admin")).toBeInTheDocument();
    expect(screen.getByText("platform admin")).toBeInTheDocument();
    expect(screen.getByText("support agent")).toBeInTheDocument();
  });

  it("shows Deactivated badge for inactive admin", async () => {
    setAuth();
    renderAdmins();

    await waitFor(() => {
      expect(screen.getByText("Deactivated")).toBeInTheDocument();
    });
  });

  // Role-based rendering
  describe("role-based action visibility", () => {
    it("super_admin sees Invite, Deactivate, Reactivate, Reset pwd", async () => {
      setAuth("super_admin", 1);
      renderAdmins();

      await waitFor(() => {
        expect(screen.getByText("Super Admin")).toBeInTheDocument();
      });

      expect(screen.getByText("Invite admin")).toBeInTheDocument();
      // Can deactivate admin #2 (not self)
      expect(screen.getByText("Deactivate")).toBeInTheDocument();
      // Can reactivate admin #3 (inactive)
      expect(screen.getByText("Reactivate")).toBeInTheDocument();
      // Can reset password for admins #2 and #3 (not self)
      expect(screen.getAllByText("Reset pwd")).toHaveLength(2);
    });

    it("super_admin cannot deactivate self", async () => {
      setAuth("super_admin", 1);
      renderAdmins();

      await waitFor(() => {
        expect(screen.getByText("Super Admin")).toBeInTheDocument();
      });

      // Only one Deactivate button (for admin #2, not for self #1)
      const deactivateButtons = screen.getAllByText("Deactivate");
      expect(deactivateButtons).toHaveLength(1);
    });

    it("platform_admin can invite but cannot see super_admin role option", async () => {
      setAuth("platform_admin", 2);
      renderAdmins();

      await waitFor(() => {
        expect(screen.getByText("Super Admin")).toBeInTheDocument();
      });

      expect(screen.getByText("Invite admin")).toBeInTheDocument();

      const user = userEvent.setup();
      await user.click(screen.getByText("Invite admin"));

      const dialog = screen.getByRole("dialog", { name: /invite admin/i });
      const roleSelect = within(dialog).getByRole("combobox");
      const options = within(roleSelect).getAllByRole("option");
      const roleValues = options.map(o => (o as HTMLOptionElement).value);
      expect(roleValues).not.toContain("super_admin");
      expect(roleValues).toContain("platform_admin");
    });

    it("platform_admin cannot deactivate super_admin", async () => {
      setAuth("platform_admin", 2);
      renderAdmins();

      await waitFor(() => {
        expect(screen.getByText("Super Admin")).toBeInTheDocument();
      });

      // No Deactivate button should appear (can't deactivate super_admin #1, can't deactivate self #2)
      expect(screen.queryByText("Deactivate")).not.toBeInTheDocument();
    });

    it("support_agent cannot invite or deactivate", async () => {
      setAuth("support_agent", 3);
      renderAdmins();

      await waitFor(() => {
        expect(screen.getByText("Super Admin")).toBeInTheDocument();
      });

      expect(screen.queryByText("Invite admin")).not.toBeInTheDocument();
      expect(screen.queryByText("Deactivate")).not.toBeInTheDocument();
      expect(screen.queryByText("Reactivate")).not.toBeInTheDocument();
      expect(screen.queryByText("Reset pwd")).not.toBeInTheDocument();
    });
  });

  // Invite flow
  describe("invite flow", () => {
    it("validates password minimum length", async () => {
      setAuth();
      const user = userEvent.setup();
      renderAdmins();

      await waitFor(() => {
        expect(screen.getByText("Super Admin")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Invite admin"));

      const dialog = screen.getByRole("dialog", { name: /invite admin/i });
      await user.type(within(dialog).getByPlaceholderText("admin@example.com"), "new@test.com");
      await user.type(within(dialog).getByPlaceholderText("Full name"), "New Admin");
      await user.type(within(dialog).getByPlaceholderText("Min. 12 characters"), "short");
      await user.click(within(dialog).getByText("Create account"));

      expect(within(dialog).getByText("Password must be at least 12 characters.")).toBeInTheDocument();
    });

    it("creates admin on valid submit", async () => {
      setAuth();
      const user = userEvent.setup();
      renderAdmins();

      await waitFor(() => {
        expect(screen.getByText("Super Admin")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Invite admin"));

      const dialog = screen.getByRole("dialog", { name: /invite admin/i });
      await user.type(within(dialog).getByPlaceholderText("admin@example.com"), "new@test.com");
      await user.type(within(dialog).getByPlaceholderText("Full name"), "New Admin");
      await user.type(within(dialog).getByPlaceholderText("Min. 12 characters"), "securePassword123");
      await user.click(within(dialog).getByText("Create account"));

      // Dialog should close after success
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
    });
  });

  // Deactivate/reactivate flow
  describe("deactivate/reactivate flow", () => {
    it("opens confirmation modal on deactivate click", async () => {
      setAuth();
      const user = userEvent.setup();
      renderAdmins();

      await waitFor(() => {
        expect(screen.getByText("Super Admin")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Deactivate"));

      expect(screen.getByText("Deactivate admin?")).toBeInTheDocument();
      expect(screen.getByText(/access will be revoked/i)).toBeInTheDocument();
    });

    it("submits deactivation after confirm", async () => {
      setAuth();
      const user = userEvent.setup();
      renderAdmins();

      await waitFor(() => {
        expect(screen.getByText("Super Admin")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Deactivate"));

      const dialog = screen.getByRole("dialog");
      const confirmBtn = within(dialog).getAllByText("Deactivate")[0];
      await user.click(confirmBtn);

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
    });

    it("cancels deactivation without action", async () => {
      setAuth();
      let deactivateCalled = false;
      server.use(
        http.patch("/api/v1/internal/admins/:id/deactivate", () => {
          deactivateCalled = true;
          return HttpResponse.json({ adminId: 2, email: "x", role: "y", isActive: false });
        }),
      );

      const user = userEvent.setup();
      renderAdmins();

      await waitFor(() => {
        expect(screen.getByText("Super Admin")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Deactivate"));
      await user.click(screen.getByText("Cancel"));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(deactivateCalled).toBe(false);
    });

    it("opens reactivation modal for inactive admin", async () => {
      setAuth();
      const user = userEvent.setup();
      renderAdmins();

      await waitFor(() => {
        expect(screen.getByText("Support Agent")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Reactivate"));

      expect(screen.getByText("Reactivate admin?")).toBeInTheDocument();
      expect(screen.getByText(/full admin access will be restored/i)).toBeInTheDocument();
    });
  });

  // Reset password flow
  describe("reset password flow", () => {
    it("opens reset modal for other admins (super_admin only)", async () => {
      setAuth("super_admin", 1);
      const user = userEvent.setup();
      renderAdmins();

      await waitFor(() => {
        expect(screen.getByText("Platform Admin")).toBeInTheDocument();
      });

      const resetButtons = screen.getAllByText("Reset pwd");
      await user.click(resetButtons[0]);

      expect(screen.getByText("Reset password")).toBeInTheDocument();
      expect(screen.getByText(/set a new password/i)).toBeInTheDocument();
    });

    it("validates password minimum on reset", async () => {
      setAuth("super_admin", 1);
      const user = userEvent.setup();
      renderAdmins();

      await waitFor(() => {
        expect(screen.getByText("Platform Admin")).toBeInTheDocument();
      });

      await user.click(screen.getAllByText("Reset pwd")[0]);

      const dialog = screen.getByRole("dialog", { name: /reset password/i });
      await user.type(within(dialog).getByPlaceholderText("Min. 12 characters"), "short");
      await user.click(within(dialog).getByText("Set password"));

      expect(within(dialog).getByText("Password must be at least 12 characters.")).toBeInTheDocument();
    });

    it("submits password reset with valid password", async () => {
      setAuth("super_admin", 1);
      const user = userEvent.setup();
      renderAdmins();

      await waitFor(() => {
        expect(screen.getByText("Platform Admin")).toBeInTheDocument();
      });

      await user.click(screen.getAllByText("Reset pwd")[0]);

      const dialog = screen.getByRole("dialog", { name: /reset password/i });
      await user.type(within(dialog).getByPlaceholderText("Min. 12 characters"), "newSecurePass123");
      await user.click(within(dialog).getByText("Set password"));

      // Dialog should close and success badge should appear
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
      expect(screen.getByText("Password reset")).toBeInTheDocument();
    });
  });

  // Error handling
  it("handles 401 by logging out", async () => {
    setAuth();
    server.use(
      http.get("/api/v1/internal/admins", () => {
        return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
      }),
    );
    renderAdmins();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/admin/login");
    });
  });

  it("shows network error", async () => {
    setAuth();
    server.use(
      http.get("/api/v1/internal/admins", () => {
        return HttpResponse.error();
      }),
    );
    renderAdmins();

    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeInTheDocument();
    });
  });

  it("has breadcrumb link back to dashboard", async () => {
    setAuth();
    renderAdmins();

    await waitFor(() => {
      expect(screen.getByText("Super Admin")).toBeInTheDocument();
    });

    const link = screen.getByText("Dashboard");
    expect(link.closest("a")).toHaveAttribute("href", "/admin");
  });
});
