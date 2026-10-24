import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http";
import { CUID_A, CUID_B, jsonRequest, routeCtx } from "./_helpers/route-request";

const mocks = vi.hoisted(() => ({
  requireKiosk: vi.fn(),
  enforceRateLimit: vi.fn(),
  substitute: vi.fn(),
  extendWindow: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn(), requireKiosk: mocks.requireKiosk }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: mocks.enforceRateLimit }));
vi.mock("@/lib/db", () => ({ db: { marker: "db" } }));
vi.mock("@/lib/services/kiosk-pickup-substitute", () => ({ substituteReservationPickupItem: mocks.substitute }));
vi.mock("@/lib/services/kiosk-extend-window", () => ({ kioskExtendWindow: mocks.extendWindow }));
vi.mock("@/lib/services/companion-projection-publisher", () => ({ deferCompanionProjectionRefresh: vi.fn() }));

import { POST as substitute } from "@/app/api/kiosk/pickup/[id]/substitute/route";
import { GET as extendWindow } from "@/app/api/kiosk/checkout/[id]/extend-window/route";

const kiosk = { kioskId: "kiosk-1", name: "Camp Randall cage", locationId: "loc-1", locationName: "Camp Randall" };

beforeEach(() => {
  mocks.requireKiosk.mockResolvedValue(kiosk);
  mocks.enforceRateLimit.mockResolvedValue(undefined);
  mocks.substitute.mockResolvedValue({ data: { swapped: true } });
  mocks.extendWindow.mockResolvedValue({ currentEndsAt: "2026-10-24T23:00:00Z", maxEndsAt: "2026-10-25T03:00:00Z" });
});

describe("POST /api/kiosk/pickup/[id]/substitute", () => {
  it("stages the scanned asset for the reserved one on this booking", async () => {
    const req = jsonRequest(`/api/kiosk/pickup/${CUID_A}/substitute`, "POST", { actorId: CUID_B, scanValue: "  BC-0042 ", reservedAssetId: "asset-9" });
    const res = await substitute(req, routeCtx({ id: CUID_A }));

    expect(res.status).toBe(200);
    expect(mocks.substitute).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: CUID_A,
      actorUserId: CUID_B,
      scanValue: "BC-0042",
      reservedAssetId: "asset-9",
    }));
  });

  it("rejects an empty scan and a request from an unpaired device", async () => {
    const empty = await substitute(jsonRequest(`/api/kiosk/pickup/${CUID_A}/substitute`, "POST", { actorId: CUID_B, scanValue: "   ", reservedAssetId: "asset-9" }), routeCtx({ id: CUID_A }));
    expect(empty.status).toBe(400);

    mocks.requireKiosk.mockRejectedValue(new HttpError(401, "Kiosk not activated"));
    const unpaired = await substitute(jsonRequest(`/api/kiosk/pickup/${CUID_A}/substitute`, "POST", { actorId: CUID_B, scanValue: "BC-0042", reservedAssetId: "asset-9" }), routeCtx({ id: CUID_A }));
    expect(unpaired.status).toBe(401);
    expect(mocks.substitute).not.toHaveBeenCalled();
  });

  it("refuses a cross-site request before reading the kiosk session", async () => {
    const req = new Request(`https://app.example.com/api/kiosk/pickup/${CUID_A}/substitute`, {
      method: "POST",
      headers: { "content-type": "application/json", host: "app.example.com", origin: "https://evil.example.net" },
      body: JSON.stringify({ actorId: CUID_B, scanValue: "BC-0042", reservedAssetId: "asset-9" }),
    });
    const res = await substitute(req, routeCtx({ id: CUID_A }));
    expect(res.status).toBe(403);
    expect(mocks.requireKiosk).not.toHaveBeenCalled();
  });
});

describe("GET /api/kiosk/checkout/[id]/extend-window", () => {
  it("rate-limits per kiosk and returns the latest allowed end", async () => {
    const res = await extendWindow(jsonRequest(`/api/kiosk/checkout/${CUID_A}/extend-window`, "GET"), routeCtx({ id: CUID_A }));

    expect(res.status).toBe(200);
    expect(mocks.enforceRateLimit).toHaveBeenCalledWith("kiosk:extend-window:kiosk-1", expect.anything());
    expect(mocks.extendWindow).toHaveBeenCalledWith({ marker: "db" }, CUID_A);
    expect(await res.json()).toEqual({ currentEndsAt: "2026-10-24T23:00:00Z", maxEndsAt: "2026-10-25T03:00:00Z" });
  });

  it("answers 429 without querying once the kiosk limit is spent", async () => {
    mocks.enforceRateLimit.mockRejectedValue(new HttpError(429, "Too many requests. Try again in 10s."));
    const res = await extendWindow(jsonRequest(`/api/kiosk/checkout/${CUID_A}/extend-window`, "GET"), routeCtx({ id: CUID_A }));
    expect(res.status).toBe(429);
    expect(mocks.extendWindow).not.toHaveBeenCalled();
  });
});
