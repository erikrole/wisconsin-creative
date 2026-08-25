import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingKind, BookingStatus, CollaboratorProfile, Prisma, Role, ShiftAssignmentSource } from "@prisma/client";
import { expectSerializableIsolation } from "./_helpers/assert-transaction";
import { MAX_LINKED_EVENTS_PER_BOOKING } from "@/lib/request-limits";

type MockFn = ReturnType<typeof vi.fn>;
type UpdateEventsTx = {
  booking: Record<"findUnique" | "findUniqueOrThrow" | "update" | "count", MockFn>;
  calendarEvent: Record<"findMany", MockFn>;
  shiftGroup: Record<"findUnique" | "update", MockFn>;
  shift: Record<"create", MockFn>;
  shiftAssignment: Record<"findMany" | "findUnique" | "updateMany" | "update" | "create", MockFn>;
  shiftTrade: Record<"updateMany", MockFn>;
  bookingEvent: Record<"deleteMany" | "createMany", MockFn>;
  auditLog: Record<"create", MockFn>;
  user: Record<"findUnique", MockFn>;
};

const transactionCalls: Array<{ options: unknown }> = [];

vi.mock("@/lib/db", () => {
  const mockTx = {
    booking: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), count: vi.fn() },
    calendarEvent: { findMany: vi.fn() },
    shiftGroup: { findUnique: vi.fn(), update: vi.fn() },
    shift: { create: vi.fn() },
    shiftAssignment: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn(), create: vi.fn() },
    shiftTrade: { updateMany: vi.fn() },
    bookingEvent: { deleteMany: vi.fn(), createMany: vi.fn() },
    auditLog: { create: vi.fn() },
    user: { findUnique: vi.fn() },
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

import { db } from "@/lib/db";
import { updateBookingEvents } from "@/lib/services/bookings";

const mockTx = (db as unknown as { _mockTx: UpdateEventsTx })._mockTx;

function reservation(overrides: Record<string, unknown> = {}) {
  return {
    id: "reservation-1",
    kind: BookingKind.RESERVATION,
    status: BookingStatus.BOOKED,
    updatedAt: new Date("2026-07-09T16:00:00Z"),
    eventId: "event-old",
    events: [{ eventId: "event-old" }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  transactionCalls.length = 0;
  mockTx.booking.findUnique.mockResolvedValue(reservation());
  mockTx.booking.findUniqueOrThrow.mockResolvedValue({ id: "reservation-1" });
  mockTx.booking.update.mockResolvedValue({});
  mockTx.booking.count.mockResolvedValue(0);
  mockTx.bookingEvent.deleteMany.mockResolvedValue({});
  mockTx.bookingEvent.createMany.mockResolvedValue({});
  mockTx.shiftGroup.findUnique.mockResolvedValue(null);
  mockTx.shiftGroup.update.mockResolvedValue({});
  mockTx.shift.create.mockResolvedValue({});
  mockTx.shiftAssignment.findMany.mockResolvedValue([]);
  mockTx.shiftAssignment.findUnique.mockResolvedValue(null);
  mockTx.shiftAssignment.updateMany.mockResolvedValue({ count: 0 });
  mockTx.shiftAssignment.update.mockResolvedValue({});
  mockTx.shiftTrade.updateMany.mockResolvedValue({ count: 0 });
  mockTx.shiftAssignment.create.mockResolvedValue({
    id: "assignment-new",
    userId: "student-1",
    status: "DIRECT_ASSIGNED",
    callStartsAt: null,
    callEndsAt: null,
    callNote: null,
    acknowledgedAt: null,
  });
  mockTx.auditLog.create.mockResolvedValue({});
  mockTx.user.findUnique.mockResolvedValue({ role: Role.STUDENT, collaboratorProfile: null });
  mockTx.calendarEvent.findMany.mockResolvedValue([
    { id: "event-late", startsAt: new Date("2026-07-11T20:00:00Z") },
    { id: "event-early", startsAt: new Date("2026-07-10T20:00:00Z") },
  ]);
});

describe("updateBookingEvents", () => {
  it("uses SERIALIZABLE isolation", async () => {
    await updateBookingEvents("reservation-1", "student-1", ["event-late", "event-early"]);
    expectSerializableIsolation(transactionCalls, 0);
  });

  it("BUG: rejects event links when the edited snapshot changed before the transaction", async () => {
    await expect(updateBookingEvents(
      "reservation-1",
      "student-1",
      ["event-late", "event-early"],
      new Date("2026-07-09T15:59:59Z"),
    )).rejects.toMatchObject({ status: 409 });

    expect(mockTx.calendarEvent.findMany).not.toHaveBeenCalled();
    expect(mockTx.booking.update).not.toHaveBeenCalled();
  });

  it("sorts event links chronologically and preserves primary event compatibility", async () => {
    await updateBookingEvents("reservation-1", "student-1", ["event-late", "event-early"]);

    expect(mockTx.booking.update).toHaveBeenCalledWith({
      where: { id: "reservation-1" },
      data: { eventId: "event-early" },
    });
    expect(mockTx.bookingEvent.deleteMany).toHaveBeenCalledWith({ where: { bookingId: "reservation-1" } });
    expect(mockTx.bookingEvent.createMany).toHaveBeenCalledWith({
      data: [
        { bookingId: "reservation-1", eventId: "event-early", ordinal: 0 },
        { bookingId: "reservation-1", eventId: "event-late", ordinal: 1 },
      ],
    });
    expect(mockTx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorUserId: "student-1",
          action: "events_updated",
          beforeJson: expect.objectContaining({ eventIds: ["event-old"] }),
          afterJson: expect.objectContaining({
            eventId: "event-early",
            eventIds: ["event-early", "event-late"],
            _actorRole: Role.STUDENT,
          }),
        }),
      }),
    );
  });

  it("allows five linked events when relinking an active booking", async () => {
    const eventIds = Array.from(
      { length: MAX_LINKED_EVENTS_PER_BOOKING },
      (_, index) => `event-${index + 1}`,
    );
    mockTx.calendarEvent.findMany.mockResolvedValue(
      [...eventIds].reverse().map((id) => ({
        id,
        startsAt: new Date(Date.UTC(2026, 6, 10 + eventIds.indexOf(id), 20)),
      })),
    );

    await updateBookingEvents("reservation-1", "student-1", eventIds);

    expect(mockTx.bookingEvent.createMany).toHaveBeenCalledWith({
      data: eventIds.map((eventId, ordinal) => ({
        bookingId: "reservation-1",
        eventId,
        ordinal,
      })),
    });
  });

  it("adds the requester when an existing reservation gains its first event link", async () => {
    mockTx.booking.findUnique.mockResolvedValue(reservation({
      requesterUserId: "student-1",
      shiftAssignmentId: null,
      requester: {
        role: Role.STUDENT,
        staffingType: "ST",
        primaryArea: "VIDEO",
        areaAssignments: [],
        availabilityBlocks: [],
      },
      eventId: null,
      events: [],
    }));
    mockTx.calendarEvent.findMany.mockResolvedValue([
      { id: "event-early", startsAt: new Date("2026-07-10T20:00:00Z") },
    ]);
    mockTx.shiftGroup.findUnique.mockResolvedValue({
      id: "group-1",
      publishedAt: null,
      workingCopy: null,
      event: {
        startsAt: new Date("2026-07-10T20:00:00Z"),
        endsAt: new Date("2026-07-10T23:00:00Z"),
        allDay: false,
      },
      shifts: [{
        id: "shift-1",
        area: "VIDEO",
        workerType: "ST",
        startsAt: new Date("2026-07-10T19:00:00Z"),
        endsAt: new Date("2026-07-11T00:00:00Z"),
        callStartsAt: null,
        callEndsAt: null,
        assignments: [],
      }],
    });

    await updateBookingEvents("reservation-1", "student-1", ["event-early"]);

    expect(mockTx.booking.update).toHaveBeenCalledWith({
      where: { id: "reservation-1" },
      data: { shiftAssignmentId: "assignment-new" },
    });
    expect(mockTx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        entityType: "shift_assignment",
        entityId: "assignment-new",
        action: "shift_assigned",
      }),
    }));
  });

  it("moves a reservation-managed assignment when the primary event changes", async () => {
    mockTx.booking.findUnique.mockResolvedValue(reservation({
      requesterUserId: "student-1",
      shiftAssignmentId: "assignment-old",
      requester: {
        role: Role.STUDENT,
        staffingType: "ST",
        primaryArea: "VIDEO",
        areaAssignments: [],
        availabilityBlocks: [],
      },
      eventId: "event-old",
      events: [{ eventId: "event-old" }],
    }));
    mockTx.calendarEvent.findMany.mockResolvedValue([
      { id: "event-new", startsAt: new Date("2026-07-12T20:00:00Z") },
    ]);
    mockTx.shiftAssignment.findUnique.mockResolvedValue({
      id: "assignment-old",
      userId: "student-1",
      status: "DIRECT_ASSIGNED",
      source: ShiftAssignmentSource.RESERVATION,
      shift: {
        id: "shift-old",
        area: "VIDEO",
        workerType: "ST",
        shiftGroup: {
          id: "group-old",
          eventId: "event-old",
          publishedAt: null,
          workingCopy: null,
        },
      },
    });
    mockTx.shiftGroup.findUnique.mockResolvedValue({
      id: "group-new",
      publishedAt: null,
      workingCopy: null,
      event: {
        startsAt: new Date("2026-07-12T20:00:00Z"),
        endsAt: new Date("2026-07-12T23:00:00Z"),
        allDay: false,
      },
      shifts: [{
        id: "shift-new",
        area: "VIDEO",
        workerType: "ST",
        startsAt: new Date("2026-07-12T19:00:00Z"),
        endsAt: new Date("2026-07-13T00:00:00Z"),
        callStartsAt: null,
        callEndsAt: null,
        assignments: [],
      }],
    });

    await updateBookingEvents("reservation-1", "student-1", ["event-new"]);

    expect(mockTx.shiftAssignment.update).toHaveBeenCalledWith({
      where: { id: "assignment-old" },
      data: { status: "DECLINED" },
    });
    expect(mockTx.shiftAssignment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ source: ShiftAssignmentSource.RESERVATION }),
    }));
    expect(mockTx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "shift_assignment_removed",
        entityId: "assignment-old",
      }),
    }));
  });

  it("clears linked events", async () => {
    await updateBookingEvents("reservation-1", "student-1", []);

    expect(mockTx.booking.update).toHaveBeenCalledWith({
      where: { id: "reservation-1" },
      data: { eventId: null },
    });
    expect(mockTx.bookingEvent.deleteMany).toHaveBeenCalledWith({ where: { bookingId: "reservation-1" } });
    expect(mockTx.bookingEvent.createMany).not.toHaveBeenCalled();
  });

  it("rejects duplicate eventIds before opening a transaction", async () => {
    await expect(
      updateBookingEvents("reservation-1", "student-1", ["event-1", "event-1"]),
    ).rejects.toThrow("eventIds must be unique");

    expect(transactionCalls).toHaveLength(0);
  });

  it("rejects more than five eventIds before opening a transaction", async () => {
    const eventIds = Array.from(
      { length: MAX_LINKED_EVENTS_PER_BOOKING + 1 },
      (_, index) => `event-${index + 1}`,
    );

    await expect(
      updateBookingEvents("reservation-1", "student-1", eventIds),
    ).rejects.toThrow(`A booking may link at most ${MAX_LINKED_EVENTS_PER_BOOKING} events`);

    expect(transactionCalls).toHaveLength(0);
  });

  it("rejects missing eventIds", async () => {
    mockTx.calendarEvent.findMany.mockResolvedValue([{ id: "event-late", startsAt: new Date("2026-07-11T20:00:00Z") }]);

    await expect(
      updateBookingEvents("reservation-1", "student-1", ["event-late", "event-missing"]),
    ).rejects.toThrow("One or more eventIds do not exist");
    expect(mockTx.booking.update).not.toHaveBeenCalled();
    expect(mockTx.bookingEvent.deleteMany).not.toHaveBeenCalled();
  });

  it("limits collaborator relinking to published visible schedule events", async () => {
    mockTx.user.findUnique.mockResolvedValue({
      role: Role.COLLABORATOR,
      collaboratorProfile: CollaboratorProfile.BTN_STANDARD,
      collaboratorPolicy: {
        status: "ACTIVE",
        grants: [{ capabilityKey: "PUBLISHED_SCHEDULE_VIEW" }],
      },
    });

    await updateBookingEvents("reservation-1", "collaborator-1", ["event-late", "event-early"]);

    expect(mockTx.calendarEvent.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["event-late", "event-early"] },
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

  it("allows active checkout bookings", async () => {
    mockTx.booking.findUnique.mockResolvedValue(reservation({
      kind: BookingKind.CHECKOUT,
      status: BookingStatus.OPEN,
    }));

    await updateBookingEvents("reservation-1", "student-1", ["event-late", "event-early"]);

    expect(mockTx.booking.update).toHaveBeenCalledWith({
      where: { id: "reservation-1" },
      data: { eventId: "event-early" },
    });
  });

  it("keeps checkout relinking scoped to event context only", async () => {
    mockTx.booking.findUnique.mockResolvedValue(reservation({
      kind: BookingKind.CHECKOUT,
      status: BookingStatus.OPEN,
    }));

    await updateBookingEvents("reservation-1", "student-1", ["event-late", "event-early"]);

    expect(mockTx.booking.update).toHaveBeenCalledTimes(1);
    expect(mockTx.booking.update).toHaveBeenCalledWith({
      where: { id: "reservation-1" },
      data: { eventId: "event-early" },
    });
    expect(mockTx.bookingEvent.deleteMany).toHaveBeenCalledWith({ where: { bookingId: "reservation-1" } });
    expect(mockTx.bookingEvent.createMany).toHaveBeenCalledWith({
      data: [
        { bookingId: "reservation-1", eventId: "event-early", ordinal: 0 },
        { bookingId: "reservation-1", eventId: "event-late", ordinal: 1 },
      ],
    });
  });

  it("rejects terminal bookings", async () => {
    mockTx.booking.findUnique.mockResolvedValue(reservation({ status: BookingStatus.COMPLETED }));

    await expect(
      updateBookingEvents("reservation-1", "student-1", ["event-late", "event-early"]),
    ).rejects.toThrow("Cannot update linked events for a completed or cancelled booking");
  });
});
