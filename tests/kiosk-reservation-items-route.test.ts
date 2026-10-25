import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  bookingFindUnique: vi.fn(),
  userFindFirst: vi.fn(),
  updateReservation: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    booking: { findUnique: mocks.bookingFindUnique },
    user: { findFirst: mocks.userFindFirst },
    bulkSku: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/api", () => ({
  withKiosk: <P extends Record<string, string>>(
    handler: (req: Request, ctx: {
      params: P;
      kiosk: { kioskId: string; locationId: string; locationName: string };
    }) => Promise<Response>,
  ) => async (req: Request, ctx: { params: Promise<P> }) =>
    handler(req, {
      params: await ctx.params,
      kiosk: { kioskId: "kiosk-1", locationId: "loc-1", locationName: "Camp Randall" },
    }),
}));

vi.mock("@/lib/services/kiosk-scan", () => ({ findAssetByScanValue: vi.fn() }));
vi.mock("@/lib/services/bulk-unit-scans", () => ({ findBulkUnitByScanValue: vi.fn() }));
vi.mock("@/lib/services/bookings-lifecycle", () => ({
  updateReservation: mocks.updateReservation,
}));

import { db } from "@/lib/db";
import { findAssetByScanValue } from "@/lib/services/kiosk-scan";
import { findBulkUnitByScanValue } from "@/lib/services/bulk-unit-scans";
import { GET as readReservationItems, POST as updateReservationItems } from "@/app/api/kiosk/reservation/[id]/items/route";

function routeCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function reservation(over: Record<string, unknown> = {}) {
  return {
    id: "rv-1",
    kind: "RESERVATION",
    status: "BOOKED",
    title: "David leftover",
    custodyScope: "PERSON",
    requesterUserId: "david",
    updatedAt: new Date("2026-09-16T18:00:00.123Z"),
    serializedItems: [{
      id: "si-leftover",
      assetId: "asset-1",
      allocationStatus: "active",
      asset: { id: "asset-1", name: "Sony FX3", assetTag: "FX3 1" },
    }],
    bulkItems: [],
    derivedCheckouts: [{ id: "co-1" }],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userFindFirst.mockResolvedValue({ id: "david", role: Role.STUDENT, collaboratorPolicy: null });
  mocks.updateReservation.mockResolvedValue({ updatedAt: new Date("2026-09-16T18:01:00.000Z") });
});

describe("kiosk reservation remaining-item edits", () => {
  it("accepts a snapshot that dropped fractional milliseconds", async () => {
    mocks.bookingFindUnique.mockResolvedValue(reservation());
    const res = await updateReservationItems(new Request("http://test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actorId: "david",
        expectedUpdatedAt: "2026-09-16T18:00:00Z",
        action: "remove",
        itemId: "si-leftover",
      }),
    }), routeCtx("rv-1"));

    expect(res.status).toBe(200);
    expect(mocks.updateReservation).toHaveBeenCalledWith(
      "rv-1",
      "david",
      { serializedAssetIds: [], bulkItems: [] },
      new Date("2026-09-16T18:00:00Z"),
    );
  });

  it("completes leftover pickup when the last remaining item is removed", async () => {
    mocks.bookingFindUnique.mockResolvedValue(reservation());
    const res = await updateReservationItems(new Request("http://test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actorId: "david",
        expectedUpdatedAt: "2026-09-16T18:00:00.123Z",
        action: "remove",
        itemId: "si-leftover",
      }),
    }), routeCtx("rv-1"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mocks.updateReservation).toHaveBeenCalled();
  });

  it("lets an identified shared operator remove remaining gear", async () => {
    mocks.bookingFindUnique.mockResolvedValue(reservation({
      custodyScope: "SHARED",
      requesterUserId: "creator",
    }));
    mocks.userFindFirst.mockResolvedValue({ id: "operator", role: Role.STUDENT, collaboratorPolicy: null });

    const res = await updateReservationItems(new Request("http://test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actorId: "operator",
        expectedUpdatedAt: "2026-09-16T18:00:00.123Z",
        action: "remove",
        itemId: "si-leftover",
      }),
    }), routeCtx("rv-1"));

    expect(res.status).toBe(200);
  });

  it("keeps an empty unpicked reservation from deleting its last item", async () => {
    mocks.bookingFindUnique.mockResolvedValue(reservation({ derivedCheckouts: [] }));
    await expect(updateReservationItems(new Request("http://test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actorId: "david",
        expectedUpdatedAt: "2026-09-16T18:00:00.123Z",
        action: "remove",
        itemId: "si-leftover",
      }),
    }), routeCtx("rv-1"))).rejects.toThrow("Keep at least one reserved item");
    expect(mocks.updateReservation).not.toHaveBeenCalled();
  });
});

describe("kiosk reservation item adds and quantity edits", () => {
  const snapshot = "2026-09-16T18:00:00.123Z";
  const post = (body: Record<string, unknown>) => updateReservationItems(new Request("http://test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ actorId: "david", expectedUpdatedAt: snapshot, ...body }),
  }), routeCtx("rv-1"));
  const batteries = {
    id: "bi-batt",
    bulkSkuId: "sku-batt",
    plannedQuantity: 4,
    checkedOutQuantity: 1,
    bulkSku: { name: "NP-FZ100" },
  };

  beforeEach(() => {
    mocks.bookingFindUnique.mockResolvedValue(reservation({ bulkItems: [batteries] }));
    vi.mocked(findBulkUnitByScanValue).mockResolvedValue(null);
    vi.mocked(findAssetByScanValue).mockResolvedValue(null);
    vi.mocked(db.bulkSku.findFirst).mockResolvedValue(null);
  });

  it("adds a scanned serialized asset to the plan", async () => {
    vi.mocked(findAssetByScanValue).mockResolvedValue({ id: "asset-2" } as never);

    const res = await post({ action: "add", scanValue: "FX3 2" });

    expect(res.status).toBe(200);
    expect(mocks.updateReservation).toHaveBeenCalledWith("rv-1", "david", {
      serializedAssetIds: ["asset-1", "asset-2"],
      bulkItems: [{ bulkSkuId: "sku-batt", quantity: 4 }],
    }, new Date(snapshot));
  });

  it("adds one more of a SKU already on the plan when a numbered unit is scanned", async () => {
    vi.mocked(findBulkUnitByScanValue).mockResolvedValue({ bulkSkuId: "sku-batt" } as never);

    await post({ action: "add", scanValue: "BATT-7" });

    expect(findAssetByScanValue).not.toHaveBeenCalled();
    expect(mocks.updateReservation).toHaveBeenCalledWith("rv-1", "david", expect.objectContaining({
      bulkItems: [{ bulkSkuId: "sku-batt", quantity: 5 }],
    }), expect.any(Date));
  });

  it("adds a new SKU line from an active bin code", async () => {
    vi.mocked(db.bulkSku.findFirst).mockResolvedValue({ id: "sku-tape" } as never);

    await post({ action: "add", scanValue: "BIN-TAPE" });

    expect(db.bulkSku.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ active: true }) }));
    expect(mocks.updateReservation).toHaveBeenCalledWith("rv-1", "david", expect.objectContaining({
      bulkItems: [{ bulkSkuId: "sku-batt", quantity: 4 }, { bulkSkuId: "sku-tape", quantity: 1 }],
    }), expect.any(Date));
  });

  it("refuses an asset that is already on the reservation", async () => {
    vi.mocked(findAssetByScanValue).mockResolvedValue({ id: "asset-1" } as never);

    await expect(post({ action: "add", scanValue: "FX3 1" })).rejects.toMatchObject({ status: 409 });
    expect(mocks.updateReservation).not.toHaveBeenCalled();
  });

  it("answers 404 for a scan that names nothing", async () => {
    await expect(post({ action: "add", scanValue: "NOPE" })).rejects.toMatchObject({ status: 404 });
  });

  it("requires a scan value to add", async () => {
    await expect(post({ action: "add" })).rejects.toMatchObject({ status: 400 });
  });

  it("sets the remaining bulk quantity on top of what was already picked up", async () => {
    await post({ action: "quantity", itemId: "bi-batt", quantity: 2 });

    expect(mocks.updateReservation).toHaveBeenCalledWith("rv-1", "david", expect.objectContaining({
      bulkItems: [{ bulkSkuId: "sku-batt", quantity: 3 }],
    }), expect.any(Date));
  });

  it("removing a bulk line keeps the units already picked up", async () => {
    await post({ action: "remove", itemId: "bi-batt" });

    expect(mocks.updateReservation).toHaveBeenCalledWith("rv-1", "david", expect.objectContaining({
      bulkItems: [{ bulkSkuId: "sku-batt", quantity: 1 }],
    }), expect.any(Date));
  });

  it("requires a quantity for a quantity edit", async () => {
    await expect(post({ action: "quantity", itemId: "bi-batt" })).rejects.toMatchObject({ status: 400 });
  });

  it("does not let a serialized item take a quantity", async () => {
    await expect(post({ action: "quantity", itemId: "si-leftover", quantity: 2 })).rejects.toMatchObject({ status: 400 });
  });

  it("keeps picked-up items in history", async () => {
    mocks.bookingFindUnique.mockResolvedValue(reservation({
      serializedItems: [{ id: "si-out", assetId: "asset-9", allocationStatus: "picked_up", asset: { id: "asset-9", name: "FX3 9", assetTag: "FX3 9" } }],
    }));

    await expect(post({ action: "remove", itemId: "si-out" })).rejects.toMatchObject({ status: 409 });
    expect(mocks.updateReservation).not.toHaveBeenCalled();
  });

  it("answers 404 for an item id that is not on the reservation", async () => {
    await expect(post({ action: "remove", itemId: "someone-elses" })).rejects.toMatchObject({ status: 404 });
  });

  it("refuses a stale snapshot", async () => {
    await expect(post({ action: "remove", itemId: "si-leftover", expectedUpdatedAt: "2026-09-16T17:00:00.000Z" }))
      .rejects.toMatchObject({ status: 409 });
    expect(mocks.updateReservation).not.toHaveBeenCalled();
  });

  it("refuses a reservation that is no longer booked", async () => {
    mocks.bookingFindUnique.mockResolvedValue(reservation({ status: "COMPLETED" }));

    await expect(post({ action: "remove", itemId: "si-leftover" })).rejects.toMatchObject({ status: 404 });
  });

  it("refuses an operator who is not on the kiosk roster", async () => {
    mocks.userFindFirst.mockResolvedValue(null);

    await expect(post({ action: "remove", itemId: "si-leftover" })).rejects.toMatchObject({ status: 403 });
  });

  it("keeps another student's personal reservation locked", async () => {
    mocks.userFindFirst.mockResolvedValue({ id: "jordan", role: Role.STUDENT, collaboratorPolicy: null });

    await expect(post({ actorId: "jordan", action: "remove", itemId: "si-leftover" })).rejects.toMatchObject({ status: 403 });
    expect(mocks.updateReservation).not.toHaveBeenCalled();
  });

  it("lists what is still waiting and what was already picked up", async () => {
    const res = await readReservationItems(new Request("http://test/api/kiosk/reservation/rv-1/items?actorId=david"), routeCtx("rv-1"));
    const json = await res.json();

    expect(json.items).toEqual([
      { id: "si-leftover", assetId: "asset-1", name: "Sony FX3", quantity: 1, pickedQuantity: 0 },
      { id: "bi-batt", bulkSkuId: "sku-batt", name: "NP-FZ100", quantity: 3, pickedQuantity: 1 },
    ]);
  });
});
