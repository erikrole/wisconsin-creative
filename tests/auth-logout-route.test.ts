import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import { authUser, jsonRequest } from "./_helpers/route-request";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  destroySession: vi.fn(),
  audit: vi.fn(),
  revokePush: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth, requireKiosk: vi.fn(), destroySession: mocks.destroySession }));
vi.mock("@/lib/audit", () => ({ createAuditEntry: mocks.audit }));
vi.mock("@/lib/db", () => ({ db: { webPushSubscription: { updateMany: mocks.revokePush } } }));
vi.mock("@/lib/services/companion-projection-publisher", () => ({ deferCompanionProjectionRefresh: vi.fn() }));

import { POST } from "@/app/api/auth/logout/route";

const ctx = { params: Promise.resolve({}) };
const student = authUser(Role.STUDENT);

beforeEach(() => {
  mocks.requireAuth.mockResolvedValue(student);
  mocks.revokePush.mockResolvedValue({ count: 1 });
});

describe("POST /api/auth/logout", () => {
  it("revokes this account's browser push subscriptions before ending the session", async () => {
    const order: string[] = [];
    mocks.revokePush.mockImplementation(async () => { order.push("revoke"); return { count: 1 }; });
    mocks.destroySession.mockImplementation(async () => { order.push("destroy"); });

    const res = await POST(jsonRequest("/api/auth/logout", "POST"), ctx);

    expect(res.status).toBe(200);
    expect(mocks.revokePush).toHaveBeenCalledWith({
      where: { userId: student.id, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(order).toEqual(["revoke", "destroy"]);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "logout", actorRole: Role.STUDENT }));
  });

  it("still signs out when revoking push subscriptions fails", async () => {
    mocks.revokePush.mockRejectedValue(new Error("connection reset"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(jsonRequest("/api/auth/logout", "POST"), ctx);

    expect(res.status).toBe(200);
    expect(mocks.destroySession).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("audits the real role while a staff member previews another role", async () => {
    mocks.requireAuth.mockResolvedValue({ ...student, preview: { actualRole: Role.ADMIN } });
    await POST(jsonRequest("/api/auth/logout", "POST"), ctx);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ actorRole: Role.ADMIN }));
  });

  it("rejects a cross-site logout request", async () => {
    const req = new Request("https://app.example.com/api/auth/logout", {
      method: "POST",
      headers: { host: "app.example.com", origin: "https://evil.example.net" },
    });
    const res = await POST(req, ctx);
    expect(res.status).toBe(403);
    expect(mocks.destroySession).not.toHaveBeenCalled();
  });
});
