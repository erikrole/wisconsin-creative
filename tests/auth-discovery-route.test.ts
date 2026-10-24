import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    allowedEmail: {
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientIp: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

vi.mock("@/lib/services/invite-token", () => ({
  inviteTokenMatches: vi.fn(async (_invite: unknown, raw: string | undefined) => raw === "valid-invite-token"),
}));

import { db } from "@/lib/db";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { POST } from "@/app/api/auth/discover/route";

const noParams = { params: Promise.resolve({}) };

function postDiscover(email: string, invite?: string) {
  return new Request("https://app.example.com/api/auth/discover", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "127.0.0.1",
    },
    body: JSON.stringify({ email, ...(invite ? { invite } : {}) }),
  });
}

const allowed = {
  claimedAt: null,
  role: "STUDENT",
  collaboratorPolicy: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkRateLimit).mockResolvedValue({
    allowed: true,
    remaining: 19,
    resetAt: Date.now() + 60_000,
  });
  vi.mocked(getClientIp).mockReturnValue("127.0.0.1");
  vi.mocked(db.allowedEmail.findUnique).mockResolvedValue(null);
  vi.mocked(db.user.findUnique).mockResolvedValue(null);
});

describe("POST /api/auth/discover", () => {
  it("routes an unclaimed allowed email to onboarding", async () => {
    vi.mocked(db.allowedEmail.findUnique).mockResolvedValue(allowed as never);

    const response = await POST(postDiscover(" INVITED@EXAMPLE.COM "), noParams);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ flow: "onboarding", inviteLink: "required" });
    expect(db.allowedEmail.findUnique).toHaveBeenCalledWith({
      where: { email: "invited@example.com" },
      select: {
        claimedAt: true,
        role: true,
        inviteTokenHash: true,
        inviteTokenIssuedAt: true,
        collaboratorPolicy: { select: { status: true } },
      },
    });
    expect(db.user.findUnique).toHaveBeenCalledWith({
      where: { email: "invited@example.com" },
      select: { id: true },
    });
  });

  it.each([
    ["a missing email", null, null],
    ["a claimed invite", { ...allowed, claimedAt: new Date() }, null],
    ["an existing account", allowed, { id: "user-1" }],
    ["an inactive collaborator policy", { ...allowed, role: "COLLABORATOR", collaboratorPolicy: { status: "INACTIVE" } }, null],
  ])("keeps %s on password sign-in", async (_label, allowedEmail, user) => {
    vi.mocked(db.allowedEmail.findUnique).mockResolvedValue(allowedEmail as never);
    vi.mocked(db.user.findUnique).mockResolvedValue(user as never);

    const response = await POST(postDiscover("user@example.com"), noParams);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ flow: "password" });
  });

  it("rate limits both discovery dimensions before querying account state", async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60_000,
    });

    const response = await POST(postDiscover("user@example.com"), noParams);

    expect(response.status).toBe(429);
    expect(db.allowedEmail.findUnique).not.toHaveBeenCalled();
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it("opens account setup only when the visit carries the emailed invite link", async () => {
    vi.mocked(db.allowedEmail.findUnique).mockResolvedValue(allowed as never);

    const withLink = await (await POST(postDiscover("invited@example.com", "valid-invite-token"), noParams)).json();
    const wrongLink = await (await POST(postDiscover("invited@example.com", "someone-elses-token"), noParams)).json();

    expect(withLink).toEqual({ flow: "onboarding", inviteLink: "valid" });
    expect(wrongLink).toEqual({ flow: "onboarding", inviteLink: "required" });
  });

  it("does not expose account metadata in the response", async () => {
    vi.mocked(db.allowedEmail.findUnique).mockResolvedValue({
      ...allowed,
      role: "STAFF",
    } as never);

    const body = await (await POST(postDiscover("staff@example.com"), noParams)).json();

    expect(body).toEqual({ flow: "onboarding", inviteLink: "required" });
    expect(body).not.toHaveProperty("role");
    expect(body).not.toHaveProperty("name");
    expect(body).not.toHaveProperty("profile");
  });
});
