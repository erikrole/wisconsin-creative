import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bookingFindUnique: vi.fn(),
  userFindFirst: vi.fn(),
  bulkSkuFindFirst: vi.fn(),
  stage: vi.fn(),
  findUnit: vi.fn(),
  checkAvailability: vi.fn(),
  updateReservation: vi.fn(),
  findAsset: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const tx = {
    booking: { findUnique: mocks.bookingFindUnique },
    user: { findFirst: mocks.userFindFirst },
  };
  return {
    db: {
      booking: { findUnique: mocks.bookingFindUnique },
      user: { findFirst: mocks.userFindFirst },
      bulkSku: { findFirst: mocks.bulkSkuFindFirst },
      $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});
vi.mock("@/lib/api", () => ({
  withKiosk: <P extends Record<string, string>>(
    handler: (req: Request, ctx: { params: P; kiosk: { kioskId: string } }) => Promise<Response>,
  ) => async (req: Request, ctx: { params: Promise<P> }) =>
    handler(req, { params: await ctx.params, kiosk: { kioskId: "kiosk-1" } }),
}));
vi.mock("@/lib/services/bulk-unit-scans", () => ({
  stageKioskReservationPickupBulkUnit: mocks.stage,
  scanKioskPickupBulkUnit: vi.fn(),
  findBulkUnitByScanValue: mocks.findUnit,
}));
vi.mock("@/lib/services/availability", () => ({ checkAvailability: mocks.checkAvailability }));
vi.mock("@/lib/services/bookings-lifecycle", () => ({ updateReservation: mocks.updateReservation }));
vi.mock("@/lib/services/kiosk-scan", () => ({ findAssetByScanValue: mocks.findAsset }));
vi.mock("@/lib/services/kiosk-pickup-substitute", () => ({ previewPickupSubstitution: vi.fn() }));
vi.mock("@/lib/audit", () => ({ createAuditEntryTx: vi.fn(), lookupActorRole: vi.fn() }));

import { POST } from "@/app/api/kiosk/pickup/[id]/scan/route";

const route = { params: Promise.resolve({ id: "rv-1" }) };
const clear = { allocations: [], conflicts: [], shortages: [], unavailableAssets: [] };

function scan(scanValue: string, intent?: "add") {
  return POST(new Request("http://test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ actorId: "david", scanValue, ...(intent ? { intent } : {}) }),
  }), route as never).then((res) => res.json());
}

const reservation = {
  id: "rv-1",
  kind: "RESERVATION",
  status: "BOOKED",
  custodyScope: "PERSON",
  requesterUserId: "david",
  locationId: "loc-1",
  startsAt: new Date("2099-01-01T10:00:00Z"),
  endsAt: new Date("2099-01-01T18:00:00Z"),
  serializedItems: [],
  bulkItems: [{ bulkSkuId: "sony", plannedQuantity: 2 }],
};

const sonyUnit = {
  id: "unit-9",
  bulkSkuId: "np-fz100",
  bulkSkuName: "NP-FZ100",
  unitNumber: 9,
  type: "Battery",
  status: "AVAILABLE",
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.bookingFindUnique.mockResolvedValue(reservation);
  mocks.userFindFirst.mockResolvedValue({ id: "david", role: "STUDENT", collaboratorPolicy: null });
  mocks.checkAvailability.mockResolvedValue(clear);
  mocks.updateReservation.mockResolvedValue({ updatedAt: new Date() });
});

describe("kiosk pickup scan: off-plan bulk items on a reservation", () => {
  it("offers Add for a numbered unit of a SKU that is not on the reservation", async () => {
    mocks.stage.mockResolvedValue({ handled: true, success: false, error: "Wrong battery type", errorCode: "not_in_booking" });
    mocks.findUnit.mockResolvedValue(sonyUnit);

    const body = await scan("FZ-9");
    expect(body).toMatchObject({ success: false, errorCode: "add_available", item: { bulkSkuId: "np-fz100", unitNumber: 9 } });
    expect(mocks.updateReservation).not.toHaveBeenCalled();
  });

  it("adds the SKU to the plan and stages the unit on intent add", async () => {
    mocks.stage
      .mockResolvedValueOnce({ handled: true, success: false, error: "Wrong battery type", errorCode: "not_in_booking" })
      .mockResolvedValueOnce({ handled: true, success: true, item: { id: "x:slot:1", name: "NP-FZ100 #9", tagName: "#9", unitNumber: 9, bulkSkuId: "np-fz100" } });
    mocks.findUnit.mockResolvedValue(sonyUnit);

    const body = await scan("FZ-9", "add");
    expect(body).toMatchObject({ success: true, addedToPlan: true, item: { unitNumber: 9 } });
    expect(mocks.updateReservation).toHaveBeenCalledWith("rv-1", "david", {
      serializedAssetIds: [],
      bulkItems: [{ bulkSkuId: "sony", quantity: 2 }, { bulkSkuId: "np-fz100", quantity: 1 }],
    });
  });

  it("offers Add for a unit past the planned quantity and raises the quantity", async () => {
    mocks.stage
      .mockResolvedValueOnce({ handled: true, success: false, error: "already has 2 of 2", errorCode: "quantity_exceeded" })
      .mockResolvedValueOnce({ handled: true, success: false, error: "already has 2 of 2", errorCode: "quantity_exceeded" })
      .mockResolvedValueOnce({ handled: true, success: true, item: { id: "x:slot:3", name: "Sony #3", tagName: "#3", unitNumber: 3, bulkSkuId: "sony" } });
    mocks.findUnit.mockResolvedValue({ ...sonyUnit, bulkSkuId: "sony", bulkSkuName: "Sony Battery", unitNumber: 3 });

    expect(await scan("S-3")).toMatchObject({ errorCode: "add_available" });
    expect(await scan("S-3", "add")).toMatchObject({ success: true, addedToPlan: true });
    expect(mocks.updateReservation).toHaveBeenCalledWith("rv-1", "david", {
      serializedAssetIds: [],
      bulkItems: [{ bulkSkuId: "sony", quantity: 3 }],
    });
  });

  it("blocks a unit that is held elsewhere instead of offering Add", async () => {
    mocks.stage.mockResolvedValue({ handled: true, success: false, error: "Wrong battery type", errorCode: "not_in_booking" });
    mocks.findUnit.mockResolvedValue({ ...sonyUnit, status: "CHECKED_OUT" });

    expect(await scan("FZ-9")).toMatchObject({ success: false, errorCode: "unavailable" });
  });

  it("offers Add for a counted SKU's bin QR instead of Item not found", async () => {
    mocks.stage.mockResolvedValue({ handled: false });
    mocks.findAsset.mockResolvedValue(null);
    mocks.findUnit.mockResolvedValue(null);
    mocks.bulkSkuFindFirst.mockResolvedValue({ id: "gaff", name: "Gaff Tape", category: "Grip" });

    expect(await scan("BIN-GAFF")).toMatchObject({ success: false, errorCode: "add_available", item: { bulkSkuId: "gaff", name: "Gaff Tape" } });
    expect(await scan("BIN-GAFF", "add")).toMatchObject({ success: true, addedToPlan: true });
    expect(mocks.updateReservation).toHaveBeenCalledWith("rv-1", "david", {
      serializedAssetIds: [],
      bulkItems: [{ bulkSkuId: "sony", quantity: 2 }, { bulkSkuId: "gaff", quantity: 1 }],
    });
  });

  it("still reports Item not found for an unknown code", async () => {
    mocks.stage.mockResolvedValue({ handled: false });
    mocks.findAsset.mockResolvedValue(null);
    mocks.findUnit.mockResolvedValue(null);
    mocks.bulkSkuFindFirst.mockResolvedValue(null);

    expect(await scan("???")).toEqual({ success: false, error: "Item not found" });
  });
});
