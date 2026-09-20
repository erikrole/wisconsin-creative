import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
  hashPassword: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(async (input: unknown) => {
      if (Array.isArray(input)) return Promise.all(input);
      return (input as (tx: unknown) => Promise<unknown>)(undefined);
    }),
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    session: {
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/audit", () => ({
  createAuditEntry: vi.fn(),
}));

vi.mock("@/lib/companion-store", () => ({
  revokeCompanionUser: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { requireAuth, hashPassword } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAuditEntry } from "@/lib/audit";
import { revokeCompanionUser } from "@/lib/companion-store";
import { POST as adminResetPassword } from "@/app/api/users/[id]/reset-password/route";

const adminUser = {
  id: "admin-1",
  email: "admin@example.com",
  name: "Admin One",
  role: Role.ADMIN,
  avatarUrl: null,
};

function authedPost(path: string) {
  return new Request(`https://app.example.com${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "app.example.com",
      origin: "https://app.example.com",
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(adminUser);
  vi.mocked(hashPassword).mockResolvedValue("hashed-temp");
  vi.mocked(revokeCompanionUser).mockResolvedValue(undefined);
  vi.mocked(db.user.findUnique).mockResolvedValue(
    { id: "user-1", name: "User One" } as unknown as Awaited<ReturnType<typeof db.user.findUnique>>,
  );
  vi.mocked(db.user.update).mockResolvedValue(
    { id: "user-1" } as unknown as Awaited<ReturnType<typeof db.user.update>>,
  );
  vi.mocked(db.session.deleteMany).mockResolvedValue(
    { count: 2 } as unknown as Awaited<ReturnType<typeof db.session.deleteMany>>,
  );
});

describe("admin password reset route", () => {
  it("marks administrator-issued passwords as forced-change credentials", async () => {
    const res = await adminResetPassword(
      authedPost("/api/users/user-1/reset-password"),
      { params: Promise.resolve({ id: "user-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { passwordHash: "hashed-temp", forcePasswordChange: true },
    });
    expect(body.data.forcePasswordChange).toBe(true);
    expect(revokeCompanionUser).toHaveBeenCalledWith("user-1");
    expect(vi.mocked(revokeCompanionUser).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(createAuditEntry).mock.invocationCallOrder[0]!);
    expect(createAuditEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "password_reset",
        after: expect.objectContaining({ forcePasswordChange: true }),
      }),
    );
  });

  it("reports when a reset cannot revoke existing companion access", async () => {
    vi.mocked(revokeCompanionUser).mockRejectedValueOnce(new Error("Redis unavailable"));

    const res = await adminResetPassword(
      authedPost("/api/users/user-1/reset-password"),
      { params: Promise.resolve({ id: "user-1" }) },
    );

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      error: "The password was reset, but companion access could not be revoked. Retry the reset before sharing the temporary password.",
    });
    expect(revokeCompanionUser).toHaveBeenCalledWith("user-1");
    expect(db.user.update).toHaveBeenCalled();
    expect(db.session.deleteMany).toHaveBeenCalled();
    expect(createAuditEntry).not.toHaveBeenCalled();
  });
});
