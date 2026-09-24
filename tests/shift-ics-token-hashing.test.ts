import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  withAuth: (handler: (req: Request, context: unknown) => Promise<unknown>) =>
    (req: Request) => handler(req, { user: { id: "user-1", role: "STUDENT" } }),
}));
vi.mock("@/lib/db", () => ({
  db: { user: { findUnique: mocks.findUnique, update: mocks.update, updateMany: mocks.updateMany } },
}));
vi.mock("@/lib/audit", () => ({ createAuditEntry: mocks.audit }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: { appUrl: "https://wisconsincreative.com" } }));

import { GET, POST } from "@/app/api/shifts/ics-token/route";
import { hashIcsToken, icsTokenLookupValues, isHashedIcsToken } from "@/lib/ics-token";

const legacyToken = "b".repeat(48);

async function body(response: unknown) {
  return (response as Response).json();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("shift calendar token storage", () => {
  it("hashes with a recognisable prefix and still matches legacy raw tokens", () => {
    const hashed = hashIcsToken(legacyToken);
    expect(isHashedIcsToken(hashed)).toBe(true);
    expect(isHashedIcsToken(legacyToken)).toBe(false);
    expect(icsTokenLookupValues(legacyToken)).toEqual([hashed, legacyToken]);
  });

  it("stores only the hash when minting, and returns the raw token once", async () => {
    const json = await body(await POST(new Request("https://x/api/shifts/ics-token", { method: "POST" }), {} as never));
    const token = json.data.token as string;
    expect(token).toMatch(/^[0-9a-f]{48}$/);
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "user-1" }, data: { icsToken: hashIcsToken(token) } });
    // Canonical origin, never the caller's host.
    expect(json.data.feedUrl).toBe(`https://wisconsincreative.com/api/shifts/ics/${token}`);
  });

  it("never returns a hashed token, only that one exists", async () => {
    mocks.findUnique.mockResolvedValue({ icsToken: hashIcsToken(legacyToken) });
    const json = await body(await GET(new Request("https://x/api/shifts/ics-token"), {} as never));
    expect(json.data).toEqual({ token: null, hasToken: true });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("upgrades a legacy raw token to its hash on first read, returning it once", async () => {
    mocks.findUnique.mockResolvedValue({ icsToken: legacyToken });
    const json = await body(await GET(new Request("https://x/api/shifts/ics-token"), {} as never));
    expect(json.data.token).toBe(legacyToken);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "user-1", icsToken: legacyToken },
      data: { icsToken: hashIcsToken(legacyToken) },
    });
  });

  it("tells a device whether the link it holds is still current", async () => {
    mocks.findUnique.mockResolvedValue({ icsToken: hashIcsToken(legacyToken) });
    const current = await body(await GET(new Request("https://x/api/shifts/ics-token", {
      headers: { "x-ics-token-check": legacyToken },
    }), {} as never));
    expect(current.data.matches).toBe(true);
    const stale = await body(await GET(new Request("https://x/api/shifts/ics-token", {
      headers: { "x-ics-token-check": "c".repeat(48) },
    }), {} as never));
    expect(stale.data.matches).toBe(false);
  });
});
