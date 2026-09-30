import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  allocationFindFirst: vi.fn(),
  allocationFindMany: vi.fn(),
  unitAllocationFindFirst: vi.fn(),
  findAsset: vi.fn(),
  findUnit: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    assetAllocation: { findFirst: mocks.allocationFindFirst, findMany: mocks.allocationFindMany },
    bookingBulkUnitAllocation: { findFirst: mocks.unitAllocationFindFirst },
  },
}));
vi.mock("@/lib/api", () => ({
  withKiosk: (handler: (request: Request, context: { kiosk: { kioskId: string } }) => unknown) =>
    (request: Request) => handler(request, { kiosk: { kioskId: "kiosk-1" } }),
}));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: mocks.rateLimit }));
vi.mock("@/lib/services/kiosk-scan", () => ({ findAssetByScanValue: mocks.findAsset }));
vi.mock("@/lib/services/bulk-unit-scans", () => ({ findBulkUnitByScanValue: mocks.findUnit }));

import { POST } from "@/app/api/kiosk/scan-lookup/route";

const lookup = async () => (await (POST as unknown as (r: Request) => Promise<Response>)(
  new Request("http://test", { method: "POST", body: JSON.stringify({ scanValue: "CAM-1" }) }),
)).json();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rateLimit.mockResolvedValue(undefined);
  mocks.findAsset.mockResolvedValue({ id: "asset-1", assetTag: "CAM-1", name: "FX3", status: "AVAILABLE", category: { name: "Camera" } });
  mocks.findUnit.mockResolvedValue(null);
  mocks.allocationFindFirst.mockImplementation(async (args: { where: { active: boolean } }) =>
    args.where.active ? null : { updatedAt: new Date("2026-09-24T21:10:00.000Z") });
  mocks.allocationFindMany.mockResolvedValue([]);
});

describe("POST /api/kiosk/scan-lookup free until and last back", () => {
  it("returns the next claim's start and when it last came back", async () => {
    mocks.allocationFindMany.mockResolvedValue([{
      assetId: "asset-1", bookingId: "rv-1",
      startsAt: new Date("2026-09-26T14:00:00.000Z"), endsAt: new Date("2026-09-26T20:00:00.000Z"),
      booking: { title: "Volleyball", status: "BOOKED", kind: "RESERVATION", custodyScope: "PERSON", requester: { name: "Erik" }, location: null },
    }]);
    const body = await lookup();
    expect(body.item).toMatchObject({
      status: "Available",
      freeUntil: "2026-09-26T14:00:00.000Z",
      lastReturnedAt: "2026-09-24T21:10:00.000Z",
    });
    // Batched: the three reads run together, and "free until" uses the
    // shared upcoming-commitment rule from now.
    expect(mocks.allocationFindMany.mock.calls[0]![0].where).toMatchObject({
      assetId: { in: ["asset-1"] }, active: true, booking: { status: { in: ["BOOKED", "PENDING_PICKUP", "OPEN"] } },
    });
    expect(mocks.allocationFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { assetId: "asset-1", active: false, kind: "CHECKOUT" },
    }));
  });

  it("answers null when nothing is next and it has never been back", async () => {
    mocks.allocationFindFirst.mockResolvedValue(null);
    const body = await lookup();
    expect(body.item.freeUntil).toBeNull();
    expect(body.item.lastReturnedAt).toBeNull();
  });

  it("gives numbered units a last-back time and no free-until", async () => {
    mocks.findAsset.mockResolvedValue(null);
    mocks.findUnit.mockResolvedValue({
      id: "unit-1", tagName: "#12", name: "Sony battery #12", bulkSkuName: "Battery", status: "AVAILABLE",
      holder: undefined, dueAt: null, bookingTitle: null,
    });
    mocks.unitAllocationFindFirst.mockResolvedValue({ checkedInAt: new Date("2026-09-20T12:00:00.000Z") });
    const body = await lookup();
    expect(body.item).toMatchObject({ freeUntil: null, lastReturnedAt: "2026-09-20T12:00:00.000Z" });
  });
});
