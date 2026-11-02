import { describe, it, expect, vi, beforeEach } from "vitest";
import { Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
  tokenHash: vi.fn(),
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
}));

const mockTx = {
  passwordResetToken: {
    findUnique: vi.fn(),
    deleteMany: vi.fn(),
  },
  user: {
    updateMany: vi.fn(),
  },
  apiToken: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  session: {
    deleteMany: vi.fn(),
  },
  deviceToken: {
    updateMany: vi.fn(),
  },
  liveActivityStartToken: {
    updateMany: vi.fn(),
  },
  liveActivityToken: {
    count: vi.fn(),
  },
  liveActivityStart: {
    count: vi.fn(),
  },
};

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(async (input: unknown) => {
      if (Array.isArray(input)) return Promise.all(input);
      return (input as (tx: typeof mockTx) => Promise<unknown>)(mockTx);
    }),
    user: {
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    apiToken: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    session: {
      deleteMany: vi.fn(),
    },
    passwordResetToken: {
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/audit", () => ({
  createAuditEntry: vi.fn(),
  createAuditEntryTx: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  enforceRateLimit: vi.fn(),
  getClientIp: vi.fn(),
}));

vi.mock("@/lib/companion-store", () => ({
  revokeCompanionUser: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { requireAuth, tokenHash, hashPassword, verifyPassword } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAuditEntry, createAuditEntryTx } from "@/lib/audit";
import { checkRateLimit, enforceRateLimit, getClientIp } from "@/lib/rate-limit";
import { revokeCompanionUser } from "@/lib/companion-store";
import { PATCH as patchProfile } from "@/app/api/profile/route";
import { POST as resetPassword } from "@/app/api/auth/reset-password/route";

function userForPassword(row: unknown) {
  return row as Awaited<ReturnType<typeof db.user.findUniqueOrThrow>>;
}

function userUpdateResult(row: unknown) {
  return row as Awaited<ReturnType<typeof db.user.update>>;
}

function deleteManyResult(count: number) {
  return { count } as Awaited<ReturnType<typeof db.session.deleteMany>>;
}

function authedRequest(path: string, body: Record<string, unknown>) {
  return new Request(`https://app.example.com${path}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      origin: "https://app.example.com",
    },
    body: JSON.stringify(body),
  });
}

function publicPost(path: string, body: Record<string, unknown>) {
  return new Request(`https://app.example.com${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0.1" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({
    id: "user-1",
    email: "user@example.com",
    name: "User One",
    role: Role.STAFF,
    avatarUrl: null,
    forcePasswordChange: false,
  });
  vi.mocked(hashPassword).mockResolvedValue("next-hash");
  vi.mocked(verifyPassword).mockResolvedValue(true);
  vi.mocked(tokenHash).mockResolvedValue("hashed-token");
  vi.mocked(checkRateLimit).mockResolvedValue({
    allowed: true,
    remaining: 4,
    resetAt: Date.now() + 60_000,
  });
  vi.mocked(getClientIp).mockReturnValue("127.0.0.1");
  vi.mocked(revokeCompanionUser).mockResolvedValue(undefined);

  vi.mocked(db.user.findUniqueOrThrow).mockResolvedValue(userForPassword({
    id: "user-1",
    passwordHash: "old-hash",
  }));
  vi.mocked(db.user.update).mockResolvedValue(userUpdateResult({ id: "user-1" }));
  vi.mocked(db.session.deleteMany).mockResolvedValue(deleteManyResult(2));
  mockTx.passwordResetToken.findUnique.mockResolvedValue({
    id: "token-1",
    userId: "user-1",
    expiresAt: new Date(Date.now() + 60_000),
    user: { id: "user-1", role: Role.STUDENT, active: true },
  });
  mockTx.passwordResetToken.deleteMany
    .mockResolvedValueOnce({ count: 1 })
    .mockResolvedValue({ count: 0 });
  mockTx.user.updateMany.mockResolvedValue({ count: 1 });
  mockTx.session.deleteMany.mockResolvedValue({ count: 3 });
  mockTx.deviceToken.updateMany.mockResolvedValue({ count: 2 });
  mockTx.liveActivityStartToken.updateMany.mockResolvedValue({ count: 1 });
  mockTx.liveActivityToken.count.mockResolvedValue(4);
  mockTx.liveActivityStart.count.mockResolvedValue(3);
});

describe("auth hardening", () => {
  it("BUG: self-service password change invalidates existing sessions atomically", async () => {
    const res = await patchProfile(
      authedRequest("/api/profile", {
        action: "change_password",
        currentPassword: "old-password",
        newPassword: "new-password",
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(200);
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { passwordHash: "next-hash", forcePasswordChange: false },
    });
    expect(db.session.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    expect(db.$transaction).toHaveBeenCalledWith([
      expect.any(Promise),
      expect.any(Promise),
      expect.any(Promise),
    ]);
    expect(revokeCompanionUser).toHaveBeenCalledWith("user-1");
    expect(createAuditEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "user-1",
        action: "password_change",
      }),
    );
  });

  it("throttles password guesses through the profile route like the dedicated one", async () => {
    vi.mocked(verifyPassword).mockResolvedValue(false);

    const res = await patchProfile(
      authedRequest("/api/profile", { action: "change_password", currentPassword: "wrong-password", newPassword: "new-password" }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(400);
    expect(enforceRateLimit).toHaveBeenCalledWith("change-password:user-1", { max: 5, windowMs: 60_000 });
  });

  it("refuses a password change from an API token", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      id: "user-1", email: "user@example.com", name: "User One", role: Role.STAFF, avatarUrl: null, apiTokenScope: "WRITE",
    });

    const res = await patchProfile(
      authedRequest("/api/profile", { action: "change_password", currentPassword: "old-password", newPassword: "new-password" }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(403);
    expect(verifyPassword).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("reports a committed profile password change when companion revocation fails", async () => {
    vi.mocked(revokeCompanionUser).mockRejectedValue(new Error("Redis unavailable"));

    const res = await patchProfile(
      authedRequest("/api/profile", {
        action: "change_password",
        currentPassword: "old-password",
        newPassword: "new-password",
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(503);
    expect(db.$transaction).toHaveBeenCalled();
    expect(db.user.update).toHaveBeenCalled();
  });

  it("BUG: password reset consumes the token inside a Serializable transaction", async () => {
    const res = await resetPassword(
      publicPost("/api/auth/reset-password", {
        token: "raw-token",
        password: "new-password",
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(200);
    expect(db.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: "Serializable" },
    );
    expect(revokeCompanionUser).toHaveBeenCalledWith("user-1");
    expect(mockTx.passwordResetToken.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: "hashed-token" },
      include: { user: { select: { id: true, role: true, active: true } } },
    });
    expect(mockTx.passwordResetToken.deleteMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          id: "token-1",
          expiresAt: expect.objectContaining({ gte: expect.any(Date) }),
        }),
      }),
    );
    expect(mockTx.user.updateMany).toHaveBeenCalledWith({
      where: { id: "user-1", active: true },
      data: { passwordHash: "next-hash", forcePasswordChange: false },
    });
    expect(mockTx.session.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    const revokedAt = mockTx.deviceToken.updateMany.mock.calls[0]![0].data.revokedAt;
    expect(mockTx.deviceToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", revokedAt: null },
      data: { revokedAt },
    });
    expect(mockTx.liveActivityStartToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", revokedAt: null },
      data: { revokedAt },
    });
    expect(mockTx.liveActivityToken.count).toHaveBeenCalledWith({
      where: { userId: "user-1", endedAt: null },
    });
    expect(mockTx.liveActivityStart.count).toHaveBeenCalledWith({
      where: { userId: "user-1", endedAt: null },
    });
    expect(createAuditEntryTx).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({
        actorId: "user-1",
        action: "password_reset_self",
        after: expect.objectContaining({
          notificationAccessRevoked: {
            deviceTokens: 2,
            liveActivityStartTokens: 1,
            liveActivityTokensQueuedForEnd: 4,
            liveActivityStartsQueuedForEnd: 3,
          },
        }),
      }),
    );
  });

  it("rejects password reset consumption for an inactive user", async () => {
    mockTx.passwordResetToken.findUnique.mockResolvedValue({
      id: "token-1",
      userId: "user-1",
      expiresAt: new Date(Date.now() + 60_000),
      user: { id: "user-1", role: Role.STUDENT, active: false },
    });

    const res = await resetPassword(
      publicPost("/api/auth/reset-password", {
        token: "raw-token",
        password: "new-password",
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(400);
    expect(revokeCompanionUser).not.toHaveBeenCalled();
    expect(db.$transaction).toHaveBeenCalled();
    expect(mockTx.user.updateMany).not.toHaveBeenCalled();
  });

  it("reports when companion revocation fails after a reset commits", async () => {
    vi.mocked(revokeCompanionUser).mockRejectedValue(new Error("Redis unavailable"));

    const res = await resetPassword(
      publicPost("/api/auth/reset-password", {
        token: "raw-token",
        password: "new-password",
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(503);
    expect(db.$transaction).toHaveBeenCalled();
    expect(mockTx.passwordResetToken.deleteMany).toHaveBeenCalled();
    expect(mockTx.user.updateMany).toHaveBeenCalled();
  });
});
