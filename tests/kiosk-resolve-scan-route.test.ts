import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindFirst: vi.fn(),
  allocationFindFirst: vi.fn(),
  unitAllocationFindFirst: vi.fn(),
  bookingFindMany: vi.fn(),
  findAsset: vi.fn(),
  findUnit: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: { findFirst: mocks.userFindFirst },
    assetAllocation: { findFirst: mocks.allocationFindFirst },
    bookingBulkUnitAllocation: { findFirst: mocks.unitAllocationFindFirst },
    booking: { findMany: mocks.bookingFindMany },
  },
}));
vi.mock("@/lib/api", () => ({
  withKiosk: (handler: (request: Request, context: { kiosk: { kioskId: string; locationId: string; locationName: string } }) => unknown) => (req: Request) => handler(req, { kiosk: {
    kioskId: "kiosk-1", locationId: "loc-1", locationName: "Camp Randall",
  } }),
}));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: mocks.rateLimit }));
vi.mock("@/lib/services/kiosk-scan", () => ({ findAssetByScanValue: mocks.findAsset }));
vi.mock("@/lib/services/bulk-unit-scans", () => ({ findBulkUnitByScanValue: mocks.findUnit }));

import { POST } from "@/app/api/kiosk/resolve-scan/route";

const requester = { id: "user-1", name: "Usman", avatarUrl: null, role: "STUDENT", affiliation: null };
const location = { id: "loc-1", name: "Camp Randall" };
const asset = {
  id: "asset-1", assetTag: "CAM-1", name: "FX3", status: "AVAILABLE",
  availableForCheckout: true, availableForCustody: true, locationId: "loc-1",
  location, category: { name: "Camera" },
};
const reservation = {
  id: "booking-1", title: "Volleyball vs. Purdue", kind: "RESERVATION", status: "BOOKED",
  startsAt: new Date("2026-07-16T21:30:00Z"), endsAt: new Date("2026-07-17T02:00:00Z"),
  locationId: "loc-1", location, requester,
};

function request(body: object) {
  return POST(new Request("http://test/api/kiosk/resolve-scan", {
    method: "POST", body: JSON.stringify(body),
  }), { params: Promise.resolve({}) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.setSystemTime(new Date("2026-07-16T21:15:00Z"));
  mocks.userFindFirst.mockResolvedValue(null);
  mocks.findAsset.mockResolvedValue(null);
  mocks.findUnit.mockResolvedValue(null);
  mocks.allocationFindFirst.mockResolvedValue(null);
  mocks.unitAllocationFindFirst.mockResolvedValue(null);
  mocks.bookingFindMany.mockResolvedValue([]);
});

describe("POST /api/kiosk/resolve-scan", () => {
  it("routes a BOOKED reservation to pickup before startsAt", async () => {
    mocks.findAsset.mockResolvedValue(asset);
    mocks.allocationFindFirst.mockResolvedValue({ kind: "RESERVATION", booking: reservation });
    const json = await (await request({ scanValue: "CAM-1", userId: "user-1" })).json();
    expect(json).toMatchObject({ kind: "action", action: "pickup", booking: { id: "booking-1" } });
  });

  it("corrects legacy team abbreviation casing in inferred booking context", async () => {
    mocks.findAsset.mockResolvedValue(asset);
    mocks.allocationFindFirst.mockResolvedValue({
      kind: "RESERVATION",
      booking: { ...reservation, title: "Volleyball vs. Tcu" },
    });

    const json = await (await request({ scanValue: "CAM-1" })).json();

    expect(json).toMatchObject({
      kind: "pending_identity",
      booking: { title: "Volleyball vs. TCU" },
    });
  });

  it("requires the expected requester for inferred return", async () => {
    mocks.findAsset.mockResolvedValue(asset);
    mocks.allocationFindFirst.mockResolvedValue({
      kind: "CHECKOUT",
      booking: { ...reservation, kind: "CHECKOUT", status: "OPEN" },
    });
    const json = await (await request({ scanValue: "CAM-1", userId: "user-2" })).json();
    expect(json).toMatchObject({ kind: "blocked", code: "wrong_requester", expectedRequester: requester });
  });

  it("lets any identified operator return a shared checkout without exposing a requester", async () => {
    mocks.findAsset.mockResolvedValue(asset);
    mocks.allocationFindFirst.mockResolvedValue({
      kind: "CHECKOUT",
      booking: { ...reservation, kind: "CHECKOUT", status: "OPEN", custodyScope: "SHARED" },
    });

    const json = await (await request({ scanValue: "CAM-1", userId: "user-2" })).json();

    expect(json).toMatchObject({
      kind: "action",
      action: "return",
      booking: { id: "booking-1", custodyScope: "SHARED" },
    });
    expect(json).not.toHaveProperty("expectedRequester");
  });

  it("routes pickup from another kiosk location", async () => {
    mocks.findAsset.mockResolvedValue(asset);
    mocks.allocationFindFirst.mockResolvedValue({
      kind: "RESERVATION",
      booking: { ...reservation, locationId: "loc-2", location: { id: "loc-2", name: "Kohl Center" } },
    });
    const json = await (await request({ scanValue: "CAM-1", userId: "user-1" })).json();
    expect(json).toMatchObject({ kind: "action", action: "pickup", booking: { id: "booking-1" } });
  });

  it("reports Wiscard and item collisions as ambiguous", async () => {
    mocks.userFindFirst.mockResolvedValue(requester);
    mocks.findAsset.mockResolvedValue(asset);
    const json = await (await request({ scanValue: "9000000000" })).json();
    expect(json).toMatchObject({ kind: "ambiguous" });
  });

  it("BUG: resolves a visible Wiscard user without applying kiosk-location scope", async () => {
    mocks.userFindFirst.mockResolvedValue(requester);
    const json = await (await request({ scanValue: "9000000000" })).json();

    expect(json).toMatchObject({ kind: "identity", user: requester });
    const where = mocks.userFindFirst.mock.calls[0]?.[0]?.where;
    expect(where).toMatchObject({
      active: true,
      hiddenFromRoster: false,
      wiscardNumber: "9000000000",
    });
    expect(where).not.toHaveProperty("locationId");
  });

  it("routes an available numbered unit into checkout after identity", async () => {
    mocks.findUnit.mockResolvedValue({
      id: "unit-31", name: "Sony Battery #31", tagName: "#31", type: "Batteries",
      status: "AVAILABLE", bulkSkuId: "sku-sony", unitNumber: 31,
    });
    const json = await (await request({ scanValue: "sony-31", userId: "user-1" })).json();
    expect(json).toMatchObject({
      kind: "action", action: "checkout",
      item: { id: "unit-31", bulkSkuId: "sku-sony", unitNumber: 31 },
    });
  });

  it("routes a numbered unit in active custody to return", async () => {
    mocks.findUnit.mockResolvedValue({
      id: "unit-31", name: "Sony Battery #31", tagName: "#31", type: "Batteries",
      status: "CHECKED_OUT", bulkSkuId: "sku-sony", unitNumber: 31,
    });
    mocks.unitAllocationFindFirst.mockResolvedValue({
      bookingBulkItem: { booking: { ...reservation, kind: "CHECKOUT", status: "OPEN" } },
    });
    const json = await (await request({ scanValue: "sony-31", userId: "user-1" })).json();
    expect(json).toMatchObject({ kind: "action", action: "return", booking: { id: "booking-1" } });
  });

  it("is read-only and returns unknown without invoking mutation services", async () => {
    const json = await (await request({ scanValue: "NOPE" })).json();
    expect(json).toEqual({ kind: "unknown", message: "No person or item matches that code." });
    expect(mocks.allocationFindFirst).not.toHaveBeenCalled();
    expect(mocks.unitAllocationFindFirst).not.toHaveBeenCalled();
    expect(mocks.bookingFindMany).not.toHaveBeenCalled();
  });
});
