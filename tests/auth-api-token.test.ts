import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  cookieStore: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
  headers: new Headers(),
  after: vi.fn(),
  rateLimit: vi.fn(),
  db: {
    apiToken: { findUnique: vi.fn(), updateMany: vi.fn() },
    session: { findUnique: vi.fn() },
  },
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: mocks.after,
}));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => mocks.cookieStore), headers: vi.fn(async () => mocks.headers) }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/env", () => ({ env: { sessionSecret: "test-session-secret-value-32chars", sessionCookieName: "wc_session" } }));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  enforceRateLimit: mocks.rateLimit,
}));

import { requireAuth, tokenHash } from "@/lib/auth";

const now = new Date("2026-10-31T20:00:00.000Z");
const secret = "wc_" + "ab".repeat(32);
const user = {
  id: "u1", email: "ada@wisc.edu", name: "Ada", role: Role.STAFF, active: true, affiliation: null,
  collaboratorProfile: null, collaboratorPolicyId: null, collaboratorPolicy: null, staffingType: "FT",
  avatarUrl: null, forcePasswordChange: false, onboardingRequired: false, onboardingCompletedAt: now, lastActiveAt: now,
};
const tokenRow = (extra: Record<string, unknown> = {}) => ({
  id: "tok-1", scope: "WRITE", expiresAt: new Date(now.getTime() + 86_400_000), lastUsedAt: now, user, ...extra,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  mocks.headers = new Headers({ authorization: `Bearer ${secret}`, "x-forwarded-for": "203.0.113.9, 10.0.0.1" });
  mocks.cookieStore.get.mockReturnValue(undefined);
  mocks.rateLimit.mockResolvedValue(undefined);
  mocks.db.apiToken.findUnique.mockResolvedValue(tokenRow());
  mocks.db.apiToken.updateMany.mockResolvedValue({ count: 1 });
});
afterEach(() => { vi.useRealTimers(); });

describe("requireAuth with a personal API token", () => {
  it("authenticates by the hashed bearer token alone and never consults the session cookie", async () => {
    mocks.cookieStore.get.mockReturnValue({ value: "a-session-cookie" });

    const auth = await requireAuth();

    expect(mocks.db.apiToken.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tokenHash: await tokenHash(secret) } }));
    expect(mocks.db.session.findUnique).not.toHaveBeenCalled();
    expect(auth).toMatchObject({ id: "u1", role: Role.STAFF, apiTokenScope: "WRITE", preview: undefined });
  });

  it("marks a READ token read-only", async () => {
    mocks.db.apiToken.findUnique.mockResolvedValue(tokenRow({ scope: "READ" }));

    await expect(requireAuth()).resolves.toMatchObject({ apiTokenScope: "READ" });
  });

  it("rejects an unknown or expired token with a 401 and counts the miss against the caller's IP", async () => {
    mocks.db.apiToken.findUnique.mockResolvedValue(null);
    await expect(requireAuth()).rejects.toMatchObject({ status: 401, message: "API token is invalid or expired" });
    expect(mocks.rateLimit).toHaveBeenCalledWith("api-token:bad:203.0.113.9", { max: 30, windowMs: 60_000 });

    mocks.db.apiToken.findUnique.mockResolvedValue(tokenRow({ expiresAt: new Date(now.getTime() - 1) }));
    await expect(requireAuth()).rejects.toMatchObject({ status: 401 });
    expect(mocks.db.session.findUnique).not.toHaveBeenCalled();
  });

  it("stops guessing once the per-IP budget is spent", async () => {
    mocks.db.apiToken.findUnique.mockResolvedValue(null);
    const { HttpError } = await import("@/lib/http");
    mocks.rateLimit.mockRejectedValue(new HttpError(429, "Too many requests. Try again in 60s."));

    await expect(requireAuth()).rejects.toMatchObject({ status: 429 });
  });

  it("refuses a token whose owner was deactivated", async () => {
    mocks.db.apiToken.findUnique.mockResolvedValue(tokenRow({ user: { ...user, active: false } }));

    await expect(requireAuth()).rejects.toMatchObject({ status: 401, message: "Account deactivated" });
    expect(mocks.rateLimit).not.toHaveBeenCalled();
  });

  it("refuses a collaborator token whose affiliation is suspended", async () => {
    mocks.db.apiToken.findUnique.mockResolvedValue(tokenRow({
      user: { ...user, role: Role.COLLABORATOR, collaboratorPolicyId: "cp1", collaboratorPolicy: { id: "cp1", status: "SUSPENDED", affiliationKey: "LEARFIELD", displayName: "Learfield", capabilities: [] } },
    }));

    await expect(requireAuth()).rejects.toMatchObject({ status: 403 });
  });

  it("refreshes last-used at most once an hour, after the response", async () => {
    await requireAuth();
    expect(mocks.after).not.toHaveBeenCalled();

    mocks.db.apiToken.findUnique.mockResolvedValue(tokenRow({ lastUsedAt: null }));
    await requireAuth();
    expect(mocks.after).toHaveBeenCalledTimes(1);
    await mocks.after.mock.calls[0]![0]();
    const update = mocks.db.apiToken.updateMany.mock.calls[0]![0];
    expect(update.where.id).toBe("tok-1");
    expect(update.data.lastUsedAt).toEqual(now);
    expect(update.where.OR[1].lastUsedAt.lt.getTime()).toBe(now.getTime() - 60 * 60 * 1000);

    mocks.db.apiToken.findUnique.mockResolvedValue(tokenRow({ lastUsedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000) }));
    await requireAuth();
    expect(mocks.after).toHaveBeenCalledTimes(2);
  });

  it("ignores a malformed bearer value and falls back to the session cookie", async () => {
    mocks.headers = new Headers({ authorization: "Bearer not-a-wc-token" });

    await expect(requireAuth()).rejects.toMatchObject({ status: 401, message: "Authentication required" });
    expect(mocks.db.apiToken.findUnique).not.toHaveBeenCalled();
  });
});
