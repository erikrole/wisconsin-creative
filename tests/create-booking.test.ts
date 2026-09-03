import { describe, it, expect, vi, beforeEach } from "vitest";
import { BookingKind, BookingStatus, CollaboratorProfile, Prisma, Role } from "@prisma/client";
import { expectSerializableIsolation } from "./_helpers/assert-transaction";
import {
  MAX_BULK_SKU_LINES_PER_REQUEST,
  MAX_CHECKOUT_DISTINCT_BULK_SKUS_PER_REQUEST,
  MAX_EQUIPMENT_SELECTIONS_PER_REQUEST,
  MAX_LINKED_EVENTS_PER_BOOKING,
} from "@/lib/request-limits";

type MockFn = ReturnType<typeof vi.fn>;
type CreateBookingTx = {
  booking: Record<"findUnique" | "findUniqueOrThrow" | "findFirst" | "create" | "update" | "delete" | "count", MockFn>;
  calendarEvent: Record<"findMany", MockFn>;
  shiftGroup: Record<"findUnique" | "update", MockFn>;
  shift: Record<"create", MockFn>;
  shiftAssignment: Record<"findMany" | "findUnique" | "updateMany" | "create", MockFn>;
  bookingEvent: Record<"createMany", MockFn>;
  scheduleEventFollow: Record<"createMany", MockFn>;
  bookingSerializedItem: Record<"createMany" | "updateMany", MockFn>;
  bookingBulkItem: Record<"createMany" | "update", MockFn>;
  bulkSku: Record<"findMany", MockFn>;
  assetAllocation: Record<"createMany" | "updateMany", MockFn>;
  bulkStockBalance: Record<"findMany" | "upsert", MockFn>;
  bulkStockMovement: Record<"createMany", MockFn>;
  auditLog: Record<"create", MockFn>;
  overrideEvent: Record<"create", MockFn>;
  scanSession: Record<"updateMany", MockFn>;
  user: Record<"findUnique", MockFn>;
  $queryRaw: MockFn;
};

// ─── Transaction tracking ───────────────────────────────────────────────────
const transactionCalls: Array<{ options: unknown }> = [];

// ─── Mock @/lib/db ──────────────────────────────────────────────────────────
vi.mock("@/lib/db", () => {
  const mockTx = {
    booking: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    calendarEvent: { findMany: vi.fn() },
    shiftGroup: { findUnique: vi.fn(), update: vi.fn() },
    shift: { create: vi.fn() },
    shiftAssignment: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    bookingEvent: { createMany: vi.fn() },
    scheduleEventFollow: { createMany: vi.fn() },
    bookingSerializedItem: { createMany: vi.fn(), updateMany: vi.fn() },
    bookingBulkItem: { createMany: vi.fn(), update: vi.fn() },
    bulkSku: { findMany: vi.fn() },
    assetAllocation: { createMany: vi.fn(), updateMany: vi.fn() },
    bulkStockBalance: { findMany: vi.fn(), upsert: vi.fn() },
    bulkStockMovement: { createMany: vi.fn() },
    auditLog: { create: vi.fn() },
    overrideEvent: { create: vi.fn() },
    scanSession: { updateMany: vi.fn() },
    user: { findUnique: vi.fn().mockResolvedValue({ role: "ADMIN", active: true }) },
    $queryRaw: vi.fn(),
  };

  return {
    db: {
      booking: { findUnique: vi.fn() },
      bulkSkuUnit: { findMany: vi.fn() },
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

vi.mock("@/lib/live-activity-workflow", () => ({
  scheduleCheckoutReturnLiveActivity: vi.fn(),
}));

import { db } from "@/lib/db";
import { scheduleCheckoutReturnLiveActivity } from "@/lib/live-activity-workflow";
import { checkAvailability } from "@/lib/services/availability";
import { createBooking, forceCheckoutReservation } from "@/lib/services/bookings";

const mockTx = (db as unknown as { _mockTx: CreateBookingTx })._mockTx;
const mockDb = db as unknown as {
  booking: { findUnique: MockFn };
  bulkSkuUnit: { findMany: MockFn };
};

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    kind: BookingKind.CHECKOUT,
    custodySource: "KIOSK" as const,
    title: "Test Checkout",
    requesterUserId: "user-1",
    locationId: "loc-1",
    startsAt: new Date("2026-04-01T08:00:00Z"),
    endsAt: new Date("2026-04-01T17:00:00Z"),
    serializedAssetIds: ["a-base"] as string[],
    bulkItems: [] as Array<{ bulkSkuId: string; quantity: number }>,
    createdBy: "user-1",
    ...overrides,
  };
}

function serializableConflict() {
  return new Prisma.PrismaClientKnownRequestError("Serializable conflict", {
    code: "P2034",
    clientVersion: "test",
  });
}

function bulkRequests(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    bulkSkuId: `sku-${index}`,
    quantity: 1,
  }));
}

beforeEach(() => {
  transactionCalls.length = 0;
  mockDb.booking.findUnique.mockResolvedValue(null);
  mockDb.bulkSkuUnit.findMany.mockResolvedValue([]);
  mockTx.booking.create.mockResolvedValue({ id: "b-new" });
  mockTx.booking.findFirst.mockResolvedValue(null);
  mockTx.booking.delete.mockResolvedValue({});
  mockTx.booking.count.mockResolvedValue(0);
  mockTx.$queryRaw.mockResolvedValue([{ nextval: 1n }]);
  mockTx.booking.update.mockResolvedValue({});
  mockTx.booking.findUniqueOrThrow.mockResolvedValue({ id: "b-new", refNumber: "CO-0001" });
  mockTx.calendarEvent.findMany.mockResolvedValue([]);
  mockTx.shiftGroup.findUnique.mockResolvedValue(null);
  mockTx.shiftGroup.update.mockResolvedValue({});
  mockTx.shift.create.mockResolvedValue({});
  mockTx.shiftAssignment.findMany.mockResolvedValue([]);
  mockTx.shiftAssignment.findUnique.mockResolvedValue(null);
  mockTx.shiftAssignment.updateMany.mockResolvedValue({ count: 0 });
  mockTx.shiftAssignment.create.mockResolvedValue({
    id: "assignment-new",
    userId: "user-1",
    status: "DIRECT_ASSIGNED",
    callStartsAt: null,
    callEndsAt: null,
    callNote: null,
    acknowledgedAt: null,
  });
  mockTx.bookingEvent.createMany.mockResolvedValue({});
  mockTx.scheduleEventFollow.createMany.mockResolvedValue({});
  mockTx.bookingSerializedItem.createMany.mockResolvedValue({});
  mockTx.bookingSerializedItem.updateMany.mockResolvedValue({ count: 0 });
  mockTx.assetAllocation.createMany.mockResolvedValue({});
  mockTx.bookingBulkItem.createMany.mockResolvedValue({});
  mockTx.bookingBulkItem.update.mockResolvedValue({});
  mockTx.bulkSku.findMany.mockResolvedValue([]);
  mockTx.bulkStockBalance.findMany.mockResolvedValue([]);
  mockTx.bulkStockBalance.upsert.mockResolvedValue({});
  mockTx.bulkStockMovement.createMany.mockResolvedValue({});
  mockTx.auditLog.create.mockResolvedValue({});
  mockTx.overrideEvent.create.mockResolvedValue({});
  mockTx.user.findUnique.mockResolvedValue({
    active: true,
    role: Role.ADMIN,
    collaboratorProfile: null,
  });
  vi.mocked(checkAvailability).mockResolvedValue({
    conflicts: [],
    shortages: [],
    unavailableAssets: [],
    upcomingCommitments: [],
    turnaroundRisks: [],
    bulkTurnaroundRisks: [],
  });
});

describe("createBooking", () => {
  it("uses SERIALIZABLE isolation", async () => {
    await createBooking(baseInput());
    expectSerializableIsolation(transactionCalls, 0);
  });

  it("rejects checkout creation without kiosk custody source before opening a transaction", async () => {
    await expect(createBooking(baseInput({ custodySource: undefined }))).rejects.toMatchObject({
      status: 403,
      message: "Direct checkout custody can only be created at a kiosk",
    });

    expect(transactionCalls).toHaveLength(0);
    expect(mockTx.booking.create).not.toHaveBeenCalled();
  });

  it("creates kiosk CHECKOUT custody directly as OPEN", async () => {
    await createBooking(baseInput({ kind: "CHECKOUT" }));
    expect(mockTx.booking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: "CHECKOUT", status: "OPEN" }),
      })
    );
  });

  it("creates a RESERVATION with BOOKED status", async () => {
    await createBooking(baseInput({ kind: "RESERVATION" }));
    expect(mockTx.booking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: "RESERVATION", status: "BOOKED" }),
      })
    );
  });

  it("consumes an owned source draft inside reservation creation", async () => {
    mockTx.booking.findFirst.mockResolvedValue({
      id: "draft-1",
      kind: BookingKind.RESERVATION,
      title: "Saved draft",
      requesterUserId: "user-1",
      locationId: "loc-1",
      startsAt: new Date("2026-04-01T08:00:00Z"),
      endsAt: new Date("2026-04-01T17:00:00Z"),
    });

    await createBooking(baseInput({
      kind: BookingKind.RESERVATION,
      custodySource: undefined,
      sourceDraftId: "draft-1",
    }));

    expect(mockTx.booking.findFirst).toHaveBeenCalledWith({
      where: {
        id: "draft-1",
        kind: BookingKind.RESERVATION,
        status: "DRAFT",
        createdBy: "user-1",
      },
      select: expect.any(Object),
    });
    expect(mockTx.booking.delete).toHaveBeenCalledWith({ where: { id: "draft-1" } });
    expect(mockTx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityId: "draft-1",
        action: "draft_consumed",
        afterJson: expect.objectContaining({ createdReservationId: "b-new" }),
      }),
    });
  });

  it("does not create a reservation when its source draft is no longer owned and active", async () => {
    mockTx.booking.findFirst.mockResolvedValue(null);

    await expect(createBooking(baseInput({
      kind: BookingKind.RESERVATION,
      custodySource: undefined,
      sourceDraftId: "draft-1",
    }))).rejects.toMatchObject({
      status: 404,
      message: "Source draft not found",
    });

    expect(mockTx.booking.create).not.toHaveBeenCalled();
    expect(mockTx.booking.delete).not.toHaveBeenCalled();
  });

  it("BUG: rejects a reservation at its concurrent reservation cap inside the transaction", async () => {
    mockTx.booking.count.mockResolvedValueOnce(2);

    await expect(createBooking(baseInput({
      kind: BookingKind.RESERVATION,
      custodySource: undefined,
      maxConcurrentReservations: 2,
    }))).rejects.toMatchObject({
      status: 409,
      message: "This user already has 2 active reservations (limit: 2).",
    });

    expect(mockTx.booking.count).toHaveBeenCalledWith({
      where: {
        requesterUserId: "user-1",
        kind: BookingKind.RESERVATION,
        status: "BOOKED",
      },
    });
    expect(mockTx.booking.create).not.toHaveBeenCalled();
  });

  it("BUG: creates a reservation when the transactional count is just below the cap", async () => {
    mockTx.booking.count.mockResolvedValueOnce(1);

    await createBooking(baseInput({
      kind: BookingKind.RESERVATION,
      custodySource: undefined,
      maxConcurrentReservations: 2,
    }));

    expect(mockTx.booking.count).toHaveBeenCalledOnce();
    expect(mockTx.booking.create).toHaveBeenCalledOnce();
  });

  it.each([
    ["zero", 0],
    ["fraction", 1.5],
    ["NaN", Number.NaN],
    ["infinity", Number.POSITIVE_INFINITY],
    ["above maximum", 51],
  ])("BUG: rejects a malformed reservation cap: %s", async (_label, maxConcurrentReservations) => {
    await expect(createBooking(baseInput({
      kind: BookingKind.RESERVATION,
      custodySource: undefined,
      maxConcurrentReservations,
    }))).rejects.toMatchObject({
      status: 400,
      message: "maxConcurrentReservations must be a whole number between 1 and 50",
    });

    expect(transactionCalls).toHaveLength(0);
    expect(mockTx.booking.count).not.toHaveBeenCalled();
  });

  it("normalizes the stored title while preserving sport codes", async () => {
    await createBooking(baseInput({ title: "mbb PRACTICE" }));

    expect(mockTx.booking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: "MBB Practice" }),
      }),
    );
    expect(mockTx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          afterJson: expect.objectContaining({ title: "MBB Practice" }),
        }),
      }),
    );
  });

  it("generates ref number with CO- prefix for checkout", async () => {
    await createBooking(baseInput({ kind: "CHECKOUT" }));
    expect(mockTx.booking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ refNumber: "CO-0001" }),
      })
    );
  });

  it("generates ref number with RV- prefix for reservation", async () => {
    await createBooking(baseInput({ kind: "RESERVATION" }));
    expect(mockTx.booking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ refNumber: "RV-0001" }),
      })
    );
  });

  it("throws 409 on availability conflicts", async () => {
    vi.mocked(checkAvailability).mockResolvedValueOnce({
      conflicts: [{ assetId: "a-1", conflictingBookingId: "b-other", startsAt: new Date(), endsAt: new Date() }],
      shortages: [],
      unavailableAssets: [],
      upcomingCommitments: [],
      turnaroundRisks: [],
      bulkTurnaroundRisks: [],
    });

    await expect(createBooking(baseInput({ serializedAssetIds: ["a-1"] }))).rejects.toThrow("Availability conflict");
  });

  it("throws 409 on bulk shortages", async () => {
    vi.mocked(checkAvailability).mockResolvedValueOnce({
      conflicts: [],
      shortages: [{ bulkSkuId: "sku-1", requested: 10, available: 2 }],
      unavailableAssets: [],
      upcomingCommitments: [],
      turnaroundRisks: [],
      bulkTurnaroundRisks: [],
    });

    await expect(createBooking(baseInput({
      serializedAssetIds: [],
      bulkItems: [{ bulkSkuId: "sku-1", quantity: 10 }],
    }))).rejects.toThrow("Availability conflict");
  });

  it("creates serialized items and allocations", async () => {
    await createBooking(baseInput({ serializedAssetIds: ["a-1", "a-2"] }));

    expect(mockTx.bookingSerializedItem.createMany).toHaveBeenCalled();
    expect(mockTx.assetAllocation.createMany).toHaveBeenCalled();
  });

  it("creates bulk items and stock movements for CHECKOUT", async () => {
    // Need sufficient stock for upsertBulkBalancesAndMovements
    mockTx.bulkStockBalance.findMany.mockResolvedValue([
      { bulkSkuId: "sku-1", onHandQuantity: 100 },
    ]);

    await createBooking(baseInput({
      serializedAssetIds: [],
      bulkItems: [{ bulkSkuId: "sku-1", quantity: 5 }],
    }));

    expect(mockTx.bookingBulkItem.createMany).toHaveBeenCalled();
    expect(mockTx.bulkStockMovement.createMany).toHaveBeenCalled();
  });

  it("allows a direct checkout at the 10-SKU execution boundary", async () => {
    const bulkItems = bulkRequests(MAX_CHECKOUT_DISTINCT_BULK_SKUS_PER_REQUEST);
    mockTx.bulkStockBalance.findMany.mockResolvedValue(
      bulkItems.map((item) => ({ bulkSkuId: item.bulkSkuId, onHandQuantity: 10 })),
    );

    await createBooking(baseInput({ serializedAssetIds: [], bulkItems }));

    expect(mockTx.bulkStockBalance.upsert).toHaveBeenCalledTimes(
      MAX_CHECKOUT_DISTINCT_BULK_SKUS_PER_REQUEST,
    );
  });

  it("rejects a direct checkout above 10 distinct bulk SKUs before transaction work", async () => {
    await expect(createBooking(baseInput({
      serializedAssetIds: [],
      bulkItems: bulkRequests(MAX_CHECKOUT_DISTINCT_BULK_SKUS_PER_REQUEST + 1),
    }))).rejects.toMatchObject({
      status: 400,
      message: `A checkout may include at most ${MAX_CHECKOUT_DISTINCT_BULK_SKUS_PER_REQUEST} distinct bulk item types`,
    });

    expect(transactionCalls).toHaveLength(0);
    expect(checkAvailability).not.toHaveBeenCalled();
    expect(mockTx.booking.create).not.toHaveBeenCalled();
  });

  it("creates bulk items but NO stock movements for RESERVATION", async () => {
    await createBooking(baseInput({
      kind: "RESERVATION",
      serializedAssetIds: [],
      bulkItems: [{ bulkSkuId: "sku-1", quantity: 5 }],
    }));

    expect(mockTx.bookingBulkItem.createMany).toHaveBeenCalled();
    expect(mockTx.bulkStockMovement.createMany).not.toHaveBeenCalled();
  });

  it("keeps the 50-line boundary available for reservation-only planning", async () => {
    const bulkItems = bulkRequests(MAX_BULK_SKU_LINES_PER_REQUEST);

    await createBooking(baseInput({
      kind: BookingKind.RESERVATION,
      custodySource: undefined,
      serializedAssetIds: [],
      bulkItems,
    }));

    expect(mockTx.bookingBulkItem.createMany).toHaveBeenCalledWith({
      data: bulkItems.map((item) => ({
        bookingId: "b-new",
        bulkSkuId: item.bulkSkuId,
        plannedQuantity: item.quantity,
      })),
    });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(mockTx.bulkStockBalance.upsert).not.toHaveBeenCalled();
    expect(scheduleCheckoutReturnLiveActivity).not.toHaveBeenCalled();
  });

  it("allows a numbered reservation at the native pickup checklist ceiling", async () => {
    mockTx.bulkSku.findMany.mockResolvedValue([{ id: "sku-numbered" }]);

    await createBooking(baseInput({
      kind: BookingKind.RESERVATION,
      custodySource: undefined,
      serializedAssetIds: [],
      bulkItems: [{
        bulkSkuId: "sku-numbered",
        quantity: MAX_EQUIPMENT_SELECTIONS_PER_REQUEST,
      }],
    }));

    expect(mockTx.bulkSku.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["sku-numbered"] },
        trackByNumber: true,
      },
      select: { id: true },
    });
    expect(mockTx.bookingBulkItem.createMany).toHaveBeenCalledOnce();
  });

  it("rejects a numbered reservation above the native pickup checklist ceiling before availability or writes", async () => {
    mockTx.bulkSku.findMany.mockResolvedValue([
      { id: "sku-numbered-1" },
      { id: "sku-numbered-2" },
    ]);

    await expect(createBooking(baseInput({
      kind: BookingKind.RESERVATION,
      custodySource: undefined,
      serializedAssetIds: [],
      bulkItems: [
        { bulkSkuId: "sku-numbered-1", quantity: 250 },
        { bulkSkuId: "sku-numbered-2", quantity: 251 },
      ],
    }))).rejects.toMatchObject({
      status: 400,
      message: `Numbered pickup plans support at most ${MAX_EQUIPMENT_SELECTIONS_PER_REQUEST} units total`,
    });

    expect(checkAvailability).not.toHaveBeenCalled();
    expect(mockTx.booking.create).not.toHaveBeenCalled();
    expect(mockTx.auditLog.create).not.toHaveBeenCalled();
  });

  it("allows large quantity-tracked reservation quantities without expanding them into pickup units", async () => {
    await createBooking(baseInput({
      kind: BookingKind.RESERVATION,
      custodySource: undefined,
      serializedAssetIds: [],
      bulkItems: [{ bulkSkuId: "sku-quantity", quantity: 1_000_000 }],
    }));

    expect(mockTx.bulkSku.findMany).toHaveBeenCalledOnce();
    expect(mockTx.bookingBulkItem.createMany).toHaveBeenCalledWith({
      data: [{
        bookingId: "b-new",
        bulkSkuId: "sku-quantity",
        plannedQuantity: 1_000_000,
      }],
    });
  });

  it("creates audit log", async () => {
    await createBooking(baseInput());
    expect(mockTx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "created",
          entityType: "booking",
        }),
      })
    );
  });

  it("records admin force-checkout evidence inside the custody transaction", async () => {
    mockTx.booking.findUnique.mockResolvedValue({
      id: "rv-1",
      kind: BookingKind.RESERVATION,
      status: BookingStatus.BOOKED,
      locationId: "loc-1",
      serializedItems: [{ assetId: "a-1", allocationStatus: "active" }],
      bulkItems: [],
    });

    await createBooking(baseInput({
      custodySource: "ADMIN_OVERRIDE",
      adminOverrideReason: "Kiosk unavailable; admin verified the handoff.",
      sourceReservationId: "rv-1",
      sourceReservationPickup: true,
      serializedAssetIds: ["a-1"],
    }));

    expect(mockTx.overrideEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        bookingId: "b-new",
        actorUserId: "user-1",
        reason: "Kiosk unavailable; admin verified the handoff.",
        details: expect.objectContaining({ type: "admin_force_checkout" }),
      }),
    }));
    expect(mockTx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        entityId: "b-new",
        action: "admin_force_checkout",
      }),
    }));
  });

  it("force-checks out only the reservation items that remain after a partial pickup", async () => {
    const startsAt = new Date(Date.now() - 60_000);
    const endsAt = new Date(Date.now() + 60 * 60_000);
    const source = {
      id: "rv-1",
      kind: BookingKind.RESERVATION,
      status: BookingStatus.BOOKED,
      title: "Reservation pickup",
      requesterUserId: "user-1",
      locationId: "loc-1",
      startsAt,
      endsAt,
      notes: "Handle with care",
      eventId: null,
      sportCode: null,
      shiftAssignmentId: null,
      kitId: null,
      serializedItems: [
        { assetId: "a-picked", allocationStatus: "picked_up" },
        { assetId: "a-remaining", allocationStatus: "active" },
      ],
      bulkItems: [],
      scanEvents: [],
      events: [],
    };
    mockDb.booking.findUnique.mockResolvedValue(source);
    mockTx.booking.findUnique.mockResolvedValue(source);

    const result = await forceCheckoutReservation({
      reservationId: "rv-1",
      actorUserId: "user-1",
      reason: "Kiosk unavailable; admin verified the handoff.",
    });

    expect(result).toEqual({ id: "b-new", refNumber: "CO-0001" });
    expect(mockTx.booking.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        kind: BookingKind.CHECKOUT,
        status: BookingStatus.OPEN,
        sourceReservationId: "rv-1",
      }),
    }));
    expect(mockTx.bookingSerializedItem.createMany).toHaveBeenCalledWith({
      data: [{
        bookingId: "b-new",
        assetId: "a-remaining",
        allocationStatus: "active",
      }],
    });
    expect(mockTx.booking.update).toHaveBeenCalledWith({
      where: { id: "rv-1" },
      data: { status: BookingStatus.COMPLETED, completedAt: expect.any(Date) },
    });
  });

  it("rejects empty non-draft bookings at the shared service boundary", async () => {
    await expect(createBooking(baseInput({
      serializedAssetIds: [],
      bulkItems: [],
    }))).rejects.toThrow("Add at least one piece of equipment");

    expect(checkAvailability).not.toHaveBeenCalled();
    expect(mockTx.booking.create).not.toHaveBeenCalled();
  });

  it("rejects invalid booking windows before opening a transaction", async () => {
    await expect(createBooking(baseInput({
      startsAt: new Date("2026-04-01T17:00:00Z"),
      endsAt: new Date("2026-04-01T08:00:00Z"),
    }))).rejects.toThrow("endsAt must be later than startsAt");

    expect(transactionCalls).toHaveLength(0);
  });

  it("rejects duplicate eventIds instead of silently deduping", async () => {
    await expect(createBooking(baseInput({
      eventIds: ["event-1", "event-1"],
    }))).rejects.toThrow("eventIds must be unique");

    expect(mockTx.calendarEvent.findMany).not.toHaveBeenCalled();
    expect(mockTx.booking.create).not.toHaveBeenCalled();
  });

  it("sorts event links chronologically and writes junction rows", async () => {
    mockTx.calendarEvent.findMany.mockResolvedValue([
      { id: "event-late", startsAt: new Date("2026-04-03T20:00:00Z") },
      { id: "event-early", startsAt: new Date("2026-04-01T20:00:00Z") },
    ]);

    await createBooking(baseInput({ eventIds: ["event-late", "event-early"] }));

    expect(mockTx.booking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventId: "event-early" }),
      }),
    );
    expect(mockTx.bookingEvent.createMany).toHaveBeenCalledWith({
      data: [
        { bookingId: "b-new", eventId: "event-early", ordinal: 0 },
        { bookingId: "b-new", eventId: "event-late", ordinal: 1 },
      ],
    });
  });

  it("allows five linked events and rejects a sixth at the service boundary", async () => {
    const eventIds = Array.from(
      { length: MAX_LINKED_EVENTS_PER_BOOKING },
      (_, index) => `event-${index + 1}`,
    );
    mockTx.calendarEvent.findMany.mockResolvedValue(
      [...eventIds].reverse().map((id) => ({
        id,
        startsAt: new Date(Date.UTC(2026, 3, 1 + eventIds.indexOf(id), 20)),
      })),
    );

    await createBooking(baseInput({ eventIds }));

    expect(mockTx.booking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventId: eventIds[0] }),
      }),
    );
    expect(mockTx.bookingEvent.createMany).toHaveBeenCalledWith({
      data: eventIds.map((eventId, ordinal) => ({
        bookingId: "b-new",
        eventId,
        ordinal,
      })),
    });

    await expect(createBooking(baseInput({
      eventIds: [...eventIds, "event-6"],
    }))).rejects.toThrow(`A booking may link at most ${MAX_LINKED_EVENTS_PER_BOOKING} events`);
  });

  it("adds an internal event reservation requester to the schedule and links the booking", async () => {
    mockTx.user.findUnique.mockResolvedValue({
      active: true,
      role: Role.STUDENT,
      staffingType: "ST",
      primaryArea: "VIDEO",
      areaAssignments: [],
      availabilityBlocks: [],
      collaboratorProfile: null,
      collaboratorPolicy: null,
    });
    mockTx.calendarEvent.findMany.mockResolvedValue([
      { id: "event-1", startsAt: new Date("2026-04-01T18:00:00Z") },
    ]);
    mockTx.shiftGroup.findUnique.mockResolvedValue({
      id: "group-1",
      publishedAt: null,
      workingCopy: null,
      event: {
        startsAt: new Date("2026-04-01T18:00:00Z"),
        endsAt: new Date("2026-04-01T22:00:00Z"),
        allDay: false,
      },
      shifts: [{
        id: "shift-1",
        area: "VIDEO",
        workerType: "ST",
        startsAt: new Date("2026-04-01T17:00:00Z"),
        endsAt: new Date("2026-04-01T23:00:00Z"),
        callStartsAt: null,
        callEndsAt: null,
        assignments: [],
      }],
    });

    await createBooking(baseInput({
      kind: BookingKind.RESERVATION,
      custodySource: undefined,
      eventId: "event-1",
    }));

    expect(mockTx.booking.update).toHaveBeenCalledWith({
      where: { id: "b-new" },
      data: { shiftAssignmentId: "assignment-new" },
    });
    expect(mockTx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        entityType: "shift_assignment",
        entityId: "assignment-new",
        action: "shift_assigned",
        afterJson: expect.objectContaining({
          source: "event_gear_reservation",
          bookingId: "b-new",
          eventId: "event-1",
        }),
      }),
    }));
  });

  it("validates an explicit schedule link before creating the booking", async () => {
    mockTx.user.findUnique.mockResolvedValue({
      active: true,
      role: Role.STUDENT,
      staffingType: "ST",
      primaryArea: "VIDEO",
      areaAssignments: [],
      availabilityBlocks: [],
      collaboratorProfile: null,
      collaboratorPolicy: null,
    });
    mockTx.calendarEvent.findMany.mockResolvedValue([
      { id: "event-1", startsAt: new Date("2026-04-01T18:00:00Z") },
    ]);
    mockTx.shiftAssignment.findUnique.mockResolvedValue({
      id: "assignment-explicit",
      userId: "user-1",
      status: "DIRECT_ASSIGNED",
      source: "MANUAL",
      shift: {
        id: "shift-1",
        area: "VIDEO",
        workerType: "ST",
        shiftGroup: {
          id: "group-1",
          eventId: "event-1",
          publishedAt: null,
          workingCopy: null,
        },
      },
    });

    await createBooking(baseInput({
      kind: BookingKind.RESERVATION,
      custodySource: undefined,
      eventId: "event-1",
      shiftAssignmentId: "assignment-explicit",
    }));

    expect(mockTx.booking.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ shiftAssignmentId: "assignment-explicit" }),
    }));
    expect(mockTx.shiftAssignment.create).not.toHaveBeenCalled();
  });

  it("limits collaborator event links to published visible schedule events", async () => {
    mockTx.user.findUnique.mockResolvedValue({
      active: true,
      role: Role.COLLABORATOR,
      collaboratorProfile: CollaboratorProfile.BTN_STANDARD,
      collaboratorPolicy: {
        status: "ACTIVE",
        grants: [{ capabilityKey: "PUBLISHED_SCHEDULE_VIEW" }],
      },
    });
    mockTx.calendarEvent.findMany.mockResolvedValue([
      { id: "event-published", startsAt: new Date("2026-04-01T20:00:00Z") },
    ]);

    await createBooking(baseInput({
      kind: BookingKind.RESERVATION,
      custodySource: undefined,
      eventIds: ["event-published"],
    }));

    expect(mockTx.calendarEvent.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["event-published"] },
        isHidden: false,
        archivedAt: null,
        shiftGroup: {
          is: {
            publishedAt: { not: null },
            archivedAt: null,
            lastPublishedSnapshot: { not: Prisma.JsonNull },
          },
        },
      },
      select: { id: true, startsAt: true },
    });
  });

  it("does not reveal whether an inaccessible collaborator event ID exists", async () => {
    mockTx.user.findUnique.mockResolvedValue({
      active: true,
      role: Role.COLLABORATOR,
      collaboratorProfile: CollaboratorProfile.BTN_STANDARD,
      collaboratorPolicy: {
        status: "ACTIVE",
        grants: [{ capabilityKey: "PUBLISHED_SCHEDULE_VIEW" }],
      },
    });

    await expect(createBooking(baseInput({
      kind: BookingKind.RESERVATION,
      custodySource: undefined,
      eventIds: ["event-hidden-or-missing"],
    }))).rejects.toMatchObject({
      status: 400,
      message: "One or more eventIds do not exist",
    });
  });

  it("maps DB overlap constraint races to availability conflicts", async () => {
    mockTx.assetAllocation.createMany.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Exclusion constraint failed on asset_allocations_no_overlap", {
        code: "P2004",
        clientVersion: "test",
        meta: { constraint: "asset_allocations_no_overlap" },
      }),
    );

    await expect(createBooking(baseInput({ serializedAssetIds: ["a-race"] }))).rejects.toMatchObject({
      status: 409,
      message: "One or more items are no longer available",
    });
  });

  it("BUG: retries a serialization conflict once and then observes the reservation cap", async () => {
    vi.mocked(db.$transaction).mockRejectedValueOnce(serializableConflict());
    mockTx.booking.count.mockResolvedValueOnce(2);

    await expect(createBooking(baseInput({
      kind: BookingKind.RESERVATION,
      custodySource: undefined,
      maxConcurrentReservations: 2,
    }))).rejects.toMatchObject({
      status: 409,
      message: "This user already has 2 active reservations (limit: 2).",
    });

    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(mockTx.booking.count).toHaveBeenCalledOnce();
    expect(mockTx.booking.create).not.toHaveBeenCalled();
    expect(mockTx.auditLog.create).not.toHaveBeenCalled();
  });

  it("BUG: maps a persistent serialization conflict to a friendly 409 after one retry", async () => {
    vi.mocked(db.$transaction)
      .mockRejectedValueOnce(serializableConflict())
      .mockRejectedValueOnce(serializableConflict());

    await expect(createBooking(baseInput())).rejects.toMatchObject({
      status: 409,
      message: "Someone else submitted at the same time; please try again.",
    });

    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(scheduleCheckoutReturnLiveActivity).not.toHaveBeenCalled();
  });

  it("BUG: runs post-commit checkout effects once after a successful serialization retry", async () => {
    vi.mocked(db.$transaction).mockRejectedValueOnce(serializableConflict());
    mockTx.booking.findUnique.mockResolvedValue({
      id: "rv-1",
      kind: BookingKind.RESERVATION,
      status: "BOOKED",
      locationId: "loc-1",
      serializedItems: [],
      bulkItems: [],
    });
    const endsAt = new Date("2026-04-01T17:00:00Z");
    mockTx.booking.findUniqueOrThrow.mockResolvedValue({
      id: "b-new",
      kind: BookingKind.CHECKOUT,
      status: "OPEN",
      endsAt,
    });

    await createBooking(baseInput({ sourceReservationId: "rv-1" }));

    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(scheduleCheckoutReturnLiveActivity).toHaveBeenCalledTimes(1);
    expect(scheduleCheckoutReturnLiveActivity).toHaveBeenCalledWith({ bookingId: "b-new", endsAt });
  });

  // Source reservation tests
  it("resolves items from source reservation", async () => {
    const sourceRes = {
      id: "rv-1",
      kind: "RESERVATION",
      status: "BOOKED",
      locationId: "loc-1",
      serializedItems: [{ assetId: "a-1" }],
      bulkItems: [{ bulkSkuId: "sku-1", plannedQuantity: 5 }],
    };
    mockTx.booking.findUnique.mockResolvedValue(sourceRes);
    mockTx.scanSession.updateMany.mockResolvedValue({});
    mockTx.assetAllocation.updateMany.mockResolvedValue({});
    // Need sufficient stock for checkout bulk movements
    mockTx.bulkStockBalance.findMany.mockResolvedValue([
      { bulkSkuId: "sku-1", onHandQuantity: 100 },
    ]);

    await createBooking(baseInput({ sourceReservationId: "rv-1", serializedAssetIds: [], bulkItems: [] }));

    // Should complete the source reservation as fulfilled
    expect(mockTx.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rv-1" },
        data: { status: "COMPLETED", completedAt: expect.any(Date) },
      })
    );
  });

  it("keeps a source reservation BOOKED when a partial pickup takes only selected items", async () => {
    const sourceRes = {
      id: "rv-1",
      kind: "RESERVATION",
      status: "BOOKED",
      locationId: "loc-1",
      serializedItems: [
        { assetId: "a-1", allocationStatus: "active" },
        { assetId: "a-2", allocationStatus: "active" },
      ],
      bulkItems: [{ bulkSkuId: "sku-1", plannedQuantity: 3, checkedOutQuantity: 0 }],
    };
    mockTx.booking.findUnique.mockResolvedValue(sourceRes);

    await createBooking(baseInput({
      sourceReservationId: "rv-1",
      sourceReservationPickup: true,
      serializedAssetIds: ["a-1"],
      bulkItems: [],
    }));

    expect(mockTx.bookingSerializedItem.updateMany).toHaveBeenCalledWith({
      where: {
        bookingId: "rv-1",
        assetId: { in: ["a-1"] },
        allocationStatus: "active",
      },
      data: { allocationStatus: "picked_up" },
    });
    expect(mockTx.assetAllocation.updateMany).toHaveBeenCalledWith({
      where: {
        bookingId: "rv-1",
        assetId: { in: ["a-1"] },
        active: true,
      },
      data: { active: false },
    });
    expect(mockTx.booking.update).toHaveBeenCalledWith({
      where: { id: "rv-1" },
      data: { status: "BOOKED" },
    });
    expect(mockTx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        entityId: "rv-1",
        action: "partially_fulfilled_by_kiosk_pickup",
      }),
    }));
  });

  it("rejects reservation pickup above 10 distinct bulk SKUs before availability or writes", async () => {
    mockTx.booking.findUnique.mockResolvedValue({
      id: "rv-1",
      kind: BookingKind.RESERVATION,
      status: "BOOKED",
      locationId: "loc-1",
      serializedItems: [],
      bulkItems: bulkRequests(MAX_CHECKOUT_DISTINCT_BULK_SKUS_PER_REQUEST + 1).map((item) => ({
        bulkSkuId: item.bulkSkuId,
        plannedQuantity: item.quantity,
      })),
    });

    await expect(createBooking(baseInput({
      sourceReservationId: "rv-1",
      serializedAssetIds: [],
      bulkItems: [],
    }))).rejects.toMatchObject({
      status: 400,
      message: `A reservation pickup may include at most ${MAX_CHECKOUT_DISTINCT_BULK_SKUS_PER_REQUEST} distinct bulk item types`,
    });

    expect(checkAvailability).not.toHaveBeenCalled();
    expect(mockTx.booking.create).not.toHaveBeenCalled();
    expect(mockTx.booking.update).not.toHaveBeenCalled();
  });

  it("throws 400 when the requester does not exist", async () => {
    mockTx.user.findUnique.mockResolvedValueOnce(null);
    await expect(createBooking(baseInput())).rejects.toThrow("Requester not found");
    expect(mockTx.booking.create).not.toHaveBeenCalled();
  });

  it("throws 400 when the requester is inactive", async () => {
    mockTx.user.findUnique.mockResolvedValueOnce({ active: false });
    await expect(createBooking(baseInput())).rejects.toThrow("inactive user");
    expect(mockTx.booking.create).not.toHaveBeenCalled();
  });

  it("throws 404 when source reservation not found", async () => {
    mockTx.booking.findUnique.mockResolvedValue(null);
    await expect(createBooking(baseInput({ sourceReservationId: "rv-bad" }))).rejects.toThrow("Source reservation not found");
  });

  it("throws 400 when source is not a RESERVATION", async () => {
    mockTx.booking.findUnique.mockResolvedValue({
      id: "rv-1", kind: "CHECKOUT", status: "OPEN", locationId: "loc-1",
      serializedItems: [], bulkItems: [],
    });
    await expect(createBooking(baseInput({ sourceReservationId: "rv-1" }))).rejects.toThrow("does not refer to a reservation");
  });

  it("throws 400 when source reservation is not BOOKED", async () => {
    mockTx.booking.findUnique.mockResolvedValue({
      id: "rv-1", kind: "RESERVATION", status: "CANCELLED", locationId: "loc-1",
      serializedItems: [], bulkItems: [],
    });
    await expect(createBooking(baseInput({ sourceReservationId: "rv-1" }))).rejects.toThrow("not in BOOKED status");
  });

  it("throws 400 when source reservation has different location", async () => {
    mockTx.booking.findUnique.mockResolvedValue({
      id: "rv-1", kind: "RESERVATION", status: "BOOKED", locationId: "loc-other",
      serializedItems: [], bulkItems: [],
    });
    await expect(createBooking(baseInput({ sourceReservationId: "rv-1" }))).rejects.toThrow("different location");
  });
});
