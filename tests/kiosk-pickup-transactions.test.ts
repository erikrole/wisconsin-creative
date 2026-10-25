import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingCustodyScope, BookingKind, BookingStatus, Prisma, Role } from "@prisma/client";

const mockTx = {
  booking: { findUnique: vi.fn(), update: vi.fn() },
  user: { findFirst: vi.fn() },
  bookingSerializedItem: { create: vi.fn(), deleteMany: vi.fn() },
  assetAllocation: { create: vi.fn(), updateMany: vi.fn() },
  scanEvent: { create: vi.fn() },
};

const txOptions: unknown[] = [];

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>, options?: unknown) => {
      txOptions.push(options);
      return fn(mockTx);
    }),
    booking: { findUnique: vi.fn() },
    bulkSku: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/audit", () => ({
  createAuditEntryTx: vi.fn(),
  lookupActorRole: vi.fn(async () => "STUDENT"),
}));

vi.mock("@/lib/services/availability", () => ({
  checkAvailability: vi.fn(),
}));

vi.mock("@/lib/services/kiosk-scan", () => ({
  findAssetByScanValue: vi.fn(),
}));

vi.mock("@/lib/services/bulk-unit-scans", () => ({
  findBulkUnitByScanValue: vi.fn(),
  stageKioskReservationPickupBulkUnit: vi.fn(),
}));

vi.mock("@/lib/services/bookings-lifecycle", () => ({
  updateReservation: vi.fn(),
}));

import { db } from "@/lib/db";
import { createAuditEntryTx } from "@/lib/audit";
import { HttpError } from "@/lib/http";
import { checkAvailability } from "@/lib/services/availability";
import { findAssetByScanValue } from "@/lib/services/kiosk-scan";
import { findBulkUnitByScanValue, stageKioskReservationPickupBulkUnit } from "@/lib/services/bulk-unit-scans";
import { updateReservation } from "@/lib/services/bookings-lifecycle";
import {
  addAndStageReservationPickupBulk,
  addAndStageReservationPickupSerialized,
  preflightReservationPickupSerializedAdd,
  resolvePickupBulkAddTarget,
  type PickupBulkAddTarget,
} from "@/lib/services/kiosk-pickup-add";
import {
  previewPickupSubstitution,
  substituteReservationPickupItem,
} from "@/lib/services/kiosk-pickup-substitute";

const FAR_FUTURE_START = new Date("2099-01-01T15:00:00.000Z");
const FAR_FUTURE_END = new Date("2099-01-02T15:00:00.000Z");
const CLEAR = { conflicts: [], shortages: [], unavailableAssets: [] };

function tripod(id: string, tag: string, categoryId = "tripods") {
  return { id, assetTag: tag, name: `${tag} Tripod`, type: "Tripod", categoryId };
}

function booking(over: Record<string, unknown> = {}) {
  return {
    id: "booking-1",
    kind: BookingKind.RESERVATION,
    status: BookingStatus.BOOKED,
    custodyScope: BookingCustodyScope.PERSON,
    requesterUserId: "maya",
    locationId: "camp-randall",
    startsAt: FAR_FUTURE_START,
    endsAt: FAR_FUTURE_END,
    serializedItems: [],
    bulkItems: [],
    scanEvents: [],
    ...over,
  };
}

const maya = { id: "maya", role: Role.STUDENT, collaboratorPolicy: null };

beforeEach(() => {
  vi.clearAllMocks();
  txOptions.length = 0;
  mockTx.user.findFirst.mockResolvedValue(maya);
  vi.mocked(checkAvailability).mockResolvedValue(CLEAR as never);
});

describe("adding an off-plan serialized item at pickup", () => {
  const asset = { id: "fx3-2", name: "FX3 2", assetTag: "FX3-2" };
  const args = { bookingId: "booking-1", actorUserId: "maya", scanValue: "FX3-2", asset, deviceContext: "kiosk:k1" };

  it("adds the item to the plan, holds it, stages the scan and audits it in one serializable transaction", async () => {
    mockTx.booking.findUnique.mockResolvedValue(booking({ serializedItems: [{ assetId: "lens-1", allocationStatus: "active" }] }));

    const result = await addAndStageReservationPickupSerialized(args);

    expect(result).toEqual({ success: true, addedToPlan: true, item: { id: "fx3-2", name: "FX3 2", tagName: "FX3-2" } });
    expect(txOptions[0]).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    expect(mockTx.bookingSerializedItem.create).toHaveBeenCalledWith({
      data: { bookingId: "booking-1", assetId: "fx3-2", allocationStatus: "active" },
    });
    expect(mockTx.assetAllocation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bookingId: "booking-1",
        assetId: "fx3-2",
        startsAt: FAR_FUTURE_START,
        endsAt: FAR_FUTURE_END,
        active: true,
      }),
    });
    expect(mockTx.scanEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ phase: "CHECKOUT", success: true, assetId: "fx3-2", actorUserId: "maya", deviceContext: "kiosk:k1" }),
    });
    expect(createAuditEntryTx).toHaveBeenCalledWith(mockTx, expect.objectContaining({
      action: "kiosk_pickup_item_added",
      before: { serializedAssetIds: ["lens-1"] },
      after: expect.objectContaining({ serializedAssetIds: ["lens-1", "fx3-2"] }),
    }));
    expect(checkAvailability).toHaveBeenCalledWith(mockTx, expect.objectContaining({
      serializedAssetIds: ["fx3-2"],
      excludeBookingId: "booking-1",
    }));
  });

  it("returns a conflict without writing anything when another booking holds the item", async () => {
    mockTx.booking.findUnique.mockResolvedValue(booking());
    vi.mocked(checkAvailability).mockResolvedValue({
      ...CLEAR,
      conflicts: [{ assetId: "fx3-2", conflictingBookingTitle: "Volleyball", startsAt: FAR_FUTURE_START, endsAt: FAR_FUTURE_END }],
    } as never);

    const result = await addAndStageReservationPickupSerialized(args);

    expect(result).toMatchObject({ success: false, errorCode: "conflict" });
    expect(mockTx.bookingSerializedItem.create).not.toHaveBeenCalled();
    expect(mockTx.scanEvent.create).not.toHaveBeenCalled();
  });

  it("reports an unavailable item (e.g. in maintenance) as unavailable, not a conflict", async () => {
    mockTx.booking.findUnique.mockResolvedValue(booking());
    vi.mocked(checkAvailability).mockResolvedValue({
      ...CLEAR,
      unavailableAssets: [{ assetId: "fx3-2", status: "MAINTENANCE" }],
    } as never);

    const result = await addAndStageReservationPickupSerialized(args);
    expect(result).toMatchObject({ success: false, errorCode: "unavailable" });
  });

  it("turns a lost allocation race (exclusion constraint) into a friendly conflict", async () => {
    mockTx.booking.findUnique.mockResolvedValue(booking());
    mockTx.assetAllocation.create.mockRejectedValueOnce(Object.assign(new Error("asset_allocations_no_overlap"), { code: "23P01" }));

    const result = await addAndStageReservationPickupSerialized(args);
    expect(result).toEqual({ success: false, error: "FX3-2 is no longer available", errorCode: "conflict" });
  });

  it("rethrows unexpected database errors instead of hiding them", async () => {
    mockTx.booking.findUnique.mockResolvedValue(booking());
    mockTx.assetAllocation.create.mockRejectedValueOnce(new Error("connection reset"));

    await expect(addAndStageReservationPickupSerialized(args)).rejects.toThrow("connection reset");
  });

  it("refuses an item that is already on the reservation", async () => {
    mockTx.booking.findUnique.mockResolvedValue(booking({ serializedItems: [{ assetId: "fx3-2", allocationStatus: "active" }] }));

    await expect(addAndStageReservationPickupSerialized(args)).rejects.toMatchObject({ status: 409 });
    expect(checkAvailability).not.toHaveBeenCalled();
  });

  it("refuses a reservation that is no longer BOOKED", async () => {
    mockTx.booking.findUnique.mockResolvedValue(booking({ status: BookingStatus.CANCELLED }));

    await expect(addAndStageReservationPickupSerialized(args)).rejects.toMatchObject({ status: 409 });
    expect(mockTx.user.findFirst).not.toHaveBeenCalled();
  });

  it("refuses an actor who is not on the kiosk roster", async () => {
    mockTx.booking.findUnique.mockResolvedValue(booking());
    mockTx.user.findFirst.mockResolvedValue(null);

    await expect(addAndStageReservationPickupSerialized(args)).rejects.toMatchObject({ status: 403 });
  });

  it("keeps a personal reservation requester-locked for other students", async () => {
    mockTx.booking.findUnique.mockResolvedValue(booking());
    mockTx.user.findFirst.mockResolvedValue({ id: "jordan", role: Role.STUDENT, collaboratorPolicy: null });

    await expect(addAndStageReservationPickupSerialized({ ...args, actorUserId: "jordan" }))
      .rejects.toMatchObject({ status: 403 });
    expect(mockTx.bookingSerializedItem.create).not.toHaveBeenCalled();
  });

  it("stops at the per-request item limit", async () => {
    mockTx.booking.findUnique.mockResolvedValue(booking({ bulkItems: [{ plannedQuantity: 100_000 }] }));

    await expect(addAndStageReservationPickupSerialized(args)).rejects.toMatchObject({ status: 400 });
  });

  it("preflight answers Add or Discard without writing", async () => {
    mockTx.booking.findUnique.mockResolvedValue(booking());

    const result = await preflightReservationPickupSerializedAdd({ bookingId: "booking-1", actorUserId: "maya", asset });

    expect(result).toEqual({ ok: true, item: { id: "fx3-2", name: "FX3 2", tagName: "FX3-2" } });
    expect(mockTx.bookingSerializedItem.create).not.toHaveBeenCalled();
    expect(mockTx.scanEvent.create).not.toHaveBeenCalled();
  });
});

describe("resolving a bulk scan at pickup", () => {
  it("names a numbered unit and blocks one that cannot go out", async () => {
    vi.mocked(findBulkUnitByScanValue).mockResolvedValue({
      id: "unit-7",
      bulkSkuId: "sku-batt",
      bulkSkuName: "NP-FZ100",
      unitNumber: 7,
      type: "Battery",
      status: "DAMAGED",
    } as never);

    const target = await resolvePickupBulkAddTarget("BATT-7");

    expect(target).toMatchObject({
      bulkSkuId: "sku-batt",
      unitNumber: 7,
      blockedReason: "NP-FZ100 #7 is damaged and cannot be added",
      item: { name: "NP-FZ100 #7", unitNumber: 7 },
    });
  });

  it("falls back to an active counted SKU's bin code", async () => {
    vi.mocked(findBulkUnitByScanValue).mockResolvedValue(null);
    vi.mocked(db.bulkSku.findFirst).mockResolvedValue({ id: "sku-tape", name: "Gaff tape", category: "Expendables" } as never);

    const target = await resolvePickupBulkAddTarget("BIN-TAPE");

    expect(target).toMatchObject({ bulkSkuId: "sku-tape", unitNumber: null, blockedReason: null });
    expect(db.bulkSku.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ active: true, trackByNumber: false }),
    }));
  });

  it("returns null for a scan that names nothing", async () => {
    vi.mocked(findBulkUnitByScanValue).mockResolvedValue(null);
    vi.mocked(db.bulkSku.findFirst).mockResolvedValue(null);

    await expect(resolvePickupBulkAddTarget("NOPE")).resolves.toBeNull();
  });
});

describe("adding an off-plan bulk unit at pickup", () => {
  const unitTarget: PickupBulkAddTarget = {
    bulkSkuId: "sku-batt",
    skuName: "NP-FZ100",
    category: "Battery",
    unitNumber: 7,
    blockedReason: null,
    item: { id: "unit-7", name: "NP-FZ100 #7", tagName: "NP-FZ100 #7", type: "Battery", bulkSkuId: "sku-batt", unitNumber: 7 },
  };
  const args = { bookingId: "booking-1", actorUserId: "maya", scanValue: "BATT-7", target: unitTarget, deviceContext: "kiosk:k1" };

  beforeEach(() => {
    mockTx.booking.findUnique.mockResolvedValue(booking({ bulkItems: [{ plannedQuantity: 2 }] }));
    vi.mocked(db.booking.findUnique).mockResolvedValue({
      serializedItems: [{ assetId: "fx3-1" }],
      bulkItems: [{ bulkSkuId: "sku-batt", plannedQuantity: 2 }],
    } as never);
  });

  it("raises the planned quantity through updateReservation, then stages the unit", async () => {
    vi.mocked(stageKioskReservationPickupBulkUnit).mockResolvedValue({ handled: true, success: true, item: unitTarget.item } as never);

    const result = await addAndStageReservationPickupBulk(args);

    expect(result).toEqual({ success: true, addedToPlan: true, item: unitTarget.item });
    expect(updateReservation).toHaveBeenCalledTimes(1);
    expect(updateReservation).toHaveBeenCalledWith("booking-1", "maya", {
      serializedAssetIds: ["fx3-1"],
      bulkItems: [{ bulkSkuId: "sku-batt", quantity: 3 }],
    });
  });

  it("adds a new SKU line when the unit's SKU was not on the plan", async () => {
    vi.mocked(db.booking.findUnique).mockResolvedValue({ serializedItems: [], bulkItems: [] } as never);
    vi.mocked(stageKioskReservationPickupBulkUnit).mockResolvedValue({ handled: true, success: true, item: unitTarget.item } as never);

    await addAndStageReservationPickupBulk(args);

    expect(updateReservation).toHaveBeenCalledWith("booking-1", "maya", {
      serializedAssetIds: [],
      bulkItems: [{ bulkSkuId: "sku-batt", quantity: 1 }],
    });
  });

  it("gives the reserved slot back when the unit cannot be staged", async () => {
    vi.mocked(stageKioskReservationPickupBulkUnit).mockResolvedValue({
      handled: true,
      success: false,
      error: "NP-FZ100 #7 is checked out to Jordan",
      errorCode: "held",
    } as never);

    const result = await addAndStageReservationPickupBulk(args);

    expect(result).toEqual({ success: false, error: "NP-FZ100 #7 is checked out to Jordan", errorCode: "held" });
    expect(updateReservation).toHaveBeenNthCalledWith(2, "booking-1", "maya", {
      serializedAssetIds: ["fx3-1"],
      bulkItems: [{ bulkSkuId: "sku-batt", quantity: 2 }],
    });
  });

  it("does not stage anything for a counted SKU", async () => {
    const counted = { ...unitTarget, unitNumber: null, item: { ...unitTarget.item, unitNumber: undefined } };

    const result = await addAndStageReservationPickupBulk({ ...args, target: counted });

    expect(result).toMatchObject({ success: true, addedToPlan: true });
    expect(stageKioskReservationPickupBulkUnit).not.toHaveBeenCalled();
  });

  it("reports a reservation rule rejection as a conflict", async () => {
    vi.mocked(updateReservation).mockRejectedValueOnce(new HttpError(409, "Not enough NP-FZ100 left"));

    const result = await addAndStageReservationPickupBulk(args);

    expect(result).toEqual({ success: false, error: "Not enough NP-FZ100 left", errorCode: "conflict" });
    expect(stageKioskReservationPickupBulkUnit).not.toHaveBeenCalled();
  });

  it("stops before touching the plan when the scanned unit is blocked", async () => {
    const result = await addAndStageReservationPickupBulk({ ...args, target: { ...unitTarget, blockedReason: "NP-FZ100 #7 is damaged and cannot be added" } });

    expect(result).toEqual({ success: false, error: "NP-FZ100 #7 is damaged and cannot be added", errorCode: "unavailable" });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(updateReservation).not.toHaveBeenCalled();
  });

  it("stops before touching the plan when no unit of the SKU is free", async () => {
    vi.mocked(checkAvailability).mockResolvedValue({
      ...CLEAR,
      shortages: [{ bulkSkuId: "sku-batt", requested: 1, available: 0 }],
    } as never);

    const result = await addAndStageReservationPickupBulk(args);

    expect(result).toMatchObject({ success: false, errorCode: "unavailable" });
    expect(updateReservation).not.toHaveBeenCalled();
  });
});

describe("swapping a reserved item for a like-for-like scan at pickup", () => {
  const reserved = tripod("t-535", "535");
  const scanned = { ...tripod("t-755", "755"), status: "AVAILABLE" };
  const args = { bookingId: "booking-1", actorUserId: "maya", scanValue: "755", reservedAssetId: "t-535", deviceContext: "kiosk:k1" };

  beforeEach(() => {
    mockTx.booking.findUnique.mockResolvedValue(booking({
      serializedItems: [{ assetId: "t-535", allocationStatus: "active", asset: reserved }],
    }));
    vi.mocked(findAssetByScanValue).mockResolvedValue(scanned as never);
  });

  it("releases the reserved item, holds the scanned one, stages its scan and audits the swap", async () => {
    const result = await substituteReservationPickupItem(args);

    expect(result).toEqual({
      success: true,
      item: { id: "t-755", name: "755 Tripod", tagName: "755" },
      replaced: { id: "t-535", name: "535 Tripod", tagName: "535" },
    });
    expect(txOptions[0]).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    expect(mockTx.bookingSerializedItem.deleteMany).toHaveBeenCalledWith({
      where: { bookingId: "booking-1", assetId: "t-535", allocationStatus: "active" },
    });
    expect(mockTx.assetAllocation.updateMany).toHaveBeenCalledWith({
      where: { bookingId: "booking-1", assetId: "t-535", active: true },
      data: { active: false },
    });
    expect(mockTx.bookingSerializedItem.create).toHaveBeenCalledWith({
      data: { bookingId: "booking-1", assetId: "t-755", allocationStatus: "active" },
    });
    expect(mockTx.scanEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ assetId: "t-755", phase: "CHECKOUT", success: true }),
    });
    expect(createAuditEntryTx).toHaveBeenCalledWith(mockTx, expect.objectContaining({
      action: "booking.item_substituted",
      before: expect.objectContaining({ serializedAssetIds: ["t-535"] }),
      after: expect.objectContaining({ serializedAssetIds: ["t-755"] }),
    }));
  });

  it("refuses when the kiosk's offer is stale (a different reserved item would be replaced)", async () => {
    await expect(substituteReservationPickupItem({ ...args, reservedAssetId: "t-other" }))
      .rejects.toMatchObject({ status: 409 });
    expect(mockTx.bookingSerializedItem.deleteMany).not.toHaveBeenCalled();
  });

  it("refuses when the reserved item was already scanned for pickup", async () => {
    mockTx.booking.findUnique.mockResolvedValue(booking({
      serializedItems: [{ assetId: "t-535", allocationStatus: "active", asset: reserved }],
      scanEvents: [{ assetId: "t-535" }],
    }));

    await expect(substituteReservationPickupItem(args)).rejects.toMatchObject({ status: 409 });
    expect(mockTx.bookingSerializedItem.deleteMany).not.toHaveBeenCalled();
  });

  it("refuses a scanned item that is already on the reservation", async () => {
    mockTx.booking.findUnique.mockResolvedValue(booking({
      serializedItems: [
        { assetId: "t-535", allocationStatus: "active", asset: reserved },
        { assetId: "t-755", allocationStatus: "active", asset: scanned },
      ],
    }));

    await expect(substituteReservationPickupItem(args)).rejects.toThrow("755 is already on this reservation");
  });

  it("refuses an unknown scan", async () => {
    vi.mocked(findAssetByScanValue).mockResolvedValue(null);

    await expect(substituteReservationPickupItem(args)).rejects.toMatchObject({ status: 404 });
  });

  it("keeps the original plan when the scanned item is held elsewhere", async () => {
    vi.mocked(checkAvailability).mockResolvedValue({
      ...CLEAR,
      conflicts: [{ assetId: "t-755", conflictingBookingTitle: "Soccer", startsAt: FAR_FUTURE_START, endsAt: FAR_FUTURE_END }],
    } as never);

    await expect(substituteReservationPickupItem(args)).rejects.toMatchObject({ status: 409 });
    expect(mockTx.bookingSerializedItem.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.assetAllocation.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a reservation that is no longer BOOKED", async () => {
    mockTx.booking.findUnique.mockResolvedValue(booking({ status: BookingStatus.OPEN, kind: BookingKind.CHECKOUT }));

    await expect(substituteReservationPickupItem(args)).rejects.toMatchObject({ status: 409 });
    expect(findAssetByScanValue).not.toHaveBeenCalled();
  });

  it("previews the same swap read-only", async () => {
    vi.mocked(db.booking.findUnique).mockResolvedValue({
      serializedItems: [{ assetId: "t-535", allocationStatus: "active", asset: reserved }],
      scanEvents: [],
    } as never);

    const offer = await previewPickupSubstitution("booking-1", scanned);

    expect(offer).toEqual({
      scanned: { id: "t-755", name: "755 Tripod", tagName: "755" },
      reserved: { id: "t-535", name: "535 Tripod", tagName: "535" },
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("previews nothing for a missing booking", async () => {
    vi.mocked(db.booking.findUnique).mockResolvedValue(null);

    await expect(previewPickupSubstitution("gone", scanned)).resolves.toBeNull();
  });
});
