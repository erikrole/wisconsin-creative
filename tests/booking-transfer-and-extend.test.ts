import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingCustodyScope, BookingKind, BookingStatus, Prisma, Role } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  bookingFindUnique: vi.fn(),
  bookingFindUniqueOrThrow: vi.fn(),
  bookingUpdate: vi.fn(),
  userFindUnique: vi.fn(),
  scanSessionFindFirst: vi.fn(),
  exclusionFindUnique: vi.fn(),
  allocationUpdateMany: vi.fn(),
  dueDateChangeCreate: vi.fn(),
  createAuditEntryTx: vi.fn(),
  lookupActorRole: vi.fn(),
  checkAvailability: vi.fn(),
  checkCheckoutDueTime: vi.fn(),
  reconcileSchedule: vi.fn(),
  dispatchScheduleNotifications: vi.fn(),
  updateLiveActivities: vi.fn(),
  scheduleLiveActivity: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const tx = {
    booking: { findUnique: mocks.bookingFindUnique, findUniqueOrThrow: mocks.bookingFindUniqueOrThrow, update: mocks.bookingUpdate },
    user: { findUnique: mocks.userFindUnique },
    scanSession: { findFirst: mocks.scanSessionFindFirst },
    bookingAccountabilityExclusion: { findUnique: mocks.exclusionFindUnique },
    assetAllocation: { updateMany: mocks.allocationUpdateMany },
    bookingDueDateChange: { create: mocks.dueDateChangeCreate },
  };
  mocks.transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx));
  return { db: { $transaction: mocks.transaction } };
});
vi.mock("@/lib/audit", () => ({
  createAuditEntryTx: mocks.createAuditEntryTx,
  createAuditEntriesTx: vi.fn(),
  lookupActorRole: mocks.lookupActorRole,
}));
vi.mock("@/lib/services/availability", () => ({
  checkAvailability: mocks.checkAvailability,
  checkCheckoutDueTime: mocks.checkCheckoutDueTime,
}));
vi.mock("@/lib/services/reservation-schedule", () => ({
  reconcileReservationScheduleTx: mocks.reconcileSchedule,
  releaseReservationManagedAssignmentTx: vi.fn(),
}));
vi.mock("@/lib/services/notifications", () => ({
  createShiftScheduleNotification: vi.fn(),
  dispatchScheduleAssignmentNotifications: mocks.dispatchScheduleNotifications,
}));
vi.mock("@/lib/services/live-activities", () => ({
  endCheckoutReturnLiveActivities: vi.fn(),
  updateCheckoutReturnLiveActivities: mocks.updateLiveActivities,
}));
vi.mock("@/lib/live-activity-workflow", () => ({ scheduleCheckoutReturnLiveActivity: mocks.scheduleLiveActivity }));

import { extendBooking, transferBookingOwner } from "@/lib/services/checkout-lifecycle";

const SNAPSHOT = new Date("2026-10-24T20:00:00.000Z");
const CLEAR = { conflicts: [], shortages: [], unavailableAssets: [] };

function owned(over: Record<string, unknown> = {}) {
  return {
    id: "b1",
    kind: BookingKind.CHECKOUT,
    status: BookingStatus.OPEN,
    updatedAt: SNAPSHOT,
    requesterUserId: "maya",
    custodyScope: BookingCustodyScope.PERSON,
    eventId: null,
    shiftAssignmentId: null,
    createdBy: "maya",
    requester: { id: "maya", name: "Maya", email: "maya@example.com" },
    ...over,
  };
}

const jordan = { id: "jordan", name: "Jordan", email: "jordan@example.com", active: true, hiddenFromRoster: false, role: Role.STUDENT };

function usersById(byId: Record<string, unknown>) {
  mocks.userFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => byId[where.id] ?? null);
}

const transfer = (actor = "maya", input: { targetUserId: string; reason?: string } = { targetUserId: "jordan" }, expected: Date | undefined = SNAPSHOT) =>
  transferBookingOwner("b1", actor, input, expected);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.bookingFindUnique.mockResolvedValue(owned());
  mocks.bookingFindUniqueOrThrow.mockResolvedValue({ id: "b1", kind: BookingKind.CHECKOUT, status: BookingStatus.OPEN, endsAt: new Date("2099-01-03T15:00:00Z") });
  mocks.scanSessionFindFirst.mockResolvedValue(null);
  mocks.exclusionFindUnique.mockResolvedValue(null);
  usersById({ maya: { role: Role.STUDENT }, "staff-1": { role: Role.STAFF }, jordan });
  mocks.lookupActorRole.mockResolvedValue(Role.STAFF);
  mocks.checkAvailability.mockResolvedValue(CLEAR);
  mocks.checkCheckoutDueTime.mockResolvedValue(CLEAR);
});

describe("transferBookingOwner", () => {
  it("lets the holder hand an open checkout to a teammate, audited with the reason", async () => {
    await transfer("maya", { targetUserId: "jordan", reason: "  Covering the late game  " });

    expect(mocks.bookingUpdate).toHaveBeenCalledWith({ where: { id: "b1" }, data: { requesterUserId: "jordan" } });
    expect(mocks.createAuditEntryTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "owner_transferred",
      before: { requesterUserId: "maya", requesterName: "Maya", requesterEmail: "maya@example.com" },
      after: { requesterUserId: "jordan", requesterName: "Jordan", requesterEmail: "jordan@example.com", reason: "Covering the late game" },
    }));
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
  });

  it("lets staff transfer someone else's checkout", async () => {
    await transfer("staff-1");

    expect(mocks.bookingUpdate).toHaveBeenCalled();
  });

  it("refuses a student who neither holds nor created it", async () => {
    usersById({ riley: { role: Role.STUDENT }, jordan });

    await expect(transfer("riley")).rejects.toMatchObject({ status: 403 });
    expect(mocks.bookingUpdate).not.toHaveBeenCalled();
  });

  it("is a no-op when the target already holds it", async () => {
    await transfer("maya", { targetUserId: "maya" });

    expect(mocks.bookingUpdate).not.toHaveBeenCalled();
    expect(mocks.createAuditEntryTx).not.toHaveBeenCalled();
  });

  it("waits for an in-progress return to finish", async () => {
    mocks.scanSessionFindFirst.mockResolvedValue({ id: "scan-1" });

    await expect(transfer()).rejects.toThrow("Finish the in-progress return before transferring this checkout");
  });

  it("waits for an open accountability exclusion, but not a restored one", async () => {
    mocks.exclusionFindUnique.mockResolvedValue({ restoredAt: null });
    await expect(transfer()).rejects.toThrow("Resolve the checkout accountability exclusion before transferring it");

    mocks.exclusionFindUnique.mockResolvedValue({ restoredAt: new Date() });
    await expect(transfer()).resolves.toBeDefined();
  });

  it.each([
    ["a completed booking", { status: BookingStatus.COMPLETED }, 400],
    ["a cancelled booking", { status: BookingStatus.CANCELLED }, 400],
    ["a shared travel case", { custodyScope: BookingCustodyScope.SHARED }, 400],
    ["a stale copy", { updatedAt: new Date("2026-10-24T19:00:00.000Z") }, 409],
  ])("refuses %s", async (_label, over, status) => {
    mocks.bookingFindUnique.mockResolvedValue(owned(over));

    await expect(transfer()).rejects.toMatchObject({ status });
    expect(mocks.bookingUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ["someone who doesn't exist", null, "Target user not found"],
    ["an inactive user", { ...jordan, active: false }, "Cannot transfer ownership to an inactive user"],
    ["a hidden test user", { ...jordan, hiddenFromRoster: true }, "Cannot transfer ownership to a hidden test user"],
  ])("refuses a transfer to %s", async (_label, target, message) => {
    usersById({ maya: { role: Role.STUDENT }, jordan: target });

    await expect(transfer()).rejects.toThrow(message);
    expect(mocks.bookingUpdate).not.toHaveBeenCalled();
  });

  it("answers 404 for a missing booking", async () => {
    mocks.bookingFindUnique.mockResolvedValue(null);

    await expect(transfer()).rejects.toMatchObject({ status: 404 });
  });

  it("moves an event reservation's shift to the new owner and notifies them after commit", async () => {
    mocks.bookingFindUnique.mockResolvedValue(owned({ kind: BookingKind.RESERVATION, status: BookingStatus.BOOKED, eventId: "ev-1", shiftAssignmentId: "sa-old" }));
    mocks.reconcileSchedule.mockResolvedValue({ status: "assigned", assignment: { created: true, shiftAssignmentId: "sa-new" }, releasedAssignmentId: "sa-old" });

    await transfer();

    expect(mocks.reconcileSchedule).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      bookingId: "b1",
      requesterUserId: "jordan",
      primaryEventId: "ev-1",
      currentAssignmentId: "sa-old",
    }));
    expect(mocks.createAuditEntryTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      entityType: "shift_assignment",
      entityId: "sa-old",
      action: "shift_assignment_removed",
      after: { reason: "booking_owner_transferred" },
    }));
    expect(mocks.dispatchScheduleNotifications).toHaveBeenCalledWith("sa-new", "assigned", { actorUserId: "maya" });
  });

  it("flags the schedule for review when the new owner can't be placed", async () => {
    mocks.bookingFindUnique.mockResolvedValue(owned({ kind: BookingKind.RESERVATION, status: BookingStatus.BOOKED, eventId: "ev-1" }));
    mocks.reconcileSchedule.mockResolvedValue({ status: "needs_review", reason: "unavailable" });

    await transfer();

    expect(mocks.createAuditEntryTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "schedule_assignment_review_needed",
      after: { status: "needs_review", reason: "unavailable" },
    }));
    expect(mocks.dispatchScheduleNotifications).not.toHaveBeenCalled();
  });

  it("turns a serialization conflict into a friendly retry", async () => {
    mocks.transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("conflict", { code: "P2034", clientVersion: "7" }));

    await expect(transfer()).rejects.toMatchObject({ status: 409, message: "Someone else submitted at the same time; please try again." });
  });
});

describe("extendBooking", () => {
  const ENDS_AT = new Date("2099-01-02T15:00:00.000Z");
  const LATER = new Date("2099-01-03T15:00:00.000Z");

  function extendable(over: Record<string, unknown> = {}) {
    return {
      id: "b1",
      kind: BookingKind.CHECKOUT,
      status: BookingStatus.OPEN,
      locationId: "cr",
      startsAt: new Date("2099-01-01T15:00:00.000Z"),
      endsAt: ENDS_AT,
      updatedAt: SNAPSHOT,
      serializedItems: [{ assetId: "fx3-1" }],
      bulkItems: [{ bulkSkuId: "batt", plannedQuantity: 2 }],
      ...over,
    };
  }

  beforeEach(() => {
    mocks.bookingFindUnique.mockResolvedValue(extendable());
  });

  it("moves an open checkout's due time, its allocations and history, then refreshes the return live activity", async () => {
    await extendBooking("b1", "staff-1", LATER, SNAPSHOT);

    expect(mocks.checkCheckoutDueTime).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: "b1" }), LATER);
    expect(mocks.checkAvailability).not.toHaveBeenCalled();
    expect(mocks.bookingUpdate).toHaveBeenCalledWith({ where: { id: "b1" }, data: { endsAt: LATER } });
    expect(mocks.allocationUpdateMany).toHaveBeenCalledWith({ where: { bookingId: "b1", active: true }, data: { endsAt: LATER } });
    expect(mocks.dueDateChangeCreate).toHaveBeenCalledWith({ data: { bookingId: "b1", actorUserId: "staff-1", previousEndsAt: ENDS_AT, nextEndsAt: LATER } });
    expect(mocks.createAuditEntryTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "extended",
      before: { endsAt: ENDS_AT },
      after: { endsAt: LATER },
    }));
    expect(mocks.updateLiveActivities).toHaveBeenCalledWith({ bookingId: "b1", endsAt: new Date("2099-01-03T15:00:00Z") });
    expect(mocks.scheduleLiveActivity).toHaveBeenCalledWith({ bookingId: "b1", endsAt: new Date("2099-01-03T15:00:00Z") });
  });

  it("checks a booked reservation's whole window with the turnaround buffer and skips live activities", async () => {
    mocks.bookingFindUnique.mockResolvedValue(extendable({ kind: BookingKind.RESERVATION, status: BookingStatus.BOOKED }));
    mocks.bookingFindUniqueOrThrow.mockResolvedValue({ id: "b1", kind: BookingKind.RESERVATION, status: BookingStatus.BOOKED, endsAt: LATER });

    await extendBooking("b1", "staff-1", LATER);

    expect(mocks.checkAvailability).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      endsAt: LATER,
      serializedAssetIds: ["fx3-1"],
      bulkItems: [{ bulkSkuId: "batt", quantity: 2 }],
      excludeBookingId: "b1",
      enforceSerializedTurnaroundBuffer: true,
    }));
    expect(mocks.updateLiveActivities).not.toHaveBeenCalled();
  });

  it.each([
    ["a conflict", { ...CLEAR, conflicts: [{ assetId: "fx3-1", conflictingBookingId: "b2" }] }],
    ["a bulk shortage", { ...CLEAR, shortages: [{ bulkSkuId: "batt", requested: 2, available: 1 }] }],
  ])("refuses an extension that runs into %s", async (_label, availability) => {
    mocks.checkCheckoutDueTime.mockResolvedValue(availability);

    await expect(extendBooking("b1", "staff-1", LATER)).rejects.toMatchObject({ status: 409 });
    expect(mocks.bookingUpdate).not.toHaveBeenCalled();
  });

  it("ignores a later retire flag on gear already in custody", async () => {
    mocks.checkCheckoutDueTime.mockResolvedValue({ ...CLEAR, unavailableAssets: [{ assetId: "fx3-1" }] });

    await expect(extendBooking("b1", "staff-1", LATER)).resolves.toBeDefined();
  });

  it.each([
    ["a completed booking", { status: BookingStatus.COMPLETED }, LATER, "Can only extend active bookings"],
    ["an earlier end", {}, new Date("2099-01-02T14:00:00.000Z"), "New end date must be later than current end date"],
    ["an end that has already passed", { endsAt: new Date("2020-01-01T00:00:00.000Z"), startsAt: new Date("2019-12-31T00:00:00.000Z") }, new Date("2020-01-02T00:00:00.000Z"), "New end date must be in the future"],
  ])("refuses %s", async (_label, over, newEndsAt, message) => {
    mocks.bookingFindUnique.mockResolvedValue(extendable(over));

    await expect(extendBooking("b1", "staff-1", newEndsAt)).rejects.toThrow(message);
    expect(mocks.bookingUpdate).not.toHaveBeenCalled();
  });

  it("refuses an extension against a stale copy", async () => {
    await expect(extendBooking("b1", "staff-1", LATER, new Date("2026-10-24T19:00:00.000Z"))).rejects.toMatchObject({ status: 409 });
  });

  it("answers 404 for a missing booking", async () => {
    mocks.bookingFindUnique.mockResolvedValue(null);

    await expect(extendBooking("b1", "staff-1", LATER)).rejects.toMatchObject({ status: 404 });
  });
});
