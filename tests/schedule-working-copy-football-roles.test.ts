import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findGroup: vi.fn(),
  findUser: vi.fn(),
  findUsers: vi.fn(),
  findSportConfig: vi.fn(),
  updateWorkingCopy: vi.fn(),
  createWorkingCopy: vi.fn(),
  createAuditEntryTx: vi.fn(),
  checkTimeConflict: vi.fn(),
  transactionOptions: [] as unknown[],
}));

vi.mock("@/lib/db", () => {
  const client = {
    shiftGroup: { findUnique: mocks.findGroup },
    user: { findUnique: mocks.findUser, findMany: mocks.findUsers },
    sportConfig: { findUnique: mocks.findSportConfig },
    shiftGroupWorkingCopy: {
      updateMany: mocks.updateWorkingCopy,
      create: mocks.createWorkingCopy,
    },
  };
  return {
    db: {
      ...client,
      $transaction: (fn: (tx: unknown) => unknown, options: unknown) => {
        mocks.transactionOptions.push(options);
        return fn(client);
      },
    },
  };
});

vi.mock("@/lib/audit", () => ({ createAuditEntryTx: mocks.createAuditEntryTx }));
vi.mock("@/lib/services/shift-assignments", () => ({ checkTimeConflict: mocks.checkTimeConflict }));

import { mutateWorkingSchedule } from "@/lib/services/schedule-working-copy";

const eventStartsAt = new Date("2026-10-06T18:00:00.000Z");
const eventEndsAt = new Date("2026-10-06T21:00:00.000Z");

function group(sportCode = "FB") {
  const assignment = {
    id: "assignment-1",
    userId: "student-1",
    status: "DIRECT_ASSIGNED",
    source: "MANUAL",
    callStartsAt: null,
    callEndsAt: null,
    callNote: null,
    footballRoles: [] as string[],
    trades: [],
    _count: { bookings: 0 },
  };
  return {
    id: "group-1",
    publishedAt: new Date("2026-09-01T12:00:00.000Z"),
    publishedVersion: 3,
    event: {
      id: "event-1",
      startsAt: eventStartsAt,
      endsAt: eventEndsAt,
      allDay: false,
      sportCode,
      opponent: "Miami",
      isHome: true,
    },
    shifts: [{
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
      assignments: [assignment],
    }],
    workingCopy: {
      version: 5,
      basePublishedVersion: 3,
      payloadVersion: 2,
      payload: {
        eventStartsAt: eventStartsAt.toISOString(),
        eventEndsAt: eventEndsAt.toISOString(),
        baseShiftIds: ["shift-1"],
        slots: [{
          key: "shift-1",
          sourceShiftId: "shift-1",
          area: "VIDEO",
          workerType: "ST",
          startsAt: eventStartsAt.toISOString(),
          endsAt: eventEndsAt.toISOString(),
          callStartsAt: null,
          callEndsAt: null,
          notes: null,
          assignmentHistoryCount: 1,
          assignment: {
            sourceAssignmentId: "assignment-1",
            source: "MANUAL",
            userId: "student-1",
            status: "DIRECT_ASSIGNED",
            callStartsAt: null,
            callEndsAt: null,
            callNote: null,
            activeTradeId: null,
            bookingCount: 0,
            footballRoles: [] as string[],
          } as {
            sourceAssignmentId: string;
            source: string;
            userId: string;
            status: string;
            callStartsAt: null;
            callEndsAt: null;
            callNote: null;
            activeTradeId: null;
            bookingCount: number;
            footballRoles: string[];
          } | null,
        }],
      },
      autoReleaseAt: null,
      autoReleaseRunId: null,
      autoReleaseError: null,
      createdAt: new Date("2026-09-02T12:00:00.000Z"),
      updatedAt: new Date("2026-09-02T12:00:00.000Z"),
      updatedById: "admin-1",
    },
  };
}

describe("working-copy Football role mutation", () => {
  beforeEach(() => {
    for (const mock of [
      mocks.findGroup,
      mocks.findUser,
      mocks.findUsers,
      mocks.findSportConfig,
      mocks.updateWorkingCopy,
      mocks.createWorkingCopy,
      mocks.createAuditEntryTx,
      mocks.checkTimeConflict,
    ]) mock.mockReset();
    mocks.transactionOptions.length = 0;
    mocks.findGroup.mockResolvedValue(group());
    mocks.findUsers.mockResolvedValue([{
      id: "student-1",
      name: "Student One",
      role: "STUDENT",
      staffingType: "ST",
      primaryArea: "VIDEO",
      avatarUrl: null,
    }]);
    mocks.findUser.mockResolvedValue({
      id: "student-1",
      name: "Student One",
      active: true,
      hiddenFromRoster: false,
      role: "STUDENT",
      staffingType: "ST",
      collaboratorPolicy: null,
      availabilityBlocks: [],
    });
    mocks.findSportConfig.mockResolvedValue(null);
    mocks.updateWorkingCopy.mockResolvedValue({ count: 1 });
    mocks.createAuditEntryTx.mockResolvedValue(undefined);
  });

  it("writes canonical roles and owns the before/after audit in a serializable transaction", async () => {
    await mutateWorkingSchedule(
      "group-1",
      5,
      { type: "setFootballRoles", slotKey: "shift-1", roles: ["SOCIAL", "SLOW1", "ROAM2"] },
      { id: "admin-1", role: "ADMIN" },
    );

    const written = mocks.updateWorkingCopy.mock.calls[0]?.[0]?.data?.payload as {
      slots: Array<{ assignment: { footballRoles: string[] } | null }>;
    };
    expect(written.slots[0]?.assignment?.footballRoles).toEqual(["SLOW1", "ROAM2", "SOCIAL"]);
    expect(mocks.transactionOptions).toEqual([{ isolationLevel: "Serializable" }]);
    expect(mocks.createAuditEntryTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actorId: "admin-1",
      actorRole: "ADMIN",
      entityType: "shift_group_working_copy",
      entityId: "group-1",
      action: "working_schedule_setFootballRoles",
      before: expect.objectContaining({
        footballRoleChange: { slotKey: "shift-1", roles: [] },
      }),
      after: expect.objectContaining({
        footballRoleChange: { slotKey: "shift-1", roles: ["SLOW1", "ROAM2", "SOCIAL"] },
      }),
    }));
  });

  it("rejects non-admin role edits before writing or auditing", async () => {
    await expect(mutateWorkingSchedule(
      "group-1",
      5,
      { type: "setFootballRoles", slotKey: "shift-1", roles: ["BENCH"] },
      { id: "staff-1", role: "STAFF" },
    )).rejects.toMatchObject({ status: 403 });

    expect(mocks.updateWorkingCopy).not.toHaveBeenCalled();
    expect(mocks.createAuditEntryTx).not.toHaveBeenCalled();
  });

  it("rejects role metadata on non-Football events", async () => {
    mocks.findGroup.mockResolvedValue(group("VB"));

    await expect(mutateWorkingSchedule(
      "group-1",
      5,
      { type: "setFootballRoles", slotKey: "shift-1", roles: ["PHOTO1"] },
      { id: "admin-1", role: "ADMIN" },
    )).rejects.toMatchObject({ status: 409 });

    expect(mocks.updateWorkingCopy).not.toHaveBeenCalled();
    expect(mocks.createAuditEntryTx).not.toHaveBeenCalled();
  });

  it("atomically assigns an exact reviewed person and Football role to an open slot", async () => {
    const open = group();
    open.shifts[0]!.assignments = [];
    open.shifts[0]!._count.assignments = 0;
    open.workingCopy.payload.slots[0]!.assignment = null;
    mocks.findGroup.mockResolvedValue(open);

    await mutateWorkingSchedule(
      "group-1",
      5,
      {
        type: "applyFootballSheetAssignment",
        slotKey: "shift-1",
        userId: "student-1",
        role: "SLOW1",
        proof: {
          source: {
            sheetId: "1BrASYKR3XZyE4_Hm6DiHTWIPZwP7NUv8iEuDmncZsZQ",
            tabName: "Sheet1",
            range: "A1:M14",
          },
          sourceA1: "B2",
          sourceRaw: "Student One",
          sourceFingerprint: "a".repeat(64),
          reviewFingerprint: "b".repeat(64),
          event: {
            id: "event-1",
            startsAt: eventStartsAt.toISOString(),
            opponent: "Miami",
            isHome: true,
          },
        },
      },
      { id: "admin-1", role: "ADMIN" },
    );

    const written = mocks.updateWorkingCopy.mock.calls[0]?.[0]?.data?.payload as {
      slots: Array<{ assignment: { userId: string; footballRoles: string[] } | null }>;
    };
    expect(written.slots[0]?.assignment).toMatchObject({ userId: "student-1", footballRoles: ["SLOW1"] });
    expect(mocks.checkTimeConflict).toHaveBeenCalledTimes(1);
    expect(mocks.createAuditEntryTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "working_schedule_applyFootballSheetAssignment",
      before: expect.objectContaining({ footballStaffingSheet: expect.objectContaining({ sourceA1: "B2" }) }),
      after: expect.objectContaining({ footballRoleChange: { slotKey: "shift-1", roles: ["SLOW1"] } }),
    }));
  });

  it("turns a reviewed dash into role vacancy without unassigning the holder", async () => {
    const occupied = group();
    occupied.shifts[0]!.assignments[0]!.footballRoles = ["SLOW1"];
    occupied.workingCopy.payload.slots[0]!.assignment!.footballRoles = ["SLOW1"];
    mocks.findGroup.mockResolvedValue(occupied);

    await mutateWorkingSchedule(
      "group-1",
      5,
      {
        type: "clearFootballSheetRole",
        role: "SLOW1",
        proof: {
          source: {
            sheetId: "1BrASYKR3XZyE4_Hm6DiHTWIPZwP7NUv8iEuDmncZsZQ",
            tabName: "Sheet1",
            range: "A1:M14",
          },
          sourceA1: "B2",
          sourceRaw: "-",
          sourceFingerprint: "a".repeat(64),
          reviewFingerprint: "b".repeat(64),
          event: {
            id: "event-1",
            startsAt: eventStartsAt.toISOString(),
            opponent: "Miami",
            isHome: true,
          },
        },
      },
      { id: "admin-1", role: "ADMIN" },
    );

    const written = mocks.updateWorkingCopy.mock.calls[0]?.[0]?.data?.payload as {
      slots: Array<{ assignment: { userId: string; footballRoles: string[] } | null }>;
    };
    expect(written.slots[0]?.assignment).toMatchObject({ userId: "student-1", footballRoles: [] });
    expect(mocks.createAuditEntryTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "working_schedule_clearFootballSheetRole",
      before: expect.objectContaining({
        footballRoleChange: { role: "SLOW1", holders: [{ slotKey: "shift-1", userId: "student-1" }] },
      }),
      after: expect.objectContaining({ footballRoleChange: { role: "SLOW1", holders: [] } }),
    }));
  });

  it("rejects reviewed sheet commands when the exact event or person changed", async () => {
    const command = {
      type: "applyFootballSheetAssignment" as const,
      slotKey: "shift-1",
      userId: "student-1",
      role: "SLOW1" as const,
      proof: {
        source: {
          sheetId: "1BrASYKR3XZyE4_Hm6DiHTWIPZwP7NUv8iEuDmncZsZQ" as const,
          tabName: "Sheet1" as const,
          range: "A1:M14" as const,
        },
        sourceA1: "B2",
        sourceRaw: "Student One",
        sourceFingerprint: "a".repeat(64),
        reviewFingerprint: "b".repeat(64),
        event: {
          id: "event-1",
          startsAt: eventStartsAt.toISOString(),
          opponent: "Miami",
          isHome: true,
        },
      },
    };
    const changedEvent = group();
    changedEvent.event.opponent = "Oregon";
    mocks.findGroup.mockResolvedValue(changedEvent);
    await expect(mutateWorkingSchedule(
      "group-1",
      5,
      command,
      { id: "admin-1", role: "ADMIN" },
    )).rejects.toMatchObject({ status: 409 });

    mocks.findGroup.mockResolvedValue(group());
    mocks.findUser.mockResolvedValue({
      id: "student-1",
      name: "Renamed Student",
      active: true,
      hiddenFromRoster: false,
      role: "STUDENT",
      staffingType: "ST",
      collaboratorPolicy: null,
      availabilityBlocks: [],
    });
    await expect(mutateWorkingSchedule(
      "group-1",
      5,
      command,
      { id: "admin-1", role: "ADMIN" },
    )).rejects.toMatchObject({ status: 409 });
    expect(mocks.updateWorkingCopy).not.toHaveBeenCalled();
  });
});
