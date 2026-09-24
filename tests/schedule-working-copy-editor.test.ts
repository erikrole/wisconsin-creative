import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findGroup: vi.fn(),
  findUsers: vi.fn(),
  findSportConfig: vi.fn(),
  findAssignments: vi.fn(),
  findTrades: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    shiftGroup: { findUnique: mocks.findGroup },
    user: { findMany: mocks.findUsers },
    sportConfig: { findUnique: mocks.findSportConfig },
    shiftAssignment: { findMany: mocks.findAssignments },
    shiftTrade: { findMany: mocks.findTrades },
  },
}));

import { getWorkingScheduleEditor } from "@/lib/services/schedule-working-copy";

const eventStartsAt = new Date("2026-08-08T17:00:00.000Z");
const eventEndsAt = new Date("2026-08-08T20:00:00.000Z");

function draftSlot(key: string, area: "VIDEO" | "COMMS", userId: string) {
  return {
    key,
    sourceShiftId: null,
    area,
    workerType: "FT",
    startsAt: eventStartsAt.toISOString(),
    endsAt: eventEndsAt.toISOString(),
    callStartsAt: null,
    callEndsAt: null,
    notes: null,
    assignmentHistoryCount: 0,
    assignment: {
      sourceAssignmentId: null,
      userId,
      status: "DIRECT_ASSIGNED",
      callStartsAt: null,
      callEndsAt: null,
      callNote: null,
      activeTradeId: null,
      bookingCount: 0,
    },
  };
}

describe("working schedule editor read model", () => {
  beforeEach(() => {
    mocks.findGroup.mockReset();
    mocks.findUsers.mockReset();
    mocks.findSportConfig.mockReset();
    mocks.findAssignments.mockReset();
    mocks.findTrades.mockReset();
    mocks.findSportConfig.mockResolvedValue(null);
    mocks.findAssignments.mockResolvedValue([]);
    mocks.findTrades.mockResolvedValue([]);
  });

  it("hydrates draft-only assignee identities after refresh", async () => {
    mocks.findGroup.mockResolvedValue({
      id: "group-1",
      publishedAt: new Date("2026-07-01T12:00:00.000Z"),
      publishedVersion: 2,
      event: { startsAt: eventStartsAt, endsAt: eventEndsAt, allDay: false, sportCode: "VB" },
      shifts: [],
      workingCopy: {
        version: 4,
        basePublishedVersion: 2,
        payloadVersion: 1,
        payload: {
          eventStartsAt: eventStartsAt.toISOString(),
          eventEndsAt: eventEndsAt.toISOString(),
          slots: [
            draftSlot("draft:ashley", "VIDEO", "ashley-id"),
            draftSlot("draft:maddy", "COMMS", "maddy-id"),
          ],
        },
        createdAt: new Date("2026-07-22T11:00:00.000Z"),
        updatedAt: new Date("2026-07-22T12:00:00.000Z"),
        updatedById: "admin-1",
      },
    });
    mocks.findUsers.mockResolvedValue([
      {
        id: "ashley-id",
        name: "Ashley",
        role: "STAFF",
        staffingType: "FT",
        primaryArea: "VIDEO",
        avatarUrl: "/ashley.jpg",
      },
      {
        id: "maddy-id",
        name: "Maddy",
        role: "STAFF",
        staffingType: "FT",
        primaryArea: "COMMS",
        avatarUrl: "/maddy.jpg",
      },
    ]);

    const result = await getWorkingScheduleEditor("group-1");

    expect(mocks.findUsers).toHaveBeenCalledWith({
      where: { id: { in: ["ashley-id", "maddy-id"] } },
      select: {
        id: true,
        name: true,
        role: true,
        staffingType: true,
        primaryArea: true,
        avatarUrl: true,
      },
    });
    expect(result.assignedUsers).toEqual([
      expect.objectContaining({ id: "ashley-id", name: "Ashley" }),
      expect.objectContaining({ id: "maddy-id", name: "Maddy" }),
    ]);
    expect(result.defaultWindow).toEqual({
      startsAt: eventStartsAt.toISOString(),
      endsAt: eventEndsAt.toISOString(),
    });
    expect(result.allDay).toBe(false);
  });

  it("returns the settings-owned default window for a timed event", async () => {
    mocks.findGroup.mockResolvedValue({
      id: "group-2",
      publishedAt: new Date("2026-07-01T12:00:00.000Z"),
      publishedVersion: 2,
      event: { startsAt: eventStartsAt, endsAt: eventEndsAt, allDay: false, sportCode: "VB" },
      shifts: [],
      workingCopy: null,
    });
    mocks.findUsers.mockResolvedValue([]);
    mocks.findSportConfig.mockResolvedValue({ shiftStartOffset: 90, shiftEndOffset: 30 });

    const result = await getWorkingScheduleEditor("group-2");

    expect(mocks.findSportConfig).toHaveBeenCalledWith({
      where: { sportCode: "VB" },
      select: { shiftStartOffset: true, shiftEndOffset: true },
    });
    expect(result.defaultWindow).toEqual({
      startsAt: "2026-08-08T15:30:00.000Z",
      endsAt: "2026-08-08T20:30:00.000Z",
    });
    expect(result.allDay).toBe(false);
  });

  it("includes live open-slot claims and claimed trades for crew review", async () => {
    mocks.findGroup.mockResolvedValue({
      id: "group-3",
      publishedAt: new Date("2026-07-01T12:00:00.000Z"),
      publishedVersion: 2,
      event: { startsAt: eventStartsAt, endsAt: eventEndsAt, allDay: false, sportCode: "VB" },
      shifts: [
        {
          id: "shift-open",
          createdAt: eventStartsAt,
          area: "VIDEO",
          workerType: "ST",
          startsAt: eventStartsAt,
          endsAt: eventEndsAt,
          callStartsAt: null,
          callEndsAt: null,
          notes: null,
          _count: { assignments: 0 },
          assignments: [],
        },
        {
          id: "shift-filled",
          createdAt: eventStartsAt,
          area: "PHOTO",
          workerType: "ST",
          startsAt: eventStartsAt,
          endsAt: eventEndsAt,
          callStartsAt: null,
          callEndsAt: null,
          notes: null,
          _count: { assignments: 1 },
          assignments: [{
            id: "assignment-live",
            userId: "poster-id",
            status: "DIRECT_ASSIGNED",
            source: "MANUAL",
            callStartsAt: null,
            callEndsAt: null,
            callNote: null,
            trades: [{ id: "trade-1" }],
            _count: { bookings: 0 },
          }],
        },
      ],
      workingCopy: null,
    });
    mocks.findUsers.mockResolvedValue([{
      id: "poster-id",
      name: "Poster",
      role: "STUDENT",
      staffingType: "ST",
      primaryArea: "PHOTO",
      avatarUrl: null,
    }]);
    mocks.findAssignments.mockResolvedValue([
      {
        id: "claim-1",
        shiftId: "shift-open",
        hasConflict: false,
        conflictNote: null,
        user: { id: "student-a", name: "Alex", avatarUrl: null },
      },
      {
        id: "claim-2",
        shiftId: "shift-open",
        hasConflict: true,
        conflictNote: "Overlaps class",
        user: { id: "student-b", name: "Blair", avatarUrl: "/blair.jpg" },
      },
    ]);
    mocks.findTrades.mockResolvedValue([{
      id: "trade-1",
      notes: "Can cover",
      shiftAssignmentId: "assignment-live",
      claimedBy: { id: "student-c", name: "Casey", avatarUrl: null },
      postedBy: { id: "poster-id", name: "Poster", avatarUrl: null },
    }]);

    const result = await getWorkingScheduleEditor("group-3");

    expect(result.pendingClaims).toEqual([
      expect.objectContaining({ id: "claim-1", shiftId: "shift-open", user: expect.objectContaining({ name: "Alex" }) }),
      expect.objectContaining({
        id: "claim-2",
        hasConflict: true,
        conflictNote: "Overlaps class",
        user: expect.objectContaining({ name: "Blair" }),
      }),
    ]);
    expect(result.pendingTrades).toEqual([
      expect.objectContaining({
        id: "trade-1",
        assignmentId: "assignment-live",
        status: "CLAIMED",
        claimedBy: expect.objectContaining({ name: "Casey" }),
        postedBy: expect.objectContaining({ name: "Poster" }),
      }),
    ]);
  });
});
