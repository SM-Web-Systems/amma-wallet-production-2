import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { server } from "../test/msw-server";
import { http, HttpResponse } from "msw";
import AdminLogin from "./AdminLogin";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={["/admin/login"]}>
      <AdminLogin />
    </MemoryRouter>,
  );
}

describe("AdminLogin", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it("renders login form with email and password fields", () => {
    renderLogin();
    expect(screen.getByLabelText(/admin email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  it("shows validation error when fields are empty", async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(screen.getByText("Email and password are required.")).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("shows validation error when only email is filled", async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText(/admin email/i), "admin@test.com");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(screen.getByText("Email and password are required.")).toBeInTheDocument();
  });

  it("stores token and admin info on successful login", async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText(/admin email/i), "admin@test.com");
    await user.type(screen.getByLabelText(/^password$/i), "correctPassword");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(sessionStorage.getItem("aw_admin_token")).toBe("mock-jwt-token");
    });
    const info = JSON.parse(sessionStorage.getItem("aw_admin_info")!);
    expect(info.email).toBe("admin@test.com");
    expect(info.role).toBe("super_admin");
    expect(mockNavigate).toHaveBeenCalledWith("/admin");
  });

  it("shows error on invalid credentials", async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText(/admin email/i), "wrong@test.com");
    await user.type(screen.getByLabelText(/^password$/i), "wrongPass");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText("Invalid credentials")).toBeInTheDocument();
    });
    expect(sessionStorage.getItem("aw_admin_token")).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("shows network error on fetch failure", async () => {
    server.use(
      http.post("/api/v1/internal/auth/login", () => {
        return HttpResponse.error();
      }),
    );

    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText(/admin email/i), "admin@test.com");
    await user.type(screen.getByLabelText(/^password$/i), "somePassword");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeInTheDocument();
    });
  });

  it("shows loading state during submission", async () => {
    // Slow down the response
    server.use(
      http.post("/api/v1/internal/auth/login", async () => {
        await new Promise((r) => setTimeout(r, 100));
        return HttpResponse.json({ token: "t", admin: { id: 1, email: "a", name: "b", role: "c" } });
      }),
    );

    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText(/admin email/i), "admin@test.com");
    await user.type(screen.getByLabelText(/^password$/i), "pass");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(screen.getByText("Signing in…")).toBeInTheDocument();
    expect(screen.getByLabelText(/admin email/i)).toBeDisabled();
    expect(screen.getByLabelText(/^password$/i)).toBeDisabled();

    await waitFor(() => {
      expect(screen.queryByText("Signing in…")).not.toBeInTheDocument();
    });
  });

  it("toggles password visibility", async () => {
    const user = userEvent.setup();
    renderLogin();

    const passwordInput = screen.getByLabelText(/^password$/i);
    expect(passwordInput).toHaveAttribute("type", "password");

    await user.click(screen.getByLabelText(/show password/i));
    expect(passwordInput).toHaveAttribute("type", "text");

    await user.click(screen.getByLabelText(/hide password/i));
    expect(passwordInput).toHaveAttribute("type", "password");
  });

  it("clears previous error on new submit", async () => {
    const user = userEvent.setup();
    renderLogin();

    // First: trigger empty-field error
    await user.click(screen.getByRole("button", { name: /sign in/i }));
    expect(screen.getByText("Email and password are required.")).toBeInTheDocument();

    // Fill fields and submit — error should clear
    await user.type(screen.getByLabelText(/admin email/i), "admin@test.com");
    await user.type(screen.getByLabelText(/^password$/i), "correctPassword");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.queryByText("Email and password are required.")).not.toBeInTheDocument();
    });
  });
});
