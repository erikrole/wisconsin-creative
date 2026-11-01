import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http";

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
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("@/lib/db", () => ({
  db: {
    kioskDevice: {
      update: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/env", () => ({
  env: {
    sessionSecret: "test-session-secret",
    sessionCookieName: "app_session",
  },
}));

vi.mock("@/lib/crypto", () => ({
  randomHex: vi.fn(() => "raw-kiosk-token"),
}));

import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { createKioskSession, requireKiosk } from "@/lib/auth";

describe("kiosk session auth", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T12:00:00.000Z"));
    vi.mocked(cookies).mockResolvedValue(cookieStore as never);
    cookieStore.get.mockReset();
    cookieStore.set.mockReset();
    cookieStore.delete.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("persists the same expiry that is placed on the kiosk cookie", async () => {
    const raw = await createKioskSession("kiosk-1");
    const expiresAt = new Date("2026-05-19T12:00:00.000Z");

    expect(raw).toBe("raw-kiosk-token");
    expect(db.kioskDevice.update).toHaveBeenCalledWith({
      where: { id: "kiosk-1" },
      data: expect.objectContaining({
        sessionToken: expect.any(String),
        sessionExpiresAt: expiresAt,
        activatedAt: new Date("2026-05-12T12:00:00.000Z"),
        lastSeenAt: new Date("2026-05-12T12:00:00.000Z"),
      }),
    });
    expect(cookieStore.set).toHaveBeenCalledWith(
      "kiosk_session",
      "raw-kiosk-token",
      expect.objectContaining({ expires: expiresAt }),
    );
  });

  it("updates lastSeenAt via after() on a valid kiosk session", async () => {
    cookieStore.get.mockReturnValue({ value: "raw-kiosk-token" });
    vi.mocked(db.kioskDevice.findUnique).mockResolvedValue({
      id: "kiosk-1",
      active: true,
      sessionExpiresAt: new Date("2026-05-19T12:00:00.000Z"),
      location: { id: "loc-1", name: "Main" },
    } as never);
    vi.mocked(db.kioskDevice.update).mockResolvedValue({} as never);

    await requireKiosk();

    expect(db.kioskDevice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "kiosk-1" },
        data: expect.objectContaining({ lastSeenAt: expect.any(Date) }),
      }),
    );
  });

  it("rejects expired kiosk sessions and clears their stored token", async () => {
    cookieStore.get.mockReturnValue({ value: "raw-kiosk-token" });
    vi.mocked(db.kioskDevice.findUnique).mockResolvedValue({
      id: "kiosk-1",
      active: true,
      sessionExpiresAt: new Date("2026-05-12T11:59:59.000Z"),
      location: { id: "loc-1", name: "Main" },
    } as never);

    await expect(requireKiosk()).rejects.toMatchObject(
      new HttpError(401, "Kiosk session expired"),
    );

    expect(db.kioskDevice.update).toHaveBeenCalledWith({
      where: { id: "kiosk-1" },
      data: { sessionToken: null, sessionExpiresAt: null },
    });
  });
});
