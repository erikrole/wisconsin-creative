import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const dbMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  session: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    deleteMany: vi.fn(),
  },
}));

const cookieJar = vi.hoisted(() => ({
  value: "raw-session-token" as string | undefined,
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn(() => (cookieJar.value ? { value: cookieJar.value } : undefined)),
  })),
}));

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
  tokenHash: vi.fn(),
  verifyPassword: vi.fn(),
  hashPassword: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: dbMock,
}));

vi.mock("@/lib/env", () => ({
  env: {
    sessionCookieName: "app_session",
    trustedOrigins: ["https://app.example.com"],
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  createAuditEntry: vi.fn(),
}));

vi.mock("@/lib/companion-store", () => ({
  revokeCompanionUser: vi.fn(),
}));

import { requireAuth, tokenHash, verifyPassword, hashPassword } from "@/lib/auth";
import { db } from "@/lib/db";
import { revokeCompanionUser } from "@/lib/companion-store";
import { DELETE as revokeOtherSessions } from "@/app/api/me/sessions/route";
import { POST as changePassword } from "@/app/api/me/change-password/route";

const user = {
  id: "user-1",
  email: "user@example.com",
  name: "User One",
  role: Role.STAFF,
  avatarUrl: null,
  forcePasswordChange: false,
};

function request(path: string, body?: Record<string, unknown>) {
  return new Request(`https://app.example.com${path}`, {
    method: body ? "POST" : "DELETE",
    headers: {
      "content-type": "application/json",
      origin: "https://app.example.com",
      host: "app.example.com",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  cookieJar.value = "raw-session-token";
  vi.mocked(requireAuth).mockResolvedValue(user);
  vi.mocked(tokenHash).mockResolvedValue("hashed-session-token");
  vi.mocked(verifyPassword).mockResolvedValue(true);
  vi.mocked(hashPassword).mockResolvedValue("new-password-hash");
  dbMock.user.findUnique.mockResolvedValue({ id: "user-1", passwordHash: "old-password-hash" });
  dbMock.user.update.mockResolvedValue({ id: "user-1" });
  dbMock.session.findUnique.mockResolvedValue({ id: "current-session" });
  dbMock.session.deleteMany.mockResolvedValue({ count: 2 });
  vi.mocked(revokeCompanionUser).mockResolvedValue(undefined);
});

describe("self-service session management", () => {
  it("revokes every session except the verified current session", async () => {
    const res = await revokeOtherSessions(request("/api/me/sessions"), { params: Promise.resolve({}) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.revokedCount).toBe(2);
    expect(db.session.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        id: { not: "current-session" },
      },
    });
    expect(revokeCompanionUser).not.toHaveBeenCalled();
  });

  it("reports a committed password change when companion revocation fails", async () => {
    vi.mocked(revokeCompanionUser).mockRejectedValue(new Error("Redis unavailable"));

    const res = await changePassword(
      request("/api/me/change-password", {
        currentPassword: "old-password",
        newPassword: "new-password",
        revokeOtherSessions: false,
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(503);
    expect(db.user.update).toHaveBeenCalled();
    expect(db.session.deleteMany).not.toHaveBeenCalled();
  });

  it("does not bulk-delete sessions when the current session cannot be re-identified", async () => {
    dbMock.session.findUnique.mockResolvedValueOnce(null);

    const res = await revokeOtherSessions(request("/api/me/sessions"), { params: Promise.resolve({}) });

    expect(res.status).toBe(401);
    expect(db.session.deleteMany).not.toHaveBeenCalled();
  });

  it("changes password and revokes other sessions only after verifying the current session", async () => {
    const res = await changePassword(
      request("/api/me/change-password", {
        currentPassword: "old-password",
        newPassword: "new-password",
        revokeOtherSessions: true,
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(200);
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { passwordHash: "new-password-hash", forcePasswordChange: false },
    });
    expect(db.session.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        id: { not: "current-session" },
      },
    });
    expect(revokeCompanionUser).toHaveBeenCalledWith("user-1");
  });

  it("does not change password when revoke-other-sessions cannot verify the current session", async () => {
    dbMock.session.findUnique.mockResolvedValueOnce(null);

    const res = await changePassword(
      request("/api/me/change-password", {
        currentPassword: "old-password",
        newPassword: "new-password",
        revokeOtherSessions: true,
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(401);
    expect(db.user.update).not.toHaveBeenCalled();
    expect(db.session.deleteMany).not.toHaveBeenCalled();
  });
});
