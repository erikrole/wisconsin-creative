import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("@/lib/db", () => ({ db: { allowedEmail: { findUnique: vi.fn() } } }));
vi.mock("@/lib/api", () => ({
  withAuth: (handler: unknown) => handler,
}));
vi.mock("@/lib/rbac", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: vi.fn() }));
vi.mock("@/lib/audit", () => ({ createAuditEntry: vi.fn() }));
vi.mock("@/lib/hiring/invite-scope", () => ({ assertNotHiringInvite: vi.fn() }));
const { sendEmail, envMock } = vi.hoisted(() => ({ sendEmail: vi.fn(), envMock: { resendApiKey: "key", appUrl: "https://example.test" } }));
vi.mock("@/lib/email", async (orig) => ({ ...(await orig<typeof import("@/lib/email")>()), sendEmail }));
vi.mock("@/lib/env", () => ({ env: envMock }));

import { db } from "@/lib/db";
import { POST } from "@/app/api/allowed-emails/[id]/send/route";
import { buildInviteEmail } from "@/lib/email";

const call = (POST as unknown as (req: Request, ctx: unknown) => Promise<Response>);
const ctx = { user: { id: "u1", role: "ADMIN" }, params: { id: "a1" } };

describe("POST /api/allowed-emails/[id]/send", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envMock.resendApiKey = "key";
    (db.allowedEmail.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "a1", email: "kai@example.edu", preloadedName: "Kai Mercer", claimedAt: null });
    sendEmail.mockResolvedValue(true);
  });

  it("emails the login link to an unclaimed invite", async () => {
    const res = await call(new Request("http://x", { method: "POST" }), ctx);
    expect(res.status).toBe(200);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const arg = sendEmail.mock.calls[0]![0];
    expect(arg.to).toBe("kai@example.edu");
    expect(arg.html).toContain("https://example.test/login?email=kai%40example.edu");
  });

  it("refuses a claimed invite and sends nothing", async () => {
    (db.allowedEmail.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "a1", email: "k@x.edu", claimedAt: new Date() });
    await expect(call(new Request("http://x", { method: "POST" }), ctx)).rejects.toMatchObject({ status: 400 });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("says so when email delivery is not configured, without sending", async () => {
    envMock.resendApiKey = "";
    await expect(call(new Request("http://x", { method: "POST" }), ctx)).rejects.toMatchObject({ status: 409 });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("escapes the name and link in the invite email", () => {
    const html = buildInviteEmail({ name: "<b>Kai</b>", loginUrl: "https://x.test/login?a=1&b=2" });
    expect(html).not.toContain("<b>Kai</b>");
    expect(html).toContain("&amp;b=2");
  });

  it("is wired into onboarding rows and the application sheet", () => {
    expect(readFileSync("src/app/(app)/staff/onboarding-status/page.tsx", "utf8")).toContain("/api/allowed-emails/${row.id}/send");
    expect(readFileSync("src/app/(app)/staff/workforce/hiring/ApplicationSheet.tsx", "utf8")).toContain("/api/allowed-emails/${detail.invite.id}/send");
  });
});
