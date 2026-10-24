import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters";
  return {
    readCached: vi.fn(),
    remember: vi.fn(),
    recordBeat: vi.fn(),
    requireKiosk: vi.fn(),
    kioskFindUnique: vi.fn(),
    enforceRateLimit: vi.fn(),
  };
});

vi.mock("@/lib/kiosk-heartbeat-cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/kiosk-heartbeat-cache")>()),
  readCachedKioskHeartbeat: mocks.readCached,
  rememberKioskHeartbeat: mocks.remember,
  recordKioskBeat: mocks.recordBeat,
}));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireKiosk: mocks.requireKiosk,
}));
vi.mock("@/lib/db", () => ({
  db: { kioskDevice: { findUnique: mocks.kioskFindUnique, update: vi.fn() } },
}));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  enforceRateLimit: mocks.enforceRateLimit,
}));
vi.mock("@/lib/services/companion-projection", () => ({ refreshCompanionProjection: vi.fn() }));

import { GET } from "@/app/api/kiosk/heartbeat/route";

const params = { params: Promise.resolve({}) };
const request = () =>
  new Request("http://test/api/kiosk/heartbeat", { headers: { cookie: "kiosk_session=raw-token" } });

beforeEach(() => {
  mocks.requireKiosk.mockResolvedValue({ kioskId: "kiosk-1", name: "Video Office", locationId: "l", locationName: "L" });
  mocks.kioskFindUnique.mockResolvedValue({
    sessionExpiresAt: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000),
    appVersion: "1.3",
    appBuild: "2",
    osVersion: null,
    deviceModel: null,
  });
});

describe("kiosk heartbeat route", () => {
  it("answers a recent kiosk from Redis without touching Neon", async () => {
    mocks.readCached.mockResolvedValue({
      kioskId: "kiosk-1",
      sessionExpiresAt: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString(),
      dbSeenAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      report: { appVersion: "1.3", appBuild: "2", osVersion: null, deviceModel: null },
    });

    const response = await GET(request(), params);

    expect(response.status).toBe(200);
    expect(mocks.requireKiosk).not.toHaveBeenCalled();
    expect(mocks.kioskFindUnique).not.toHaveBeenCalled();
    expect(mocks.enforceRateLimit).toHaveBeenCalledWith("kiosk:heartbeat:kiosk-1", { max: 1, windowMs: 60_000 });
    expect(mocks.recordBeat).toHaveBeenCalledWith("kiosk-1", expect.any(Date));
  });

  it("authenticates against Neon and caches the session when nothing is cached", async () => {
    mocks.readCached.mockResolvedValue(null);

    const response = await GET(request(), params);

    expect(response.status).toBe(200);
    expect(mocks.requireKiosk).toHaveBeenCalledTimes(1);
    expect(mocks.remember).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ kioskId: "kiosk-1", report: { appVersion: "1.3", appBuild: "2", osVersion: null, deviceModel: null } }),
    );
  });

  it("goes to Neon without a kiosk cookie", async () => {
    const response = await GET(new Request("http://test/api/kiosk/heartbeat"), params);
    expect(response.status).toBe(200);
    expect(mocks.readCached).not.toHaveBeenCalled();
    expect(mocks.requireKiosk).toHaveBeenCalledTimes(1);
  });
});
