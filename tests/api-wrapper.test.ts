import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock @/lib/auth ────────────────────────────────────────────────────────
vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

// ─── Mock @sentry/nextjs ────────────────────────────────────────────────────
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { withAuth, withHandler } from "@/lib/api";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { HttpError } from "@/lib/http";
import * as Sentry from "@sentry/nextjs";

const mockUser = {
  id: "user-1",
  email: "test@test.com",
  name: "Test User",
  role: "ADMIN" as const,
  avatarUrl: null,
  forcePasswordChange: false,
};

beforeEach(() => {
  vi.mocked(requireAuth).mockResolvedValue(mockUser);
});

function makeRequest(method: string, headers: Record<string, string> = {}) {
  return new Request("https://app.example.com/api/test", {
    method,
    headers: {
      host: "app.example.com",
      ...headers,
    },
  });
}

function makeRequestAt(pathname: string, method: string, headers: Record<string, string> = {}) {
  return new Request(`https://app.example.com${pathname}`, {
    method,
    headers: {
      host: "app.example.com",
      ...headers,
    },
  });
}

function makeMalformedJsonRequest() {
  return new Request("https://app.example.com/api/test", {
    method: "POST",
    headers: {
      host: "app.example.com",
      origin: "https://app.example.com",
      "content-type": "application/json; charset=utf-8",
    },
    body: '{"broken":',
  });
}

describe("withAuth", () => {
  it("calls handler with authenticated user", async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const wrapped = withAuth(handler);

    const res = await wrapped(
      makeRequest("GET"),
      { params: Promise.resolve({}) }
    );

    expect(handler).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ user: mockUser })
    );
    expect(res.status).toBe(200);
  });

  it("returns 401 on auth failure", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new HttpError(401, "Unauthorized"));
    const handler = vi.fn();
    const wrapped = withAuth(handler);

    const res = await wrapped(
      makeRequest("GET"),
      { params: Promise.resolve({}) }
    );

    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("resolves dynamic params", async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const wrapped = withAuth<{ id: string }>(handler);

    await wrapped(
      makeRequest("GET"),
      { params: Promise.resolve({ id: "123" }) }
    );

    expect(handler).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ params: { id: "123" } })
    );
  });

  it("returns proper status for HttpError", async () => {
    const handler = vi.fn().mockRejectedValue(new HttpError(409, "Conflict"));
    const wrapped = withAuth(handler);

    const res = await wrapped(
      makeRequest("GET"),
      { params: Promise.resolve({}) }
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("Conflict");
  });

  it("returns 500 for unknown errors", async () => {
    const unexpectedError = new Error("unexpected");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handler = vi.fn().mockRejectedValue(unexpectedError);
    const wrapped = withAuth(handler);

    const res = await wrapped(
      makeRequest("GET"),
      { params: Promise.resolve({}) }
    );

    expect(res.status).toBe(500);
    expect(consoleError).toHaveBeenCalledWith(unexpectedError);
    consoleError.mockRestore();
  });

  it("returns 400 when an authenticated JSON handler parses a malformed body", async () => {
    const handler = vi.fn(async (req: Request) => {
      await req.json();
      return NextResponse.json({ ok: true });
    });
    const wrapped = withAuth(handler);

    const res = await wrapped(makeMalformedJsonRequest(), { params: Promise.resolve({}) });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Request body must be valid JSON" });
  });

  it("does not misclassify a non-JSON server SyntaxError as malformed input", async () => {
    const syntaxError = new SyntaxError("server invariant failed");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const wrapped = withAuth(vi.fn().mockRejectedValue(syntaxError));

    const res = await wrapped(makeRequest("GET"), { params: Promise.resolve({}) });

    expect(res.status).toBe(500);
    expect(consoleError).toHaveBeenCalledWith(syntaxError);
    consoleError.mockRestore();
  });

  it("does not misclassify a server SyntaxError after valid JSON parsing", async () => {
    const syntaxError = new SyntaxError("server invariant failed");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const wrapped = withAuth(async (req: Request) => {
      await req.json();
      throw syntaxError;
    });
    const request = new Request("https://app.example.com/api/test", {
      method: "POST",
      headers: {
        host: "app.example.com",
        origin: "https://app.example.com",
        "content-type": "application/json",
      },
      body: JSON.stringify({ valid: true }),
    });

    const res = await wrapped(request, { params: Promise.resolve({}) });

    expect(res.status).toBe(500);
    expect(consoleError).toHaveBeenCalledWith(syntaxError);
    expect(Sentry.captureException).toHaveBeenCalledWith(syntaxError);
    consoleError.mockRestore();
  });

  // ── CSRF tests ──────────────────────────────────────────────────────────
  it("blocks POST with mismatched Origin header", async () => {
    const handler = vi.fn();
    const wrapped = withAuth(handler);

    const res = await wrapped(
      makeRequest("POST", { origin: "https://evil.com" }),
      { params: Promise.resolve({}) }
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("Cross-origin");
    expect(handler).not.toHaveBeenCalled();
  });

  it("allows POST with matching Origin header", async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const wrapped = withAuth(handler);

    const res = await wrapped(
      makeRequest("POST", { origin: "https://app.example.com" }),
      { params: Promise.resolve({}) }
    );

    expect(res.status).toBe(200);
  });

  it("does NOT trust x-forwarded-host to widen the allowed origin", async () => {
    // A misconfigured/hostile proxy could forward attacker-controlled
    // x-forwarded-host/proto. Those must not be able to forge an allowed
    // Origin: only the request's own origin and env.trustedOrigins count.
    const handler = vi.fn();
    const wrapped = withAuth(handler);

    const res = await wrapped(
      new Request("http://internal:3000/api/test", {
        method: "POST",
        headers: {
          host: "internal:3000",
          origin: "https://app.example.com",
          "x-forwarded-host": "app.example.com",
          "x-forwarded-proto": "https",
        },
      }),
      { params: Promise.resolve({}) }
    );

    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("allows a cross-host Origin only when it is in TRUSTED_ORIGINS", async () => {
    const prev = process.env.TRUSTED_ORIGINS;
    process.env.TRUSTED_ORIGINS = "https://app.example.com,https://gear.erikrole.com";
    try {
      const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
      const wrapped = withAuth(handler);

      const res = await wrapped(
        new Request("http://internal:3000/api/test", {
          method: "POST",
          headers: { host: "internal:3000", origin: "https://app.example.com" },
        }),
        { params: Promise.resolve({}) }
      );

      expect(res.status).toBe(200);
      expect(handler).toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.TRUSTED_ORIGINS;
      else process.env.TRUSTED_ORIGINS = prev;
    }
  });

  it("allows loopback dev POSTs when the internal URL scheme disagrees with the browser Origin", async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const wrapped = withAuth(handler);

    const res = await wrapped(
      new Request("https://127.0.0.1:3033/api/test", {
        method: "POST",
        headers: {
          host: "127.0.0.1:3033",
          origin: "http://127.0.0.1:3033",
        },
      }),
      { params: Promise.resolve({}) }
    );

    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalled();
  });

  it("allows IPv6 loopback dev POSTs when the internal URL scheme disagrees with the browser Origin", async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const wrapped = withAuth(handler);

    const res = await wrapped(
      new Request("https://[::1]:3033/api/test", {
        method: "POST",
        headers: {
          host: "[::1]:3033",
          origin: "http://[::1]:3033",
        },
      }),
      { params: Promise.resolve({}) }
    );

    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalled();
  });

  it("allows localhost and IPv4 loopback aliases on the same development port", async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const wrapped = withAuth(handler);

    const res = await wrapped(
      new Request("http://localhost:3000/api/test", {
        method: "POST",
        headers: {
          host: "localhost:3000",
          origin: "http://127.0.0.1:3000",
        },
      }),
      { params: Promise.resolve({}) }
    );

    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalled();
  });

  it("does not allow a loopback development Origin from a different port", async () => {
    const handler = vi.fn();
    const wrapped = withAuth(handler);

    const res = await wrapped(
      new Request("http://localhost:3000/api/test", {
        method: "POST",
        headers: {
          host: "localhost:3000",
          origin: "http://127.0.0.1:3001",
        },
      }),
      { params: Promise.resolve({}) }
    );

    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("blocks POST when Origin header is absent (CSRF protection)", async () => {
    const handler = vi.fn();
    const wrapped = withAuth(handler);

    // No origin header at all — should be blocked
    const res = await wrapped(
      makeRequest("POST"),
      { params: Promise.resolve({}) }
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("Origin header required");
    expect(handler).not.toHaveBeenCalled();
  });

  it("blocks POST without Origin even when a Bearer header is present", async () => {
    // Cron routes use withCron, not withAuth, so withAuth no longer waives the
    // Origin requirement for Bearer-bearing requests — that waiver was a
    // needless CSRF hole. A missing Origin is always rejected here.
    const handler = vi.fn();
    const wrapped = withAuth(handler);

    const res = await wrapped(
      makeRequest("POST", { authorization: "Bearer cron-secret-123" }),
      { params: Promise.resolve({}) }
    );

    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("skips CSRF check for GET requests", async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const wrapped = withAuth(handler);

    const res = await wrapped(
      makeRequest("GET", { origin: "https://evil.com" }),
      { params: Promise.resolve({}) }
    );

    expect(res.status).toBe(200);
  });

  it("blocks forced-password users from regular authenticated APIs", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ...mockUser,
      forcePasswordChange: true,
    });
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const wrapped = withAuth(handler);

    const res = await wrapped(
      makeRequest("POST", { origin: "https://app.example.com" }),
      { params: Promise.resolve({}) }
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("Password change required");
    expect(handler).not.toHaveBeenCalled();
  });

  it("allows forced-password users to call the profile password-change route", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ...mockUser,
      forcePasswordChange: true,
    });
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const wrapped = withAuth(handler);

    const res = await wrapped(
      new Request("https://app.example.com/api/profile", {
        method: "PATCH",
        headers: {
          host: "app.example.com",
          origin: "https://app.example.com",
        },
      }),
      { params: Promise.resolve({}) }
    );

    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalled();
  });

  it("allows forced-password users to call the self-service password setup route", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ...mockUser,
      forcePasswordChange: true,
    });
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const wrapped = withAuth(handler);

    const res = await wrapped(
      new Request("https://app.example.com/api/me/change-password", {
        method: "POST",
        headers: {
          host: "app.example.com",
          origin: "https://app.example.com",
        },
      }),
      { params: Promise.resolve({}) }
    );

    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalled();
  });

  it("blocks every preview mutation before the route handler runs", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ...mockUser,
      role: "STAFF" as const,
      preview: { actualRole: "ADMIN", role: "STAFF", readOnly: true, expiresAt: Date.now() + 60_000 },
    });
    const handler = vi.fn();
    const wrapped = withAuth(handler);

    const res = await wrapped(
      makeRequestAt("/api/bookings/booking-1", "POST", { origin: "https://app.example.com" }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Preview mode is read-only" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("blocks preview exports and protected downloads while allowing read routes", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ...mockUser,
      role: "STUDENT" as const,
      preview: { actualRole: "ADMIN", role: "STUDENT", readOnly: true, expiresAt: Date.now() + 60_000 },
    });
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const wrapped = withAuth(handler);

    const exportResponse = await wrapped(
      makeRequestAt("/api/reports/export?format=csv", "GET"),
      { params: Promise.resolve({}) },
    );
    expect(exportResponse.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();

    const readResponse = await wrapped(
      makeRequestAt("/api/dashboard/stats", "GET"),
      { params: Promise.resolve({}) },
    );
    expect(readResponse.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("allows preview start/stop control requests and logout", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ...mockUser,
      role: "STAFF" as const,
      preview: { actualRole: "ADMIN", role: "STAFF", readOnly: true, expiresAt: Date.now() + 60_000 },
    });
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const wrapped = withAuth(handler);

    const startResponse = await wrapped(
      makeRequestAt("/api/admin/role-preview", "POST", { origin: "https://app.example.com" }),
      { params: Promise.resolve({}) },
    );
    const stopResponse = await wrapped(
      makeRequestAt("/api/admin/role-preview", "DELETE", { origin: "https://app.example.com" }),
      { params: Promise.resolve({}) },
    );
    const logoutResponse = await wrapped(
      makeRequestAt("/api/auth/logout", "POST", { origin: "https://app.example.com" }),
      { params: Promise.resolve({}) },
    );

    expect(startResponse.status).toBe(200);
    expect(stopResponse.status).toBe(200);
    expect(logoutResponse.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(3);
  });
});

describe("withHandler", () => {
  it("calls handler without auth", async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const wrapped = withHandler(handler);

    const res = await wrapped(
      makeRequest("GET"),
      { params: Promise.resolve({}) }
    );

    expect(res.status).toBe(200);
    expect(requireAuth).not.toHaveBeenCalled();
  });

  it("resolves params", async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const wrapped = withHandler<{ id: string }>(handler);

    await wrapped(
      makeRequest("GET"),
      { params: Promise.resolve({ id: "456" }) }
    );

    expect(handler).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ params: { id: "456" } })
    );
  });

  it("returns 400 when a public JSON handler parses a malformed body", async () => {
    const handler = vi.fn(async (req: Request) => {
      await req.json();
      return NextResponse.json({ ok: true });
    });
    const wrapped = withHandler(handler);

    const res = await wrapped(makeMalformedJsonRequest(), { params: Promise.resolve({}) });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Request body must be valid JSON" });
  });
});
