import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectSerializableIsolation } from "./_helpers/assert-transaction";
import type { WorkingSchedulePayload } from "@/lib/schedule-working-copy";

const transactionCalls: Array<{ options: unknown }> = [];

vi.mock("@/lib/db", () => {
  const mockTx = {
    shiftGroup: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    shiftAssignment: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    shift: {
      update: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    shiftGroupWorkingCopy: {
      deleteMany: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
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
import {
  acknowledgeShiftAssignment,
  buildSchedulePublicationSnapshot,
  getAffectedPublishedScheduleWorkerIds,
  getSchedulePublicationState,
  publishShiftGroup,
} from "@/lib/services/schedule-publication";

const mockTx = (db as typeof db & {
  _mockTx: {
    shiftGroup: {
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    shiftAssignment: {
      findUnique: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
    shift: {
      update: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
    };
    shiftGroupWorkingCopy: {
      deleteMany: ReturnType<typeof vi.fn>;
    };
    user: {
      findMany: ReturnType<typeof vi.fn>;
    };
  };
})._mockTx;

function shift(overrides: Record<string, unknown> = {}) {
  return {
    id: "shift-1",
    area: "VIDEO",
    workerType: "ST",
    startsAt: new Date("2026-10-06T18:00:00.000Z"),
    endsAt: new Date("2026-10-06T21:00:00.000Z"),
    callStartsAt: null,
    callEndsAt: null,
    assignments: [
      {
        id: "assignment-1",
        userId: "user-1",
        status: "DIRECT_ASSIGNED",
        callStartsAt: null,
        callEndsAt: null,
        callNote: null,
        acknowledgedAt: null,
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  transactionCalls.length = 0;
  vi.clearAllMocks();
  mockTx.shiftAssignment.findMany.mockResolvedValue([]);
});

describe("schedule publication state", () => {
  it("only marks an added worker when Staff event windows are normalized", () => {
    const staffShift = (shiftId: string, userId: string, startsAt: string, endsAt: string) => ({
      shiftId,
      area: "VIDEO",
      workerType: "FT",
      startsAt,
      endsAt,
      callStartsAt: null,
      callEndsAt: null,
      assignments: [{
        id: `assignment-${shiftId}`,
        userId,
        status: "DIRECT_ASSIGNED",
        callStartsAt: null,
        callEndsAt: null,
        callNote: null,
      }],
    });
    const previous = {
      shifts: [
        staffShift("shift-1", "user-1", "2026-10-06T17:00:00.000Z", "2026-10-06T21:00:00.000Z"),
        staffShift("shift-2", "user-2", "2026-10-06T17:00:00.000Z", "2026-10-06T21:00:00.000Z"),
        staffShift("shift-3", "user-3", "2026-10-06T17:00:00.000Z", "2026-10-06T21:00:00.000Z"),
        staffShift("shift-4", "user-4", "2026-10-06T17:00:00.000Z", "2026-10-06T21:00:00.000Z"),
      ],
    };
    const current = {
      shifts: [
        staffShift("shift-1", "user-1", "2026-10-06T18:00:00.000Z", "2026-10-06T20:00:00.000Z"),
        staffShift("shift-2", "user-2", "2026-10-06T18:00:00.000Z", "2026-10-06T20:00:00.000Z"),
        staffShift("shift-3", "user-3", "2026-10-06T18:00:00.000Z", "2026-10-06T20:00:00.000Z"),
        staffShift("shift-4", "user-4", "2026-10-06T18:00:00.000Z", "2026-10-06T20:00:00.000Z"),
        staffShift("shift-5", "user-5", "2026-10-06T18:00:00.000Z", "2026-10-06T20:00:00.000Z"),
      ],
    };

    expect(getAffectedPublishedScheduleWorkerIds(previous, current)).toEqual(["user-5"]);
  });

  it("ignores legacy acknowledgement fields when computing schedule state", () => {
    const snapshot = buildSchedulePublicationSnapshot({ shifts: [shift()] });

    const state = getSchedulePublicationState({
      publishedAt: new Date("2026-10-01T12:00:00.000Z"),
      publishedById: "staff-1",
      lastPublishedSnapshot: snapshot,
      shifts: [
        shift({
          assignments: [
            {
              id: "assignment-1",
              userId: "user-1",
              status: "DIRECT_ASSIGNED",
              callStartsAt: null,
              callEndsAt: null,
              callNote: null,
              acknowledgedAt: new Date("2026-10-01T12:01:00.000Z"),
            },
          ],
        }),
      ],
    });

    expect(state).toEqual({
      status: "published",
      publishedAt: "2026-10-01T12:00:00.000Z",
      publishedById: "staff-1",
      changedAfterPublish: false,
      activeAssignmentCount: 1,
      acknowledgedCount: 0,
      unacknowledgedCount: 0,
    });
  });

  it("does not expose acknowledgement readiness after a later group release", () => {
    const unchanged = shift({
      assignments: [{
        id: "assignment-1",
        userId: "user-1",
        status: "DIRECT_ASSIGNED",
        callStartsAt: null,
        callEndsAt: null,
        callNote: null,
        acknowledgedAt: new Date("2026-10-01T12:05:00.000Z"),
      }],
    });
    const snapshot = buildSchedulePublicationSnapshot({ shifts: [unchanged] });

    const state = getSchedulePublicationState({
      publishedAt: new Date("2026-10-02T12:00:00.000Z"),
      publishedById: "staff-1",
      lastPublishedSnapshot: snapshot,
      shifts: [unchanged],
    });

    expect(state.acknowledgedCount).toBe(0);
    expect(state.unacknowledgedCount).toBe(0);
  });

  it("marks a group changed when the worker-facing assignment snapshot differs", () => {
    const snapshot = buildSchedulePublicationSnapshot({ shifts: [shift()] });

    const state = getSchedulePublicationState({
      publishedAt: new Date("2026-10-01T12:00:00.000Z"),
      publishedById: "staff-1",
      lastPublishedSnapshot: snapshot,
      shifts: [
        shift({
          assignments: [
            {
              id: "assignment-1",
              userId: "user-2",
              status: "DIRECT_ASSIGNED",
              callStartsAt: null,
              callEndsAt: null,
              callNote: null,
              acknowledgedAt: null,
            },
          ],
        }),
      ],
    });

    expect(state.status).toBe("changed");
    expect(state.changedAfterPublish).toBe(true);
  });
});

describe("publishShiftGroup", () => {
  it("stores the current snapshot in a serializable transaction", async () => {
    const group = {
      id: "group-1",
      publishedAt: null,
      publishedById: null,
      lastPublishedSnapshot: null,
      shifts: [shift()],
    };
    mockTx.shiftGroup.findUnique.mockResolvedValue(group);
    mockTx.shiftGroup.update.mockImplementation(async ({ data }) => ({
      ...group,
      publishedAt: data.publishedAt,
      publishedById: data.publishedById,
      lastPublishedSnapshot: data.lastPublishedSnapshot,
    }));

    const result = await publishShiftGroup("group-1", "staff-1");

    expectSerializableIsolation(transactionCalls, 0);
    expect(mockTx.shiftGroup.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "group-1" },
      data: expect.objectContaining({
        publishedById: "staff-1",
        lastPublishedSnapshot: expect.objectContaining({ shifts: expect.any(Array) }),
      }),
    }));
    expect(result.before.status).toBe("draft");
    expect(result.after.status).toBe("published");
  });

  it("clears pending notification state for a silent backfill publish", async () => {
    const group = {
      id: "group-1",
      publishedAt: new Date("2026-08-25T20:00:00.000Z"),
      publishedById: "staff-1",
      publishedVersion: 4,
      lastPublishedSnapshot: null,
      shifts: [shift()],
    };
    mockTx.shiftGroup.findUnique.mockResolvedValue(group);
    mockTx.shiftGroup.update.mockImplementation(async ({ data }) => ({
      ...group,
      publishedAt: data.publishedAt,
      publishedById: data.publishedById,
      lastPublishedSnapshot: data.lastPublishedSnapshot,
    }));

    await publishShiftGroup("group-1", "staff-1", undefined, undefined, { clearNotificationPending: true });

    expect(mockTx.shiftGroup.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        notifyAfter: null,
        notifyAttemptedAt: expect.any(Date),
        notifyError: null,
      }),
    }));
  });

  it("retries one serialization conflict before returning a publish result", async () => {
    const group = {
      id: "group-1",
      publishedAt: null,
      publishedById: null,
      lastPublishedSnapshot: null,
      shifts: [shift()],
    };
    mockTx.shiftGroup.findUnique.mockResolvedValue(group);
    mockTx.shiftGroup.update.mockImplementation(async ({ data }) => ({
      ...group,
      publishedAt: data.publishedAt,
      publishedById: data.publishedById,
      lastPublishedSnapshot: data.lastPublishedSnapshot,
    }));
    vi.mocked(db.$transaction).mockRejectedValueOnce({ code: "P2034" });

    const result = await publishShiftGroup("group-1", "staff-1");

    expect(vi.mocked(db.$transaction)).toHaveBeenCalledTimes(2);
    expect(result.after.status).toBe("published");
  });

  it("reconciles an empty working slot and removes the draft in the publish transaction", async () => {
    const currentShift = {
      ...shift(),
      notes: null,
      assignments: [],
      _count: { assignments: 0 },
    };
    const group = {
      id: "group-1",
      publishedAt: new Date("2026-10-01T12:00:00.000Z"),
      publishedById: "staff-1",
      publishedVersion: 1,
      lastPublishedSnapshot: buildSchedulePublicationSnapshot({ shifts: [currentShift] }),
      workingCopy: {
        version: 2,
        basePublishedVersion: 1,
        payload: {
          eventStartsAt: "2026-10-06T18:00:00.000Z",
          eventEndsAt: "2026-10-06T21:00:00.000Z",
          slots: [
            {
              key: "shift-1",
              sourceShiftId: "shift-1",
              area: "VIDEO",
              workerType: "ST",
              startsAt: "2026-10-06T18:00:00.000Z",
              endsAt: "2026-10-06T21:00:00.000Z",
              callStartsAt: null,
              callEndsAt: null,
              notes: null,
              assignmentHistoryCount: 0,
              assignment: null,
            },
            {
              key: "draft:new",
              sourceShiftId: null,
              area: "PHOTO",
              workerType: "FT",
              startsAt: "2026-10-06T18:00:00.000Z",
              endsAt: "2026-10-06T21:00:00.000Z",
              callStartsAt: null,
              callEndsAt: null,
              notes: null,
              assignmentHistoryCount: 0,
              assignment: null,
            },
          ],
        },
      },
      shifts: [currentShift],
    };
    mockTx.shiftGroup.findUnique.mockResolvedValue(group);
    mockTx.shift.update.mockResolvedValue({ id: "shift-1" });
    mockTx.shift.create.mockResolvedValue({ id: "shift-new" });
    mockTx.shiftGroupWorkingCopy.deleteMany.mockResolvedValue({ count: 1 });
    mockTx.shiftGroup.update.mockImplementation(async ({ data }) => ({
      ...group,
      publishedAt: data.publishedAt ?? group.publishedAt,
      publishedById: data.publishedById ?? group.publishedById,
      lastPublishedSnapshot: data.lastPublishedSnapshot ?? group.lastPublishedSnapshot,
    }));

    const result = await publishShiftGroup("group-1", "staff-1", 2);

    expectSerializableIsolation(transactionCalls, 0);
    expect(mockTx.shift.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ area: "PHOTO", workerType: "FT" }),
    }));
    expect(mockTx.shiftGroupWorkingCopy.deleteMany).toHaveBeenCalledWith({
      where: { shiftGroupId: "group-1", version: 2 },
    });
    expect(result.workingVersion).toBe(2);
  });

  it("revalidates and persists an assigned personal call-window change on publish", async () => {
    const currentAssignment = {
      id: "assignment-1",
      userId: "user-1",
      status: "DIRECT_ASSIGNED",
      callStartsAt: null,
      callEndsAt: null,
      callNote: null,
      acknowledgedAt: new Date("2026-10-01T12:05:00.000Z"),
      trades: [],
      _count: { bookings: 0 },
    };
    const currentShift = {
      ...shift({ assignments: [currentAssignment] }),
      notes: null,
      _count: { assignments: 1 },
    };
    const workingSlot = {
      key: "shift-1",
      sourceShiftId: "shift-1",
      area: "VIDEO",
      workerType: "ST",
      startsAt: "2026-10-06T18:00:00.000Z",
      endsAt: "2026-10-06T21:00:00.000Z",
      callStartsAt: null,
      callEndsAt: null,
      notes: null,
      assignmentHistoryCount: 1,
      assignment: {
        sourceAssignmentId: "assignment-1",
        userId: "user-1",
        status: "DIRECT_ASSIGNED",
        callStartsAt: "2026-10-06T17:00:00.000Z",
        callEndsAt: "2026-10-06T22:00:00.000Z",
        callNote: null,
        activeTradeId: null,
        bookingCount: 0,
      },
    };
    const group = {
      id: "group-1",
      publishedAt: new Date("2026-10-01T12:00:00.000Z"),
      publishedById: "staff-1",
      publishedVersion: 1,
      lastPublishedSnapshot: buildSchedulePublicationSnapshot({ shifts: [currentShift] }),
      workingCopy: {
        version: 2,
        basePublishedVersion: 1,
        payload: {
          eventStartsAt: "2026-10-06T18:00:00.000Z",
          eventEndsAt: "2026-10-06T21:00:00.000Z",
          slots: [workingSlot],
        },
      },
      shifts: [currentShift],
    };
    const updatedShift = {
      ...currentShift,
      assignments: [{
        ...currentAssignment,
        callStartsAt: new Date(workingSlot.assignment.callStartsAt),
        callEndsAt: new Date(workingSlot.assignment.callEndsAt),
        acknowledgedAt: null,
      }],
    };
    mockTx.shiftGroup.findUnique
      .mockResolvedValueOnce(group)
      .mockResolvedValueOnce({ ...group, shifts: [updatedShift] });
    mockTx.user.findMany.mockResolvedValue([{
      id: "user-1",
      active: true,
      staffingType: "ST",
      availabilityBlocks: [],
    }]);
    mockTx.shift.update.mockResolvedValue({ id: "shift-1" });
    mockTx.shiftAssignment.update.mockResolvedValue({ id: "assignment-1" });
    mockTx.shiftGroupWorkingCopy.deleteMany.mockResolvedValue({ count: 1 });
    mockTx.shiftGroup.update.mockImplementation(async ({ data }) => ({
      ...group,
      shifts: [updatedShift],
      publishedAt: data.publishedAt ?? group.publishedAt,
      publishedById: data.publishedById ?? group.publishedById,
      lastPublishedSnapshot: data.lastPublishedSnapshot ?? group.lastPublishedSnapshot,
    }));

    const result = await publishShiftGroup("group-1", "staff-1", 2);

    expect(mockTx.shiftAssignment.update).toHaveBeenCalledWith({
      where: { id: "assignment-1" },
      data: {
        callStartsAt: new Date("2026-10-06T17:00:00.000Z"),
        callEndsAt: new Date("2026-10-06T22:00:00.000Z"),
        callNote: null,
        acknowledgedAt: null,
        acknowledgedById: null,
      },
    });
    expect(result.affectedUserIds).toEqual(["user-1"]);
  });

  it("publishes an explicit assigned-slot conversion by declining the old assignment and creating the replacement", async () => {
    const currentAssignment = {
      id: "assignment-1",
      userId: "user-1",
      status: "DIRECT_ASSIGNED",
      callStartsAt: null,
      callEndsAt: null,
      callNote: null,
      acknowledgedAt: new Date("2026-10-01T12:05:00.000Z"),
      trades: [],
      _count: { bookings: 0 },
    };
    const currentShift = {
      ...shift({ assignments: [currentAssignment] }),
      notes: null,
      _count: { assignments: 1 },
    };
    const replacementAssignment = {
      id: "assignment-2",
      userId: "user-2",
      status: "DIRECT_ASSIGNED",
      callStartsAt: null,
      callEndsAt: null,
      callNote: null,
      acknowledgedAt: null,
    };
    const workingSlot = {
      key: "shift-1",
      sourceShiftId: "shift-1",
      area: "VIDEO",
      workerType: "FT",
      startsAt: "2026-10-06T18:00:00.000Z",
      endsAt: "2026-10-06T21:00:00.000Z",
      callStartsAt: null,
      callEndsAt: null,
      notes: null,
      assignmentHistoryCount: 1,
      assignment: {
        sourceAssignmentId: null,
        userId: "user-2",
        status: "DIRECT_ASSIGNED",
        callStartsAt: null,
        callEndsAt: null,
        callNote: null,
        activeTradeId: null,
        bookingCount: 0,
      },
    };
    const group = {
      id: "group-1",
      publishedAt: new Date("2026-10-01T12:00:00.000Z"),
      publishedById: "staff-1",
      publishedVersion: 1,
      lastPublishedSnapshot: buildSchedulePublicationSnapshot({ shifts: [currentShift] }),
      workingCopy: {
        version: 2,
        basePublishedVersion: 1,
        payload: {
          eventStartsAt: "2026-10-06T18:00:00.000Z",
          eventEndsAt: "2026-10-06T21:00:00.000Z",
          slots: [workingSlot],
        },
      },
      shifts: [currentShift],
    };
    const updatedShift = {
      ...currentShift,
      workerType: "FT",
      assignments: [replacementAssignment],
    };
    mockTx.shiftGroup.findUnique
      .mockResolvedValueOnce(group)
      .mockResolvedValueOnce({ ...group, shifts: [updatedShift] });
    mockTx.user.findMany.mockResolvedValue([{
      id: "user-2",
      active: true,
      staffingType: "FT",
      availabilityBlocks: [],
    }]);
    mockTx.shift.update.mockResolvedValue({ id: "shift-1" });
    mockTx.shiftAssignment.update.mockResolvedValue({ id: "assignment-1" });
    mockTx.shiftAssignment.create.mockResolvedValue({ id: "assignment-2" });
    mockTx.shiftGroupWorkingCopy.deleteMany.mockResolvedValue({ count: 1 });
    mockTx.shiftGroup.update.mockImplementation(async ({ data }) => ({
      ...group,
      shifts: [updatedShift],
      publishedAt: data.publishedAt ?? group.publishedAt,
      publishedById: data.publishedById ?? group.publishedById,
      lastPublishedSnapshot: data.lastPublishedSnapshot ?? group.lastPublishedSnapshot,
    }));

    await publishShiftGroup("group-1", "staff-1", 2);

    expect(mockTx.shiftAssignment.update).toHaveBeenCalledWith({
      where: { id: "assignment-1" },
      data: {
        status: "DECLINED",
        acknowledgedAt: null,
        acknowledgedById: null,
      },
    });
    expect(mockTx.shiftAssignment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        shiftId: "shift-1",
        userId: "user-2",
        status: "DIRECT_ASSIGNED",
        assignedBy: "staff-1",
      }),
    });
  });

  it("publishes an assigned draft-only slot after creating its relational shift", async () => {
    const currentShift = {
      ...shift({ assignments: [] }),
      notes: null,
      _count: { assignments: 0 },
    };
    const group = {
      id: "group-1",
      publishedAt: new Date("2026-10-01T12:00:00.000Z"),
      publishedById: "staff-1",
      publishedVersion: 1,
      lastPublishedSnapshot: buildSchedulePublicationSnapshot({ shifts: [currentShift] }),
      workingCopy: {
        version: 2,
        basePublishedVersion: 1,
        payload: {
          eventStartsAt: "2026-10-06T18:00:00.000Z",
          eventEndsAt: "2026-10-06T21:00:00.000Z",
          slots: [{
            key: "shift-1",
            sourceShiftId: "shift-1",
            area: "VIDEO",
            workerType: "ST",
            startsAt: "2026-10-06T18:00:00.000Z",
            endsAt: "2026-10-06T21:00:00.000Z",
            callStartsAt: null,
            callEndsAt: null,
            notes: null,
            assignmentHistoryCount: 0,
            assignment: null,
          }, {
            key: "draft:assigned",
            sourceShiftId: null,
            area: "PHOTO",
            workerType: "FT",
            startsAt: "2026-10-06T18:00:00.000Z",
            endsAt: "2026-10-06T21:00:00.000Z",
            callStartsAt: null,
            callEndsAt: null,
            notes: null,
            assignmentHistoryCount: 0,
            assignment: {
              sourceAssignmentId: null,
              userId: "user-1",
              status: "DIRECT_ASSIGNED",
              callStartsAt: null,
              callEndsAt: null,
              callNote: "Bring the wireless kit",
              activeTradeId: null,
              bookingCount: 0,
            },
          }],
        },
      },
      shifts: [currentShift],
    };
    mockTx.shiftGroup.findUnique
      .mockResolvedValueOnce(group)
      .mockResolvedValueOnce(group);
    mockTx.shift.create.mockResolvedValue({ id: "shift-new" });
    mockTx.shiftAssignment.updateMany.mockResolvedValue({ count: 0 });
    mockTx.shiftAssignment.create.mockResolvedValue({ id: "assignment-new" });
    mockTx.user.findMany.mockResolvedValue([{
      id: "user-1",
      active: true,
      staffingType: "FT",
      availabilityBlocks: [],
    }]);
    mockTx.shiftGroupWorkingCopy.deleteMany.mockResolvedValue({ count: 1 });
    mockTx.shiftGroup.update.mockImplementation(async ({ data }) => ({
      ...group,
      publishedAt: data.publishedAt ?? group.publishedAt,
      publishedById: data.publishedById ?? group.publishedById,
      lastPublishedSnapshot: data.lastPublishedSnapshot ?? group.lastPublishedSnapshot,
    }));

    const result = await publishShiftGroup("group-1", "staff-1", 2);

    expect(mockTx.shift.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ area: "PHOTO", workerType: "FT" }),
    }));
    expect(mockTx.shiftAssignment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        shiftId: "shift-new",
        userId: "user-1",
        callNote: "Bring the wireless kit",
      }),
    }));
    expect(result.affectedUserIds).toEqual(["user-1"]);
  });

  it("notifies only the added worker when existing Staff assignments keep their schedule", async () => {
    const eventStartsAt = "2026-10-06T18:00:00.000Z";
    const eventEndsAt = "2026-10-06T20:00:00.000Z";
    const currentShifts = ["user-1", "user-2", "user-3", "user-4"].map((userId, index) => ({
      ...shift({ id: `shift-${index + 1}`, workerType: "FT" }),
      createdAt: new Date("2026-09-01T12:00:00.000Z"),
      startsAt: new Date("2026-10-06T17:00:00.000Z"),
      endsAt: new Date("2026-10-06T21:00:00.000Z"),
      notes: null,
      _count: { assignments: 1 },
      assignments: [{
        id: `assignment-${index + 1}`,
        userId,
        status: "DIRECT_ASSIGNED",
        callStartsAt: null,
        callEndsAt: null,
        callNote: null,
        acknowledgedAt: null,
        trades: [],
        _count: { bookings: 0 },
      }],
    }));
    const addedShift = {
      ...shift({ id: "shift-5", workerType: "FT" }),
      createdAt: new Date("2026-09-01T12:00:00.000Z"),
      startsAt: new Date(eventStartsAt),
      endsAt: new Date(eventEndsAt),
      notes: null,
      _count: { assignments: 1 },
      assignments: [{
        id: "assignment-5",
        userId: "user-5",
        status: "DIRECT_ASSIGNED",
        callStartsAt: null,
        callEndsAt: null,
        callNote: null,
        acknowledgedAt: null,
        trades: [],
        _count: { bookings: 0 },
      }],
    };
    const workingSlots = currentShifts.map<WorkingSchedulePayload["slots"][number]>((currentShift) => ({
      key: currentShift.id,
      sourceShiftId: currentShift.id,
      area: currentShift.area as WorkingSchedulePayload["slots"][number]["area"],
      workerType: "FT" as const,
      startsAt: eventStartsAt,
      endsAt: eventEndsAt,
      callStartsAt: null,
      callEndsAt: null,
      notes: null,
      assignmentHistoryCount: 1,
      assignment: {
        sourceAssignmentId: currentShift.assignments[0]!.id,
        userId: currentShift.assignments[0]!.userId,
        status: "DIRECT_ASSIGNED" as const,
        callStartsAt: null,
        callEndsAt: null,
        callNote: null,
        activeTradeId: null,
        bookingCount: 0,
      },
    }));
    workingSlots.push({
      key: "draft:shift-5",
      sourceShiftId: null,
      area: "VIDEO",
      workerType: "FT",
      startsAt: eventStartsAt,
      endsAt: eventEndsAt,
      callStartsAt: null,
      callEndsAt: null,
      notes: null,
      assignmentHistoryCount: 0,
      assignment: {
        sourceAssignmentId: null,
        userId: "user-5",
        status: "DIRECT_ASSIGNED",
        callStartsAt: null,
        callEndsAt: null,
        callNote: null,
        activeTradeId: null,
        bookingCount: 0,
      },
    });
    const group = {
      id: "group-1",
      publishedAt: new Date("2026-10-01T12:00:00.000Z"),
      publishedById: "staff-1",
      publishedVersion: 1,
      lastPublishedSnapshot: buildSchedulePublicationSnapshot({ shifts: currentShifts }),
      workingCopy: {
        version: 2,
        basePublishedVersion: 1,
        payload: {
          eventStartsAt,
          eventEndsAt,
          baseShiftIds: currentShifts.map((currentShift) => currentShift.id),
          slots: workingSlots,
        },
      },
      shifts: currentShifts,
    };
    const updatedShifts = currentShifts.map((currentShift) => ({
      ...currentShift,
      startsAt: new Date(eventStartsAt),
      endsAt: new Date(eventEndsAt),
    }));
    updatedShifts.push(addedShift);
    mockTx.shiftGroup.findUnique
      .mockResolvedValueOnce(group)
      .mockResolvedValueOnce({ ...group, shifts: updatedShifts });
    mockTx.user.findMany.mockResolvedValue([
      ...["user-1", "user-2", "user-3", "user-4", "user-5"].map((id) => ({
        id,
        active: true,
        staffingType: "FT",
        availabilityBlocks: [],
      })),
    ]);
    mockTx.shift.update.mockResolvedValue({ id: "shift-1" });
    mockTx.shift.create.mockResolvedValue({ id: "shift-5" });
    mockTx.shiftAssignment.updateMany.mockResolvedValue({ count: 0 });
    mockTx.shiftAssignment.create.mockResolvedValue({ id: "assignment-5" });
    mockTx.shiftGroupWorkingCopy.deleteMany.mockResolvedValue({ count: 1 });
    mockTx.shiftGroup.update.mockImplementation(async ({ data }) => ({
      ...group,
      shifts: updatedShifts,
      publishedAt: data.publishedAt ?? group.publishedAt,
      publishedById: data.publishedById ?? group.publishedById,
      lastPublishedSnapshot: data.lastPublishedSnapshot ?? group.lastPublishedSnapshot,
    }));

    const result = await publishShiftGroup("group-1", "staff-1", 2);

    expect(result.affectedUserIds).toEqual(["user-5"]);
  });
});

describe("acknowledgeShiftAssignment", () => {
  it("allows only the assigned worker to acknowledge a published active assignment", async () => {
    mockTx.shiftAssignment.findUnique.mockResolvedValue({
      id: "assignment-1",
      userId: "user-1",
      status: "DIRECT_ASSIGNED",
      acknowledgedAt: null,
      shift: { shiftGroup: { id: "group-1", publishedAt: new Date("2026-10-01T12:00:00.000Z") } },
    });
    mockTx.shiftAssignment.update.mockResolvedValue({
      id: "assignment-1",
      shiftId: "shift-1",
      userId: "user-1",
      status: "DIRECT_ASSIGNED",
      acknowledgedAt: new Date("2026-10-01T12:05:00.000Z"),
      acknowledgedById: "user-1",
    });

    const result = await acknowledgeShiftAssignment("assignment-1", { id: "user-1", role: "STUDENT" });

    expectSerializableIsolation(transactionCalls, 0);
    expect(result.after.acknowledgedById).toBe("user-1");
  });

  it("rejects acknowledgement by a different user", async () => {
    mockTx.shiftAssignment.findUnique.mockResolvedValue({
      id: "assignment-1",
      userId: "user-1",
      status: "DIRECT_ASSIGNED",
      acknowledgedAt: null,
      shift: { shiftGroup: { id: "group-1", publishedAt: new Date("2026-10-01T12:00:00.000Z") } },
    });

    await expect(acknowledgeShiftAssignment("assignment-1", { id: "user-2", role: "STUDENT" }))
      .rejects
      .toMatchObject({ status: 403 });
  });
});

describe("publishShiftGroup drift detection", () => {
  const draftStartedAt = new Date("2026-08-05T02:17:21.000Z");

  function liveShift(id: string, createdAt: Date, assigned: boolean) {
    return {
      id,
      createdAt,
      area: "VIDEO",
      workerType: "FT",
      startsAt: new Date("2026-08-05T17:00:00.000Z"),
      endsAt: new Date("2026-08-05T21:00:00.000Z"),
      callStartsAt: null,
      callEndsAt: null,
      notes: null,
      _count: { assignments: assigned ? 1 : 0 },
      assignments: assigned
        ? [{
          id: `assignment-${id}`,
          userId: `user-${id}`,
          status: "DIRECT_ASSIGNED",
          callStartsAt: null,
          callEndsAt: null,
          callNote: null,
          acknowledgedAt: null,
          trades: [],
          _count: { bookings: 0 },
        }]
        : [],
    };
  }

  function groupWithDraft(shifts: Array<ReturnType<typeof liveShift>>) {
    return {
      id: "group-1",
      publishedAt: null,
      publishedById: null,
      publishedVersion: 0,
      lastPublishedSnapshot: null,
      workingCopy: {
        version: 7,
        basePublishedVersion: 0,
        createdAt: draftStartedAt,
        // The draft references no live shift, mirroring the production case
        // where every draft slot was a new draft-only slot.
        payload: {
          eventStartsAt: "2026-08-05T18:00:00.000Z",
          eventEndsAt: "2026-08-05T20:00:00.000Z",
          slots: [],
        },
      },
      shifts,
    };
  }

  // Reproduces the real failure: two shifts were added to the live schedule 18
  // minutes after the draft started, so the draft never contained them. Publish
  // used to call them history-bearing slots the user had removed and told them
  // to "add or convert an empty slot" — advice that cannot work, because those
  // slots are not visible in the editor at all.
  it("names post-draft drift instead of blaming a removal the user never made", async () => {
    mockTx.shiftGroup.findUnique.mockResolvedValue(groupWithDraft([
      liveShift("shift-late-1", new Date("2026-08-05T02:35:43.000Z"), true),
      liveShift("shift-late-2", new Date("2026-08-05T02:35:56.000Z"), true),
    ]));

    await expect(publishShiftGroup("group-1", "staff-1", 7)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("2 slots were added to this event's live schedule"),
    });
  });

  it("offers refresh and discard as the ways out", async () => {
    mockTx.shiftGroup.findUnique.mockResolvedValue(groupWithDraft([
      liveShift("shift-late-1", new Date("2026-08-05T02:35:43.000Z"), true),
    ]));

    await expect(publishShiftGroup("group-1", "staff-1", 7)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("Refresh to pull them into this draft"),
    });
  });

  it("still reports a genuine removal of a history-bearing slot", async () => {
    mockTx.shiftGroup.findUnique.mockResolvedValue(groupWithDraft([
      liveShift("shift-old", new Date("2026-08-04T10:00:00.000Z"), true),
    ]));

    await expect(publishShiftGroup("group-1", "staff-1", 7)).rejects.toMatchObject({
      status: 409,
      message: "A history-bearing slot cannot be removed. Add or convert an empty slot instead.",
    });
  });

  it("lets a drift-free draft remove an empty pre-draft slot", async () => {
    const group = groupWithDraft([liveShift("shift-old", new Date("2026-08-04T10:00:00.000Z"), false)]);
    mockTx.shiftGroup.findUnique
      .mockResolvedValueOnce(group)
      .mockResolvedValue({ ...group, shifts: [], workingCopy: null });
    mockTx.shiftAssignment.findMany.mockResolvedValue([]);

    await publishShiftGroup("group-1", "staff-1", 7);

    expect(mockTx.shift.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["shift-old"] } } });
  });
});

describe("publish preflight", () => {
  const draftStartedAt = new Date("2026-08-05T02:17:21.000Z");
  const beforeDraft = new Date("2026-08-04T10:00:00.000Z");

  function shiftRow(id: string, workerType: string, assignment: Record<string, unknown> | null) {
    return {
      id,
      createdAt: beforeDraft,
      area: "VIDEO",
      workerType,
      startsAt: new Date("2026-08-05T17:00:00.000Z"),
      endsAt: new Date("2026-08-05T21:00:00.000Z"),
      callStartsAt: null,
      callEndsAt: null,
      notes: null,
      _count: { assignments: assignment ? 1 : 0 },
      assignments: assignment ? [assignment] : [],
    };
  }

  function slot(key: string, sourceShiftId: string | null, workerType: string, assignment: Record<string, unknown> | null) {
    return {
      key,
      sourceShiftId,
      area: "VIDEO",
      workerType,
      startsAt: "2026-08-05T17:00:00.000Z",
      endsAt: "2026-08-05T21:00:00.000Z",
      callStartsAt: null,
      callEndsAt: null,
      notes: null,
      assignmentHistoryCount: 0,
      assignment,
    };
  }

  function liveAssignment(id: string, userId: string, extra: Record<string, unknown> = {}) {
    return {
      id,
      userId,
      status: "DIRECT_ASSIGNED",
      callStartsAt: null,
      callEndsAt: null,
      callNote: null,
      acknowledgedAt: null,
      trades: [],
      _count: { bookings: 0 },
      ...extra,
    };
  }

  // Two independent problems on two different slots. Publish used to throw on
  // whichever it met first, so staff fixed it, clicked Publish, and met the
  // second. One attempt now reports both.
  it("reports every blocker in one attempt", async () => {
    mockTx.shiftGroup.findUnique.mockResolvedValue({
      id: "group-1",
      publishedAt: null,
      publishedById: null,
      publishedVersion: 0,
      lastPublishedSnapshot: null,
      workingCopy: {
        version: 3,
        basePublishedVersion: 0,
        createdAt: draftStartedAt,
        payload: {
          eventStartsAt: "2026-08-05T17:00:00.000Z",
          eventEndsAt: "2026-08-05T21:00:00.000Z",
          slots: [
            // Replacing a worker whose assignment is posted for trade.
            slot("shift-traded", "shift-traded", "FT",
              { sourceAssignmentId: null, userId: "replacement", status: "DIRECT_ASSIGNED",
                callStartsAt: null, callEndsAt: null, callNote: null, activeTradeId: null, bookingCount: 0 }),
            // Replacing a worker whose assignment still has gear linked.
            slot("shift-booked", "shift-booked", "FT",
              { sourceAssignmentId: null, userId: "replacement-2", status: "DIRECT_ASSIGNED",
                callStartsAt: null, callEndsAt: null, callNote: null, activeTradeId: null, bookingCount: 0 }),
          ],
        },
      },
      shifts: [
        shiftRow("shift-traded", "FT", liveAssignment("assignment-1", "poster", { trades: [{ id: "trade-1" }] })),
        shiftRow("shift-booked", "FT", liveAssignment("assignment-2", "booker", { _count: { bookings: 2 } })),
      ],
    });
    mockTx.user.findMany.mockResolvedValue([
      { id: "replacement", name: "Rep One", active: true, staffingType: "FT", availabilityBlocks: [] },
      { id: "replacement-2", name: "Rep Two", active: true, staffingType: "FT", availabilityBlocks: [] },
    ]);
    mockTx.shiftAssignment.findMany.mockResolvedValue([]);

    const error = await publishShiftGroup("group-1", "staff-1", 3).catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 409, message: expect.stringContaining("2 problems") });
    const codes = ((error as { data: { blockers: Array<{ code: string }> } }).data.blockers).map((b) => b.code);
    expect(codes).toEqual(["active_trade", "linked_booking"]);
    expect(mockTx.shiftGroup.findUnique).toHaveBeenCalledWith(expect.objectContaining({
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

  // A single blocker must keep reading exactly as it did, so existing recovery
  // copy and its tests stay meaningful.
  it("keeps the plain message when only one thing is wrong", async () => {
    mockTx.shiftGroup.findUnique.mockResolvedValue({
      id: "group-1",
      publishedAt: null,
      publishedById: null,
      publishedVersion: 0,
      lastPublishedSnapshot: null,
      workingCopy: {
        version: 3,
        basePublishedVersion: 0,
        createdAt: draftStartedAt,
        payload: {
          eventStartsAt: "2026-08-05T17:00:00.000Z",
          eventEndsAt: "2026-08-05T21:00:00.000Z",
          slots: [
            slot("shift-traded", "shift-traded", "FT",
              { sourceAssignmentId: null, userId: "replacement", status: "DIRECT_ASSIGNED",
                callStartsAt: null, callEndsAt: null, callNote: null, activeTradeId: null, bookingCount: 0 }),
          ],
        },
      },
      shifts: [shiftRow("shift-traded", "FT", liveAssignment("assignment-1", "poster", { trades: [{ id: "trade-1" }] }))],
    });
    mockTx.user.findMany.mockResolvedValue([
      { id: "replacement", name: "Rep One", active: true, staffingType: "FT", availabilityBlocks: [] },
    ]);
    mockTx.shiftAssignment.findMany.mockResolvedValue([]);

    await expect(publishShiftGroup("group-1", "staff-1", 3)).rejects.toMatchObject({
      status: 409,
      message: "Cancel the active trade before publishing this assignment change.",
    });
  });

  // Blockers are gathered before anything is written, so a rejected publish
  // cannot have already created a shift or an assignment.
  it("writes nothing when a blocker is found", async () => {
    mockTx.shiftGroup.findUnique.mockResolvedValue({
      id: "group-1",
      publishedAt: null,
      publishedById: null,
      publishedVersion: 0,
      lastPublishedSnapshot: null,
      workingCopy: {
        version: 3,
        basePublishedVersion: 0,
        createdAt: draftStartedAt,
        payload: {
          eventStartsAt: "2026-08-05T17:00:00.000Z",
          eventEndsAt: "2026-08-05T21:00:00.000Z",
          slots: [
            slot("draft:new", null, "ST",
              { sourceAssignmentId: null, userId: "inactive-person", status: "DIRECT_ASSIGNED",
                callStartsAt: null, callEndsAt: null, callNote: null, activeTradeId: null, bookingCount: 0 }),
          ],
        },
      },
      shifts: [],
    });
    mockTx.user.findMany.mockResolvedValue([
      { id: "inactive-person", name: "Gone", active: false, staffingType: "ST", availabilityBlocks: [] },
    ]);
    mockTx.shiftAssignment.findMany.mockResolvedValue([]);

    await expect(publishShiftGroup("group-1", "staff-1", 3)).rejects.toMatchObject({ status: 409 });

    expect(mockTx.shift.create).not.toHaveBeenCalled();
    expect(mockTx.shiftAssignment.create).not.toHaveBeenCalled();
  });

  it("does not report a same-person staged replacement as a time conflict", async () => {
    const currentShift = shiftRow("shift-video", "FT", liveAssignment("assignment-maddy", "maddy"));
    const group = {
      id: "group-1",
      publishedAt: new Date("2026-08-01T12:00:00.000Z"),
      publishedById: "staff-1",
      publishedVersion: 1,
      lastPublishedSnapshot: null,
      workingCopy: {
        version: 3,
        basePublishedVersion: 1,
        createdAt: draftStartedAt,
        payload: {
          eventStartsAt: "2026-08-05T17:00:00.000Z",
          eventEndsAt: "2026-08-05T21:00:00.000Z",
          slots: [slot("shift-video", "shift-video", "FT", {
            sourceAssignmentId: null,
            userId: "maddy",
            status: "DIRECT_ASSIGNED",
            callStartsAt: null,
            callEndsAt: null,
            callNote: null,
            activeTradeId: null,
            bookingCount: 0,
          })],
        },
      },
      shifts: [currentShift],
    };
    mockTx.shiftGroup.findUnique
      .mockResolvedValueOnce(group)
      .mockResolvedValueOnce({ ...group, workingCopy: null });
    mockTx.shiftGroup.update.mockImplementation(async ({ data }) => ({
      ...group,
      publishedAt: data.publishedAt,
      publishedById: data.publishedById,
      publishedVersion: 2,
      lastPublishedSnapshot: data.lastPublishedSnapshot,
      workingCopy: null,
    }));
    mockTx.shiftGroupWorkingCopy.deleteMany.mockResolvedValue({ count: 1 });

    await expect(publishShiftGroup("group-1", "staff-1", 3)).resolves.toMatchObject({
      workingVersion: 3,
    });

    expect(mockTx.shiftAssignment.update).not.toHaveBeenCalled();
    expect(mockTx.shiftAssignment.create).not.toHaveBeenCalled();
  });
});

describe("publish drift uses the recorded base shift set", () => {
  const draftStartedAt = new Date("2026-08-05T02:17:21.000Z");
  const afterDraft = new Date("2026-08-05T02:35:43.000Z");

  function shiftRow(id: string, createdAt: Date) {
    return {
      id,
      createdAt,
      area: "VIDEO",
      workerType: "FT",
      startsAt: new Date("2026-08-05T17:00:00.000Z"),
      endsAt: new Date("2026-08-05T21:00:00.000Z"),
      callStartsAt: null,
      callEndsAt: null,
      notes: null,
      _count: { assignments: 0 },
      assignments: [],
    };
  }

  function groupWith(payload: Record<string, unknown>, shifts: unknown[]) {
    return {
      id: "group-1",
      publishedAt: null,
      publishedById: null,
      publishedVersion: 0,
      lastPublishedSnapshot: null,
      workingCopy: {
        version: 9,
        basePublishedVersion: 0,
        createdAt: draftStartedAt,
        payload: {
          eventStartsAt: "2026-08-05T17:00:00.000Z",
          eventEndsAt: "2026-08-05T21:00:00.000Z",
          slots: [],
          ...payload,
        },
      },
      shifts,
    };
  }

  it("treats a shift outside the recorded base as drift", async () => {
    mockTx.shiftGroup.findUnique.mockResolvedValue(groupWith(
      { baseShiftIds: [] },
      [shiftRow("shift-late", afterDraft)],
    ));

    await expect(publishShiftGroup("group-1", "staff-1", 9)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("added to this event's live schedule"),
    });
  });

  /**
   * The case the createdAt proxy gets wrong. After a refresh adopts a shift
   * that was created after the draft started, removing it is a deliberate
   * removal — but its timestamp still postdates the working copy, so the proxy
   * would call it drift forever and the draft could never be published.
   */
  it("treats a removal of a previously adopted shift as a removal, not drift", async () => {
    mockTx.shiftGroup.findUnique
      .mockResolvedValueOnce(groupWith(
        { baseShiftIds: ["shift-adopted"] },
        [shiftRow("shift-adopted", afterDraft)],
      ))
      .mockResolvedValue({
        ...groupWith({ baseShiftIds: ["shift-adopted"] }, []),
        workingCopy: null,
      });
    mockTx.shiftAssignment.findMany.mockResolvedValue([]);

    await publishShiftGroup("group-1", "staff-1", 9);

    expect(mockTx.shift.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["shift-adopted"] } } });
  });

  it("falls back to the timestamp for drafts written before payloadVersion 2", async () => {
    mockTx.shiftGroup.findUnique.mockResolvedValue(groupWith({}, [shiftRow("shift-late", afterDraft)]));

    await expect(publishShiftGroup("group-1", "staff-1", 9)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("added to this event's live schedule"),
    });
  });
});
