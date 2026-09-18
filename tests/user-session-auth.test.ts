import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http";
import { Role } from "@prisma/client";

const cookieStore = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => unknown) => {
    void fn();
  },
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    session: {
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
    user: {
      updateMany: vi.fn(),
    },
    kioskDevice: {
      update: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/env", () => ({
  env: {
    sessionSecret: "test-session-secret-value-32chars",
    sessionCookieName: "gear-tracker-session",
  },
}));

vi.mock("@/lib/role-preview", () => ({
  clearRolePreviewCookie: vi.fn(),
  readRolePreviewCookie: vi.fn(),
  rolePreviewCollaboratorPolicyMetadata: vi.fn(),
  rolePreviewInfo: vi.fn(),
}));

import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { clearRolePreviewCookie } from "@/lib/role-preview";
import { requireAuth } from "@/lib/auth";

describe("user session expiry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-17T12:00:00.000Z"));
    vi.mocked(cookies).mockResolvedValue(cookieStore as never);
    cookieStore.get.mockReset();
    cookieStore.set.mockReset();
    cookieStore.delete.mockReset();
    vi.mocked(clearRolePreviewCookie).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears the session cookie when the stored session has expired", async () => {
    cookieStore.get.mockReturnValue({ value: "stale-token" });
    vi.mocked(db.session.findUnique).mockResolvedValue({
      id: "session-1",
      tokenHash: "hashed",
      expiresAt: new Date("2026-09-17T11:59:59.000Z"),
      user: {
        id: "user-1",
        email: "admin@creative.local",
        name: "Creative Admin",
        role: Role.ADMIN,
        active: true,
        affiliation: null,
        collaboratorProfile: null,
        collaboratorPolicy: null,
        staffingType: null,
        avatarUrl: null,
        forcePasswordChange: false,
        lastActiveAt: null,
      },
    } as never);

    await expect(requireAuth()).rejects.toMatchObject(new HttpError(401, "Session expired"));
    expect(cookieStore.delete).toHaveBeenCalledWith("gear-tracker-session");
    expect(clearRolePreviewCookie).toHaveBeenCalled();
    expect(db.session.deleteMany).toHaveBeenCalledWith({ where: { id: "session-1" } });
  });

  it("clears the session cookie when the token no longer matches a row", async () => {
    cookieStore.get.mockReturnValue({ value: "unknown-token" });
    vi.mocked(db.session.findUnique).mockResolvedValue(null);

    await expect(requireAuth()).rejects.toMatchObject(new HttpError(401, "Session expired"));
    expect(cookieStore.delete).toHaveBeenCalledWith("gear-tracker-session");
    expect(clearRolePreviewCookie).toHaveBeenCalled();
    expect(db.session.deleteMany).not.toHaveBeenCalled();
  });
});
