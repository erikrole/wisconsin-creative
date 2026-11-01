import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  cookieStore: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
  after: vi.fn(),
  db: {
    session: { findUnique: vi.fn(), deleteMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    user: { updateMany: vi.fn() },
    kioskDevice: { update: vi.fn(), findUnique: vi.fn() },
  },
  readPreview: vi.fn(),
  clearPreview: vi.fn(),
  previewInfo: vi.fn(),
  previewPolicy: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: mocks.after,
}));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => mocks.cookieStore), headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/env", () => ({ env: { sessionSecret: "test-session-secret-value-32chars", sessionCookieName: "wc_session" } }));
vi.mock("@/lib/role-preview", () => ({
  clearRolePreviewCookie: mocks.clearPreview,
  readRolePreviewCookie: mocks.readPreview,
  rolePreviewCollaboratorPolicyMetadata: mocks.previewPolicy,
  rolePreviewInfo: mocks.previewInfo,
}));

import { createSession, destroySession, requireAuth, requireKiosk, tokenHash } from "@/lib/auth";

const now = new Date("2026-10-25T17:00:00.000Z");
const hours = (count: number) => count * 60 * 60 * 1000;

function sessionRow(user: Record<string, unknown> = {}) {
  return {
    id: "s1",
    expiresAt: new Date(now.getTime() + hours(11.5)),
    createdAt: new Date(now.getTime() - hours(1)),
    persistent: false,
    user: {
      id: "u1", email: "ada@wisc.edu", name: "Ada", role: Role.STAFF, active: true, affiliation: null,
      collaboratorProfile: null, collaboratorPolicyId: null, collaboratorPolicy: null, staffingType: "FT",
      avatarUrl: null, forcePasswordChange: false, onboardingRequired: false, onboardingCompletedAt: now,
      lastActiveAt: now,
      ...user,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  mocks.cookieStore.get.mockReturnValue({ value: "raw-token" });
  mocks.readPreview.mockResolvedValue(null);
  mocks.db.session.findUnique.mockResolvedValue(sessionRow());
});
afterEach(() => { vi.useRealTimers(); });

describe("requireAuth", () => {
  it("rejects a request with no session cookie", async () => {
    mocks.cookieStore.get.mockReturnValue(undefined);

    await expect(requireAuth()).rejects.toMatchObject({ status: 401, message: "Authentication required" });
    expect(mocks.db.session.findUnique).not.toHaveBeenCalled();
  });

  it("looks the session up by the hashed token and returns the person", async () => {
    const user = await requireAuth();

    expect(mocks.db.session.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tokenHash: await tokenHash("raw-token") } }));
    expect(user).toEqual(expect.objectContaining({ id: "u1", role: Role.STAFF, avatarUrl: null, forcePasswordChange: false, onboardingRequired: false, preview: undefined }));
  });

  it("signs out a deactivated person and removes every session for that token", async () => {
    mocks.db.session.findUnique.mockResolvedValue(sessionRow({ active: false }));

    await expect(requireAuth()).rejects.toMatchObject({ status: 401, message: "Account deactivated" });
    expect(mocks.cookieStore.delete).toHaveBeenCalledWith("wc_session");
    expect(mocks.clearPreview).toHaveBeenCalled();
    expect(mocks.db.session.deleteMany).toHaveBeenCalledWith({ where: { tokenHash: await tokenHash("raw-token") } });
  });

  it("records activity only when the last mark is stale", async () => {
    await requireAuth();
    expect(mocks.db.user.updateMany).not.toHaveBeenCalled();

    mocks.db.session.findUnique.mockResolvedValue(sessionRow({ lastActiveAt: new Date(now.getTime() - hours(1)) }));
    await requireAuth();
    expect(mocks.db.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "u1" }), data: { lastActiveAt: now } }));
  });

  it("logs, rather than fails, when the activity or slide write fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.db.session.findUnique.mockResolvedValue({ ...sessionRow({ lastActiveAt: null }), expiresAt: new Date(now.getTime() + hours(1)) });
    mocks.db.user.updateMany.mockRejectedValue(new Error("db down"));
    mocks.db.session.updateMany.mockRejectedValue(new Error("db down"));

    await expect(requireAuth()).resolves.toEqual(expect.objectContaining({ id: "u1" }));
    expect(error).toHaveBeenCalledWith("Failed to update user last active timestamp", expect.any(Error));
    expect(error).toHaveBeenCalledWith("Failed to extend session", expect.any(Error));
  });

  it("lets an admin preview another role without recording activity", async () => {
    mocks.db.session.findUnique.mockResolvedValue(sessionRow({ role: Role.ADMIN, lastActiveAt: null }));
    mocks.readPreview.mockResolvedValue({ role: Role.STUDENT, capabilities: [] });
    mocks.previewInfo.mockReturnValue({ role: Role.STUDENT });

    const user = await requireAuth();

    expect(user).toEqual(expect.objectContaining({ id: "u1", role: Role.STUDENT, capabilities: [], preview: { role: Role.STUDENT }, collaboratorPolicy: null }));
    expect(mocks.db.user.updateMany).not.toHaveBeenCalled();
  });

  it("never reads a preview for someone who is not an admin", async () => {
    mocks.readPreview.mockResolvedValue({ role: Role.ADMIN, capabilities: [] });

    expect((await requireAuth()).role).toBe(Role.STAFF);
    expect(mocks.readPreview).not.toHaveBeenCalled();
  });

  it("uses the previewed collaborator policy when an admin previews a collaborator", async () => {
    mocks.db.session.findUnique.mockResolvedValue(sessionRow({ role: Role.ADMIN }));
    mocks.readPreview.mockResolvedValue({ role: Role.COLLABORATOR, capabilities: ["MY_GEAR_VIEW"], collaboratorAffiliation: "btn" });
    const policy = { affiliationKey: "btn", label: "Big Ten Network" };
    mocks.previewPolicy.mockReturnValue(policy);

    const user = await requireAuth();

    expect(mocks.previewPolicy).toHaveBeenCalledWith("btn");
    expect(user).toEqual(expect.objectContaining({ role: Role.COLLABORATOR, affiliation: "btn", collaboratorPolicy: policy, capabilities: ["MY_GEAR_VIEW"] }));
  });
});

describe("createSession and destroySession", () => {
  it("revokes the session already in the browser before issuing a new one", async () => {
    mocks.cookieStore.get.mockReturnValue({ value: "old-token" });

    await createSession("u1");

    expect(mocks.clearPreview).toHaveBeenCalled();
    expect(mocks.db.session.deleteMany).toHaveBeenCalledWith({ where: { tokenHash: await tokenHash("old-token") } });
    const { data } = mocks.db.session.create.mock.calls[0]![0];
    expect(data).toEqual({ userId: "u1", tokenHash: expect.stringMatching(/^[0-9a-f]+$/), expiresAt: new Date(now.getTime() + hours(12)), persistent: false });
    const [name, raw, options] = mocks.cookieStore.set.mock.calls[0]!;
    expect(name).toBe("wc_session");
    expect(await tokenHash(raw)).toBe(data.tokenHash);
    expect(options).toEqual(expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }));
  });

  it("skips the revoke on a first sign-in", async () => {
    mocks.cookieStore.get.mockReturnValue(undefined);

    await createSession("u1", true);

    expect(mocks.db.session.deleteMany).not.toHaveBeenCalled();
    expect(mocks.db.session.create.mock.calls[0]![0].data.persistent).toBe(true);
  });

  it("deletes the stored session and clears both cookies on sign-out", async () => {
    await destroySession();

    expect(mocks.db.session.deleteMany).toHaveBeenCalledWith({ where: { tokenHash: await tokenHash("raw-token") } });
    expect(mocks.cookieStore.delete).toHaveBeenCalledWith("wc_session");
    expect(mocks.clearPreview).toHaveBeenCalled();
  });

  it("still clears the cookies when there is no session", async () => {
    mocks.cookieStore.get.mockReturnValue(undefined);

    await destroySession();

    expect(mocks.db.session.deleteMany).not.toHaveBeenCalled();
    expect(mocks.cookieStore.delete).toHaveBeenCalledWith("wc_session");
  });
});

describe("requireKiosk", () => {
  const device = (extra: Record<string, unknown> = {}) => ({
    id: "k1", name: "Camp Randall iPad", active: true,
    sessionExpiresAt: new Date(now.getTime() + hours(24 * 6.5)),
    lastSeenAt: new Date(now.getTime() - 60_000),
    location: { id: "loc-1", name: "Camp Randall" },
    ...extra,
  });

  it("rejects a missing, unknown or deactivated kiosk", async () => {
    mocks.cookieStore.get.mockReturnValueOnce(undefined);
    await expect(requireKiosk()).rejects.toMatchObject({ status: 401, message: "Kiosk session required" });

    mocks.db.kioskDevice.findUnique.mockResolvedValueOnce(null);
    await expect(requireKiosk()).rejects.toMatchObject({ status: 401, message: "Invalid kiosk session" });

    mocks.db.kioskDevice.findUnique.mockResolvedValueOnce(device({ active: false }));
    await expect(requireKiosk()).rejects.toMatchObject({ status: 401, message: "Kiosk device deactivated" });
  });

  it("writes nothing when the session is fresh and the kiosk was seen recently", async () => {
    mocks.db.kioskDevice.findUnique.mockResolvedValue(device());

    expect(await requireKiosk()).toEqual({ kioskId: "k1", name: "Camp Randall iPad", locationId: "loc-1", locationName: "Camp Randall" });
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.cookieStore.set).toHaveBeenCalledWith("kiosk_session", "raw-token", expect.objectContaining({ sameSite: "strict", expires: device().sessionExpiresAt }));
  });

  it("slides an older session and marks the kiosk seen after the response", async () => {
    mocks.db.kioskDevice.findUnique.mockResolvedValue(device({ sessionExpiresAt: new Date(now.getTime() + hours(24 * 5)), lastSeenAt: null }));

    await requireKiosk();
    const slid = new Date(now.getTime() + hours(24 * 7));
    expect(mocks.cookieStore.set).toHaveBeenCalledWith("kiosk_session", "raw-token", expect.objectContaining({ expires: slid }));
    await mocks.after.mock.calls[0]![0]();

    expect(mocks.db.kioskDevice.update).toHaveBeenCalledWith({ where: { id: "k1" }, data: { lastSeenAt: now, sessionExpiresAt: slid } });
  });

  it("logs a failed deferred update", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.db.kioskDevice.findUnique.mockResolvedValue(device({ lastSeenAt: new Date(now.getTime() - hours(1)) }));
    mocks.db.kioskDevice.update.mockRejectedValue(new Error("db down"));

    await requireKiosk();
    await mocks.after.mock.calls[0]![0]();

    expect(mocks.db.kioskDevice.update).toHaveBeenCalledWith({ where: { id: "k1" }, data: { lastSeenAt: now } });
    expect(error).toHaveBeenCalledWith("[Kiosk] deferred activity update failed", expect.any(Error));
  });
});
