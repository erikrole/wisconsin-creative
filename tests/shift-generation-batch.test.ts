import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const { db, nonGame } = vi.hoisted(() => {
  const db = {
    calendarEvent: { findUnique: vi.fn(), findMany: vi.fn() },
    sportConfig: { findUnique: vi.fn(), findMany: vi.fn() },
    shiftGroup: { create: vi.fn() },
    shift: { createMany: vi.fn() },
    $transaction: vi.fn(),
  };
  return { db, nonGame: vi.fn() };
});

vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/services/non-game-schedule-defaults", () => ({ getNonGameScheduleDefaults: nonGame }));

import {
  generateShiftsForEvent,
  generateShiftsForEvents,
  generateShiftsForNewEvents,
  regenerateShiftsForEvent,
} from "@/lib/services/shift-generation";

const kickoff = new Date("2026-10-24T16:00:00.000Z");
const final = new Date("2026-10-24T19:30:00.000Z");
const minutes = (date: Date, n: number) => new Date(date.getTime() + n * 60_000);

function event(id: string, overrides: Record<string, unknown> = {}) {
  return { id, sportCode: "FB", opponent: "Iowa", isHome: true, allDay: false, startsAt: kickoff, endsAt: final, ...overrides };
}

const football = {
  sportCode: "FB",
  active: true,
  shiftStartOffset: 90,
  shiftEndOffset: 30,
  shiftConfigs: [
    { area: "VIDEO", homeCount: 2, awayCount: 1, homeStaffCount: 1, homeStudentCount: 2, awayStaffCount: 0, awayStudentCount: 1 },
    { area: "PHOTO", homeCount: 1, awayCount: 0, homeStaffCount: null, homeStudentCount: null, awayStaffCount: null, awayStudentCount: null },
  ],
};

const meetingDefaults = {
  shiftStartOffset: 15,
  shiftEndOffset: 0,
  shiftConfigs: [{ area: "VIDEO", staffCount: 1, studentCount: 1 }],
};

function createdShifts() {
  return db.shift.createMany.mock.calls.flatMap(([args]) => args.data);
}

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
  let groups = 0;
  db.shiftGroup.create.mockImplementation(async () => ({ id: `group-${++groups}` }));
  db.shift.createMany.mockResolvedValue({ count: 0 });
  db.sportConfig.findMany.mockResolvedValue([football]);
  nonGame.mockResolvedValue(meetingDefaults);
});

describe("generateShiftsForEvents", () => {
  it("builds every event's slots in one transaction, students on the call-time window", async () => {
    db.calendarEvent.findMany.mockResolvedValue([
      event("home"),
      event("away", { isHome: false }),
      event("meeting", { opponent: null, sportCode: null }),
      event("unknown-sport", { sportCode: "XX" }),
    ]);

    const result = await generateShiftsForEvents({ where: { sourceId: "s1" } });

    expect(result).toEqual({ eventsMatched: 4, groupsCreated: 3, shiftsCreated: 7, hasMore: false });
    expect(db.shiftGroup.create.mock.calls.map(([args]) => args.data.eventId)).toEqual(["home", "away", "meeting"]);
    expect(db.sportConfig.findMany.mock.calls[0]?.[0]?.where).toEqual({ sportCode: { in: ["FB", "XX"] }, active: true });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.$transaction.mock.calls[0]?.[1]).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    const shifts = createdShifts();
    // Home: 1 staff + 2 students on video, 1 student on photo (falls back to homeCount).
    const home = shifts.filter((s) => s.shiftGroupId === "group-1");
    expect(home.map((s) => `${s.area}:${s.workerType}`)).toEqual(["VIDEO:FT", "VIDEO:ST", "VIDEO:ST", "PHOTO:ST"]);
    expect(home[0]).toMatchObject({ startsAt: kickoff, endsAt: final, templateManaged: true });
    expect(home[1]).toMatchObject({ startsAt: minutes(kickoff, -90), endsAt: minutes(final, 30) });
    // Away: one video student only.
    expect(shifts.filter((s) => s.shiftGroupId === "group-2").map((s) => `${s.area}:${s.workerType}`)).toEqual(["VIDEO:ST"]);
    // A non-game event uses the non-game defaults.
    const meeting = shifts.filter((s) => s.shiftGroupId === "group-3");
    expect(meeting.map((s) => s.workerType)).toEqual(["FT", "ST"]);
    expect(meeting[1]).toMatchObject({ startsAt: minutes(kickoff, -15), endsAt: final });
  });

  it("caps a batch, reports that more remain, and orders by start", async () => {
    db.calendarEvent.findMany.mockResolvedValue([event("a"), event("b"), event("c")]);

    const result = await generateShiftsForEvents({ where: {}, limit: 2 });

    expect(result).toMatchObject({ eventsMatched: 2, groupsCreated: 2, hasMore: true });
    expect(db.calendarEvent.findMany.mock.calls[0]?.[0]).toMatchObject({ take: 3, orderBy: { startsAt: "asc" } });
  });

  it("never asks for more than 200 events at once", async () => {
    db.calendarEvent.findMany.mockResolvedValue([]);

    expect(await generateShiftsForEvents({ where: {}, limit: 5_000 })).toEqual({ eventsMatched: 0, groupsCreated: 0, shiftsCreated: 0, hasMore: false });
    expect(db.calendarEvent.findMany.mock.calls[0]?.[0]?.take).toBe(201);
    expect(db.sportConfig.findMany).not.toHaveBeenCalled();
  });

  it("writes nothing when no event has a template", async () => {
    db.calendarEvent.findMany.mockResolvedValue([event("x", { sportCode: "XX" })]);

    expect(await generateShiftsForEvents({ where: {} })).toEqual({ eventsMatched: 1, groupsCreated: 0, shiftsCreated: 0, hasMore: false });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("covers only upcoming events without shifts for a synced source", async () => {
    vi.useFakeTimers({ now: kickoff });
    try {
      db.calendarEvent.findMany.mockResolvedValue([event("home")]);

      expect(await generateShiftsForNewEvents("source-1")).toEqual({ groupsCreated: 1, shiftsCreated: 4 });
      expect(db.calendarEvent.findMany.mock.calls[0]?.[0]?.where).toEqual({ sourceId: "source-1", shiftGroup: null, startsAt: { gte: kickoff } });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("generateShiftsForEvent", () => {
  it("leaves events alone that are missing, already staffed, or without a template", async () => {
    db.calendarEvent.findUnique.mockResolvedValueOnce(null);
    expect(await generateShiftsForEvent("gone")).toEqual({ created: false, shiftGroupId: null, shiftCount: 0 });

    db.calendarEvent.findUnique.mockResolvedValueOnce({ ...event("e"), shiftGroup: { id: "g-old" } });
    expect(await generateShiftsForEvent("e")).toEqual({ created: false, shiftGroupId: "g-old", shiftCount: 0 });

    db.calendarEvent.findUnique.mockResolvedValueOnce({ ...event("e"), shiftGroup: null });
    db.sportConfig.findUnique.mockResolvedValueOnce({ ...football, active: false });
    expect((await generateShiftsForEvent("e")).created).toBe(false);

    expect(db.shiftGroup.create).not.toHaveBeenCalled();
  });

  it("builds a non-game event from the non-game defaults", async () => {
    db.calendarEvent.findUnique.mockResolvedValue({ ...event("m", { opponent: null }), shiftGroup: null });

    expect(await generateShiftsForEvent("m")).toEqual({ created: true, shiftGroupId: "group-1", shiftCount: 2 });
  });

  it("keeps the group another request created first", async () => {
    db.calendarEvent.findUnique
      .mockResolvedValueOnce({ ...event("e"), shiftGroup: null })
      .mockResolvedValueOnce({ ...event("e"), shiftGroup: { id: "g-race" } });
    db.sportConfig.findUnique.mockResolvedValue(football);

    expect(await generateShiftsForEvent("e")).toEqual({ created: false, shiftGroupId: "g-race", shiftCount: 0 });
    expect(db.shift.createMany).not.toHaveBeenCalled();
  });
});

describe("regenerateShiftsForEvent", () => {
  function staffed(shifts: Array<{ area: string; workerType: string }>, manuallyEdited = false) {
    return { ...event("e"), shiftGroup: { id: "g1", manuallyEdited, shifts } };
  }

  it("adds only the missing positions and keeps existing ones", async () => {
    db.calendarEvent.findUnique.mockResolvedValue(staffed([
      { area: "VIDEO", workerType: "FT" },
      { area: "VIDEO", workerType: "ST" },
      { area: "VIDEO", workerType: "ST" },
      { area: "VIDEO", workerType: "ST" }, // an extra slot is never removed
    ]));
    db.sportConfig.findUnique.mockResolvedValue(football);

    expect(await regenerateShiftsForEvent("e")).toEqual({ added: 1 });
    expect(createdShifts()).toEqual([
      { shiftGroupId: "g1", area: "PHOTO", workerType: "ST", startsAt: minutes(kickoff, -90), endsAt: minutes(final, 30), templateManaged: true },
    ]);
  });

  it("does nothing for a hand-edited schedule, an inactive sport, or a full one", async () => {
    db.sportConfig.findUnique.mockResolvedValue(football);

    db.calendarEvent.findUnique.mockResolvedValueOnce(staffed([], true));
    expect(await regenerateShiftsForEvent("e")).toEqual({ added: 0 });

    db.calendarEvent.findUnique.mockResolvedValueOnce(staffed([]));
    db.sportConfig.findUnique.mockResolvedValueOnce({ ...football, active: false });
    expect(await regenerateShiftsForEvent("e")).toEqual({ added: 0 });

    db.calendarEvent.findUnique.mockResolvedValueOnce(staffed([
      { area: "VIDEO", workerType: "FT" }, { area: "VIDEO", workerType: "ST" }, { area: "VIDEO", workerType: "ST" }, { area: "PHOTO", workerType: "ST" },
    ]));
    expect(await regenerateShiftsForEvent("e")).toEqual({ added: 0 });

    db.calendarEvent.findUnique.mockResolvedValueOnce({ ...event("e"), shiftGroup: null });
    expect(await regenerateShiftsForEvent("e")).toEqual({ added: 0 });

    expect(db.shift.createMany).not.toHaveBeenCalled();
  });
});
