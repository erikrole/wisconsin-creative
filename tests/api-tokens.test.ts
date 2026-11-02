import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { withAuth } from "@/lib/api";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { bearerTokenFrom, isTokenBlockedRequest } from "@/lib/api-token";

const TOKEN = `wc_${"a".repeat(64)}`;
const admin = { id: "u1", email: "a@x.com", name: "A", role: "ADMIN" as const, avatarUrl: null };

function req(method: string, path: string, headers: Record<string, string> = {}) {
  return new Request(`https://app.example.com${path}`, { method, headers });
}

describe("bearerTokenFrom", () => {
  it("accepts only well-formed wc_ tokens", () => {
    expect(bearerTokenFrom(`Bearer ${TOKEN}`)).toBe(TOKEN);
    expect(bearerTokenFrom("Bearer abc")).toBeNull();
    expect(bearerTokenFrom(`Bearer wc_${"a".repeat(10)}`)).toBeNull();
    expect(bearerTokenFrom(null)).toBeNull();
  });
});

describe("isTokenBlockedRequest", () => {
  it.each([
    ["/api/auth/login", "POST"],
    ["/api/me/change-password", "POST"],
    ["/api/me/passkeys/abc", "DELETE"],
    ["/api/me/sessions", "DELETE"],
    ["/api/me/api-tokens", "GET"],
    ["/api/users", "POST"],
    ["/api/users/u2/reset-password", "POST"],
    ["/api/users/u2/role", "PATCH"],
  ])("blocks %s %s", (path, method) => {
    expect(isTokenBlockedRequest(path, method)).toBe(true);
  });

  it("allows schedule and read routes", () => {
    expect(isTokenBlockedRequest("/api/shift-groups/g1/working-copy", "PATCH")).toBe(false);
    expect(isTokenBlockedRequest("/api/users", "GET")).toBe(false);
    expect(isTokenBlockedRequest("/api/me", "GET")).toBe(false);
  });
});

describe("withAuth with an API token", () => {
  const handler = withAuth(async () => NextResponse.json({ ok: true }));
  const ctx = { params: Promise.resolve({}) };

  beforeEach(() => vi.mocked(requireAuth).mockReset());

  it("skips the Origin check for a bearer request", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...admin, apiTokenScope: "WRITE" });
    const res = await handler(req("POST", "/api/shift-trades", { authorization: `Bearer ${TOKEN}` }), ctx);
    expect(res.status).toBe(200);
  });

  it("still requires Origin without a bearer token", async () => {
    vi.mocked(requireAuth).mockResolvedValue(admin);
    const res = await handler(req("POST", "/api/shift-trades"), ctx);
    expect(res.status).toBe(403);
  });

  it("refuses writes from a READ token and allows reads", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...admin, apiTokenScope: "READ" });
    const headers = { authorization: `Bearer ${TOKEN}` };
    expect((await handler(req("PATCH", "/api/shift-trades/t/approve", headers), ctx)).status).toBe(403);
    expect((await handler(req("GET", "/api/shift-trades", headers), ctx)).status).toBe(200);
  });

  it("refuses credential routes even for a WRITE token", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...admin, apiTokenScope: "WRITE" });
    const res = await handler(req("POST", "/api/users/u2/reset-password", { authorization: `Bearer ${TOKEN}` }), ctx);
    expect(res.status).toBe(403);
  });
});
