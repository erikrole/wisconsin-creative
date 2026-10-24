import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    allowedEmail: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientIp: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({
  createSystemAuditEntry: vi.fn(),
}));
vi.mock("@/lib/services/invite-email", () => ({
  sendInviteEmail: vi.fn(),
}));
let apiKey = "re_test";
vi.mock("@/lib/env", () => ({
  env: {
    get resendApiKey() {
      return apiKey;
    },
  },
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { db } from "@/lib/db";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { createSystemAuditEntry } from "@/lib/audit";
import { sendInviteEmail } from "@/lib/services/invite-email";
import { POST } from "@/app/api/auth/invite/resend/route";

const noParams = { params: Promise.resolve({}) };
const SAME_RESPONSE = { message: "If that address has a pending invite, we sent the link.", inviteEmailConfigured: true };

function postResend(email: string) {
  return new Request("https://app.example.com/api/auth/invite/resend", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0.1" },
    body: JSON.stringify({ email }),
  });
}

const pendingInvite = { id: "invite-1", preloadedName: "Maya Chen", claimedAt: null, role: "STUDENT", collaboratorPolicy: null };

beforeEach(() => {
  vi.clearAllMocks();
  apiKey = "re_test";
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 2, resetAt: Date.now() + 60_000 });
  vi.mocked(getClientIp).mockReturnValue("127.0.0.1");
  vi.mocked(db.allowedEmail.findUnique).mockResolvedValue(null);
  vi.mocked(db.user.findUnique).mockResolvedValue(null);
  vi.mocked(sendInviteEmail).mockResolvedValue("sent");
});

describe("POST /api/auth/invite/resend", () => {
  it("emails a fresh sign-up link to a pending invite and audits it without the address", async () => {
    vi.mocked(db.allowedEmail.findUnique).mockResolvedValue(pendingInvite as never);

    const response = await POST(postResend(" MAYA@WISC.EDU "), noParams);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(SAME_RESPONSE);
    expect(sendInviteEmail).toHaveBeenCalledWith({ email: "maya@wisc.edu", name: "Maya Chen", allowedEmailId: "invite-1" });
    expect(createSystemAuditEntry).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "allowed_email",
      entityId: "invite-1",
      action: "invite_link_requested",
      after: expect.objectContaining({ emailStatus: "sent" }),
    }));
    expect(JSON.stringify(vi.mocked(createSystemAuditEntry).mock.calls[0])).not.toContain("maya@wisc.edu");
  });

  it.each([
    ["unknown address", null, null],
    ["claimed invite", { ...pendingInvite, claimedAt: new Date() }, null],
    ["registered account", pendingInvite, { id: "user-1" }],
    ["collaborator without an active policy", { ...pendingInvite, role: "COLLABORATOR", collaboratorPolicy: { status: "SUSPENDED" } }, null],
  ])("sends nothing for a %s and answers the same way", async (_label, invite, user) => {
    vi.mocked(db.allowedEmail.findUnique).mockResolvedValue(invite as never);
    vi.mocked(db.user.findUnique).mockResolvedValue(user as never);

    const response = await POST(postResend("maya@wisc.edu"), noParams);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(SAME_RESPONSE);
    expect(sendInviteEmail).not.toHaveBeenCalled();
    expect(createSystemAuditEntry).not.toHaveBeenCalled();
  });

  it("rate limits per address and per IP before touching the database", async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: true, remaining: 1, resetAt: 0 })
      .mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: 0 });

    const response = await POST(postResend("maya@wisc.edu"), noParams);

    expect(response.status).toBe(429);
    expect(checkRateLimit).toHaveBeenCalledWith("invite-resend:ip:127.0.0.1", expect.any(Object));
    expect(checkRateLimit).toHaveBeenCalledWith("invite-resend:email:maya@wisc.edu", expect.any(Object));
    expect(db.allowedEmail.findUnique).not.toHaveBeenCalled();
  });

  it("says so when invite email is not configured instead of pretending to send", async () => {
    apiKey = "";
    vi.mocked(db.allowedEmail.findUnique).mockResolvedValue(pendingInvite as never);

    const body = await (await POST(postResend("maya@wisc.edu"), noParams)).json();

    expect(body.inviteEmailConfigured).toBe(false);
    expect(sendInviteEmail).not.toHaveBeenCalled();
  });
});
