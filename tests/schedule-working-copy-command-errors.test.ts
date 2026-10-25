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
  applyCommand: vi.fn(),
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

vi.mock("@/lib/schedule-working-copy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/schedule-working-copy")>();
  mocks.applyCommand.mockImplementation(actual.applyWorkingScheduleCommand);
  return { ...actual, applyWorkingScheduleCommand: mocks.applyCommand };
});

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

function run(command: WorkingScheduleCommand, version = 5) {
  return mutateWorkingSchedule("group-1", version, command, actor);
}

async function rejects(command: WorkingScheduleCommand, status: number, message: string) {
  await expect(run(command)).rejects.toMatchObject({ status, message });
  expect(mocks.updateWorkingCopy).not.toHaveBeenCalled();
  expect(mocks.createWorkingCopy).not.toHaveBeenCalled();
}

beforeEach(() => {
  for (const [name, mock] of Object.entries(mocks)) if (name !== "applyCommand") mock.mockReset();
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

const adjust: WorkingScheduleCommand = { type: "adjustSlots", area: "VIDEO", workerType: "ST", delta: -1 };

describe("working schedule command errors", () => {
  it.each([
    ["UNASSIGN_BEFORE_CONVERTING", 409, "Unassign this person before converting the slot."],
    ["CONVERT_AND_REPLACE_REQUIRES_CONVERSION", 400, "Choose the other worker class when converting this slot."],
    ["CANCEL_TRADE_BEFORE_REPLACING", 409, "Cancel the active trade before replacing this person."],
    ["UNLINK_BOOKING_BEFORE_REPLACING", 409, "Unlink the assignment's booking before replacing this person."],
    ["WORKING_SLOT_NOT_FOUND", 404, "Working slot not found"],
    ["WORKING_SLOT_ALREADY_ASSIGNED", 409, "This slot is already assigned"],
    ["WORKING_SLOT_NOT_ASSIGNED", 409, "This slot is not assigned"],
    ["CALL_TIME_STUDENT_ONLY", 400, "Call times apply only to Student slots."],
  ])("turns %s into a %i reply", async (code, status, message) => {
    mocks.applyCommand.mockImplementationOnce(() => { throw new Error(code); });

    await rejects(adjust, status, message);
  });

  it("words a blocked reduction for the count editor and for one crew", async () => {
    mocks.applyCommand.mockImplementationOnce(() => { throw new Error("UNASSIGN_BEFORE_REDUCING"); });
    await rejects(adjust, 409, "Unassign an open matching slot before reducing this crew count.");

    mocks.applyCommand.mockImplementationOnce(() => { throw new Error("UNASSIGN_BEFORE_REDUCING"); });
    await rejects({ type: "setSlotCounts", counts: [] } as unknown as WorkingScheduleCommand, 409, expect.stringMatching(/^Some of those slots have people or history/) as unknown as string);
  });

  it("passes unknown errors through, including ones named like object keys", async () => {
    mocks.applyCommand.mockImplementationOnce(() => { throw new Error("constructor"); });
    await expect(run(adjust)).rejects.toThrow("constructor");

    mocks.applyCommand.mockImplementationOnce(() => { throw "not an error"; });
    await expect(run(adjust)).rejects.toBe("not an error");
    expect(mocks.updateWorkingCopy).not.toHaveBeenCalled();
  });
});
