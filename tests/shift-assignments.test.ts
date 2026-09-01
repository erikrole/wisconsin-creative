import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeShiftAssignment, makeShift } from "./_helpers/factories";
import { expectSerializableIsolation } from "./_helpers/assert-transaction";

type MockFn = ReturnType<typeof vi.fn>;
type ShiftAssignmentsTx = {
  shift: Record<"findUnique" | "findFirst" | "create" | "update", MockFn>;
  shiftGroup: Record<"update", MockFn>;
  shiftAssignment: Record<
    "findFirst" | "findMany" | "findUnique" | "create" | "update" | "updateMany",
    MockFn
  >;
  user: Record<"findUnique", MockFn>;
  shiftTrade: Record<"updateMany", MockFn>;
  auditLog: Record<"create", MockFn>;
};

const notificationMocks = vi.hoisted(() => ({
  dispatchScheduleAssignmentNotifications: vi.fn(),
}));

vi.mock("@/lib/services/notifications", () => notificationMocks);

// ─── Transaction tracking ──────────��────────────────────────────────────────
const transactionCalls: Array<{ options: unknown }> = [];

// ─── Mock @/lib/db ───────────────��──────────────────────────────────────────
vi.mock("@/lib/db", () => {
  const mockTx = {
    shift: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    shiftGroup: {
      update: vi.fn(),
    },
    shiftAssignment: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    shiftTrade: {
      updateMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
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

// ─── Mock checkTimeConflict self-reference (used internally) ────────────────
// The service imports checkTimeConflict from itself, so we let the real
// module load and only mock the db dependency above.

import { db } from "@/lib/db";
import {
  directAssignShift,
  requestShift,
  approveRequest,
  declineRequest,
  initiateSwap,
  repairRoleSlotMismatch,
  removeAssignment,
} from "@/lib/services/shift-assignments";

const mockTx = (db as unknown as { _mockTx: ShiftAssignmentsTx })._mockTx;

beforeEach(() => {
  transactionCalls.length = 0;
  mockTx.shift.findUnique.mockReset();
  mockTx.shift.findFirst.mockReset();
  mockTx.shift.create.mockReset();
  mockTx.shift.update.mockReset();
  mockTx.shiftGroup.update.mockReset();
  mockTx.shiftAssignment.findFirst.mockReset();
  mockTx.shiftAssignment.findMany.mockReset();
  mockTx.shiftAssignment.findUnique.mockReset();
  mockTx.shiftAssignment.create.mockReset();
  mockTx.shiftAssignment.update.mockReset();
  mockTx.shiftAssignment.updateMany.mockReset();
  mockTx.shiftAssignment.findMany.mockResolvedValue([]);
  mockTx.user.findUnique.mockReset();
  mockTx.user.findUnique.mockResolvedValue({
    id: "user-1",
    role: "STUDENT",
    staffingType: "ST",
    active: true,
    collaboratorPolicy: null,
    availabilityBlocks: [],
  });
  mockTx.shiftTrade.updateMany.mockReset();
  mockTx.shiftTrade.updateMany.mockResolvedValue({ count: 0 });
  mockTx.auditLog.create.mockReset();
  mockTx.auditLog.create.mockResolvedValue({});
  notificationMocks.dispatchScheduleAssignmentNotifications.mockReset();
  notificationMocks.dispatchScheduleAssignmentNotifications.mockResolvedValue(undefined);
});

// ════════════��═══════════════════════════════════���════════════════════════════
// directAssignShift
// ════════���════════════════════════════════════════════════════════════════════
describe("directAssignShift", () => {
  const shift = makeShift();

  it("creates a DIRECT_ASSIGNED assignment", async () => {
    mockTx.shift.findUnique.mockResolvedValue(shift);
    mockTx.shiftAssignment.findFirst.mockResolvedValue(null);
    mockTx.shiftAssignment.updateMany.mockResolvedValue({ count: 0 });
    mockTx.shiftAssignment.create.mockResolvedValue({
      id: "sa-1",
      shiftId: shift.id,
      userId: "user-1",
      status: "DIRECT_ASSIGNED",
    });

    const result = await directAssignShift(shift.id, "user-1", "admin-1");

    expect(mockTx.shiftAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shiftId: shift.id,
          userId: "user-1",
          status: "DIRECT_ASSIGNED",
          assignedBy: "admin-1",
        }),
      })
    );
    expect(result.id).toBe("sa-1");
  });

  it("uses SERIALIZABLE isolation", async () => {
    mockTx.shift.findUnique.mockResolvedValue(shift);
    mockTx.shiftAssignment.findFirst.mockResolvedValue(null);
    mockTx.shiftAssignment.updateMany.mockResolvedValue({ count: 0 });
    mockTx.shiftAssignment.create.mockResolvedValue({ id: "sa-1" });

    await directAssignShift(shift.id, "user-1", "admin-1");

    expectSerializableIsolation(transactionCalls, 0);
  });

  it("throws 404 when shift not found", async () => {
    mockTx.shift.findUnique.mockResolvedValue(null);

    await expect(directAssignShift("bad-id", "user-1", "admin-1")).rejects.toThrow(
      "Shift not found"
    );
  });

  it("rejects live assignment changes while a private working copy exists", async () => {
    mockTx.shift.findUnique.mockResolvedValue({
      ...shift,
      shiftGroup: { workingCopy: { version: 2 } },
    });

    await expect(directAssignShift(shift.id, "user-1", "admin-1"))
      .rejects
      .toMatchObject({ status: 409 });
    expect(mockTx.user.findUnique).not.toHaveBeenCalled();
  });

  it("throws 409 when shift already has an active assignment", async () => {
    mockTx.shift.findUnique.mockResolvedValue(shift);
    mockTx.shiftAssignment.findFirst.mockResolvedValue(
      makeShiftAssignment({ status: "DIRECT_ASSIGNED" })
    );

    await expect(directAssignShift(shift.id, "user-1", "admin-1")).rejects.toThrow(
      "already has an active assignment"
    );
  });

  it("declines pending REQUESTED assignments on the same shift", async () => {
    mockTx.shift.findUnique.mockResolvedValue(shift);
    // First call: check for active assignment → none
    // Second call: checkTimeConflict → none
    mockTx.shiftAssignment.findFirst
      .mockResolvedValueOnce(null)  // no active assignment
      .mockResolvedValueOnce(null); // no time conflict
    mockTx.shiftAssignment.updateMany.mockResolvedValue({ count: 2 });
    mockTx.shiftAssignment.create.mockResolvedValue({ id: "sa-1" });

    await directAssignShift(shift.id, "user-1", "admin-1");

    expect(mockTx.shiftAssignment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          shiftId: shift.id,
          status: "REQUESTED",
        }),
        data: { status: "DECLINED" },
      })
    );
  });

  it("assigns a mismatched role into a new matching slot and leaves the original slot open", async () => {
    const studentSlot = makeShift({ workerType: "ST" });
    const staffSlot = makeShift({ id: "staff-slot-1", shiftGroupId: studentSlot.shiftGroupId, area: studentSlot.area, workerType: "FT" });
    mockTx.shift.findUnique.mockResolvedValue(studentSlot);
    mockTx.user.findUnique.mockResolvedValue({ id: "staff-1", role: "STAFF", active: true });
    mockTx.shift.findFirst.mockResolvedValue(null);
    mockTx.shift.create.mockResolvedValue(staffSlot);
    mockTx.shiftGroup.update.mockResolvedValue({});
    mockTx.shiftAssignment.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockTx.shiftAssignment.findMany.mockResolvedValue([]);
    mockTx.shiftAssignment.updateMany.mockResolvedValue({ count: 0 });
    mockTx.shiftAssignment.create.mockResolvedValue({
      id: "sa-1",
      shiftId: staffSlot.id,
      userId: "staff-1",
      status: "DIRECT_ASSIGNED",
      user: { id: "staff-1", name: "Staff One", role: "STAFF", primaryArea: null, avatarUrl: null },
    });

    await directAssignShift(studentSlot.id, "staff-1", "admin-1");

    expect(mockTx.shift.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        shiftGroupId: studentSlot.shiftGroupId,
        area: studentSlot.area,
        workerType: "FT",
        startsAt: studentSlot.startsAt,
        endsAt: studentSlot.endsAt,
      }),
    }));
    expect(mockTx.shiftGroup.update).toHaveBeenCalledWith({
      where: { id: studentSlot.shiftGroupId },
      data: { manuallyEdited: true },
    });
    expect(mockTx.shiftAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shiftId: staffSlot.id,
          userId: "staff-1",
        }),
      })
    );
    expect(mockTx.shiftAssignment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          shiftId: staffSlot.id,
          status: "REQUESTED",
        }),
      })
    );
  });

  it("reuses an existing open matching slot for a mismatched role", async () => {
    const studentSlot = makeShift({ workerType: "ST" });
    const openStaffSlot = makeShift({ id: "open-staff-slot", shiftGroupId: studentSlot.shiftGroupId, area: studentSlot.area, workerType: "FT" });
    mockTx.shift.findUnique.mockResolvedValue(studentSlot);
    mockTx.user.findUnique.mockResolvedValue({ id: "staff-1", role: "STAFF", active: true });
    mockTx.shift.findFirst.mockResolvedValue(openStaffSlot);
    mockTx.shiftAssignment.findFirst.mockResolvedValue(null);
    mockTx.shiftAssignment.updateMany.mockResolvedValue({ count: 0 });
    mockTx.shiftAssignment.create.mockResolvedValue({ id: "sa-1", shiftId: openStaffSlot.id });

    await directAssignShift(studentSlot.id, "staff-1", "admin-1");

    expect(mockTx.shift.create).not.toHaveBeenCalled();
    expect(mockTx.shiftGroup.update).not.toHaveBeenCalled();
    expect(mockTx.shiftAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ shiftId: openStaffSlot.id }),
      })
    );
  });

  it("routes a staff user to a staff slot even when roster metadata exists", async () => {
    const studentSlot = makeShift({ workerType: "ST" });
    const openStaffSlot = makeShift({ id: "metadata-staff-slot", shiftGroupId: studentSlot.shiftGroupId, area: studentSlot.area, workerType: "FT" });
    mockTx.shift.findUnique.mockResolvedValue(studentSlot);
    mockTx.user.findUnique.mockResolvedValue({
      id: "staff-with-roster",
      role: "STAFF",
      active: true,
      areaAssignments: [{ area: studentSlot.area, isPrimary: true }],
      sportAssignments: [],
    });
    mockTx.shift.findFirst.mockResolvedValue(openStaffSlot);
    mockTx.shiftAssignment.findFirst.mockResolvedValue(null);
    mockTx.shiftAssignment.findMany.mockResolvedValue([]);
    mockTx.shiftAssignment.updateMany.mockResolvedValue({ count: 0 });
    mockTx.shiftAssignment.create.mockResolvedValue({
      id: "sa-1",
      shiftId: openStaffSlot.id,
      userId: "staff-with-roster",
      status: "DIRECT_ASSIGNED",
    });

    await directAssignShift(studentSlot.id, "staff-with-roster", "admin-1");

    expect(mockTx.shift.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        workerType: "FT",
      }),
    }));
    expect(mockTx.shift.create).not.toHaveBeenCalled();
    expect(mockTx.shiftAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shiftId: openStaffSlot.id,
          userId: "staff-with-roster",
        }),
      })
    );
  });

  it("keeps a staff-access user in a student slot when their scheduling class is student", async () => {
    const studentSlot = makeShift({ workerType: "ST" });
    mockTx.shift.findUnique.mockResolvedValue(studentSlot);
    mockTx.user.findUnique.mockResolvedValue({
      id: "staff-access-student-worker",
      role: "STAFF",
      staffingType: "ST",
      active: true,
      availabilityBlocks: [],
    });
    mockTx.shiftAssignment.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockTx.shiftAssignment.findMany.mockResolvedValue([]);
    mockTx.shiftAssignment.updateMany.mockResolvedValue({ count: 0 });
    mockTx.shiftAssignment.create.mockResolvedValue({
      id: "sa-1",
      shiftId: studentSlot.id,
      userId: "staff-access-student-worker",
      status: "DIRECT_ASSIGNED",
    });

    await directAssignShift(studentSlot.id, "staff-access-student-worker", "admin-1");

    expect(mockTx.shift.findFirst).not.toHaveBeenCalled();
    expect(mockTx.shift.create).not.toHaveBeenCalled();
    expect(mockTx.shiftAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shiftId: studentSlot.id,
          userId: "staff-access-student-worker",
        }),
      })
    );
  });

  it("rejects collaborators without an active published-schedule grant", async () => {
    const staffSlot = makeShift({ workerType: "FT" });
    mockTx.shift.findUnique.mockResolvedValue(staffSlot);
    mockTx.user.findUnique.mockResolvedValue({
      id: "collaborator-1",
      role: "COLLABORATOR",
      staffingType: "FT",
      active: true,
      collaboratorPolicy: {
        status: "ACTIVE",
        grants: [{ capabilityKey: "ITEMS_VIEW" }],
      },
      availabilityBlocks: [],
    });

    await expect(directAssignShift(staffSlot.id, "collaborator-1", "admin-1"))
      .rejects
      .toThrow("not eligible for schedule assignment");
    expect(mockTx.shiftAssignment.create).not.toHaveBeenCalled();
  });

  it("allows collaborators with active published-schedule access into Staff slots", async () => {
    const staffSlot = makeShift({ workerType: "FT" });
    mockTx.shift.findUnique.mockResolvedValue(staffSlot);
    mockTx.user.findUnique.mockResolvedValue({
      id: "collaborator-1",
      role: "COLLABORATOR",
      staffingType: "ST",
      active: true,
      collaboratorPolicy: {
        status: "ACTIVE",
        grants: [{ capabilityKey: "PUBLISHED_SCHEDULE_VIEW" }],
      },
      availabilityBlocks: [],
    });
    mockTx.shiftAssignment.findFirst.mockResolvedValue(null);
    mockTx.shiftAssignment.updateMany.mockResolvedValue({ count: 0 });
    mockTx.shiftAssignment.create.mockResolvedValue({ id: "sa-collaborator", status: "DIRECT_ASSIGNED" });

    const result = await directAssignShift(staffSlot.id, "collaborator-1", "admin-1");

    expect(result.id).toBe("sa-collaborator");
    expect(mockTx.shiftAssignment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ shiftId: staffSlot.id, userId: "collaborator-1" }),
    }));
  });

  it("uses personal call-time overrides when checking conflicts", async () => {
    const shiftWithDefaultWindow = makeShift({
      startsAt: new Date("2026-04-01T10:00:00Z"),
      endsAt: new Date("2026-04-01T12:00:00Z"),
    });
    mockTx.shift.findUnique.mockResolvedValue(shiftWithDefaultWindow);
    mockTx.shiftAssignment.findFirst.mockResolvedValue(null);
    mockTx.shiftAssignment.findMany.mockResolvedValue([
      {
        id: "existing-assignment",
        callStartsAt: new Date("2026-04-01T08:30:00Z"),
        callEndsAt: new Date("2026-04-01T09:30:00Z"),
        shift: {
          area: "VIDEO",
          startsAt: new Date("2026-04-01T14:00:00Z"),
          endsAt: new Date("2026-04-01T16:00:00Z"),
          callStartsAt: null,
          callEndsAt: null,
        },
      },
    ]);

    await expect(
      directAssignShift(shiftWithDefaultWindow.id, "user-1", "admin-1", {
        callStartsAt: new Date("2026-04-01T09:00:00Z"),
        callEndsAt: new Date("2026-04-01T10:00:00Z"),
      })
    ).rejects.toThrow("User already has a shift during this time");
  });

  it("does not treat consecutive all-day media days as overlapping when their UTC storage windows touch", async () => {
    const volleyballShift = makeShift({
      id: "volleyball-media-day-video",
      shiftGroupId: "volleyball-media-day-group",
      startsAt: new Date("2026-07-09T05:00:00.000Z"),
      endsAt: new Date("2026-07-10T05:00:00.000Z"),
      callStartsAt: null,
      callEndsAt: null,
      shiftGroup: {
        event: {
          startsAt: new Date("2026-07-09T05:00:00.000Z"),
          endsAt: new Date("2026-07-10T05:00:00.000Z"),
          allDay: true,
        },
      },
    });
    const footballShift = makeShift({
      id: "football-media-day-video",
      shiftGroupId: "football-media-day-group",
      startsAt: new Date("2026-07-07T10:00:00.000Z"),
      endsAt: new Date("2026-07-09T10:00:00.000Z"),
      callStartsAt: null,
      callEndsAt: null,
      shiftGroup: {
        event: {
          startsAt: new Date("2026-07-07T10:00:00.000Z"),
          endsAt: new Date("2026-07-09T10:00:00.000Z"),
          allDay: true,
        },
      },
    });
    mockTx.shift.findUnique.mockResolvedValue(volleyballShift);
    mockTx.shiftAssignment.findFirst.mockResolvedValue(null);
    mockTx.shiftAssignment.findMany.mockResolvedValue([
      {
        id: "football-assignment",
        callStartsAt: null,
        callEndsAt: null,
        shift: footballShift,
      },
    ]);
    mockTx.shiftAssignment.updateMany.mockResolvedValue({ count: 0 });
    mockTx.shiftAssignment.create.mockResolvedValue({
      id: "volleyball-assignment",
      shiftId: volleyballShift.id,
      userId: "user-1",
      status: "DIRECT_ASSIGNED",
    });

    const result = await directAssignShift(volleyballShift.id, "user-1", "admin-1");

    expect(result.id).toBe("volleyball-assignment");
    expect(mockTx.shiftAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shiftId: volleyballShift.id,
          userId: "user-1",
          status: "DIRECT_ASSIGNED",
        }),
      })
    );
  });
});

describe("repairRoleSlotMismatch", () => {
  it("moves an active mismatched assignment into a matching open slot", async () => {
    const studentSlot = makeShift({ id: "student-slot", workerType: "ST" });
    const staffSlot = makeShift({ id: "staff-slot", shiftGroupId: studentSlot.shiftGroupId, area: studentSlot.area, workerType: "FT" });
    mockTx.shiftAssignment.findUnique.mockResolvedValue({
      id: "assignment-1",
      shiftId: studentSlot.id,
      userId: "staff-1",
      status: "DIRECT_ASSIGNED",
      user: { id: "staff-1", name: "Staff One", role: "STAFF" },
      shift: studentSlot,
    });
    mockTx.shift.findFirst.mockResolvedValue(staffSlot);
    mockTx.shiftAssignment.findFirst.mockResolvedValue(null);
    mockTx.shiftAssignment.updateMany.mockResolvedValue({ count: 0 });
    mockTx.shiftAssignment.update.mockResolvedValue({
      id: "assignment-1",
      shiftId: staffSlot.id,
      user: { id: "staff-1", name: "Staff One", role: "STAFF", primaryArea: null, avatarUrl: null },
    });
    mockTx.shiftGroup.update.mockResolvedValue({});

    const result = await repairRoleSlotMismatch("assignment-1");

    expect(mockTx.shiftAssignment.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "assignment-1" },
      data: { shiftId: staffSlot.id },
    }));
    expect(result.outcome).toEqual(expect.objectContaining({
      requestedShiftId: studentSlot.id,
      targetShiftId: staffSlot.id,
      movedToMatchingSlot: true,
      reusedMatchingSlot: true,
    }));
    expectSerializableIsolation(transactionCalls, 0);
  });

  it("creates a matching slot when no open slot exists", async () => {
    const studentSlot = makeShift({ id: "student-slot", workerType: "ST" });
    const createdStaffSlot = makeShift({ id: "created-staff-slot", shiftGroupId: studentSlot.shiftGroupId, area: studentSlot.area, workerType: "FT" });
    mockTx.shiftAssignment.findUnique.mockResolvedValue({
      id: "assignment-1",
      shiftId: studentSlot.id,
      userId: "staff-1",
      status: "APPROVED",
      user: { id: "staff-1", name: "Staff One", role: "STAFF" },
      shift: studentSlot,
    });
    mockTx.shift.findFirst.mockResolvedValue(null);
    mockTx.shift.create.mockResolvedValue(createdStaffSlot);
    mockTx.shiftGroup.update.mockResolvedValue({});
    mockTx.shiftAssignment.findFirst.mockResolvedValue(null);
    mockTx.shiftAssignment.updateMany.mockResolvedValue({ count: 0 });
    mockTx.shiftAssignment.update.mockResolvedValue({ id: "assignment-1", shiftId: createdStaffSlot.id });

    const result = await repairRoleSlotMismatch("assignment-1");

    expect(mockTx.shift.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        shiftGroupId: studentSlot.shiftGroupId,
        area: studentSlot.area,
        workerType: "FT",
      }),
    }));
    expect(result.outcome).toEqual(expect.objectContaining({
      targetShiftId: createdStaffSlot.id,
      movedToMatchingSlot: true,
      createdMatchingSlot: true,
    }));
  });
});

// ══════��════════════════��═════════════════════════════════════════════════════
// requestShift
// ═══════��═════════════════════════════════════════════════════════════════════
describe("requestShift", () => {
  it("rejects new shift requests because open shifts are claimed directly", async () => {
    await expect(requestShift("shift-1", "student-1")).rejects.toThrow(
      "Shift requests are retired. Claim open shifts instead."
    );
    expect(mockTx.shiftAssignment.create).not.toHaveBeenCalled();
  });
});

// ═══��════════════════════════════════════════════════════���════════════════════
// approveRequest
// ��═══════════════════════════════��═════════════════════════════════════════��══
describe("approveRequest", () => {
  const shift = makeShift();
  const eligibleStudent = {
    id: "student-1",
    active: true,
    role: "STUDENT",
    staffingType: "ST",
    primaryArea: shift.area,
    collaboratorPolicy: null,
    availabilityBlocks: [],
  };

  it("approves a REQUESTED assignment", async () => {
    const assignment = {
      ...makeShiftAssignment({ status: "REQUESTED", userId: "student-1" }),
      shift,
      user: eligibleStudent,
    };
    mockTx.shiftAssignment.findUnique.mockResolvedValue(assignment);
    mockTx.shiftAssignment.findFirst
      .mockResolvedValueOnce(null)  // no time conflict
      .mockResolvedValueOnce(null); // no active assignment on shift
    mockTx.shiftAssignment.updateMany.mockResolvedValue({ count: 0 });
    mockTx.shiftAssignment.update.mockResolvedValue({
      ...assignment,
      status: "APPROVED",
    });

    const result = await approveRequest(assignment.id);

    expect(mockTx.shiftAssignment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          status: "APPROVED",
          hasConflict: false,
          conflictNote: undefined,
        },
      })
    );
    expect(result.status).toBe("APPROVED");
  });

  it("uses SERIALIZABLE isolation", async () => {
    const assignment = {
      ...makeShiftAssignment({ status: "REQUESTED" }),
      shift,
      user: eligibleStudent,
    };
    mockTx.shiftAssignment.findUnique.mockResolvedValue(assignment);
    mockTx.shiftAssignment.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockTx.shiftAssignment.updateMany.mockResolvedValue({ count: 0 });
    mockTx.shiftAssignment.update.mockResolvedValue({ ...assignment, status: "APPROVED" });

    await approveRequest(assignment.id);

    expectSerializableIsolation(transactionCalls, 0);
  });

  it("throws 404 when assignment not found", async () => {
    mockTx.shiftAssignment.findUnique.mockResolvedValue(null);

    await expect(approveRequest("bad-id")).rejects.toThrow("Assignment not found");
  });

  it("throws 400 when assignment is not REQUESTED", async () => {
    mockTx.shiftAssignment.findUnique.mockResolvedValue({
      ...makeShiftAssignment({ status: "DIRECT_ASSIGNED" }),
      shift,
      user: eligibleStudent,
    });

    await expect(approveRequest("sa-1")).rejects.toThrow("Only REQUESTED");
  });

  it("declines other REQUESTED assignments on the same shift", async () => {
    const assignment = {
      ...makeShiftAssignment({ status: "REQUESTED", shiftId: "shift-1" }),
      shift,
      user: eligibleStudent,
    };
    mockTx.shiftAssignment.findUnique.mockResolvedValue(assignment);
    mockTx.shiftAssignment.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockTx.shiftAssignment.updateMany.mockResolvedValue({ count: 3 });
    mockTx.shiftAssignment.update.mockResolvedValue({ ...assignment, status: "APPROVED" });

    await approveRequest(assignment.id);

    expect(mockTx.shiftAssignment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          shiftId: assignment.shiftId,
          status: "REQUESTED",
          id: { not: assignment.id },
        }),
        data: { status: "DECLINED" },
      })
    );
  });

  it("writes a system audit and sends the approved-worker notification for auto approval", async () => {
    const assignment = {
      ...makeShiftAssignment({ status: "REQUESTED", userId: "student-1" }),
      shift,
      user: eligibleStudent,
    };
    mockTx.shiftAssignment.findUnique.mockResolvedValue(assignment);
    mockTx.shiftAssignment.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockTx.shiftAssignment.updateMany.mockResolvedValue({ count: 0 });
    mockTx.shiftAssignment.update.mockResolvedValue({ ...assignment, status: "APPROVED" });

    await approveRequest(assignment.id);

    expect(mockTx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        actorUserId: undefined,
        entityType: "shift_assignment",
        entityId: assignment.id,
        action: "shift_request_auto_approved",
      }),
    }));
    expect(notificationMocks.dispatchScheduleAssignmentNotifications)
      .toHaveBeenCalledWith(assignment.id, "approved");
  });

  it("records the reviewing staff actor for human approval", async () => {
    const assignment = {
      ...makeShiftAssignment({ status: "REQUESTED", userId: "student-1" }),
      shift,
      user: eligibleStudent,
    };
    mockTx.shiftAssignment.findUnique.mockResolvedValue(assignment);
    mockTx.shiftAssignment.findFirst.mockResolvedValue(null);
    mockTx.shiftAssignment.updateMany.mockResolvedValue({ count: 0 });
    mockTx.shiftAssignment.update.mockResolvedValue({ ...assignment, status: "APPROVED" });

    await approveRequest(assignment.id, { id: "staff-1", role: "STAFF" });

    expect(mockTx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        actorUserId: "staff-1",
        action: "shift_request_approved",
      }),
    }));
  });

  it("rejects approval when the requester became inactive", async () => {
    mockTx.shiftAssignment.findUnique.mockResolvedValue({
      ...makeShiftAssignment({ status: "REQUESTED" }),
      shift,
      user: { ...eligibleStudent, active: false },
    });

    await expect(approveRequest("sa-1")).rejects.toThrow("no longer active");
    expect(mockTx.shiftAssignment.update).not.toHaveBeenCalled();
    expect(mockTx.auditLog.create).not.toHaveBeenCalled();
  });

  it("rejects approval when the requester's scheduling class changed", async () => {
    mockTx.shiftAssignment.findUnique.mockResolvedValue({
      ...makeShiftAssignment({ status: "REQUESTED" }),
      shift,
      user: { ...eligibleStudent, staffingType: "FT" },
    });

    await expect(approveRequest("sa-1")).rejects.toThrow("no longer matches");
    expect(mockTx.shiftAssignment.update).not.toHaveBeenCalled();
  });

  it("rejects approval when the requester no longer matches the claimable area", async () => {
    mockTx.shiftAssignment.findUnique.mockResolvedValue({
      ...makeShiftAssignment({ status: "REQUESTED" }),
      shift,
      user: { ...eligibleStudent, primaryArea: "PHOTO" },
    });

    await expect(approveRequest("sa-1")).rejects.toThrow(
      "cannot claim shifts in this area",
    );
    expect(mockTx.shiftAssignment.update).not.toHaveBeenCalled();
  });
});

// ═════���═══════════════════════════════════════════════════════════���═══════════
// declineRequest
// ═════════════════════════════════════════════════════════════════════════════
describe("declineRequest", () => {
  it("declines a REQUESTED assignment", async () => {
    const assignment = makeShiftAssignment({ status: "REQUESTED" });
    mockTx.shiftAssignment.findUnique.mockResolvedValue(assignment);
    mockTx.shiftAssignment.update.mockResolvedValue({
      ...assignment,
      status: "DECLINED",
    });

    await declineRequest(assignment.id);

    expect(mockTx.shiftAssignment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: "DECLINED" },
      })
    );
    expect(notificationMocks.dispatchScheduleAssignmentNotifications)
      .toHaveBeenCalledWith(assignment.id, "declined");
  });

  it("uses SERIALIZABLE isolation", async () => {
    const assignment = makeShiftAssignment({ status: "REQUESTED" });
    mockTx.shiftAssignment.findUnique.mockResolvedValue(assignment);
    mockTx.shiftAssignment.update.mockResolvedValue({ ...assignment, status: "DECLINED" });

    await declineRequest(assignment.id);

    expectSerializableIsolation(transactionCalls, 0);
  });

  it("throws 404 when assignment not found", async () => {
    mockTx.shiftAssignment.findUnique.mockResolvedValue(null);

    await expect(declineRequest("bad-id")).rejects.toThrow("Assignment not found");
  });

  it("throws 400 when assignment is not REQUESTED", async () => {
    mockTx.shiftAssignment.findUnique.mockResolvedValue(
      makeShiftAssignment({ status: "APPROVED" })
    );

    await expect(declineRequest("sa-1")).rejects.toThrow("Only REQUESTED");
  });
});

// ═���════════════════���══════════════════════════════════════════════════════════
// initiateSwap
// ═���════════════════════════���══════════════════════════════════���═══════════════
describe("initiateSwap", () => {
  const shift = makeShift();

  it("swaps an active assignment to a new user", async () => {
    const assignment = {
      ...makeShiftAssignment({ status: "DIRECT_ASSIGNED", shiftId: shift.id }),
      shift,
    };
    mockTx.shiftAssignment.findUnique.mockResolvedValue(assignment);
    mockTx.shiftAssignment.findFirst.mockResolvedValue(null); // no time conflict
    mockTx.shiftAssignment.update.mockResolvedValue({
      ...assignment,
      status: "SWAPPED",
    });
    mockTx.shiftAssignment.create.mockResolvedValue({
      id: "sa-new",
      shiftId: shift.id,
      userId: "target-1",
      status: "DIRECT_ASSIGNED",
    });

    await initiateSwap(assignment.id, "target-1", "admin-1");

    expect(mockTx.shiftAssignment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: "SWAPPED" },
      })
    );
    expect(mockTx.shiftAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shiftId: shift.id,
          userId: "target-1",
          status: "DIRECT_ASSIGNED",
          assignedBy: "admin-1",
          swapFromId: assignment.id,
        }),
      })
    );
  });

  it("uses SERIALIZABLE isolation", async () => {
    const assignment = {
      ...makeShiftAssignment({ status: "DIRECT_ASSIGNED" }),
      shift,
    };
    mockTx.shiftAssignment.findUnique.mockResolvedValue(assignment);
    mockTx.shiftAssignment.findFirst.mockResolvedValue(null);
    mockTx.shiftAssignment.update.mockResolvedValue({});
    mockTx.shiftAssignment.create.mockResolvedValue({ id: "sa-new" });

    await initiateSwap(assignment.id, "target-1", "admin-1");

    expectSerializableIsolation(transactionCalls, 0);
  });

  it("throws 404 when assignment not found", async () => {
    mockTx.shiftAssignment.findUnique.mockResolvedValue(null);

    await expect(initiateSwap("bad-id", "target-1", "admin-1")).rejects.toThrow(
      "Assignment not found"
    );
  });

  it("throws 400 when assignment is not active", async () => {
    mockTx.shiftAssignment.findUnique.mockResolvedValue({
      ...makeShiftAssignment({ status: "SWAPPED" }),
      shift,
    });

    await expect(initiateSwap("sa-1", "target-1", "admin-1")).rejects.toThrow(
      "Only active assignments"
    );
  });

  it("throws 400 for DECLINED assignment", async () => {
    mockTx.shiftAssignment.findUnique.mockResolvedValue({
      ...makeShiftAssignment({ status: "DECLINED" }),
      shift,
    });

    await expect(initiateSwap("sa-1", "target-1", "admin-1")).rejects.toThrow(
      "Only active assignments"
    );
  });

  it("throws 404 when the target user does not exist", async () => {
    mockTx.shiftAssignment.findUnique.mockResolvedValue({
      ...makeShiftAssignment({ status: "DIRECT_ASSIGNED" }),
      shift,
    });
    mockTx.user.findUnique.mockResolvedValue(null);

    await expect(initiateSwap("sa-1", "ghost-user", "admin-1")).rejects.toThrow(
      "User not found"
    );
    expect(mockTx.shiftAssignment.create).not.toHaveBeenCalled();
  });

  it("throws 400 when the target user is inactive", async () => {
    mockTx.shiftAssignment.findUnique.mockResolvedValue({
      ...makeShiftAssignment({ status: "DIRECT_ASSIGNED" }),
      shift,
    });
    mockTx.user.findUnique.mockResolvedValue({ id: "target-1", role: "STUDENT", active: false });

    await expect(initiateSwap("sa-1", "target-1", "admin-1")).rejects.toThrow(
      "inactive user"
    );
    expect(mockTx.shiftAssignment.create).not.toHaveBeenCalled();
  });

  it("cancels open trades on the outgoing assignment", async () => {
    const assignment = {
      ...makeShiftAssignment({ status: "DIRECT_ASSIGNED", shiftId: shift.id }),
      shift,
    };
    mockTx.shiftAssignment.findUnique.mockResolvedValue(assignment);
    mockTx.shiftAssignment.findFirst.mockResolvedValue(null);
    mockTx.shiftAssignment.update.mockResolvedValue({ ...assignment, status: "SWAPPED" });
    mockTx.shiftAssignment.create.mockResolvedValue({ id: "sa-new" });

    await initiateSwap(assignment.id, "target-1", "admin-1");

    expect(mockTx.shiftTrade.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          shiftAssignmentId: assignment.id,
          status: { in: ["OPEN", "CLAIMED"] },
        }),
        data: expect.objectContaining({ status: "CANCELLED" }),
      })
    );
  });
});

// ��═════════════════════════════════════════════════════════���══════════════════
// removeAssignment
// ═════════════════════════════════���═══════════════════════════════════════════
describe("removeAssignment", () => {
  it("removes a DIRECT_ASSIGNED assignment", async () => {
    const assignment = makeShiftAssignment({ status: "DIRECT_ASSIGNED" });
    mockTx.shiftAssignment.findUnique.mockResolvedValue(assignment);
    mockTx.shiftAssignment.update.mockResolvedValue({
      ...assignment,
      status: "DECLINED",
    });

    await removeAssignment(assignment.id);

    expect(mockTx.shiftAssignment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: "DECLINED" },
      })
    );
  });

  it("removes an APPROVED assignment", async () => {
    const assignment = makeShiftAssignment({ status: "APPROVED" });
    mockTx.shiftAssignment.findUnique.mockResolvedValue(assignment);
    mockTx.shiftAssignment.update.mockResolvedValue({ ...assignment, status: "DECLINED" });

    await removeAssignment(assignment.id);

    expect(mockTx.shiftAssignment.update).toHaveBeenCalled();
  });

  it("removes a REQUESTED assignment", async () => {
    const assignment = makeShiftAssignment({ status: "REQUESTED" });
    mockTx.shiftAssignment.findUnique.mockResolvedValue(assignment);
    mockTx.shiftAssignment.update.mockResolvedValue({ ...assignment, status: "DECLINED" });

    await removeAssignment(assignment.id);

    expect(mockTx.shiftAssignment.update).toHaveBeenCalled();
  });

  it("uses SERIALIZABLE isolation", async () => {
    const assignment = makeShiftAssignment({ status: "DIRECT_ASSIGNED" });
    mockTx.shiftAssignment.findUnique.mockResolvedValue(assignment);
    mockTx.shiftAssignment.update.mockResolvedValue({ ...assignment, status: "DECLINED" });

    await removeAssignment(assignment.id);

    expectSerializableIsolation(transactionCalls, 0);
  });

  it("throws 404 when assignment not found", async () => {
    mockTx.shiftAssignment.findUnique.mockResolvedValue(null);

    await expect(removeAssignment("bad-id")).rejects.toThrow("Assignment not found");
  });

  it("throws 400 for SWAPPED status (terminal)", async () => {
    mockTx.shiftAssignment.findUnique.mockResolvedValue(
      makeShiftAssignment({ status: "SWAPPED" })
    );

    await expect(removeAssignment("sa-1")).rejects.toThrow("cannot be removed");
  });

  it("throws 400 for DECLINED status (terminal)", async () => {
    mockTx.shiftAssignment.findUnique.mockResolvedValue(
      makeShiftAssignment({ status: "DECLINED" })
    );

    await expect(removeAssignment("sa-1")).rejects.toThrow("cannot be removed");
  });

  it("cancels open trades so the board stops advertising a removed shift", async () => {
    const assignment = makeShiftAssignment({ status: "DIRECT_ASSIGNED" });
    mockTx.shiftAssignment.findUnique.mockResolvedValue(assignment);
    mockTx.shiftAssignment.update.mockResolvedValue({ ...assignment, status: "DECLINED" });

    await removeAssignment(assignment.id);

    expect(mockTx.shiftTrade.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          shiftAssignmentId: assignment.id,
          status: { in: ["OPEN", "CLAIMED"] },
        }),
        data: expect.objectContaining({ status: "CANCELLED" }),
      })
    );
  });
});
