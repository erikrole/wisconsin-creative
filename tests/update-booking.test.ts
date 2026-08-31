import { describe, it, expect, vi, beforeEach } from "vitest";
import { expectSerializableIsolation } from "./_helpers/assert-transaction";

type MockFn = ReturnType<typeof vi.fn>;
type UpdateBookingTx = {
  booking: Record<"findUnique" | "findUniqueOrThrow" | "update", MockFn>;
  bookingSerializedItem: Record<"deleteMany" | "createMany", MockFn>;
  bookingBulkItem: Record<"deleteMany" | "createMany" | "update", MockFn>;
  bulkSku: Record<"findMany", MockFn>;
  assetAllocation: Record<"deleteMany" | "createMany" | "updateMany", MockFn>;
  auditLog: Record<"create" | "createMany", MockFn>;
  user: Record<"findUnique", MockFn>;
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
    bookingBulkItem: { deleteMany: vi.fn(), createMany: vi.fn(), update: vi.fn() },
    bulkSku: { findMany: vi.fn() },
    assetAllocation: { deleteMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn() },
    auditLog: { create: vi.fn(), createMany: vi.fn() },
    user: { findUnique: vi.fn().mockResolvedValue({ role: "ADMIN", active: true }) },
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
}));

import { db } from "@/lib/db";
import {
  MAX_EQUIPMENT_SELECTIONS_PER_REQUEST,
} from "@/lib/request-limits";
import { checkAvailability } from "@/lib/services/availability";
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
  mockTx.bulkSku.findMany.mockResolvedValue([]);
  mockTx.assetAllocation.deleteMany.mockResolvedValue({});
  mockTx.assetAllocation.createMany.mockResolvedValue({});
  mockTx.assetAllocation.updateMany.mockResolvedValue({});
  mockTx.bookingBulkItem.update.mockResolvedValue({});
  mockTx.auditLog.create.mockResolvedValue({});
  mockTx.auditLog.createMany.mockResolvedValue({});
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
});

// ═══════════════════════════════════════════════════════════════════════════════
// updateReservation
// ═══════════════════════════════════════════════════════════════════════════════
describe("updateReservation", () => {
  it("uses SERIALIZABLE isolation", async () => {
    mockTx.booking.findUnique.mockResolvedValue(makeExistingReservation());

    await updateReservation("r-1", "actor-1", { title: "Updated" });

    expectSerializableIsolation(transactionCalls, 0);
  });

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
      message: "Equipment cannot be edited after a partial pickup",
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
      where: { bookingId: "r-1" },
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
    ).rejects.toThrow("Availability conflict");
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

    expect(mockTx.bookingSerializedItem.deleteMany).toHaveBeenCalledWith({ where: { bookingId: "r-1" } });
    expect(mockTx.assetAllocation.deleteMany).toHaveBeenCalledWith({ where: { bookingId: "r-1" } });
    expect(mockTx.bookingSerializedItem.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ bookingId: "r-1", assetId: "a-1" }),
        expect.objectContaining({ bookingId: "r-1", assetId: "a-2" }),
      ]),
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

    expect(mockTx.bookingBulkItem.createMany).toHaveBeenCalledWith({
      data: [{
        bookingId: "r-1",
        bulkSkuId: "sku-numbered",
        plannedQuantity: MAX_EQUIPMENT_SELECTIONS_PER_REQUEST,
      }],
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

    expect(mockTx.bookingBulkItem.createMany).toHaveBeenCalledWith({
      data: [{
        bookingId: "r-1",
        bulkSkuId: "sku-quantity",
        plannedQuantity: 1_000_000,
      }],
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
  it("uses SERIALIZABLE isolation", async () => {
    mockTx.booking.findUnique.mockResolvedValue(makeExistingCheckout());

    await updateCheckout("c-1", "actor-1", { title: "Updated" });

    expectSerializableIsolation(transactionCalls, 0);
  });

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

    expect(checkAvailability).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({ excludeBookingId: "c-1" })
    );
    expect(mockTx.assetAllocation.updateMany).toHaveBeenCalledWith({
      where: { bookingId: "c-1" },
      data: {
        startsAt,
        endsAt: newEnd,
      },
    });
  });

  it("throws 409 on availability conflict", async () => {
    mockTx.booking.findUnique.mockResolvedValue(makeExistingCheckout());
    vi.mocked(checkAvailability).mockResolvedValueOnce({
      conflicts: [{ assetId: "a-1", conflictingBookingId: "b-other", startsAt: new Date(), endsAt: new Date() }],
      shortages: [],
      unavailableAssets: [],
      upcomingCommitments: [],
      turnaroundRisks: [],
      bulkTurnaroundRisks: [],
    });

    await expect(
      updateCheckout("c-1", "actor-1", { endsAt: new Date("2026-04-11T17:00:00Z") })
    ).rejects.toThrow("Conflicts");
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
