import { describe, it, expect, vi, beforeEach } from "vitest";
import { expectSerializableIsolation } from "./_helpers/assert-transaction";

type MockFn = ReturnType<typeof vi.fn>;
type UpdateBookingTx = {
  booking: Record<"findUnique" | "findUniqueOrThrow" | "update", MockFn>;
  bookingSerializedItem: Record<"deleteMany" | "createMany", MockFn>;
  bookingBulkItem: Record<"deleteMany" | "createMany" | "update" | "upsert", MockFn>;
  bulkSku: Record<"findMany", MockFn>;
  assetAllocation: Record<"deleteMany" | "createMany" | "updateMany", MockFn>;
  auditLog: Record<"create" | "createMany", MockFn>;
  user: Record<"findUnique", MockFn>;
  scanSession: Record<"updateMany", MockFn>;
  scanEvent: Record<"updateMany" | "findMany", MockFn>;
  bookingBulkUnitAllocation: Record<"findMany", MockFn>;
  bulkStockBalance: Record<"findMany" | "upsert", MockFn>;
  bulkStockMovement: Record<"createMany", MockFn>;
};

// ─── Transaction tracking ───────────────────────────────────────────────────
const transactionCalls: Array<{ options: unknown }> = [];

// ─── Mock @/lib/db ──────────────────────────────────────────────────────────
vi.mock("@/lib/db", () => {
  const mockTx = {
    booking: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
    bookingSerializedItem: { deleteMany: vi.fn(), createMany: vi.fn() },
    bookingBulkItem: { deleteMany: vi.fn(), createMany: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    bulkSku: { findMany: vi.fn() },
    assetAllocation: { deleteMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn() },
    auditLog: { create: vi.fn(), createMany: vi.fn() },
    user: { findUnique: vi.fn().mockResolvedValue({ role: "ADMIN", active: true }) },
    scanSession: { updateMany: vi.fn() },
    scanEvent: { updateMany: vi.fn(), findMany: vi.fn() },
    bookingBulkUnitAllocation: { findMany: vi.fn() },
    bulkStockBalance: { findMany: vi.fn(), upsert: vi.fn() },
    bulkStockMovement: { createMany: vi.fn() },
  };

  return {
    db: {
      $transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>, options?: unknown) => {
        transactionCalls.push({ options });
        return fn(mockTx);
      }),
      _mockTx: mockTx,
    },
  };
});

vi.mock("@/lib/services/availability", () => ({
  checkAvailability: vi.fn().mockResolvedValue({
    conflicts: [],
    shortages: [],
    unavailableAssets: [],
    upcomingCommitments: [],
    turnaroundRisks: [],
    bulkTurnaroundRisks: [],
  }),
  checkCheckoutDueTime: vi.fn().mockResolvedValue({
    conflicts: [],
    shortages: [],
    unavailableAssets: [],
    upcomingCommitments: [],
    turnaroundRisks: [],
    bulkTurnaroundRisks: [],
  }),
}));

import { db } from "@/lib/db";
import {
  MAX_EQUIPMENT_SELECTIONS_PER_REQUEST,
} from "@/lib/request-limits";
import { checkAvailability, checkCheckoutDueTime } from "@/lib/services/availability";
import { updateReservation, updateCheckout } from "@/lib/services/bookings";

const mockTx = (db as unknown as { _mockTx: UpdateBookingTx })._mockTx;

const startsAt = new Date("2026-04-10T08:00:00Z");
const endsAt = new Date("2026-04-10T17:00:00Z");

function makeExistingReservation(overrides: Record<string, unknown> = {}) {
  return {
    id: "r-1",
    kind: "RESERVATION",
    status: "BOOKED",
    title: "Game Day Gear",
    locationId: "loc-1",
    startsAt,
    endsAt,
    updatedAt: new Date("2026-04-10T07:00:00Z"),
    notes: null,
    serializedItems: [{ assetId: "a-1" }],
    bulkItems: [{ bulkSkuId: "sku-1", plannedQuantity: 5 }],
    derivedCheckouts: [],
    ...overrides,
  };
}

function makeExistingCheckout(overrides: Record<string, unknown> = {}) {
  return {
    id: "c-1",
    kind: "CHECKOUT",
    status: "OPEN",
    title: "Practice Checkout",
    locationId: "loc-1",
    startsAt,
    endsAt,
    updatedAt: new Date("2026-04-10T07:00:00Z"),
    notes: null,
    serializedItems: [{ assetId: "a-1", allocationStatus: "active" }],
    bulkItems: [{
      id: "bbi-1",
      bulkSkuId: "sku-1",
      plannedQuantity: 5,
      checkedOutQuantity: null,
      checkedInQuantity: 0,
      unitAllocations: [],
    }],
    ...overrides,
  };
}

const returnedBooking = { id: "r-1", kind: "RESERVATION", status: "BOOKED" };

beforeEach(() => {
  vi.clearAllMocks();
  transactionCalls.length = 0;
  mockTx.booking.update.mockResolvedValue({});
  mockTx.booking.findUniqueOrThrow.mockResolvedValue(returnedBooking);
  mockTx.bookingSerializedItem.deleteMany.mockResolvedValue({});
  mockTx.bookingSerializedItem.createMany.mockResolvedValue({});
  mockTx.bookingBulkItem.deleteMany.mockResolvedValue({});
  mockTx.bookingBulkItem.createMany.mockResolvedValue({});
  mockTx.bookingBulkItem.upsert.mockResolvedValue({});
  mockTx.bulkSku.findMany.mockResolvedValue([]);
  mockTx.assetAllocation.deleteMany.mockResolvedValue({});
  mockTx.assetAllocation.createMany.mockResolvedValue({});
  mockTx.assetAllocation.updateMany.mockResolvedValue({});
  mockTx.bookingBulkItem.update.mockResolvedValue({});
  mockTx.auditLog.create.mockResolvedValue({});
  mockTx.auditLog.createMany.mockResolvedValue({});
  mockTx.scanSession.updateMany.mockResolvedValue({ count: 0 });
  mockTx.scanEvent.updateMany.mockResolvedValue({ count: 0 });
  mockTx.scanEvent.findMany.mockResolvedValue([]);
  mockTx.bookingBulkUnitAllocation.findMany.mockResolvedValue([]);
  mockTx.bulkStockBalance.findMany.mockResolvedValue([{ bulkSkuId: "sku-1", onHandQuantity: 50 }]);
  mockTx.bulkStockBalance.upsert.mockResolvedValue({});
  mockTx.bulkStockMovement.createMany.mockResolvedValue({});
  vi.mocked(checkAvailability).mockResolvedValue({
    conflicts: [],
    shortages: [],
    unavailableAssets: [],
    upcomingCommitments: [],
    turnaroundRisks: [],
    bulkTurnaroundRisks: [],
  });
  vi.mocked(checkCheckoutDueTime).mockResolvedValue({
    conflicts: [],
    shortages: [],
    unavailableAssets: [],
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// updateReservation
// ═══════════════════════════════════════════════════════════════════════════════
describe("updateReservation", () => {
  it("BUG: rejects a snapshot that became stale before the transaction write", async () => {
    mockTx.booking.findUnique.mockResolvedValue(makeExistingReservation());

    await expect(updateReservation(
      "r-1",
      "actor-1",
      { title: "Updated" },
      new Date("2026-04-10T06:59:59Z"),
    )).rejects.toMatchObject({ status: 409 });

    expect(mockTx.booking.update).not.toHaveBeenCalled();
    expect(mockTx.auditLog.create).not.toHaveBeenCalled();
  });

  it("updates title and creates audit log", async () => {
    mockTx.booking.findUnique.mockResolvedValue(makeExistingReservation());

    await updateReservation("r-1", "actor-1", { title: "New Title" });

    expect(mockTx.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "r-1" },
        data: expect.objectContaining({ title: "New Title" }),
      })
    );
    expectSerializableIsolation(transactionCalls, 0);
  });

  it("normalizes reservation titles before storing and auditing them", async () => {
    mockTx.booking.findUnique.mockResolvedValue(makeExistingReservation());

    await updateReservation("r-1", "actor-1", { title: "wbb PRACTICE" });

    expect(mockTx.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: "WBB Practice" }),
      }),
    );
    expect(mockTx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          afterJson: expect.objectContaining({ title: "WBB Practice" }),
        }),
      }),
    );
  });

  it("does not check availability or rebuild equipment when only reservation details change", async () => {
    mockTx.booking.findUnique.mockResolvedValue(makeExistingReservation());

    await updateReservation("r-1", "actor-1", { title: "Updated" });

    expect(checkAvailability).not.toHaveBeenCalled();
    expect(mockTx.bookingSerializedItem.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.bookingBulkItem.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.assetAllocation.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.assetAllocation.updateMany).not.toHaveBeenCalled();
  });

  it("rejects equipment edits after a partial pickup begins", async () => {
    mockTx.booking.findUnique.mockResolvedValue(makeExistingReservation({
      serializedItems: [{ assetId: "a-1", allocationStatus: "picked_up" }],
      bulkItems: [{ bulkSkuId: "sku-1", plannedQuantity: 5, checkedOutQuantity: 2 }],
    }));

    await expect(
      updateReservation("r-1", "actor-1", { serializedAssetIds: ["a-2"] }),
    ).rejects.toMatchObject({
      status: 409,
      message: "Items already picked up are on the checkout. Edit the remaining items only.",
    });

    expect(checkAvailability).not.toHaveBeenCalled();
    expect(mockTx.bookingSerializedItem.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.bookingBulkItem.deleteMany).not.toHaveBeenCalled();
  });

  it("checks availability with excludeBookingId when reservation timing changes", async () => {
    mockTx.booking.findUnique.mockResolvedValue(makeExistingReservation());
    const newEnd = new Date("2026-04-11T17:00:00Z");

    await updateReservation("r-1", "actor-1", { endsAt: newEnd });

    expect(checkAvailability).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({ excludeBookingId: "r-1" })
    );
    expect(mockTx.assetAllocation.updateMany).toHaveBeenCalledWith({
      where: { bookingId: "r-1", active: true },
      data: {
        startsAt,
        endsAt: newEnd,
      },
    });
  });

  it("throws 409 on availability conflict", async () => {
    mockTx.booking.findUnique.mockResolvedValue(makeExistingReservation());
    vi.mocked(checkAvailability).mockResolvedValueOnce({
      conflicts: [{ assetId: "a-1", conflictingBookingId: "b-other", startsAt: new Date(), endsAt: new Date() }],
      shortages: [],
      unavailableAssets: [],
      upcomingCommitments: [],
      turnaroundRisks: [],
      bulkTurnaroundRisks: [],
    });

    await expect(
      updateReservation("r-1", "actor-1", { endsAt: new Date("2026-04-11T17:00:00Z") })
    ).rejects.toThrow("Conflict with another booking");
  });

  it("maps commit-time allocation races to a booking conflict", async () => {
    mockTx.booking.findUnique.mockResolvedValue(makeExistingReservation());
    mockTx.assetAllocation.createMany.mockRejectedValueOnce({ code: "23P01" });

    await expect(
      updateReservation("r-1", "actor-1", { serializedAssetIds: ["a-1", "a-2"] })
    ).rejects.toThrow("One or more items are no longer available");
  });

  it("rebuilds serialized items and allocations", async () => {
    mockTx.booking.findUnique.mockResolvedValue(makeExistingReservation());

    await updateReservation("r-1", "actor-1", { serializedAssetIds: ["a-1", "a-2"] });

    expect(mockTx.bookingSerializedItem.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ bookingId: "r-1", assetId: "a-2" })],
    });
    expect(mockTx.assetAllocation.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ bookingId: "r-1", assetId: "a-2" })],
    });
  });

  it("allows a numbered reservation update at the native pickup checklist ceiling", async () => {
    mockTx.booking.findUnique.mockResolvedValue(makeExistingReservation());
    mockTx.bulkSku.findMany.mockResolvedValue([{ id: "sku-numbered" }]);

    await updateReservation("r-1", "actor-1", {
      bulkItems: [{
        bulkSkuId: "sku-numbered",
        quantity: MAX_EQUIPMENT_SELECTIONS_PER_REQUEST,
      }],
    });

    expect(mockTx.bookingBulkItem.upsert).toHaveBeenCalledWith({
      where: { bookingId_bulkSkuId: { bookingId: "r-1", bulkSkuId: "sku-numbered" } },
      create: {
        bookingId: "r-1",
        bulkSkuId: "sku-numbered",
        plannedQuantity: MAX_EQUIPMENT_SELECTIONS_PER_REQUEST,
      },
      update: { plannedQuantity: MAX_EQUIPMENT_SELECTIONS_PER_REQUEST },
    });
  });

  it("rejects a numbered reservation update above the native pickup checklist ceiling before availability or writes", async () => {
    mockTx.booking.findUnique.mockResolvedValue(makeExistingReservation());
    mockTx.bulkSku.findMany.mockResolvedValue([
      { id: "sku-numbered-1" },
      { id: "sku-numbered-2" },
    ]);

    await expect(updateReservation("r-1", "actor-1", {
      bulkItems: [
        { bulkSkuId: "sku-numbered-1", quantity: 250 },
        { bulkSkuId: "sku-numbered-2", quantity: 251 },
      ],
    })).rejects.toMatchObject({
      status: 400,
      message: `Numbered pickup plans support at most ${MAX_EQUIPMENT_SELECTIONS_PER_REQUEST} units total`,
    });

    expect(checkAvailability).not.toHaveBeenCalled();
    expect(mockTx.booking.update).not.toHaveBeenCalled();
    expect(mockTx.bookingBulkItem.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.auditLog.create).not.toHaveBeenCalled();
    expect(mockTx.auditLog.createMany).not.toHaveBeenCalled();
  });

  it("allows a large quantity-tracked reservation update", async () => {
    mockTx.booking.findUnique.mockResolvedValue(makeExistingReservation());

    await updateReservation("r-1", "actor-1", {
      bulkItems: [{ bulkSkuId: "sku-quantity", quantity: 1_000_000 }],
    });

    expect(mockTx.bookingBulkItem.upsert).toHaveBeenCalledWith({
      where: { bookingId_bulkSkuId: { bookingId: "r-1", bulkSkuId: "sku-quantity" } },
      create: {
        bookingId: "r-1",
        bulkSkuId: "sku-quantity",
        plannedQuantity: 1_000_000,
      },
      update: { plannedQuantity: 1_000_000 },
    });
  });

  it("throws 404 when reservation not found", async () => {
    mockTx.booking.findUnique.mockResolvedValue(null);
    await expect(updateReservation("bad-id", "actor-1", {})).rejects.toThrow("Reservation not found");
  });

  it("throws 400 when booking is a CHECKOUT", async () => {
    mockTx.booking.findUnique.mockResolvedValue(makeExistingCheckout());
    await expect(updateReservation("c-1", "actor-1", {})).rejects.toThrow("Only reservations");
  });

  it("throws 400 when reservation is CANCELLED", async () => {
    mockTx.booking.findUnique.mockResolvedValue(makeExistingReservation({ status: "CANCELLED" }));
    await expect(updateReservation("r-1", "actor-1", {})).rejects.toThrow("cancelled or completed");
  });

  it("throws 400 when reservation is COMPLETED", async () => {
    mockTx.booking.findUnique.mockResolvedValue(makeExistingReservation({ status: "COMPLETED" }));
    await expect(updateReservation("r-1", "actor-1", {})).rejects.toThrow("cancelled or completed");
  });

  it("throws 400 when the new requester does not exist", async () => {
    mockTx.booking.findUnique.mockResolvedValue(makeExistingReservation({ requesterUserId: "u-old" }));
    mockTx.user.findUnique.mockResolvedValueOnce(null);

    await expect(
      updateReservation("r-1", "actor-1", { requesterUserId: "u-ghost" })
    ).rejects.toThrow("Requester not found");
  });

  it("throws 400 when the new requester is inactive", async () => {
    mockTx.booking.findUnique.mockResolvedValue(makeExistingReservation({ requesterUserId: "u-old" }));
    mockTx.user.findUnique.mockResolvedValueOnce({ active: false });

    await expect(
      updateReservation("r-1", "actor-1", { requesterUserId: "u-inactive" })
    ).rejects.toThrow("inactive user as requester");
  });

  it("creates equipment audit entries when items change", async () => {
    mockTx.booking.findUnique.mockResolvedValue(makeExistingReservation());

    await updateReservation("r-1", "actor-1", { serializedAssetIds: ["a-1", "a-2"] });

    expect(mockTx.auditLog.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ action: "booking.items_added" }),
        ]),
      })
    );
  });

  it("rejects an invalid edit window before availability or allocation work", async () => {
    mockTx.booking.findUnique.mockResolvedValue(makeExistingReservation());

    await expect(
      updateReservation("r-1", "actor-1", { endsAt: new Date("2026-04-10T07:00:00Z") })
    ).rejects.toThrow("endsAt must be later than startsAt");

    expect(checkAvailability).not.toHaveBeenCalled();
    expect(mockTx.assetAllocation.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.assetAllocation.createMany).not.toHaveBeenCalled();
    expect(mockTx.bookingSerializedItem.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.bookingSerializedItem.createMany).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// updateCheckout
// ═══════════════════════════════════════════════════════════════════════════════
describe("updateCheckout", () => {
  it("BUG: rejects a checkout snapshot that became stale before the transaction write", async () => {
    mockTx.booking.findUnique.mockResolvedValue(makeExistingCheckout());

    await expect(updateCheckout(
      "c-1",
      "actor-1",
      { title: "Updated" },
      new Date("2026-04-10T06:59:59Z"),
    )).rejects.toMatchObject({ status: 409 });

    expect(mockTx.booking.update).not.toHaveBeenCalled();
  });

  it("updates checkout fields", async () => {
    mockTx.booking.findUnique.mockResolvedValue(makeExistingCheckout());
    const newEnd = new Date("2026-04-11T17:00:00Z");

    await updateCheckout("c-1", "actor-1", { title: "New Title", endsAt: newEnd });

    expect(mockTx.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "c-1" },
        data: expect.objectContaining({ title: "New Title", endsAt: newEnd }),
      })
    );
    expectSerializableIsolation(transactionCalls, 0);
  });

  it("normalizes checkout titles before storing them", async () => {
    mockTx.booking.findUnique.mockResolvedValue(makeExistingCheckout());

    await updateCheckout("c-1", "actor-1", { title: "MBB GOLF" });

    expect(mockTx.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: "MBB Golf" }),
      }),
    );
  });

  it("preserves checkout equipment rows when only details change", async () => {
    mockTx.booking.findUnique.mockResolvedValue(makeExistingCheckout());

    await updateCheckout("c-1", "actor-1", { title: "New Title" });

    expect(mockTx.bookingSerializedItem.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.bookingBulkItem.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.assetAllocation.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.assetAllocation.updateMany).not.toHaveBeenCalled();
  });

  it("checks availability with excludeBookingId when checkout due date changes", async () => {
    mockTx.booking.findUnique.mockResolvedValue(makeExistingCheckout());
    const newEnd = new Date("2026-04-11T17:00:00Z");

    await updateCheckout("c-1", "actor-1", { endsAt: newEnd });

    expect(checkCheckoutDueTime).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({ id: "c-1" }),
      newEnd,
    );
    expect(mockTx.assetAllocation.updateMany).toHaveBeenCalledWith({
      where: { bookingId: "c-1" },
      data: {
        startsAt,
        endsAt: newEnd,
      },
    });
  });

  it("keeps the turnaround buffer when an open checkout due time moves earlier", async () => {
    mockTx.booking.findUnique.mockResolvedValue(makeExistingCheckout());
    const earlierEnd = new Date("2026-04-10T16:00:00Z");

    await updateCheckout("c-1", "actor-1", { endsAt: earlierEnd });

    expect(checkCheckoutDueTime).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({ id: "c-1" }),
      earlierEnd,
    );
  });

  it("throws 409 on availability conflict", async () => {
    mockTx.booking.findUnique.mockResolvedValue(makeExistingCheckout());
    vi.mocked(checkCheckoutDueTime).mockResolvedValueOnce({
      conflicts: [{ assetId: "a-1", conflictingBookingId: "b-other", startsAt: new Date(), endsAt: new Date() }],
      shortages: [],
      unavailableAssets: [],
    });

    await expect(
      updateCheckout("c-1", "actor-1", { endsAt: new Date("2026-04-11T17:00:00Z") })
    ).rejects.toThrow("Conflict with another booking");
  });

  it("rejects checkout equipment edits outside the kiosk service boundary", async () => {
    mockTx.booking.findUnique.mockResolvedValue(makeExistingCheckout());

    await expect(
      updateCheckout("c-1", "actor-1", { serializedAssetIds: ["a-1", "a-3"] })
    ).rejects.toMatchObject({
      status: 403,
      message: "Active checkout equipment can only be changed at a kiosk",
    });

    expect(checkAvailability).not.toHaveBeenCalled();
    expect(mockTx.bookingSerializedItem.createMany).not.toHaveBeenCalled();
  });

  it("throws 404 when checkout not found", async () => {
    mockTx.booking.findUnique.mockResolvedValue(null);
    await expect(updateCheckout("bad-id", "actor-1", {})).rejects.toThrow("Checkout not found");
  });

  it("throws 400 when booking is a RESERVATION", async () => {
    mockTx.booking.findUnique.mockResolvedValue(makeExistingReservation());
    await expect(updateCheckout("r-1", "actor-1", {})).rejects.toThrow("Only checkouts");
  });

  it("throws 400 when checkout is CANCELLED", async () => {
    mockTx.booking.findUnique.mockResolvedValue(makeExistingCheckout({ status: "CANCELLED" }));
    await expect(updateCheckout("c-1", "actor-1", {})).rejects.toThrow("cancelled or completed");
  });

  it("throws 400 when checkout is COMPLETED", async () => {
    mockTx.booking.findUnique.mockResolvedValue(makeExistingCheckout({ status: "COMPLETED" }));
    await expect(updateCheckout("c-1", "actor-1", {})).rejects.toThrow("cancelled or completed");
  });

  it("rejects an invalid edit window before availability or allocation work", async () => {
    mockTx.booking.findUnique.mockResolvedValue(makeExistingCheckout());

    await expect(
      updateCheckout("c-1", "actor-1", { endsAt: new Date("2026-04-10T07:00:00Z") })
    ).rejects.toThrow("endsAt must be later than startsAt");

    expect(checkAvailability).not.toHaveBeenCalled();
    expect(mockTx.assetAllocation.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.assetAllocation.createMany).not.toHaveBeenCalled();
    expect(mockTx.bookingSerializedItem.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.bookingSerializedItem.createMany).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Staged pickup scans after a kiosk plan edit
// ═══════════════════════════════════════════════════════════════════════════

describe("updateReservation staged pickup scans", () => {
  const batterySku = { id: "sku-bat", trackByNumber: true, binQrCodeValue: "BAT" };

  function batteryReservation(checkedOutQuantity = 0) {
    return makeExistingReservation({
      serializedItems: [{ assetId: "a-cam", allocationStatus: "active" }],
      bulkItems: [{ bulkSkuId: "sku-bat", plannedQuantity: 4, checkedOutQuantity }],
    });
  }

  function stagedBatteryScans(units: Array<[string, number]>) {
    return units.map(([id, unitNumber]) => ({ id, bulkSkuId: "sku-bat", scanValue: `BAT-${unitNumber}` }));
  }

  beforeEach(() => {
    mockTx.bulkSku.findMany.mockResolvedValue([batterySku]);
  });

  it("keeps the scanned batteries and the camera scan when the battery quantity drops to what was scanned", async () => {
    mockTx.booking.findUnique.mockResolvedValue(batteryReservation());
    mockTx.scanEvent.findMany.mockResolvedValue(stagedBatteryScans([
      ["scan-1", 1],
      ["scan-2", 2],
      ["scan-2-dup", 2],
    ]));

    await updateReservation("r-1", "actor-1", {
      serializedAssetIds: ["a-cam"],
      bulkItems: [{ bulkSkuId: "sku-bat", quantity: 2 }],
    });

    expect(mockTx.scanEvent.updateMany).not.toHaveBeenCalled();
  });

  it("releases only staged units beyond the reduced quantity and ignores already-picked units", async () => {
    // One unit already went out on the derived checkout; three remain staged.
    mockTx.booking.findUnique.mockResolvedValue(batteryReservation(1));
    mockTx.scanEvent.findMany.mockResolvedValue(stagedBatteryScans([
      ["scan-1", 1],
      ["scan-2", 2],
      ["scan-3", 3],
      ["scan-4", 4],
    ]));
    mockTx.bookingBulkUnitAllocation.findMany.mockResolvedValue([
      { bulkSkuUnit: { bulkSkuId: "sku-bat", unitNumber: 1 } },
    ]);

    await updateReservation("r-1", "actor-1", {
      serializedAssetIds: ["a-cam"],
      // picked 1 + 1 still to pick up
      bulkItems: [{ bulkSkuId: "sku-bat", quantity: 2 }],
    });

    expect(mockTx.bookingBulkUnitAllocation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        bookingBulkItem: {
          bulkSkuId: { in: ["sku-bat"] },
          booking: { sourceReservationId: "r-1" },
        },
      },
    }));
    expect(mockTx.scanEvent.updateMany).toHaveBeenCalledTimes(1);
    expect(mockTx.scanEvent.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["scan-3", "scan-4"] } },
      data: { success: false },
    });
  });

  it("releases only the removed camera's scans and leaves staged batteries alone", async () => {
    mockTx.booking.findUnique.mockResolvedValue(batteryReservation());

    await updateReservation("r-1", "actor-1", {
      serializedAssetIds: [],
      bulkItems: [{ bulkSkuId: "sku-bat", quantity: 4 }],
    });

    expect(mockTx.scanEvent.findMany).not.toHaveBeenCalled();
    expect(mockTx.scanEvent.updateMany).toHaveBeenCalledTimes(1);
    expect(mockTx.scanEvent.updateMany).toHaveBeenCalledWith({
      where: {
        bookingId: "r-1",
        phase: "CHECKOUT",
        success: true,
        OR: [{ assetId: { in: ["a-cam"] } }],
      },
      data: { success: false },
    });
  });

  it("releases every staged scan for a battery line that is removed entirely", async () => {
    mockTx.booking.findUnique.mockResolvedValue(batteryReservation());

    await updateReservation("r-1", "actor-1", {
      serializedAssetIds: ["a-cam"],
      bulkItems: [],
    });

    expect(mockTx.scanEvent.updateMany).toHaveBeenCalledTimes(1);
    expect(mockTx.scanEvent.updateMany).toHaveBeenCalledWith({
      where: {
        bookingId: "r-1",
        phase: "CHECKOUT",
        success: true,
        OR: [{ bulkSkuId: { in: ["sku-bat"] } }],
      },
      data: { success: false },
    });
  });

  it("keeps every staged scan when an item is added to the pickup", async () => {
    mockTx.booking.findUnique.mockResolvedValue(batteryReservation());

    await updateReservation("r-1", "actor-1", {
      serializedAssetIds: ["a-cam", "a-lens"],
      bulkItems: [{ bulkSkuId: "sku-bat", quantity: 5 }],
    });

    expect(mockTx.scanEvent.updateMany).not.toHaveBeenCalled();
  });
});
