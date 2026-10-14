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
      updateMany: vi.fn(),
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
import { createSession, requireAuth, slidSessionExpiry } from "@/lib/auth";

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

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function activeSessionRow(overrides: Record<string, unknown>) {
  return {
    id: "session-1",
    tokenHash: "hashed",
    user: {
      id: "user-1",
      email: "staff@creative.local",
      name: "Creative Staff",
      role: Role.STAFF,
      active: true,
      affiliation: null,
      collaboratorProfile: null,
      collaboratorPolicy: null,
      staffingType: null,
      avatarUrl: null,
      forcePasswordChange: false,
      lastActiveAt: new Date(),
    },
    ...overrides,
  };
}

describe("sliding session expiry", () => {
  const now = new Date("2026-09-17T12:00:00.000Z");

  it("leaves a remembered session alone until a day of its idle window is used", () => {
    const createdAt = new Date(now.getTime() - 2 * HOUR);
    const expiresAt = new Date(now.getTime() + 30 * DAY - 2 * HOUR);
    expect(slidSessionExpiry({ createdAt, expiresAt, persistent: true }, now)).toBeNull();
  });

  it("pushes a remembered session back out to 30 idle days", () => {
    const createdAt = new Date(now.getTime() - 10 * DAY);
    const expiresAt = new Date(now.getTime() + 20 * DAY);
    expect(slidSessionExpiry({ createdAt, expiresAt, persistent: true }, now)).toEqual(
      new Date(now.getTime() + 30 * DAY),
    );
  });

  it("never slides a remembered session past 90 days from sign-in", () => {
    const createdAt = new Date(now.getTime() - 80 * DAY);
    const expiresAt = new Date(now.getTime() + 2 * DAY);
    expect(slidSessionExpiry({ createdAt, expiresAt, persistent: true }, now)).toEqual(
      new Date(createdAt.getTime() + 90 * DAY),
    );
    const capped = new Date(createdAt.getTime() + 90 * DAY);
    expect(slidSessionExpiry({ createdAt, expiresAt: capped, persistent: true }, now)).toBeNull();
  });

  it("slides an unremembered session hourly to 12 idle hours, capped at 7 days", () => {
    const createdAt = new Date(now.getTime() - 3 * HOUR);
    expect(
      slidSessionExpiry({ createdAt, expiresAt: new Date(now.getTime() + 11.5 * HOUR), persistent: false }, now),
    ).toBeNull();
    expect(
      slidSessionExpiry({ createdAt, expiresAt: new Date(now.getTime() + 9 * HOUR), persistent: false }, now),
    ).toEqual(new Date(now.getTime() + 12 * HOUR));
    const old = new Date(now.getTime() - 7 * DAY + 4 * HOUR);
    expect(
      slidSessionExpiry({ createdAt: old, expiresAt: new Date(now.getTime() + 2 * HOUR), persistent: false }, now),
    ).toEqual(new Date(old.getTime() + 7 * DAY));
  });
});

describe("session activity", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-17T12:00:00.000Z"));
    vi.mocked(cookies).mockResolvedValue(cookieStore as never);
    cookieStore.get.mockReset();
    cookieStore.set.mockReset();
    cookieStore.delete.mockReset();
    vi.mocked(db.session.updateMany).mockReset();
    vi.mocked(db.session.create).mockReset();
    vi.mocked(clearRolePreviewCookie).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("extends a used remembered session without touching the cookie", async () => {
    const now = Date.now();
    cookieStore.get.mockReturnValue({ value: "live-token" });
    vi.mocked(db.session.findUnique).mockResolvedValue(activeSessionRow({
      createdAt: new Date(now - 10 * DAY),
      expiresAt: new Date(now + 20 * DAY),
      persistent: true,
    }) as never);

    await requireAuth();

    expect(db.session.updateMany).toHaveBeenCalledWith({
      where: { id: "session-1", expiresAt: { lt: new Date(now + 30 * DAY) } },
      data: { expiresAt: new Date(now + 30 * DAY) },
    });
    // Server components cannot set cookies; the row is the only authority.
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("does not write when the session was extended recently", async () => {
    const now = Date.now();
    cookieStore.get.mockReturnValue({ value: "live-token" });
    vi.mocked(db.session.findUnique).mockResolvedValue(activeSessionRow({
      createdAt: new Date(now - HOUR),
      expiresAt: new Date(now + 30 * DAY - HOUR),
      persistent: true,
    }) as never);

    await requireAuth();

    expect(db.session.updateMany).not.toHaveBeenCalled();
  });

  it("issues a remembered cookie to the 90-day cap and an unremembered one for the browser session", async () => {
    const now = Date.now();
    cookieStore.get.mockReturnValue(undefined);

    await createSession("user-1", true);
    expect(db.session.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "user-1", persistent: true, expiresAt: new Date(now + 30 * DAY) }),
    });
    expect(cookieStore.set.mock.calls[0]?.[2]).toMatchObject({ httpOnly: true, expires: new Date(now + 90 * DAY) });

    await createSession("user-1", false);
    expect(db.session.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ persistent: false, expiresAt: new Date(now + 12 * HOUR) }),
    });
    expect(cookieStore.set.mock.calls[1]?.[2]).not.toHaveProperty("expires");
    expect(cookieStore.set.mock.calls[1]?.[2]).not.toHaveProperty("maxAge");
  });
});
