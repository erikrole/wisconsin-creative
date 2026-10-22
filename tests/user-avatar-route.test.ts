import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(),
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/audit", () => ({
  createAuditEntryTx: vi.fn(),
}));

vi.mock("@/lib/blob", () => ({
  publicBlobAuth: () => ({ token: "test-public-store" }),
  validateImage: vi.fn(() => null),
  deleteImage: vi.fn(async () => undefined),
  isBlobUrl: vi.fn(() => true),
  imageExtensionForType: vi.fn((type: string) => (type === "image/webp" ? "webp" : "jpg")),
}));

vi.mock("@/lib/avatar-image", () => ({ prepareAvatarImage: vi.fn(async () => Buffer.from("normalized-avatar")) }));

vi.mock("@vercel/blob", () => ({
  put: vi.fn(async () => ({ url: "https://blob.example.com/new-avatar.webp" })),
}));

vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(async () => undefined),
  getClientIp: vi.fn(() => "203.0.113.10"),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAuditEntryTx } from "@/lib/audit";
import { deleteImage } from "@/lib/blob";
import { enforceRateLimit } from "@/lib/rate-limit";
import { put } from "@vercel/blob";
import { DELETE, GET, POST } from "@/app/api/users/[id]/avatar/route";

const adminUser = {
  id: "admin-1",
  email: "admin@example.com",
  name: "Admin",
  role: Role.ADMIN,
  avatarUrl: null,
};

const staffUser = {
  id: "staff-1",
  email: "staff@example.com",
  name: "Staff",
  role: Role.STAFF,
  avatarUrl: null,
};

function userResult(row: unknown) {
  return row as Awaited<ReturnType<typeof db.user.findUnique>>;
}

function userUpdate(row: unknown) {
  return row as Awaited<ReturnType<typeof db.user.update>>;
}

const targetId = "student-1";
const oldAvatarUrl = "https://old.public.blob.vercel-storage.com/avatar.webp";

function params(id = targetId) {
  return { params: Promise.resolve({ id }) };
}

function avatarPostRequest(pathId = targetId, fileName = "avatar.webp") {
  const form = new FormData();
  form.set("file", new File(["image"], fileName, { type: "image/webp" }));

  return new Request(`https://app.example.com/api/users/${pathId}/avatar`, {
    method: "POST",
    headers: {
      host: "app.example.com",
      origin: "https://app.example.com",
    },
    body: form,
  });
}

function avatarDeleteRequest(pathId = targetId) {
  return new Request(`https://app.example.com/api/users/${pathId}/avatar`, {
    method: "DELETE",
    headers: {
      host: "app.example.com",
      origin: "https://app.example.com",
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.$transaction).mockImplementation(async (fn) => (fn as (tx: typeof db) => Promise<unknown>)(db));
  vi.mocked(createAuditEntryTx).mockResolvedValue(undefined);
  vi.mocked(requireAuth).mockResolvedValue(adminUser);
  vi.mocked(db.user.findUnique).mockResolvedValue(userResult({
    id: targetId,
    avatarUrl: oldAvatarUrl,
  }));
  vi.mocked(db.user.update).mockResolvedValue(userUpdate({
    id: targetId,
    avatarUrl: "https://blob.example.com/new-avatar.webp",
  }));
});

describe("/api/users/[id]/avatar", () => {
  it("lets an admin upload another user's profile photo", async () => {
    const res = await POST(avatarPostRequest(), params());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.avatarUrl).toBe("https://blob.example.com/new-avatar.webp");
    expect(enforceRateLimit).toHaveBeenCalledWith("avatar:ip:203.0.113.10", { max: 60, windowMs: 60 * 60_000 });
    expect(enforceRateLimit).toHaveBeenCalledWith("avatar:admin-1", { max: 10, windowMs: 60 * 60_000 });
    expect(put).toHaveBeenCalled();
    expect(deleteImage).toHaveBeenCalledWith(oldAvatarUrl);
    expect(db.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: targetId },
      data: { avatarUrl: "https://blob.example.com/new-avatar.webp" },
    }));
    expect(createAuditEntryTx).toHaveBeenCalledWith(db, expect.objectContaining({
      actorId: "admin-1",
      actorRole: "ADMIN",
      entityType: "user_avatar",
      entityId: targetId,
      action: "avatar_uploaded",
    }));
  });

  it("lets an admin remove another user's profile photo", async () => {
    const res = await DELETE(avatarDeleteRequest(), params());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.avatarUrl).toBeNull();
    expect(deleteImage).toHaveBeenCalledWith(oldAvatarUrl);
    expect(db.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: targetId },
      data: { avatarUrl: null },
    }));
    expect(createAuditEntryTx).toHaveBeenCalledWith(db, expect.objectContaining({
      actorId: "admin-1",
      actorRole: "ADMIN",
      entityType: "user_avatar",
      entityId: targetId,
      action: "avatar_deleted",
      before: { avatarUrl: oldAvatarUrl },
    }));
  });

  it("derives the blob pathname extension from the MIME type, not the client filename", async () => {
    const res = await POST(avatarPostRequest(targetId, "evil.png/../../x.html"), params());

    expect(res.status).toBe(200);
    const pathname = vi.mocked(put).mock.calls[0]![0] as string;
    expect(pathname).toMatch(/^avatars\/student-1\/\d+\.webp$/);
  });

  it("deletes the freshly uploaded blob when the database update fails", async () => {
    const databaseError = new Error("db down");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(db.user.update).mockRejectedValueOnce(databaseError);

    const res = await POST(avatarPostRequest(), params());

    expect(res.status).toBe(500);
    expect(deleteImage).toHaveBeenCalledWith("https://blob.example.com/new-avatar.webp");
    expect(deleteImage).not.toHaveBeenCalledWith(oldAvatarUrl);
    expect(createAuditEntryTx).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(databaseError);
    consoleError.mockRestore();
  });

  it.each(["POST", "DELETE"])("keeps the previous blob when the %s audit fails", async (method) => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(createAuditEntryTx).mockRejectedValueOnce(new Error("audit unavailable"));
    const res = method === "POST"
      ? await POST(avatarPostRequest(), params())
      : await DELETE(avatarDeleteRequest(), params());

    expect(res.status).toBe(500);
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(deleteImage).not.toHaveBeenCalledWith(oldAvatarUrl);
    if (method === "POST") expect(deleteImage).toHaveBeenCalledWith("https://blob.example.com/new-avatar.webp");
    else expect(deleteImage).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("rejects a stale upload without overwriting a newer photo", async () => {
    vi.mocked(db.user.findUnique)
      .mockResolvedValueOnce(userResult({ id: targetId, avatarUrl: oldAvatarUrl }))
      .mockResolvedValueOnce(userResult({ id: targetId, avatarUrl: "https://blob.example.com/newer.webp" }));
    const res = await POST(avatarPostRequest(), params());
    expect(res.status).toBe(409);
    expect(db.user.update).not.toHaveBeenCalled();
    expect(deleteImage).toHaveBeenCalledExactlyOnceWith("https://blob.example.com/new-avatar.webp");
    expect(createAuditEntryTx).not.toHaveBeenCalled();
  });

  it("blocks staff from changing another user's profile photo", async () => {
    vi.mocked(requireAuth).mockResolvedValue(staffUser);

    const res = await POST(avatarPostRequest(), params());
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toContain("Only admins");
    expect(enforceRateLimit).not.toHaveBeenCalled();
    expect(db.user.findUnique).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("rejects a replacement chosen against an older photo before storing a new blob", async () => {
    const req = avatarPostRequest();
    req.headers.set("x-avatar-url", "https://old.example.test/another-photo.webp");
    const res = await POST(req, params());
    expect(res.status).toBe(409);
    expect(put).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("does not remove a newer photo and allows replay after a completed removal", async () => {
    const req = avatarDeleteRequest(); req.headers.set("x-avatar-url", "https://old.example.test/another-photo.webp");
    expect((await DELETE(req, params())).status).toBe(409);
    expect(deleteImage).not.toHaveBeenCalled();
    vi.mocked(db.user.findUnique).mockResolvedValue(userResult({ id: targetId, avatarUrl: null }));
    const replay = await DELETE(req, params());
    expect(replay.status).toBe(200);
    expect((await replay.json()).data.avatarUrl).toBeNull();
    expect(createAuditEntryTx).not.toHaveBeenCalled();
  });

  it("returns the committed receipt for a replay without uploading again", async () => {
    const uploadId = "12345678-1234-1234-1234-123456789abc";
    const avatarUrl = `https://test.public.blob.vercel-storage.com/avatars/${targetId}/${uploadId}-suffix.webp`;
    vi.mocked(db.user.findUnique).mockResolvedValue(userResult({ id: targetId, avatarUrl }));
    const body = new FormData(); body.append("uploadId", uploadId); body.append("file", new File(["image"], "avatar.webp", { type: "image/webp" }));
    const res = await POST(new Request(`https://app.example.com/api/users/${targetId}/avatar`, { method: "POST", headers: { origin: "https://app.example.com", "x-avatar-url": oldAvatarUrl }, body }), params());
    expect(res.status).toBe(200);
    expect((await res.json()).data.avatarUrl).toBe(avatarUrl);
    expect(put).not.toHaveBeenCalled();
    expect(createAuditEntryTx).not.toHaveBeenCalled();
  });

  it("limits receipt reads to the owner or an administrator and rejects a changed actor", async () => {
    vi.mocked(requireAuth).mockResolvedValue(staffUser);
    expect((await GET(new Request(`https://app.example.com/api/users/${targetId}/avatar`), params())).status).toBe(403);
    const req = avatarPostRequest(staffUser.id); req.headers.set("x-expected-actor-id", "previous-user");
    expect((await POST(req, params(staffUser.id))).status).toBe(409);
    expect(put).not.toHaveBeenCalled();
  });
});
