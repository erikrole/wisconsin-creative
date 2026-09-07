import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingCustodyScope, BookingKind, BookingStatus, Role } from "@prisma/client";

const { tx, transactionCalls } = vi.hoisted(() => ({
  tx: {
    booking: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    bookingSerializedItem: { findUnique: vi.fn(), update: vi.fn(), count: vi.fn() },
    assetAllocation: { findMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    bookingBulkItem: { findMany: vi.fn() },
    scanSession: { findFirst: vi.fn() },
    user: { findUnique: vi.fn() },
    auditLog: { findFirst: vi.fn(), create: vi.fn() },
    $queryRaw: vi.fn(),
  },
  transactionCalls: [] as Array<{ options: unknown }>,
}));
vi.mock("@/lib/db", () => ({ db: {
  $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>, options: unknown) => {
    transactionCalls.push({ options });
    return fn(tx);
  }),
} }));
import { updateBookingItemHolder } from "@/lib/services/booking-item-holder";

const updatedAt = new Date("2026-09-07T15:00:00.500Z");
const startsAt = new Date("2026-09-01T15:00:00Z");
const endsAt = new Date("2026-09-08T15:00:00Z");
const source = {
  id: "source", kind: BookingKind.CHECKOUT, status: BookingStatus.OPEN,
  custodyScope: BookingCustodyScope.PERSON, requesterUserId: "original-owner",
  title: "Football", locationId: "counter", sourceReservationId: "reservation",
  createdBy: "original-operator", pickupKioskDeviceId: "original-kiosk",
  eventId: "event", events: [{ eventId: "event", ordinal: 0 }], sportCode: "FB",
  refNumber: "CO-0010", updatedAt, startsAt, endsAt, accountabilityExclusion: null,
};
const receiving = { ...source, id: "receiving", requesterUserId: "recipient", refNumber: "CO-0011" };
const item = { asset: { assetTag: "CAM-104" }, id: "item", assetId: "asset", bookingId: source.id, allocationStatus: "active", assignedUserId: "legacy-label", assignedAt: startsAt };
const allocation = { id: "allocation", assetId: item.assetId, bookingId: source.id, startsAt, endsAt, active: true, kind: "CHECKOUT" };
const args = { bookingId: source.id, serializedItemId: item.id, actorUserId: "staff", targetUserId: "recipient", expectedUpdatedAt: updatedAt, reason: "Sideline handoff" };

beforeEach(() => {
  vi.resetAllMocks();
  transactionCalls.length = 0;
  tx.booking.findUnique.mockImplementation(({ where }) => Promise.resolve(where.id === source.id ? source : receiving));
  tx.booking.findFirst.mockResolvedValue(receiving);
  tx.booking.create.mockResolvedValue(receiving);
  tx.bookingSerializedItem.findUnique.mockResolvedValue(item);
  tx.bookingSerializedItem.count.mockResolvedValue(1);
  tx.assetAllocation.findMany.mockResolvedValue([allocation]);
  tx.assetAllocation.count.mockResolvedValue(1);
  tx.bookingBulkItem.findMany.mockResolvedValue([]);
  tx.scanSession.findFirst.mockResolvedValue(null);
  tx.user.findUnique.mockImplementation(({ where }) => Promise.resolve(where.id === "staff" ? { role: Role.STAFF } : { id: "recipient", name: "Recipient", active: true, hiddenFromRoster: false }));
  tx.$queryRaw.mockResolvedValue([{ nextval: 11n }]);
});

describe("serialized item custody transfer", () => {
  it("moves the original item and active allocation together and audits both owners", async () => {
    const result = await updateBookingItemHolder(args);
    expect(transactionCalls[0]?.options).toMatchObject({ isolationLevel: "Serializable", maxWait: 1_000, timeout: 6_000 });
    expect(tx.bookingSerializedItem.update).toHaveBeenCalledWith({ where: { id: item.id }, data: { bookingId: receiving.id, assignedUserId: null, assignedAt: null } });
    expect(tx.assetAllocation.update).toHaveBeenCalledWith({ where: { id: allocation.id }, data: { bookingId: receiving.id } });
    expect(tx.booking.create).not.toHaveBeenCalled();
    expect(tx.booking.update).toHaveBeenCalledWith({ where: { id: source.id }, data: { updatedAt: expect.any(Date) } });
    expect(tx.booking.update).toHaveBeenCalledWith({ where: { id: receiving.id }, data: { updatedAt: expect.any(Date) } });
    expect(tx.auditLog.create).toHaveBeenCalledTimes(2);
    for (const entityId of [source.id, receiving.id]) {
      expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
        entityId,
        beforeJson: expect.objectContaining({ sourceRequesterUserId: "original-owner", allocationId: allocation.id, allocationStartsAt: startsAt, allocationEndsAt: endsAt }),
        afterJson: expect.objectContaining({ originalEvidenceBookingId: source.id, sourceBookingId: source.id, targetBookingId: receiving.id, targetUserId: "recipient", reason: "Sideline handoff" }),
      }) });
    }
    expect(result).toMatchObject({ sourceBookingId: source.id, targetBookingId: receiving.id, sourceClosed: false });
  });

  it("creates personal custody from a shared checkout while keeping reservation, event and pickup provenance", async () => {
    tx.booking.findUnique.mockResolvedValue({ ...source, custodyScope: BookingCustodyScope.SHARED });
    tx.booking.findFirst.mockResolvedValue(null);
    await updateBookingItemHolder(args);
    expect(tx.booking.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      requesterUserId: "recipient", custodyScope: "PERSON", kind: "CHECKOUT", status: "OPEN",
      startsAt, endsAt, locationId: "counter", sourceReservationId: "reservation",
      createdBy: "original-operator", pickupKioskDeviceId: "original-kiosk", refNumber: "CO-0011",
      events: { create: [{ eventId: "event", ordinal: 0 }] },
    }) });
  });

  it("only reuses matching personal custody and excludes prior returned rows for the same asset", async () => {
    await updateBookingItemHolder(args);
    expect(tx.booking.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      requesterUserId: "recipient", custodyScope: "PERSON", status: "OPEN", kind: "CHECKOUT",
      title: source.title, locationId: source.locationId, endsAt, sourceReservationId: "reservation",
      eventId: "event", events: { every: { eventId: { in: ["event"] } } },
      AND: [{ events: { some: { eventId: "event" } } }],
      serializedItems: { none: { assetId: "asset" } },
      scanSessions: { none: { phase: "CHECKIN", status: "OPEN" } },
    }) }));
  });

  it("retires an emptied source without pretending the transfer was a return", async () => {
    tx.bookingSerializedItem.count.mockResolvedValue(0);
    tx.assetAllocation.count.mockResolvedValue(0);
    const result = await updateBookingItemHolder(args);
    expect(result.sourceClosed).toBe(true);
    expect(tx.booking.update).toHaveBeenCalledWith({ where: { id: source.id }, data: { updatedAt: expect.any(Date), status: "CANCELLED" } });
    expect(tx.assetAllocation.update).toHaveBeenCalledWith({ where: { id: allocation.id }, data: { bookingId: receiving.id } });
  });

  it("closes the source when actual bulk custody was returned even if the plan requested more", async () => {
    tx.bookingSerializedItem.count.mockResolvedValue(0);
    tx.assetAllocation.count.mockResolvedValue(0);
    tx.bookingBulkItem.findMany.mockResolvedValue([{ plannedQuantity: 5, checkedOutQuantity: 3, checkedInQuantity: 3, unitAllocations: [] }]);
    expect((await updateBookingItemHolder(args)).sourceClosed).toBe(true);
  });

  it.each([
    { plannedQuantity: 4, checkedOutQuantity: 4, checkedInQuantity: 0, unitAllocations: [] },
    { plannedQuantity: 0, checkedOutQuantity: 0, checkedInQuantity: 0, unitAllocations: [{ checkedOutAt: startsAt, checkedInAt: null }] },
  ])("keeps pooled or numbered bulk custody on the original checkout", async (bulk) => {
    tx.bookingSerializedItem.count.mockResolvedValue(0);
    tx.assetAllocation.count.mockResolvedValue(0);
    tx.bookingBulkItem.findMany.mockResolvedValue([bulk]);
    expect((await updateBookingItemHolder(args)).sourceClosed).toBe(false);
  });

  it.each(["returned", "picked_up", "staged"])("rejects %s line status", async (allocationStatus) => {
    tx.bookingSerializedItem.findUnique.mockResolvedValue({ ...item, allocationStatus });
    await expect(updateBookingItemHolder(args)).rejects.toMatchObject({ status: 400 });
    expect(tx.bookingSerializedItem.update).not.toHaveBeenCalled();
  });

  it.each([[], [{ ...allocation, bookingId: "elsewhere" }], [allocation, allocation], [{ ...allocation, endsAt: startsAt }]].map((allocations) => ({ allocations })))("rejects inconsistent active allocation custody", async ({ allocations }) => {
    tx.assetAllocation.findMany.mockResolvedValue(allocations);
    await expect(updateBookingItemHolder(args)).rejects.toMatchObject({ status: 409 });
    expect(tx.bookingSerializedItem.update).not.toHaveBeenCalled();
  });

  it("rejects stale snapshots even within the same second", async () => {
    await expect(updateBookingItemHolder({ ...args, expectedUpdatedAt: new Date(updatedAt.getTime() - 1) })).rejects.toMatchObject({ status: 409 });
    expect(tx.bookingSerializedItem.update).not.toHaveBeenCalled();
  });
  it("rejects an in-progress return", async () => {
    tx.scanSession.findFirst.mockResolvedValue({ id: "return-session" });
    await expect(updateBookingItemHolder(args)).rejects.toMatchObject({ status: 409 });
    expect(tx.bookingSerializedItem.update).not.toHaveBeenCalled();
  });
  it("rejects accountability-excluded custody", async () => {
    tx.booking.findUnique.mockResolvedValue({ ...source, accountabilityExclusion: { restoredAt: null } });
    await expect(updateBookingItemHolder(args)).rejects.toMatchObject({ status: 409 });
  });
  it.each([Role.STUDENT, Role.COLLABORATOR])("rejects %s actors", async (role) => {
    tx.user.findUnique.mockResolvedValue({ role });
    await expect(updateBookingItemHolder(args)).rejects.toMatchObject({ status: 403 });
  });
  it.each([null, { id: "recipient", active: false }, { id: "recipient", active: true, hiddenFromRoster: true }])("rejects invalid target users", async (target) => {
    tx.user.findUnique.mockImplementation(({ where }) => Promise.resolve(where.id === "staff" ? { role: Role.STAFF } : target));
    await expect(updateBookingItemHolder(args)).rejects.toMatchObject({ status: 400 });
  });
  it("rejects same checkout owner instead of silently writing another holder label", async () => {
    tx.booking.findUnique.mockResolvedValue({ ...source, requesterUserId: "recipient" });
    await expect(updateBookingItemHolder(args)).rejects.toMatchObject({ status: 400 });
  });
  it("acknowledges only the exact committed transfer retry without moving twice", async () => {
    tx.bookingSerializedItem.findUnique.mockResolvedValue({ ...item, bookingId: receiving.id });
    tx.auditLog.findFirst.mockResolvedValue({ id: "receipt" });
    expect((await updateBookingItemHolder(args)).targetBookingId).toBe(receiving.id);
    expect(tx.bookingSerializedItem.update).not.toHaveBeenCalled();
    expect(tx.auditLog.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      actorUserId: "staff", entityId: "source", action: "serialized_item_transferred_out",
      AND: expect.arrayContaining([{ afterJson: { path: ["sourceSnapshot"], equals: updatedAt.toISOString() } }]),
    }) }));
  });
  it("rejects an unrelated or subsequently moved item", async () => {
    tx.bookingSerializedItem.findUnique.mockResolvedValue({ ...item, bookingId: receiving.id });
    tx.auditLog.findFirst.mockResolvedValue(null);
    await expect(updateBookingItemHolder(args)).rejects.toMatchObject({ status: 409 });
    expect(tx.bookingSerializedItem.update).not.toHaveBeenCalled();
  });
  it("propagates an audit failure through the same transaction rather than reporting success", async () => {
    tx.auditLog.create.mockRejectedValue(new Error("audit failed"));
    await expect(updateBookingItemHolder(args)).rejects.toThrow("audit failed");
    expect(transactionCalls).toHaveLength(1);
    expect(transactionCalls[0]?.options).toMatchObject({ isolationLevel: "Serializable", maxWait: 1_000, timeout: 6_000 });
  });
});
