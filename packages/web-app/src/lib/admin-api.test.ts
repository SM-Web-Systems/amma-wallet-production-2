import { describe, it, expect, vi, beforeEach } from "vitest";
import { adminFetch, getAdminInfo } from "./admin-api";
import { server } from "../test/msw-server";
import { http, HttpResponse } from "msw";

describe("adminFetch", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("attaches Bearer token from sessionStorage", async () => {
    sessionStorage.setItem("aw_admin_token", "test-jwt");

    server.use(
      http.get("/api/v1/internal/tenants", ({ request }) => {
        const auth = request.headers.get("Authorization");
        return HttpResponse.json({ received: auth });
      }),
    );

    const res = await adminFetch("/api/v1/internal/tenants");
    const data = await res.json();
    expect(data.received).toBe("Bearer test-jwt");
  });

  it("sends Bearer with empty token when no token stored", async () => {
    server.use(
      http.get("/api/v1/internal/tenants", ({ request }) => {
        const auth = request.headers.get("Authorization");
        return HttpResponse.json({ received: auth });
      }),
    );

    const res = await adminFetch("/api/v1/internal/tenants");
    const data = await res.json();
    // When token is null, header value is "Bearer " which jsdom normalizes to ""
    expect(data.received).toBe("");
  });

  it("forwards custom headers and method", async () => {
    sessionStorage.setItem("aw_admin_token", "test-jwt");

    server.use(
      http.post("/api/v1/internal/test", async ({ request }) => {
        const body = await request.text();
        return HttpResponse.json({ body, contentType: request.headers.get("Content-Type") });
      }),
    );

    const res = await adminFetch("/api/v1/internal/test", {
      method: "POST",
      body: JSON.stringify({ key: "value" }),
    });
    const data = await res.json();
    expect(data.contentType).toBe("application/json");
    expect(JSON.parse(data.body)).toEqual({ key: "value" });
  });
});

describe("getAdminInfo", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("returns parsed admin info from sessionStorage", () => {
    const info = { id: 1, email: "a@b.com", name: "Admin", role: "super_admin" };
    sessionStorage.setItem("aw_admin_info", JSON.stringify(info));
    expect(getAdminInfo()).toEqual(info);
  });

  it("returns null when no admin info stored", () => {
    expect(getAdminInfo()).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    sessionStorage.setItem("aw_admin_info", "{broken");
    expect(getAdminInfo()).toBeNull();
  });
});
