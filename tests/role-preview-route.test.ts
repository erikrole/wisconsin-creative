import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import { jsonRequest, routeCtx, authUser } from "./_helpers/route-request";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  audit: vi.fn(),
  cookieStore: { set: vi.fn(), delete: vi.fn(), get: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/audit", () => ({ createAuditEntry: mocks.audit }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => mocks.cookieStore), headers: vi.fn(async () => new Headers()) }));

import { decodeRolePreview } from "@/lib/role-preview";
import { POST, DELETE } from "@/app/api/admin/role-preview/route";

const admin = authUser(Role.ADMIN);
const ctx = routeCtx({});
const start = (body: unknown) => POST(jsonRequest("/api/admin/role-preview", "POST", body), ctx);
const stop = () => DELETE(jsonRequest("/api/admin/role-preview", "DELETE"), ctx);

beforeEach(() => {
  mocks.requireAuth.mockResolvedValue(admin);
});

describe("POST /api/admin/role-preview", () => {
  it("starts a read-only student preview: signed cookie, audit row, info for the client", async () => {
    const res = await start({ role: "STUDENT" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.preview).toMatchObject({ actualRole: Role.ADMIN, role: Role.STUDENT, readOnly: true });
    expect(body.preview.expiresAt).toBeGreaterThan(Date.now());
    const [name, value, options] = mocks.cookieStore.set.mock.calls[0]!;
    expect(name).toBe("gear_tracker_role_preview");
    expect(options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 2 * 60 * 60 });
    const decoded = await decodeRolePreview(value);
    expect(decoded).toMatchObject({ role: Role.STUDENT, capabilities: [] });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "role_preview", entityId: admin.id, action: "start", actorRole: Role.ADMIN,
      after: { role: Role.STUDENT, readOnly: true },
    }));
  });

  it("gives a collaborator preview the chosen affiliation and the collaborator capabilities", async () => {
    const res = await start({ role: "COLLABORATOR", collaboratorAffiliation: "LEARFIELD" });

    expect(res.status).toBe(200);
    const decoded = await decodeRolePreview(mocks.cookieStore.set.mock.calls[0]![1]);
    expect(decoded?.role).toBe(Role.COLLABORATOR);
    expect(decoded?.collaboratorAffiliation).toBe("LEARFIELD");
    expect(decoded?.capabilities.length).toBeGreaterThan(0);
  });

  it("defaults a collaborator preview to Big Ten Network", async () => {
    await start({ role: "COLLABORATOR" });

    const decoded = await decodeRolePreview(mocks.cookieStore.set.mock.calls[0]![1]);
    expect(decoded?.collaboratorAffiliation).toBe("BIG_TEN_NETWORK");
  });

  it("cannot preview as an admin and rejects unknown roles", async () => {
    expect((await start({ role: "ADMIN" })).status).toBe(400);
    expect((await start({ role: "OWNER" })).status).toBe(400);
    expect(mocks.cookieStore.set).not.toHaveBeenCalled();
  });

  it("is admin only, judged by the real role when a preview is already running", async () => {
    mocks.requireAuth.mockResolvedValue(authUser(Role.STAFF));
    expect((await start({ role: "STUDENT" })).status).toBe(403);

    // A previewing admin looks like a student to the rest of the app but may still switch previews.
    mocks.requireAuth.mockResolvedValue({ ...authUser(Role.STUDENT, "admin-1"), preview: { actualRole: Role.ADMIN, role: Role.STUDENT, readOnly: true, expiresAt: Date.now() + 60_000 } });
    const res = await start({ role: "STAFF" });
    expect(res.status).toBe(200);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ actorRole: Role.ADMIN, after: { role: Role.STAFF, readOnly: true } }));
  });
});

describe("DELETE /api/admin/role-preview", () => {
  it("clears the cookie and audits which preview stopped", async () => {
    mocks.requireAuth.mockResolvedValue({ ...authUser(Role.STUDENT, "admin-1"), preview: { actualRole: Role.ADMIN, role: Role.STUDENT, readOnly: true, expiresAt: Date.now() + 60_000 } });

    const res = await stop();

    expect(res.status).toBe(200);
    expect(mocks.cookieStore.delete).toHaveBeenCalledWith("gear_tracker_role_preview");
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "stop", actorRole: Role.ADMIN, before: { role: Role.STUDENT, readOnly: true },
    }));
  });

  it("still succeeds with no preview running, with no before snapshot", async () => {
    const res = await stop();

    expect(res.status).toBe(200);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "stop", before: undefined }));
  });

  it("is admin only", async () => {
    mocks.requireAuth.mockResolvedValue(authUser(Role.STAFF));

    expect((await stop()).status).toBe(403);
    expect(mocks.cookieStore.delete).not.toHaveBeenCalled();
  });
});
