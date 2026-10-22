import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  store: vi.fn(),
  requireKiosk: vi.fn(),
  requireCompanion: vi.fn(),
}));

vi.mock("@/lib/services/app-diagnostics", () => ({ storeMetricKitPayload: mocks.store }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  enforceRateLimit: vi.fn().mockResolvedValue(undefined),
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));
vi.mock("@/lib/role-preview", () => ({
  readRolePreviewFromRequest: vi.fn().mockResolvedValue(null),
  isRolePreviewBlockedRequest: vi.fn().mockReturnValue(false),
}));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireKiosk: mocks.requireKiosk,
}));
vi.mock("@/lib/companion-store", () => ({ requireCompanion: mocks.requireCompanion }));
vi.mock("@/lib/services/companion-projection-publisher", () => ({ deferCompanionProjectionRefresh: vi.fn() }));

import { POST as kioskPOST } from "@/app/api/kiosk/diagnostics/route";
import { POST as companionPOST } from "@/app/api/companion/diagnostics/route";
import { env } from "@/lib/env";

const sessions = [{ pid: 7, screen: "checkout", breadcrumbs: [{ at: "2026-10-21T02:00:00Z", type: "nav", message: "checkout" }] }];

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${env.appUrl ?? "https://wisconsincreative.com"}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: env.appUrl ?? "https://wisconsincreative.com", ...headers },
    body: JSON.stringify(body),
  });
}

describe("diagnostics uploads from the kiosk and the Mac app", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.store.mockResolvedValue(1);
    mocks.requireKiosk.mockResolvedValue({ kioskId: "k1", name: "Video Office", locationId: "l1", locationName: "Camp Randall" });
    mocks.requireCompanion.mockResolvedValue({ userId: "u1", role: "STAFF" });
  });

  it("stores a kiosk crash against the kiosk, with no person", async () => {
    const res = await kioskPOST(post("/api/kiosk/diagnostics", { platform: "kiosk", payload: { crashDiagnostics: [] }, sessions }), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(mocks.store).toHaveBeenCalledWith({ crashDiagnostics: [] }, "kiosk", null, sessions, {
      kiosk: "Video Office",
      location: "Camp Randall",
    });
  });

  it("stores a Mac crash against the companion's person", async () => {
    const res = await companionPOST(
      post("/api/companion/diagnostics", { platform: "macos", payload: { crashDiagnostics: [] }, sessions }, { authorization: "Bearer x" }),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(200);
    expect(mocks.store).toHaveBeenCalledWith({ crashDiagnostics: [] }, "macos", { id: "u1", role: "STAFF" }, sessions);
  });

  it("refuses another platform on the Mac route", async () => {
    const res = await companionPOST(post("/api/companion/diagnostics", { platform: "ios", payload: {} }), { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    expect(mocks.store).not.toHaveBeenCalled();
  });
});
