import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role, ShiftAssignmentSource } from "@prisma/client";

type MockFn = ReturnType<typeof vi.fn>;

const mockTx = {
  booking: {
    count: vi.fn(),
    update: vi.fn(),
  },
  shiftGroup: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  shift: {
    create: vi.fn(),
  },
  shiftAssignment: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
  shiftTrade: {
    updateMany: vi.fn(),
  },
};

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(),
  },
}));

import {
  assignReservationRequesterToScheduleTx,
  reconcileReservationScheduleTx,
  releaseReservationManagedAssignmentTx,
  validateReservationScheduleAssignmentTx,
  type ReservationScheduleRequester,
} from "@/lib/services/reservation-schedule";

const eventId = "event-1";
const startsAt = new Date("2026-04-01T18:00:00Z");
const endsAt = new Date("2026-04-01T22:00:00Z");

function requester(overrides: Partial<ReservationScheduleRequester> = {}): ReservationScheduleRequester {
  return {
    role: Role.STUDENT,
    staffingType: "ST",
    primaryArea: "VIDEO",
    areaAssignments: [],
    availabilityBlocks: [],
    ...overrides,
  };
}

function shift(overrides: Record<string, unknown> = {}) {
  return {
    id: "shift-1",
    area: "VIDEO",
    workerType: "ST",
    startsAt,
    endsAt,
    callStartsAt: null,
    callEndsAt: null,
    assignments: [],
    ...overrides,
  };
}

function group(overrides: Record<string, unknown> = {}) {
  return {
    id: "group-1",
    publishedAt: null,
    workingCopy: null,
    event: { startsAt, endsAt, allDay: false },
    shifts: [shift()],
    ...overrides,
  };
}

function createdAssignment(overrides: Record<string, unknown> = {}) {
  return {
    id: "assignment-1",
    userId: "user-1",
    status: "DIRECT_ASSIGNED",
    callStartsAt: null,
    callEndsAt: null,
    callNote: null,
    acknowledgedAt: null,
    ...overrides,
  };
}

const tx = mockTx as {
  booking: Record<"count" | "update", MockFn>;
  shiftGroup: Record<"findUnique" | "update", MockFn>;
  shift: Record<"create", MockFn>;
  shiftAssignment: Record<"findMany" | "findUnique" | "updateMany" | "update" | "create", MockFn>;
  shiftTrade: Record<"updateMany", MockFn>;
};

beforeEach(() => {
  tx.shiftGroup.findUnique.mockReset();
  tx.shiftGroup.update.mockReset();
  tx.shift.create.mockReset();
  tx.booking.count.mockReset();
  tx.booking.update.mockReset();
  tx.shiftAssignment.findMany.mockReset();
  tx.shiftAssignment.findUnique.mockReset();
  tx.shiftAssignment.updateMany.mockReset();
  tx.shiftAssignment.update.mockReset();
  tx.shiftAssignment.create.mockReset();
  tx.shiftTrade.updateMany.mockReset();
  tx.booking.count.mockResolvedValue(0);
  tx.booking.update.mockResolvedValue({});
  tx.shiftAssignment.findUnique.mockResolvedValue(null);
  tx.shiftAssignment.findMany.mockResolvedValue([]);
  tx.shiftAssignment.updateMany.mockResolvedValue({ count: 0 });
  tx.shiftAssignment.update.mockResolvedValue({});
  tx.shiftTrade.updateMany.mockResolvedValue({ count: 0 });
  tx.shiftGroup.update.mockResolvedValue({});
  tx.shiftGroup.findUnique.mockResolvedValue(group());
  tx.shiftAssignment.create.mockResolvedValue(createdAssignment());
});

describe("assignReservationRequesterToScheduleTx", () => {
  it("reuses an existing active assignment for the event", async () => {
    tx.shiftGroup.findUnique.mockResolvedValue(group({
      shifts: [shift({ assignments: [createdAssignment({ id: "existing-assignment" })] })],
    }));

    const result = await assignReservationRequesterToScheduleTx(tx as never, {
      bookingId: "booking-1",
      eventId,
      requesterUserId: "user-1",
      requester: requester(),
      createdBy: "user-1",
    });

    expect(result).toMatchObject({
      shiftAssignmentId: "existing-assignment",
      shiftId: "shift-1",
      created: false,
    });
    expect(tx.shiftAssignment.create).not.toHaveBeenCalled();
    expect(tx.shiftGroup.update).not.toHaveBeenCalled();
  });

  it.each([
    ["an open slot in the requester's area", group()],
    ["only occupied preferred-area slots", group({ shifts: [shift({ assignments: [createdAssignment({ id: "other-assignment", userId: "other-user" })] })] })],
    ["a published schedule", group({ publishedAt: new Date("2026-03-01T12:00:00Z") })],
    ["a working copy", group({ workingCopy: { shiftGroupId: "group-1" } })],
    ["no schedule", null],
  ] as const)("never puts the requester on the schedule with %s", async (_label, eventGroup) => {
    tx.shiftGroup.findUnique.mockResolvedValue(eventGroup);

    const result = await assignReservationRequesterToScheduleTx(tx as never, {
      bookingId: "booking-1",
      eventId,
      requesterUserId: "user-1",
      requester: requester(),
      createdBy: "user-1",
    });

    expect(result).toBeNull();
    expect(tx.shiftAssignment.create).not.toHaveBeenCalled();
    expect(tx.shift.create).not.toHaveBeenCalled();
    expect(tx.shiftGroup.update).not.toHaveBeenCalled();
  });
});

function assignmentContext(overrides: Record<string, unknown> = {}) {
  return {
    id: "assignment-1",
    userId: "user-1",
    status: "DIRECT_ASSIGNED",
    source: ShiftAssignmentSource.RESERVATION,
    shift: {
      id: "shift-1",
      area: "VIDEO",
      workerType: "ST",
      shiftGroup: {
        id: "group-1",
        eventId,
        publishedAt: null,
        workingCopy: null,
      },
    },
    ...overrides,
  };
}

describe("reservation schedule lifecycle hardening", () => {
  it("validates explicit assignment ownership, activity, and event scope", async () => {
    tx.shiftAssignment.findUnique.mockResolvedValue(assignmentContext());

    await expect(validateReservationScheduleAssignmentTx(tx as never, {
      assignmentId: "assignment-1",
      requesterUserId: "user-1",
      eventIds: [eventId],
    })).resolves.toMatchObject({ id: "assignment-1" });

    await expect(validateReservationScheduleAssignmentTx(tx as never, {
      assignmentId: "assignment-1",
      requesterUserId: "other-user",
      eventIds: [eventId],
    })).rejects.toThrow("different requester");

    await expect(validateReservationScheduleAssignmentTx(tx as never, {
      assignmentId: "assignment-1",
      requesterUserId: "user-1",
      eventIds: ["other-event"],
    })).rejects.toThrow("linked events");

    tx.shiftAssignment.findUnique.mockResolvedValue(assignmentContext({ status: "DECLINED" }));
    await expect(validateReservationScheduleAssignmentTx(tx as never, {
      assignmentId: "assignment-1",
      requesterUserId: "user-1",
      eventIds: [eventId],
    })).rejects.toThrow("no longer active");
  });

  it("releases only reservation-managed assignments and refreshes published truth", async () => {
    const publishedGroup = group({ publishedAt: new Date("2026-03-01T12:00:00Z") });
    tx.shiftAssignment.findUnique.mockResolvedValue(assignmentContext());
    tx.shiftGroup.findUnique.mockResolvedValue(publishedGroup);

    const result = await releaseReservationManagedAssignmentTx(tx as never, {
      bookingId: "booking-1",
      assignmentId: "assignment-1",
    });

    expect(result).toMatchObject({
      assignmentId: "assignment-1",
      released: true,
      linkCleared: true,
      reason: "released",
    });
    expect(tx.shiftTrade.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ shiftAssignmentId: "assignment-1" }),
      data: expect.objectContaining({ status: "CANCELLED" }),
    }));
    expect(tx.shiftAssignment.update).toHaveBeenCalledWith({
      where: { id: "assignment-1" },
      data: { status: "DECLINED" },
    });
    expect(tx.booking.update).toHaveBeenCalledWith({
      where: { id: "booking-1" },
      data: { shiftAssignmentId: null },
    });
    expect(tx.shiftGroup.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        publishedVersion: { increment: 1 },
        lastPublishedSnapshot: expect.any(Object),
      }),
    }));
  });

  it("keeps a shared reservation assignment active for another reservation", async () => {
    tx.shiftAssignment.findUnique.mockResolvedValue(assignmentContext());
    tx.booking.count.mockResolvedValue(1);

    const result = await releaseReservationManagedAssignmentTx(tx as never, {
      bookingId: "booking-1",
      assignmentId: "assignment-1",
    });

    expect(result).toMatchObject({
      released: false,
      linkCleared: true,
      reason: "other_reservation",
    });
    expect(tx.shiftAssignment.update).not.toHaveBeenCalled();
    expect(tx.booking.update).toHaveBeenCalledWith({
      where: { id: "booking-1" },
      data: { shiftAssignmentId: null },
    });
  });

  it("does not mutate a working copy while reconciling a reservation link", async () => {
    const current = assignmentContext({
      shift: {
        id: "shift-1",
        area: "VIDEO",
        workerType: "ST",
        shiftGroup: {
          id: "group-1",
          eventId,
          publishedAt: new Date("2026-03-01T12:00:00Z"),
          workingCopy: { shiftGroupId: "group-1" },
        },
      },
    });
    tx.shiftAssignment.findUnique.mockResolvedValue(current);

    const result = await reconcileReservationScheduleTx(tx as never, {
      bookingId: "booking-1",
      requesterUserId: "user-1",
      requester: requester(),
      primaryEventId: "event-new",
      currentAssignmentId: "assignment-1",
      createdBy: "actor-1",
    });

    expect(result).toMatchObject({ status: "blocked_working_copy" });
    expect(tx.shiftAssignment.update).not.toHaveBeenCalled();
    expect(tx.booking.update).not.toHaveBeenCalled();
  });

  it("drops a reservation-managed link when its primary event changes and does not schedule the requester again", async () => {
    tx.shiftAssignment.findUnique.mockResolvedValue(assignmentContext());
    tx.shiftGroup.findUnique.mockResolvedValue(group());

    const result = await reconcileReservationScheduleTx(tx as never, {
      bookingId: "booking-1",
      requesterUserId: "user-1",
      requester: requester(),
      primaryEventId: "event-new",
      currentAssignmentId: "assignment-1",
      createdBy: "actor-1",
    });

    expect(result).toMatchObject({ status: "not_applicable", releasedAssignmentId: "assignment-1" });
    expect(tx.shiftAssignment.create).not.toHaveBeenCalled();
    expect(tx.booking.update).toHaveBeenCalledWith({
      where: { id: "booking-1" },
      data: { shiftAssignmentId: null },
    });
  });

  it("unlinks another person's manual assignment when the reservation owner changes", async () => {
    tx.shiftAssignment.findUnique.mockResolvedValue(assignmentContext({
      userId: "original-owner",
      source: ShiftAssignmentSource.MANUAL,
    }));

    const result = await reconcileReservationScheduleTx(tx as never, {
      bookingId: "booking-1",
      requesterUserId: "new-owner",
      requester: requester(),
      primaryEventId: eventId,
      currentAssignmentId: "assignment-1",
      createdBy: "actor-1",
    });

    expect(tx.booking.update).toHaveBeenNthCalledWith(1, {
      where: { id: "booking-1" },
      data: { shiftAssignmentId: null },
    });
    expect(tx.shiftAssignment.update).not.toHaveBeenCalled();
    expect(tx.shiftAssignment.create).not.toHaveBeenCalled();
    expect(result.assignment).toBeNull();
  });
});
