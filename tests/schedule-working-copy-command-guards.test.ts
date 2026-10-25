import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

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
import type { WorkingScheduleCommand } from "@/lib/schedule-working-copy";

const eventStartsAt = new Date("2026-10-06T18:00:00.000Z");
const eventEndsAt = new Date("2026-10-06T21:00:00.000Z");
const actor = { id: "staff-1", role: "STAFF" as const };

type Assignment = {
  sourceAssignmentId: string | null;
  userId: string;
  status: string;
  callStartsAt: string | null;
  callEndsAt: string | null;
  callNote: string | null;
  activeTradeId: string | null;
  bookingCount: number;
};

function assignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    sourceAssignmentId: null,
    userId: "student-1",
    status: "DIRECT_ASSIGNED",
    callStartsAt: null,
    callEndsAt: null,
    callNote: null,
    activeTradeId: null,
    bookingCount: 0,
    ...overrides,
  };
}

function slot(key: string, overrides: Record<string, unknown> = {}) {
  return {
    key,
    sourceShiftId: null,
    area: "VIDEO",
    workerType: "ST",
    startsAt: eventStartsAt.toISOString(),
    endsAt: eventEndsAt.toISOString(),
    callStartsAt: null,
    callEndsAt: null,
    notes: null,
    assignmentHistoryCount: 0,
    assignment: null as Assignment | null,
    ...overrides,
  };
}

function group(slots: Array<Record<string, unknown>>, options: { allDay?: boolean; workingCopy?: boolean } = {}) {
  return {
    id: "group-1",
    publishedAt: null,
    publishedVersion: 0,
    event: { startsAt: eventStartsAt, endsAt: eventEndsAt, allDay: options.allDay ?? false, sportCode: "VB" },
    shifts: [] as Array<Record<string, unknown>>,
    workingCopy: options.workingCopy === false ? null : {
      version: 5,
      basePublishedVersion: 0,
      payloadVersion: 2,
      payload: {
        eventStartsAt: eventStartsAt.toISOString(),
        eventEndsAt: eventEndsAt.toISOString(),
        slots,
      },
      undoStack: [],
      redoStack: [],
      createdAt: new Date("2026-09-02T11:00:00.000Z"),
      updatedAt: new Date("2026-09-02T12:00:00.000Z"),
      updatedById: "staff-1",
    },
  };
}

function person(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    active: true,
    role: "STUDENT",
    staffingType: "ST",
    collaboratorPolicy: null,
    availabilityBlocks: [],
    ...overrides,
  };
}

const timeOff = {
  kind: "AD_HOC",
  intent: "TIME_OFF",
  status: "APPROVED",
  dayOfWeek: null,
  date: new Date("2026-10-06T00:00:00.000Z"),
  dateEndsOn: null,
  allDay: false,
  // 13:00-16:00 Chicago is the whole 18:00-21:00Z event window.
  startsAt: "13:00",
  endsAt: "16:00",
  label: "Family trip",
  semesterLabel: null,
  semesterStartsOn: null,
  semesterEndsOn: null,
};

function run(command: WorkingScheduleCommand, version = 5) {
  return mutateWorkingSchedule("group-1", version, command, actor);
}

async function rejects(command: WorkingScheduleCommand, status: number, message: string) {
  await expect(run(command)).rejects.toMatchObject({ status, message });
  expect(mocks.updateWorkingCopy).not.toHaveBeenCalled();
  expect(mocks.createWorkingCopy).not.toHaveBeenCalled();
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.findGroup.mockResolvedValue(group([slot("open-1"), slot("open-2")]));
  mocks.findUser.mockImplementation(async ({ where }: { where: { id: string } }) => person(where.id));
  mocks.findUsers.mockResolvedValue([]);
  mocks.findSportConfig.mockResolvedValue(null);
  mocks.findAssignments.mockResolvedValue([]);
  mocks.findTrades.mockResolvedValue([]);
  mocks.updateWorkingCopy.mockResolvedValue({ count: 1 });
  mocks.createWorkingCopy.mockResolvedValue({});
  mocks.checkTimeConflict.mockResolvedValue(undefined);
  mocks.createAuditEntryTx.mockResolvedValue(undefined);
});

describe("mutateWorkingSchedule version guard", () => {
  it("refuses a command built on an older version", async () => {
    await expect(run({ type: "assign", slotKey: "open-1", userId: "student-1" }, 4))
      .rejects.toMatchObject({ status: 409, message: expect.stringContaining("changed in another session") });
    expect(mocks.findUser).not.toHaveBeenCalled();
  });

  it("reports a concurrent save that bumped the version first", async () => {
    mocks.updateWorkingCopy.mockResolvedValue({ count: 0 });

    await expect(run({ type: "assign", slotKey: "open-1", userId: "student-1" }))
      .rejects.toMatchObject({ status: 409, message: expect.stringContaining("changed in another session") });
    expect(mocks.createAuditEntryTx).not.toHaveBeenCalled();
  });

  it("starts a draft on the first command and reports a race on the unique draft row", async () => {
    mocks.findGroup.mockResolvedValue(group([], { workingCopy: false }));

    await run({ type: "adjustSlots", area: "VIDEO", workerType: "ST", delta: 1 }, 0);
    expect(mocks.createWorkingCopy).toHaveBeenCalledWith({
      data: expect.objectContaining({ shiftGroupId: "group-1", version: 1, createdById: "staff-1" }),
    });

    mocks.createWorkingCopy.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("duplicate", {
      code: "P2002",
      clientVersion: "test",
    }));
    await expect(run({ type: "adjustSlots", area: "VIDEO", workerType: "ST", delta: 1 }, 0))
      .rejects.toMatchObject({ status: 409 });
  });
});

describe("mutateWorkingSchedule assign checks", () => {
  it("assigns an eligible student and records the audit entry", async () => {
    await run({ type: "assign", slotKey: "open-1", userId: "student-1" });

    const payload = mocks.updateWorkingCopy.mock.calls[0]?.[0]?.data?.payload as { slots: Array<{ key: string; assignment: Assignment | null }> };
    expect(payload.slots.find((candidate) => candidate.key === "open-1")?.assignment?.userId).toBe("student-1");
    expect(mocks.createAuditEntryTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "working_schedule_assign",
      entityId: "group-1",
    }));
  });

  it("rejects a missing slot, a filled slot and a missing person", async () => {
    mocks.findGroup.mockResolvedValue(group([slot("filled", { assignment: assignment({ userId: "student-9" }) }), slot("open-1")]));

    await rejects({ type: "assign", slotKey: "nope", userId: "student-1" }, 404, "Working slot not found");
    await rejects({ type: "assign", slotKey: "filled", userId: "student-1" }, 409, "This slot is already assigned");
    mocks.findUser.mockResolvedValueOnce(null);
    await rejects({ type: "assign", slotKey: "open-1", userId: "ghost" }, 404, "User not found");
  });

  it("rejects an inactive person and the wrong worker class", async () => {
    mocks.findUser.mockResolvedValueOnce(person("student-1", { active: false }));
    await rejects({ type: "assign", slotKey: "open-1", userId: "student-1" }, 400, "Cannot assign an inactive user");

    mocks.findUser.mockResolvedValueOnce(person("staff-2", { role: "STAFF", staffingType: "FT" }));
    await rejects({ type: "assign", slotKey: "open-1", userId: "staff-2" }, 409, "Choose a Student worker for this slot.");
  });

  it("rejects a person already in this event's draft", async () => {
    mocks.findGroup.mockResolvedValue(group([slot("filled", { assignment: assignment() }), slot("open-1")]));

    await rejects({ type: "assign", slotKey: "open-1", userId: "student-1" }, 409, "This person is already assigned within this event draft.");
  });

  it("blocks a student whose approved time off covers the slot", async () => {
    mocks.findUser.mockResolvedValueOnce(person("student-1", { availabilityBlocks: [timeOff] }));

    await expect(run({ type: "assign", slotKey: "open-1", userId: "student-1" })).rejects.toMatchObject({ status: 409 });
    expect(mocks.updateWorkingCopy).not.toHaveBeenCalled();
  });

  it("checks each pick in a batch against the earlier picks", async () => {
    await rejects({
      type: "assignMany",
      assignments: [
        { slotKey: "open-1", userId: "student-1" },
        { slotKey: "open-1", userId: "student-2" },
      ],
    }, 409, "This slot is already assigned");
  });
});

describe("mutateWorkingSchedule convert and replace checks", () => {
  beforeEach(() => {
    mocks.findGroup.mockResolvedValue(group([
      slot("filled", { assignment: assignment() }),
      slot("other", { workerType: "FT", assignment: assignment({ userId: "staff-2" }) }),
      slot("open-1"),
    ]));
  });

  it("rejects replacing on an open slot or keeping the same class", async () => {
    await rejects({ type: "convertAndReplace", slotKey: "nope", workerType: "FT", userId: "staff-3" }, 404, "Working slot not found");
    await rejects({ type: "convertAndReplace", slotKey: "open-1", workerType: "FT", userId: "staff-3" }, 409, "This slot is not assigned");
    await rejects({ type: "convertAndReplace", slotKey: "filled", workerType: "ST", userId: "student-3" }, 400, "Choose the other worker class when converting this slot.");
  });

  it("will not replace someone with an active trade or linked gear", async () => {
    mocks.findGroup.mockResolvedValue(group([slot("filled", { assignment: assignment({ activeTradeId: "trade-1" }) })]));
    await rejects({ type: "convertAndReplace", slotKey: "filled", workerType: "FT", userId: "staff-3" }, 409, "Cancel the active trade before replacing this person.");

    mocks.findGroup.mockResolvedValue(group([slot("filled", { assignment: assignment({ bookingCount: 1 }) })]));
    await rejects({ type: "convertAndReplace", slotKey: "filled", workerType: "FT", userId: "staff-3" }, 409, "Unlink the assignment's booking before replacing this person.");
  });

  it("checks the replacement like any other assignee", async () => {
    mocks.findUser.mockResolvedValueOnce(null);
    await rejects({ type: "convertAndReplace", slotKey: "filled", workerType: "FT", userId: "ghost" }, 404, "User not found");

    mocks.findUser.mockResolvedValueOnce(person("staff-3", { active: false, role: "STAFF", staffingType: "FT" }));
    await rejects({ type: "convertAndReplace", slotKey: "filled", workerType: "FT", userId: "staff-3" }, 400, "Cannot assign an inactive user");

    mocks.findUser.mockResolvedValueOnce(person("student-3"));
    await rejects({ type: "convertAndReplace", slotKey: "filled", workerType: "FT", userId: "student-3" }, 409, "Choose a Staff worker for this slot.");

    mocks.findUser.mockResolvedValueOnce(person("staff-2", { role: "STAFF", staffingType: "FT" }));
    await rejects({ type: "convertAndReplace", slotKey: "filled", workerType: "FT", userId: "staff-2" }, 409, "This person is already assigned within this event draft.");
  });

  it("converts the slot and seats the replacement", async () => {
    mocks.findUser.mockResolvedValueOnce(person("staff-3", { role: "STAFF", staffingType: "FT" }));

    await run({ type: "convertAndReplace", slotKey: "filled", workerType: "FT", userId: "staff-3" });

    expect(mocks.checkTimeConflict).toHaveBeenCalledWith(expect.anything(), "staff-3", eventStartsAt, eventEndsAt);
    const payload = mocks.updateWorkingCopy.mock.calls[0]?.[0]?.data?.payload as { slots: Array<{ key: string; workerType: string; assignment: Assignment | null }> };
    const converted = payload.slots.find((candidate) => candidate.assignment?.userId === "staff-3");
    expect(converted?.workerType).toBe("FT");
  });
});

describe("mutateWorkingSchedule unassign and call-time checks", () => {
  it("will not unassign someone mid-trade", async () => {
    mocks.findGroup.mockResolvedValue(group([slot("filled", { assignment: assignment({ activeTradeId: "trade-1" }) })]));

    await rejects({ type: "unassign", slotKey: "filled" }, 409, "Cancel the active trade before unassigning this person.");
    await rejects({ type: "unassign", slotKey: "nope" }, 404, "Working slot not found");
  });

  it.each([
    [{ workerType: "FT", callStartsAt: "2026-10-06T17:00:00.000Z", callEndsAt: "2026-10-06T22:00:00.000Z" }, "Call times apply only to Student slots."],
    [{ workerType: "ST", callStartsAt: "2026-10-06T17:00:00.000Z" }, "Call start and release time must both be set or both be cleared."],
    [{ workerType: "ST", callStartsAt: "2026-10-06T22:00:00.000Z", callEndsAt: "2026-10-06T17:00:00.000Z" }, "Release time must be after call time."],
  ])("rejects a new slot with %j", async (fields, message) => {
    await rejects({ type: "adjustSlots", area: "VIDEO", delta: 1, ...fields } as WorkingScheduleCommand, 400, message);
  });

  it("rejects call times on an all-day event, for new slots, one slot or all slots", async () => {
    mocks.findGroup.mockResolvedValue(group([slot("open-1")], { allDay: true }));
    const window = { callStartsAt: "2026-10-06T17:00:00.000Z", callEndsAt: "2026-10-06T22:00:00.000Z" };

    await rejects({ type: "adjustSlots", area: "VIDEO", workerType: "ST", delta: 1, ...window }, 400, "All-day events do not have call times.");
    await rejects({ type: "setCallWindow", slotKey: "open-1", ...window }, 400, "All-day events do not have call times.");
    await rejects({ type: "setCallWindowForAll", ...window }, 400, "All-day events do not have call times.");
  });

  it("rejects one-sided or reversed windows for one slot and for all slots", async () => {
    await rejects({ type: "setCallWindow", slotKey: "open-1", callStartsAt: "2026-10-06T17:00:00.000Z", callEndsAt: null }, 400, "Call start and release time must both be set or both be cleared.");
    await rejects({ type: "setCallWindow", slotKey: "open-1", callStartsAt: "2026-10-06T22:00:00.000Z", callEndsAt: "2026-10-06T17:00:00.000Z" }, 400, "Release time must be after call time.");
    await rejects({ type: "setCallWindowForAll", callStartsAt: null, callEndsAt: "2026-10-06T22:00:00.000Z" }, 400, "Call start and release time must both be set or both be cleared.");
    await rejects({ type: "setCallWindowForAll", callStartsAt: "2026-10-06T22:00:00.000Z", callEndsAt: "2026-10-06T17:00:00.000Z" }, 400, "Release time must be after call time.");
  });

  it("keeps call times off Staff slots and reports a missing slot", async () => {
    mocks.findGroup.mockResolvedValue(group([slot("staff-slot", { workerType: "FT" })]));
    const window = { callStartsAt: "2026-10-06T17:00:00.000Z", callEndsAt: "2026-10-06T22:00:00.000Z" };

    await rejects({ type: "setCallWindow", slotKey: "staff-slot", ...window }, 400, "Call times apply only to Student slots.");
    await rejects({ type: "setCallWindow", slotKey: "nope", ...window }, 404, "Working slot not found");
  });

  it("reports an assignee who no longer exists when moving call times", async () => {
    mocks.findGroup.mockResolvedValue(group([slot("filled", { assignment: assignment() })]));
    const window = { callStartsAt: "2026-10-06T17:00:00.000Z", callEndsAt: "2026-10-06T22:00:00.000Z" };
    mocks.findUser.mockResolvedValueOnce(null);
    mocks.findUsers.mockResolvedValueOnce([]);

    await rejects({ type: "setCallWindow", slotKey: "filled", ...window }, 404, "Assigned user not found");
    await rejects({ type: "setCallWindowForAll", ...window }, 404, "Assigned user not found");
  });

  it("checks only assigned Student slots when moving every call time", async () => {
    mocks.findGroup.mockResolvedValue(group([
      slot("student", { assignment: assignment() }),
      slot("staff", { workerType: "FT", assignment: assignment({ userId: "staff-2" }) }),
      slot("open-1"),
    ]));
    mocks.findUsers.mockResolvedValue([person("student-1")]);

    await run({ type: "setCallWindowForAll", callStartsAt: "2026-10-06T17:00:00.000Z", callEndsAt: "2026-10-06T22:00:00.000Z" });

    expect(mocks.findUsers).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["student-1"] } } }));
    expect(mocks.checkTimeConflict).toHaveBeenCalledTimes(1);
  });

  it("skips the people lookup when no Student slot is assigned", async () => {
    await run({ type: "setCallWindowForAll", callStartsAt: "2026-10-06T17:00:00.000Z", callEndsAt: "2026-10-06T22:00:00.000Z" });

    expect(mocks.findUsers).not.toHaveBeenCalled();
    expect(mocks.updateWorkingCopy).toHaveBeenCalled();
  });
});
