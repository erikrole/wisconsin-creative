import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/audit", () => ({ createAuditEntry: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
  SETTINGS_MUTATION_LIMIT: { max: 60, windowMs: 60_000 },
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/hiring/invite-scope", () => ({ assertNotHiringInvite: vi.fn() }));
vi.mock("@/lib/services/invite-email", () => ({ sendInviteEmail: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { allowedEmail: { findUnique: vi.fn() } } }));

import { requireAuth } from "@/lib/auth";
import { createAuditEntry } from "@/lib/audit";
import { db } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { sendInviteEmail } from "@/lib/services/invite-email";
import { POST } from "@/app/api/allowed-emails/[id]/resend/route";

const req = () =>
  new Request("https://app.example.com/api/allowed-emails/inv-1/resend", {
    method: "POST",
    headers: { host: "app.example.com", origin: "https://app.example.com" },
  });
const ctx = { params: Promise.resolve({ id: "inv-1" }) };
const asRole = (role: string) =>
  vi.mocked(requireAuth).mockResolvedValue({
    id: `${role}-1`,
    email: `${role}@example.test`,
    name: role,
    role,
    avatarUrl: null,
    forcePasswordChange: false,
  } as never);
const invite = { id: "inv-1", email: "mia@wisc.edu", preloadedName: "Mia Sato", claimedAt: null };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/allowed-emails/[id]/resend", () => {
  it("rejects students", async () => {
    asRole("STUDENT");
    const res = await POST(req(), ctx);
    expect(res.status).toBe(403);
    expect(sendInviteEmail).not.toHaveBeenCalled();
  });

  it("emails a reminder for a pending invite and audits the attempt without the address", async () => {
    asRole("ADMIN");
    vi.mocked(db.allowedEmail.findUnique).mockResolvedValue(invite as never);
    vi.mocked(sendInviteEmail).mockResolvedValue("sent");
    const res = await POST(req(), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { emailStatus: "sent" } });
    expect(sendInviteEmail).toHaveBeenCalledWith({ email: "mia@wisc.edu", name: "Mia Sato", kind: "reminder", allowedEmailId: "inv-1" });
    expect(enforceRateLimit).toHaveBeenCalledWith("allowed-emails:resend:inv-1", expect.objectContaining({ max: 3 }));
    const audit = vi.mocked(createAuditEntry).mock.calls[0]![0];
    expect(audit).toMatchObject({ entityId: "inv-1", action: "invite_resent", after: { emailStatus: "sent" } });
    expect(JSON.stringify(audit)).not.toContain("mia@wisc.edu");
  });

  it("refuses an invite that was already claimed", async () => {
    asRole("ADMIN");
    vi.mocked(db.allowedEmail.findUnique).mockResolvedValue({ ...invite, claimedAt: new Date() } as never);
    const res = await POST(req(), ctx);
    expect(res.status).toBe(409);
    expect(sendInviteEmail).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown invite", async () => {
    asRole("ADMIN");
    vi.mocked(db.allowedEmail.findUnique).mockResolvedValue(null);
    expect((await POST(req(), ctx)).status).toBe(404);
  });

  it("returns a gateway error when delivery fails, and success when email is not configured", async () => {
    asRole("ADMIN");
    vi.mocked(db.allowedEmail.findUnique).mockResolvedValue(invite as never);
    vi.mocked(sendInviteEmail).mockResolvedValueOnce("failed");
    expect((await POST(req(), ctx)).status).toBe(502);
    vi.mocked(sendInviteEmail).mockResolvedValueOnce("not_configured");
    const res = await POST(req(), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { emailStatus: "not_configured" } });
  });
});
