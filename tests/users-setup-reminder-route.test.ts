import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/audit", () => ({ createAuditEntry: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
  SETTINGS_MUTATION_LIMIT: { max: 60, windowMs: 60_000 },
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/services/invite-email", () => ({ sendInviteEmail: vi.fn() }));
vi.mock("@/lib/profile-completion", () => ({ getProfileCompletion: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: vi.fn() } } }));

import { requireAuth } from "@/lib/auth";
import { createAuditEntry } from "@/lib/audit";
import { db } from "@/lib/db";
import { getProfileCompletion } from "@/lib/profile-completion";
import { enforceRateLimit } from "@/lib/rate-limit";
import { sendInviteEmail } from "@/lib/services/invite-email";
import { POST } from "@/app/api/users/[id]/setup-reminder/route";

const req = () =>
  new Request("https://app.example.com/api/users/u1/setup-reminder", {
    method: "POST",
    headers: { host: "app.example.com", origin: "https://app.example.com" },
  });
const ctx = { params: Promise.resolve({ id: "u1" }) };
const asRole = (role: string) =>
  vi.mocked(requireAuth).mockResolvedValue({
    id: `${role}-1`,
    email: `${role}@example.test`,
    name: role,
    role,
    avatarUrl: null,
    forcePasswordChange: false,
  } as never);
const person = { id: "u1", name: "Mia Sato", email: "mia@wisc.edu", active: true, hiddenFromRoster: false };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getProfileCompletion).mockReturnValue({ profileComplete: false } as never);
});

describe("POST /api/users/[id]/setup-reminder", () => {
  it("rejects students", async () => {
    asRole("STUDENT");
    expect((await POST(req(), ctx)).status).toBe(403);
    expect(sendInviteEmail).not.toHaveBeenCalled();
  });

  it("emails a reminder to someone who has not finished setup and audits it without the address", async () => {
    asRole("ADMIN");
    vi.mocked(db.user.findUnique).mockResolvedValue(person as never);
    vi.mocked(sendInviteEmail).mockResolvedValue("sent");
    const res = await POST(req(), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { emailStatus: "sent" } });
    expect(sendInviteEmail).toHaveBeenCalledWith({ email: "mia@wisc.edu", name: "Mia Sato", kind: "reminder" });
    expect(enforceRateLimit).toHaveBeenCalledWith("users:setup-reminder:u1", expect.objectContaining({ max: 1 }));
    const audit = vi.mocked(createAuditEntry).mock.calls[0]![0];
    expect(audit).toMatchObject({ entityId: "u1", action: "setup_reminder_sent", after: { emailStatus: "sent" } });
    expect(JSON.stringify(audit)).not.toContain("mia@wisc.edu");
  });

  it("refuses someone who already finished setup", async () => {
    asRole("ADMIN");
    vi.mocked(db.user.findUnique).mockResolvedValue(person as never);
    vi.mocked(getProfileCompletion).mockReturnValue({ profileComplete: true } as never);
    expect((await POST(req(), ctx)).status).toBe(409);
    expect(sendInviteEmail).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown, inactive or hidden account", async () => {
    asRole("ADMIN");
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    expect((await POST(req(), ctx)).status).toBe(404);
    vi.mocked(db.user.findUnique).mockResolvedValue({ ...person, active: false } as never);
    expect((await POST(req(), ctx)).status).toBe(404);
    vi.mocked(db.user.findUnique).mockResolvedValue({ ...person, hiddenFromRoster: true } as never);
    expect((await POST(req(), ctx)).status).toBe(404);
  });

  it("returns a gateway error when delivery fails, and success when email is not configured", async () => {
    asRole("ADMIN");
    vi.mocked(db.user.findUnique).mockResolvedValue(person as never);
    vi.mocked(sendInviteEmail).mockResolvedValueOnce("failed");
    expect((await POST(req(), ctx)).status).toBe(502);
    vi.mocked(sendInviteEmail).mockResolvedValueOnce("not_configured");
    const res = await POST(req(), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { emailStatus: "not_configured" } });
  });
});
