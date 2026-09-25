import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findGroup: vi.fn(),
  findUser: vi.fn(),
  findUsers: vi.fn(),
  findSportConfig: vi.fn(),
  findAssignments: vi.fn(),
  findTrades: vi.fn(),
  updateWorkingCopy: vi.fn(),
  createWorkingCopy: vi.fn(),
  checkTimeConflict: vi.fn(),
  createAuditEntryTx: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const client = {
    shiftGroup: { findUnique: mocks.findGroup },
    user: { findUnique: mocks.findUser, findMany: mocks.findUsers },
    sportConfig: { findUnique: mocks.findSportConfig },
    shiftAssignment: { findMany: mocks.findAssignments },
    shiftTrade: { findMany: mocks.findTrades },
    shiftGroupWorkingCopy: {
      updateMany: mocks.updateWorkingCopy,
      create: mocks.createWorkingCopy,
    },
  };
  return {
    db: {
      ...client,
      $transaction: (fn: (tx: unknown) => unknown) => fn(client),
    },
  };
});

vi.mock("@/lib/audit", () => ({ createAuditEntryTx: mocks.createAuditEntryTx }));

vi.mock("@/lib/services/shift-assignments", () => ({
  checkTimeConflict: mocks.checkTimeConflict,
}));

import { mutateWorkingSchedule } from "@/lib/services/schedule-working-copy";

const eventStartsAt = new Date("2026-10-06T18:00:00.000Z");
const eventEndsAt = new Date("2026-10-06T21:00:00.000Z");
const actor = { id: "staff-1", role: "STAFF" as const };

/**
 * One assigned slot carrying a slot-level call window plus a narrower personal
 * override, so clearing each layer falls back to a different window.
 */
function slot(overrides: Record<string, unknown> = {}) {
  return {
    key: "shift-1",
    sourceShiftId: "shift-1",
    area: "VIDEO",
    workerType: "ST",
    startsAt: eventStartsAt.toISOString(),
    endsAt: eventEndsAt.toISOString(),
    callStartsAt: "2026-10-06T17:00:00.000Z",
    callEndsAt: "2026-10-06T22:00:00.000Z",
    notes: null,
    assignmentHistoryCount: 0,
    assignment: {
      sourceAssignmentId: "assignment-1",
      userId: "student-1",
      status: "DIRECT_ASSIGNED",
      callStartsAt: "2026-10-06T19:00:00.000Z",
      callEndsAt: "2026-10-06T20:00:00.000Z",
      callNote: null,
      activeTradeId: null,
      bookingCount: 0,
    },
    ...overrides,
  };
}

function group(slots: Array<Record<string, unknown>>) {
  return {
    id: "group-1",
    publishedAt: new Date("2026-09-01T12:00:00.000Z"),
    publishedVersion: 3,
    event: { startsAt: eventStartsAt, endsAt: eventEndsAt, allDay: false, sportCode: "VB" },
    shifts: [] as Array<Record<string, unknown>>,
    workingCopy: {
      version: 5,
      basePublishedVersion: 3,
      payloadVersion: 1,
      payload: {
        eventStartsAt: eventStartsAt.toISOString(),
        eventEndsAt: eventEndsAt.toISOString(),
        slots,
      },
      createdAt: new Date("2026-09-02T11:00:00.000Z"),
      updatedAt: new Date("2026-09-02T12:00:00.000Z"),
      updatedById: "staff-1",
    },
  };
}

function liveAssignment(bookingCount: number) {
  return {
    id: "assignment-1",
    userId: "student-1",
    status: "DIRECT_ASSIGNED",
    callStartsAt: null,
    callEndsAt: null,
    callNote: null,
    trades: [],
    _count: { bookings: bookingCount },
  };
}

function groupWithLiveAssignment(storedBookingCount: number, liveBookingCount: number) {
  const live = group([slot({
    assignment: {
      ...slot().assignment,
      bookingCount: storedBookingCount,
    },
  })]);
  live.shifts = [{
    id: "shift-1",
    createdAt: eventStartsAt,
    area: "VIDEO",
    workerType: "ST",
    startsAt: eventStartsAt,
    endsAt: eventEndsAt,
    callStartsAt: null,
    callEndsAt: null,
    notes: null,
    _count: { assignments: 1 },
    assignments: [liveAssignment(liveBookingCount)],
  }];
  return live;
}

const assignee = {
  id: "student-1",
  active: true,
  staffingType: "ST",
  availabilityBlocks: [],
};

function conflictWindows() {
  return mocks.checkTimeConflict.mock.calls.map(([, , startsAt, endsAt]) => ({
    startsAt: (startsAt as Date).toISOString(),
    endsAt: (endsAt as Date).toISOString(),
  }));
}

describe("working-copy call-window validation", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.findGroup.mockResolvedValue(group([slot()]));
    mocks.findUser.mockResolvedValue(assignee);
    mocks.findUsers.mockResolvedValue([assignee]);
    mocks.findSportConfig.mockResolvedValue(null);
    mocks.findAssignments.mockResolvedValue([]);
    mocks.findTrades.mockResolvedValue([]);
    mocks.updateWorkingCopy.mockResolvedValue({ count: 1 });
    mocks.checkTimeConflict.mockResolvedValue(undefined);
    mocks.createAuditEntryTx.mockResolvedValue(undefined);
  });

  it("rechecks a cleared personal override against the slot call window", async () => {
    await mutateWorkingSchedule(
      "group-1",
      5,
      { type: "setCallWindow", slotKey: "shift-1", callStartsAt: null, callEndsAt: null },
      actor,
    );

    // Clearing the personal override leaves the slot's own 17:00-22:00 window
    // in force, so that — not the raw 18:00-21:00 shift window — is what the
    // worker actually gets and what conflict detection must evaluate.
    expect(conflictWindows()).toEqual([{
      startsAt: "2026-10-06T17:00:00.000Z",
      endsAt: "2026-10-06T22:00:00.000Z",
    }]);
  });

  it("rechecks a cleared all-slot call window against the shift window", async () => {
    await mutateWorkingSchedule(
      "group-1",
      5,
      { type: "setCallWindowForAll", callStartsAt: null, callEndsAt: null },
      actor,
    );

    // setCallWindowForAll wipes the slot window and every personal override, so
    // each worker falls all the way back to the shift's own 18:00-21:00 window.
    expect(conflictWindows()).toEqual([{
      startsAt: "2026-10-06T18:00:00.000Z",
      endsAt: "2026-10-06T21:00:00.000Z",
    }]);
  });

  it("blocks an all-slot clear that drops a student into approved time off", async () => {
    mocks.findUsers.mockResolvedValue([{
      ...assignee,
      // Institution-local 13:00-13:30 on event day. The shift window
      // (18:00-21:00Z = 13:00-16:00 local) overlaps this; the personal override
      // being cleared (19:00-20:00Z = 14:00-15:00 local) does not. So the block
      // only bites once the clear drops the worker back to the shift window.
      availabilityBlocks: [{
        kind: "AD_HOC",
        intent: "TIME_OFF",
        status: "APPROVED",
        dayOfWeek: null,
        date: new Date("2026-10-06T00:00:00.000Z"),
        startsAt: "13:00",
        endsAt: "13:30",
        label: "Family trip",
        semesterLabel: null,
        semesterStartsOn: null,
        semesterEndsOn: null,
      }],
    }]);

    await expect(mutateWorkingSchedule(
      "group-1",
      5,
      { type: "setCallWindowForAll", callStartsAt: null, callEndsAt: null },
      actor,
    )).rejects.toMatchObject({ status: 409 });

    expect(mocks.updateWorkingCopy).not.toHaveBeenCalled();
  });

  it("still checks an explicit all-slot call window", async () => {
    await mutateWorkingSchedule(
      "group-1",
      5,
      {
        type: "setCallWindowForAll",
        callStartsAt: "2026-10-06T16:00:00.000Z",
        callEndsAt: "2026-10-06T23:00:00.000Z",
      },
      actor,
    );

    expect(conflictWindows()).toEqual([{
      startsAt: "2026-10-06T16:00:00.000Z",
      endsAt: "2026-10-06T23:00:00.000Z",
    }]);
  });

  it("ignores a canceled booking left in an older working-copy snapshot", async () => {
    mocks.findGroup.mockResolvedValue(groupWithLiveAssignment(1, 0));

    await expect(mutateWorkingSchedule(
      "group-1",
      5,
      { type: "unassign", slotKey: "shift-1" },
      actor,
    )).resolves.toBeDefined();

    const writtenPayload = mocks.updateWorkingCopy.mock.calls[0]?.[0]?.data?.payload as {
      slots: Array<{ assignment: unknown }>;
    };
    expect(writtenPayload.slots[0]?.assignment).toBeNull();
    expect(mocks.findGroup).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        shifts: expect.objectContaining({
          select: expect.objectContaining({
            assignments: expect.objectContaining({
              select: expect.objectContaining({
                _count: {
                  select: {
                    bookings: {
                      where: { status: { in: ["BOOKED", "PENDING_PICKUP", "OPEN"] } },
                    },
                  },
                },
              }),
            }),
          }),
        }),
      }),
    }));
  });

  it("still blocks unassign when the live assignment has an active booking", async () => {
    mocks.findGroup.mockResolvedValue(groupWithLiveAssignment(0, 1));

    await expect(mutateWorkingSchedule(
      "group-1",
      5,
      { type: "unassign", slotKey: "shift-1" },
      actor,
    )).rejects.toThrow("Unlink the assignment's booking before unassigning this person.");
    expect(mocks.updateWorkingCopy).not.toHaveBeenCalled();
  });
});
