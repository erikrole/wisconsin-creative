import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShiftAssignmentStatus } from "@prisma/client";

const dbMock = vi.hoisted(() => ({
  $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(dbMock)),
  calendarEvent: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  shiftGroup: { update: vi.fn() },
  shiftGroupWorkingCopy: { updateMany: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/audit", () => ({ createAuditEntryTx: vi.fn() }));

import { createAuditEntryTx } from "@/lib/audit";
import {
  combineScheduleEvents,
  previewCombinedScheduleEvents,
  uncombineScheduleEvents,
} from "@/lib/services/combined-schedule-events";

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: "cmevent000000000000000001",
    summary: "Women's Cross Country vs Badger Classic",
    sportCode: "WXC",
    opponent: "Badger Classic",
    startsAt: new Date("2026-09-04T15:00:00.000Z"),
    endsAt: new Date("2026-09-04T18:00:00.000Z"),
    locationId: null,
    rawLocationText: "Madison, Wis., Zimmer Championship Course",
    combinedIntoId: null,
    combinedEvents: [],
    shiftGroup: {
      id: "cmgroup00000000000000001",
      publishedAt: new Date("2026-08-26T21:38:41.356Z"),
      archivedAt: null,
      workingCopy: null,
      shifts: [{
        id: "cmshift00000000000000001",
        assignments: [{ id: "cmassign000000000000001", status: ShiftAssignmentStatus.DIRECT_ASSIGNED }],
      }],
    },
    ...overrides,
  };
}

const secondary = () => event({
  id: "cmevent000000000000000002",
  summary: "Men's Cross Country vs Badger Classic",
  sportCode: "MXC",
  startsAt: new Date("2026-09-04T15:45:00.000Z"),
  endsAt: new Date("2026-09-04T18:45:00.000Z"),
  rawLocationText: "Madison, WI, Zimmer Championship Course",
  shiftGroup: {
    id: "cmgroup00000000000000002",
    publishedAt: null,
    archivedAt: null,
    workingCopy: { version: 8 },
    shifts: Array.from({ length: 6 }, (_, index) => ({ id: `shift-${index}`, assignments: [] })),
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.calendarEvent.findMany.mockResolvedValue([event(), secondary()]);
  dbMock.calendarEvent.findUnique.mockResolvedValue(secondaryEvent({
    combinedIntoId: "cmevent000000000000000001",
    shiftGroup: {
      ...secondary().shiftGroup,
      archivedAt: new Date("2026-09-03T18:00:00.000Z"),
      workingCopy: { version: 9 },
    },
  }));
  dbMock.shiftGroupWorkingCopy.updateMany.mockResolvedValue({ count: 1 });
  dbMock.shiftGroup.update.mockResolvedValue({});
  dbMock.calendarEvent.update.mockResolvedValue({});
  dbMock.calendarEvent.updateMany.mockResolvedValue({ count: 1 });
  vi.mocked(createAuditEntryTx).mockResolvedValue(undefined);
});

describe("combined Schedule events", () => {
  it("previews the published crew as canonical for the overlapping same-venue sport pair", async () => {
    const result = await previewCombinedScheduleEvents([
      "cmevent000000000000000001",
      "cmevent000000000000000002",
    ]);

    expect(result.primary.id).toBe("cmevent000000000000000001");
    expect(result.primary.assignedCrewCount).toBe(1);
    expect(result.secondary).toMatchObject({
      id: "cmevent000000000000000002",
      workingVersion: 8,
      draftSlotCount: 6,
    });
    expect(result.combinedWindow).toEqual({
      startsAt: "2026-09-04T15:00:00.000Z",
      endsAt: "2026-09-04T18:45:00.000Z",
    });
  });

  it("rejects a pair that does not overlap", async () => {
    dbMock.calendarEvent.findMany.mockResolvedValue([
      event(),
      secondaryEvent({ startsAt: new Date("2026-09-05T15:45:00.000Z"), endsAt: new Date("2026-09-05T18:45:00.000Z") }),
    ]);
    await expect(previewCombinedScheduleEvents([
      "cmevent000000000000000001",
      "cmevent000000000000000002",
    ])).rejects.toMatchObject({ status: 409 });
  });

  it("rejects an already archived secondary crew setup", async () => {
    dbMock.calendarEvent.findMany.mockResolvedValue([
      event(),
      secondaryEvent({ shiftGroup: { ...secondary().shiftGroup, archivedAt: new Date() } }),
    ]);
    await expect(previewCombinedScheduleEvents([
      "cmevent000000000000000001",
      "cmevent000000000000000002",
    ])).rejects.toMatchObject({ status: 409 });
  });

  it("retires only the secondary draft and writes an audit receipt", async () => {
    const result = await combineScheduleEvents({
      eventIds: ["cmevent000000000000000001", "cmevent000000000000000002"],
      expectedPrimaryId: "cmevent000000000000000001",
      expectedSecondaryWorkingVersion: 8,
      actor: { id: "cmstaff000000000000000001", role: "STAFF" },
    });

    expect(result.primary.id).toBe("cmevent000000000000000001");
    expect(dbMock.shiftGroupWorkingCopy.updateMany).toHaveBeenCalledWith({
      where: { shiftGroupId: "cmgroup00000000000000002", version: 8 },
      data: {
        version: { increment: 1 },
        autoReleaseAt: null,
        autoReleaseRunId: null,
        autoReleaseError: "Retired when this event was combined into a shared crew.",
      },
    });
    expect(dbMock.shiftGroup.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "cmgroup00000000000000002" },
      data: expect.objectContaining({ archivedAt: expect.any(Date), notifyAfter: null }),
    }));
    expect(dbMock.calendarEvent.update).toHaveBeenCalledWith({
      where: { id: "cmevent000000000000000002" },
      data: { combinedIntoId: "cmevent000000000000000001" },
    });
    expect(createAuditEntryTx).toHaveBeenCalledWith(dbMock, expect.objectContaining({
      action: "calendar_events_combined",
      entityId: "cmevent000000000000000001",
    }));
  });

  it("undoes the relationship and restores the retained draft without scheduling release", async () => {
    const result = await uncombineScheduleEvents({
      primaryEventId: "cmevent000000000000000001",
      secondaryEventId: "cmevent000000000000000002",
      actor: { id: "cmstaff000000000000000001", role: "STAFF" },
    });

    expect(result).toEqual({
      primaryEventId: "cmevent000000000000000001",
      secondaryEventId: "cmevent000000000000000002",
      restoredShiftGroupId: "cmgroup00000000000000002",
      retainedWorkingVersion: 9,
    });
    expect(dbMock.calendarEvent.updateMany).toHaveBeenCalledWith({
      where: { id: "cmevent000000000000000002", combinedIntoId: "cmevent000000000000000001" },
      data: { combinedIntoId: null },
    });
    expect(dbMock.shiftGroup.update).toHaveBeenCalledWith({
      where: { id: "cmgroup00000000000000002" },
      data: { archivedAt: null, notifyAfter: null, notifyAttemptedAt: null, notifyError: null },
    });
    expect(dbMock.shiftGroupWorkingCopy.updateMany).toHaveBeenCalledWith({
      where: { shiftGroupId: "cmgroup00000000000000002", version: 9 },
      data: { autoReleaseAt: null, autoReleaseRunId: null, autoReleaseError: null },
    });
    expect(createAuditEntryTx).toHaveBeenCalledWith(dbMock, expect.objectContaining({
      action: "calendar_events_uncombined",
      entityId: "cmevent000000000000000001",
    }));
  });
});

function secondaryEvent(overrides: Record<string, unknown>) {
  return { ...secondary(), ...overrides };
}
