import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingKind, BookingStatus, ShiftAssignmentStatus, ShiftTradeStatus, ShiftWorkerType } from "@prisma/client";

const dbMock = vi.hoisted(() => ({
  shiftGroup: {
    findMany: vi.fn(),
  },
  shiftTrade: {
    findMany: vi.fn(),
  },
  booking: {
    findMany: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ db: dbMock }));

import {
  buildScheduleExport,
  parseScheduleExportType,
  SCHEDULE_EXPORT_MAX_DAYS,
} from "@/lib/services/schedule-exports";

const baseInput = {
  parsedStartDate: new Date("2026-07-01T00:00:00Z"),
  parsedEndDate: new Date("2026-07-08T23:59:59Z"),
  includeArchived: false,
  sportCode: null,
};

function groupFixture() {
  return {
    id: "group-1",
    publishedAt: new Date("2026-07-01T12:00:00Z"),
    publishedById: "staff-1",
    lastPublishedSnapshot: null,
    archivedAt: null,
    event: {
      id: "event-1",
      summary: "=Volleyball",
      startsAt: new Date("2026-07-03T18:00:00Z"),
      endsAt: new Date("2026-07-03T21:00:00Z"),
      sportCode: "VB",
      opponent: "+Iowa",
      isHome: true,
      location: { name: "+Field House" },
    },
    shifts: [
      {
        id: "shift-1",
        area: "VIDEO",
        workerType: ShiftWorkerType.ST,
        startsAt: new Date("2026-07-03T17:00:00Z"),
        endsAt: new Date("2026-07-03T20:00:00Z"),
        callStartsAt: new Date("2026-07-03T16:30:00Z"),
        callEndsAt: new Date("2026-07-03T20:30:00Z"),
        assignments: [
          {
            id: "assignment-1",
            userId: "user-1",
            status: ShiftAssignmentStatus.DIRECT_ASSIGNED,
            callStartsAt: null,
            callEndsAt: null,
            hasConflict: true,
            conflictNote: "-Class overlap",
            acknowledgedAt: null,
            user: { name: "@Ada", role: "STUDENT", staffingType: "ST", primaryArea: "VIDEO" },
          },
        ],
      },
      {
        id: "shift-2",
        area: "PHOTO",
        workerType: ShiftWorkerType.FT,
        startsAt: new Date("2026-07-03T17:00:00Z"),
        endsAt: new Date("2026-07-03T20:00:00Z"),
        callStartsAt: null,
        callEndsAt: null,
        assignments: [
          {
            id: "assignment-2",
            userId: "user-2",
            status: ShiftAssignmentStatus.DIRECT_ASSIGNED,
            callStartsAt: null,
            callEndsAt: null,
            hasConflict: false,
            conflictNote: null,
            acknowledgedAt: null,
            user: { name: "Grace", role: "STUDENT", staffingType: "FT", primaryArea: "PHOTO" },
          },
        ],
      },
      {
        id: "shift-3",
        area: "GRAPHICS",
        workerType: ShiftWorkerType.FT,
        startsAt: new Date("2026-07-03T17:00:00Z"),
        endsAt: new Date("2026-07-03T20:00:00Z"),
        callStartsAt: null,
        callEndsAt: null,
        assignments: [
          {
            id: "request-1",
            userId: "user-3",
            status: ShiftAssignmentStatus.REQUESTED,
            callStartsAt: null,
            callEndsAt: null,
            hasConflict: false,
            conflictNote: null,
            acknowledgedAt: null,
            user: { name: "Pat", role: "STUDENT", staffingType: "ST", primaryArea: "GRAPHICS" },
          },
        ],
      },
    ],
  };
}

describe("schedule exports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.shiftGroup.findMany.mockResolvedValue([groupFixture()]);
    dbMock.shiftTrade.findMany.mockResolvedValue([]);
    dbMock.booking.findMany.mockResolvedValue([]);
  });

  it("exports a formula-safe roster CSV with publication and acknowledgement columns", async () => {
    const result = await buildScheduleExport({ ...baseInput, type: "roster" });

    expect(result.csv).toContain("Assigned Class,Planned Slot,Assignee");
    expect(result.csv).toContain("Student,Student slot,'@Ada");
    expect(result.csv).toContain("Staff,Staff slot,Grace");
    expect(result.csv).toContain("Staff,Staff slot,Grace,DIRECT_ASSIGNED,,,");
    expect(result.csv).toContain("Publication,Published At,Acknowledged,Acknowledged At");
    expect(result.csv).toContain("'=Volleyball");
    expect(result.csv).toContain("'+Field House");
    expect(result.csv).toContain("'@Ada");
    expect(result.csv).toContain("'-Class overlap");
    expect(result.exportedCount).toBe(3);
    expect(result.truncated).toBe(false);
  });

  it("names the file by Chicago calendar days, so a week ending Sunday night is not dated Monday", async () => {
    const result = await buildScheduleExport({
      ...baseInput,
      type: "roster",
      parsedStartDate: new Date("2026-10-05T05:00:00.000Z"),
      parsedEndDate: new Date("2026-10-12T04:59:59.999Z"),
    });

    expect(result.filename).toBe("schedule-roster-2026-10-05-to-2026-10-11.csv");
  });

  it("summarizes hours by active worker only", async () => {
    const result = await buildScheduleExport({ ...baseInput, type: "hours" });

    expect(result.csv).toContain("Worker,Class,Shifts,Events,Hours,Conflicts");
    expect(result.csv).toContain("'@Ada,Student,1,1,4.00,1");
    expect(result.csv).toContain("Grace,Staff,1,1,3.00,0");
  });

  it("exports open slot and pending request counts", async () => {
    const result = await buildScheduleExport({ ...baseInput, type: "open-slots" });

    expect(result.csv).toContain("Shift ID,Area,Planned Slot");
    expect(result.csv).toContain("shift-3,GRAPHICS,Staff");
    expect(result.csv).toContain(",1\n");
  });

  it("exports trade and open-work request rows", async () => {
    dbMock.shiftTrade.findMany.mockResolvedValue([
      {
        id: "trade-1",
        shiftAssignmentId: "assignment-1",
        status: ShiftTradeStatus.OPEN,
        postedAt: new Date("2026-07-02T10:00:00Z"),
        claimedAt: null,
        resolvedAt: null,
        postedBy: { name: "Ada" },
        claimedBy: null,
      },
    ]);

    const result = await buildScheduleExport({ ...baseInput, type: "trades" });

    expect(result.csv).toContain("Planned Slot,Assigned Class,Worker");
    expect(result.csv).toContain("trade,event-1");
    expect(result.csv).toContain("open-work-request,event-1");
  });

  it("exports assignment-linked gear readiness", async () => {
    dbMock.booking.findMany.mockResolvedValue([
      {
        id: "booking-1",
        kind: BookingKind.RESERVATION,
        title: "Gear, prep",
        status: BookingStatus.BOOKED,
        requesterUserId: "user-1",
        eventId: null,
        shiftAssignmentId: "assignment-1",
        events: [],
      },
    ]);

    const result = await buildScheduleExport({ ...baseInput, type: "gear-readiness" });

    expect(result.csv).toContain("Planned Slot,Assigned Class,Worker,Gear Status,Link Type,Booking ID,Booking");
    expect(result.csv).toContain('Reserved,assignment,booking-1,"Gear, prep"');
  });

  it("rejects unsupported export types and over-wide windows", async () => {
    expect(() => parseScheduleExportType("bad")).toThrow("type must be");

    await expect(buildScheduleExport({
      ...baseInput,
      type: "roster",
      parsedEndDate: new Date(baseInput.parsedStartDate.getTime() + (SCHEDULE_EXPORT_MAX_DAYS + 1) * 24 * 60 * 60 * 1000),
    })).rejects.toThrow("capped");
  });
});
