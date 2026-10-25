import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingKind, BookingStatus, Role } from "@prisma/client";

const mocks = vi.hoisted(() => {
  const tx = {
    booking: { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn() },
    assetAllocation: { updateMany: vi.fn(), createMany: vi.fn() },
    bookingSerializedItem: { createMany: vi.fn() },
    bookingBulkItem: { upsert: vi.fn() },
  };
  return {
    tx,
    db: {
      booking: { findMany: vi.fn() },
      $transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)),
    },
    availability: vi.fn(),
    audit: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/services/availability", () => ({ checkAvailability: mocks.availability }));
vi.mock("@/lib/audit", () => ({ createAuditEntryTx: mocks.audit }));
vi.mock("@/lib/serialization", () => ({ withSerializationRetry: (run: () => unknown) => run() }));

import { mergeReservations, previewReservationMerge } from "@/lib/services/reservation-consolidation";

const first = "res-first";
const second = "res-second";
const third = "res-third";
const startsAt = new Date("2026-10-31T15:00:00.000Z");
const endsAt = new Date("2026-10-31T23:00:00.000Z");

function reservation(id: string, minute: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    kind: BookingKind.RESERVATION,
    status: BookingStatus.BOOKED,
    title: "Football vs Iowa",
    requesterUserId: "ada",
    custodyScope: "PERSON",
    locationId: "cage",
    startsAt,
    endsAt,
    createdAt: new Date(`2026-10-20T15:${String(minute).padStart(2, "0")}:00.000Z`),
    notes: null,
    eventId: "game",
    events: [{ eventId: "game" }],
    serializedItems: [],
    bulkItems: [],
    ...overrides,
  };
}

const merging = [
  reservation(second, 10, {
    notes: "Bring the gimbal",
    serializedItems: [{ assetId: "roam2", allocationStatus: "active" }, { assetId: "slow1", allocationStatus: "active" }],
    bulkItems: [{ bulkSkuId: "batteries", plannedQuantity: 2, checkedOutQuantity: 0 }],
  }),
  reservation(first, 5, {
    notes: " Bring the gimbal ",
    serializedItems: [{ assetId: "roam2", allocationStatus: "active" }],
    bulkItems: [{ bulkSkuId: "batteries", plannedQuantity: 3, checkedOutQuantity: 0 }],
  }),
  reservation(third, 20, {
    notes: "Extra cards",
    bulkItems: [{ bulkSkuId: "cards", plannedQuantity: 4, checkedOutQuantity: 0 }],
  }),
];

function merge(role: Role = Role.STAFF, ids = [first, second, third]) {
  return mergeReservations({ ids, actorUserId: "staff-1", actorRole: role });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.db.booking.findMany.mockResolvedValue(merging);
  mocks.tx.booking.findMany.mockResolvedValue(merging);
  mocks.tx.booking.findUniqueOrThrow.mockResolvedValue({ id: first });
  mocks.availability.mockResolvedValue({ conflicts: [], shortages: [], unavailableAssets: [] });
});

describe("mergeReservations", () => {
  it("cancels the later reservations and moves their gear onto the earliest one", async () => {
    await expect(merge()).resolves.toEqual({ id: first });

    expect(mocks.tx.booking.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [second, third] }, status: BookingStatus.BOOKED },
      data: { status: BookingStatus.CANCELLED },
    });
    expect(mocks.tx.assetAllocation.updateMany).toHaveBeenCalledWith({ where: { bookingId: { in: [second, third] }, active: true }, data: { active: false } });
    expect(mocks.availability).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({
      locationId: "cage",
      serializedAssetIds: ["roam2", "slow1"],
      bulkItems: [{ bulkSkuId: "batteries", quantity: 5 }, { bulkSkuId: "cards", quantity: 4 }],
      excludeBookingId: first,
      bookingKind: BookingKind.RESERVATION,
    }));
  });

  it("adds only the items the earliest reservation did not already hold", async () => {
    await merge();

    expect(mocks.tx.bookingSerializedItem.createMany).toHaveBeenCalledWith({
      data: [{ bookingId: first, assetId: "slow1", allocationStatus: "active" }],
      skipDuplicates: true,
    });
    expect(mocks.tx.assetAllocation.createMany).toHaveBeenCalledWith({
      data: [{ bookingId: first, assetId: "slow1", startsAt, endsAt, active: true, kind: "RESERVATION" }],
    });
  });

  it("totals bulk quantities and combines distinct notes", async () => {
    await merge();

    expect(mocks.tx.bookingBulkItem.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { bookingId_bulkSkuId: { bookingId: first, bulkSkuId: "batteries" } },
      update: { plannedQuantity: 5 },
    }));
    expect(mocks.tx.bookingBulkItem.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { bookingId: first, bulkSkuId: "cards", plannedQuantity: 4 },
    }));
    expect(mocks.tx.booking.update).toHaveBeenCalledWith({ where: { id: first }, data: { notes: "Bring the gimbal\n\nExtra cards" } });
  });

  it("audits the merge on the kept reservation and on each cancelled one", async () => {
    await merge();

    expect(mocks.audit.mock.calls.map(([, entry]) => [entry.entityId, entry.action])).toEqual([
      [first, "reservations_merged"],
      [second, "merged_into_reservation"],
      [third, "merged_into_reservation"],
    ]);
    expect(mocks.audit.mock.calls[1]?.[1].after).toEqual({ status: BookingStatus.CANCELLED, targetReservationId: first });
  });

  it("skips adding items when the earliest reservation already has them all", async () => {
    mocks.tx.booking.findMany.mockResolvedValue([merging[1], merging[2]]);

    await merge(Role.ADMIN, [first, third]);

    expect(mocks.tx.bookingSerializedItem.createMany).not.toHaveBeenCalled();
    expect(mocks.tx.assetAllocation.createMany).not.toHaveBeenCalled();
  });

  it.each([
    ["a conflict", { conflicts: [{ assetId: "slow1" }], shortages: [], unavailableAssets: [] }],
    ["a shortage", { conflicts: [], shortages: [{ bulkSkuId: "cards" }], unavailableAssets: [] }],
    ["an unavailable item", { conflicts: [], shortages: [], unavailableAssets: ["slow1"] }],
  ])("stops before adding gear when the combined plan has %s", async (_label, availability) => {
    mocks.availability.mockResolvedValue(availability);

    await expect(merge()).rejects.toMatchObject({ status: 409, message: "The combined reservation is no longer available" });
    expect(mocks.tx.bookingSerializedItem.createMany).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it.each([[[first]], [Array.from({ length: 26 }, (_, index) => `res-${index}`)]])("needs 2 to 25 reservations", async (ids) => {
    await expect(merge(Role.STAFF, ids)).rejects.toMatchObject({ status: 400 });
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });
});

describe("previewReservationMerge", () => {
  const two = (overrides: Record<string, unknown>) => [reservation(first, 5), reservation(second, 10, overrides)];

  it.each([
    ["a checkout", { kind: BookingKind.CHECKOUT }, "Only active booked reservations can be merged"],
    ["a cancelled reservation", { status: BookingStatus.CANCELLED }, "Only active booked reservations can be merged"],
    ["another person", { requesterUserId: "grace" }, "Reservations for different people cannot be merged"],
    ["shared custody", { custodyScope: "SHARED" }, "Personal and shared travel-case reservations cannot be merged"],
    ["another pickup location", { locationId: "studio" }, "Reservations at different pickup locations cannot be merged"],
    ["another return time", { endsAt: new Date("2026-11-01T01:00:00.000Z") }, "Reservation pickup and return windows must match before merging"],
    ["other events", { events: [{ eventId: "game" }, { eventId: "practice" }] }, "Reservations must link the same exact events before merging"],
    ["started bulk pickup", { bulkItems: [{ bulkSkuId: "cards", plannedQuantity: 2, checkedOutQuantity: 1 }] }, "A reservation with a started pickup cannot be merged"],
  ])("refuses %s", async (_label, overrides, message) => {
    mocks.db.booking.findMany.mockResolvedValue(two(overrides));

    await expect(previewReservationMerge([first, second])).rejects.toMatchObject({ status: 409, message });
  });

  it("matches titles regardless of case and spacing", async () => {
    mocks.db.booking.findMany.mockResolvedValue(two({ title: "  football VS iowa " }));

    await expect(previewReservationMerge([first, second])).resolves.toEqual(expect.objectContaining({ targetReservationId: first }));
  });

  it("refuses reservations that are not linked to an event", async () => {
    mocks.db.booking.findMany.mockResolvedValue([
      reservation(first, 5, { events: [], eventId: null }),
      reservation(second, 10, { events: [], eventId: null }),
    ]);

    await expect(previewReservationMerge([first, second])).rejects.toMatchObject({ message: "Only event-linked reservations can be merged" });
  });

  it("breaks a creation-time tie by id and reports a missing reservation", async () => {
    mocks.db.booking.findMany.mockResolvedValue([reservation("res-b", 5), reservation("res-a", 5)]);
    await expect(previewReservationMerge(["res-a", "res-b"])).resolves.toEqual(expect.objectContaining({ targetReservationId: "res-a" }));

    mocks.db.booking.findMany.mockResolvedValue([reservation(first, 5)]);
    await expect(previewReservationMerge([first, second])).rejects.toMatchObject({ status: 404 });
  });
});
