import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  calendarEvent: { findMany: vi.fn() },
  gameSnapshot: { findMany: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ db }));

import { captureGameSnapshots, GAME_SNAPSHOT_SEASON_KEY, liveCrew } from "@/lib/services/game-snapshots";

const now = new Date("2026-10-25T12:00:00.000Z");
const days = (n: number) => new Date(now.getTime() - n * 86_400_000);

function event(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    summary: "Football vs Iowa",
    rawSummary: "Football vs Iowa",
    rawLocationText: "Camp Randall Stadium, Madison, Wis.",
    startsAt: days(1),
    endsAt: days(1),
    status: "CONFIRMED",
    result: "WIN",
    sportCode: "FB",
    opponent: "Iowa",
    site: "HOME",
    shiftGroup: {
      shifts: [
        { area: "VIDEO", assignments: [{ crewLabel: "Handheld", attended: true, user: { id: "u2", name: "Zoe" } }] },
        { area: "PHOTO", assignments: [{ crewLabel: null, attended: null, user: { id: "u2", name: "Zoe" } }, { crewLabel: null, attended: false, user: { id: "u1", name: "Avery" } }] },
      ],
    },
    workers: [{ user: { id: "u1", name: "Avery" } }, { user: { id: "u3", name: "Sam" } }],
    ...overrides,
  };
}

function upserts() {
  return db.gameSnapshot.upsert.mock.calls.map(([args]) => args);
}

beforeEach(() => {
  vi.clearAllMocks();
  db.gameSnapshot.findMany.mockResolvedValue([]);
  db.gameSnapshot.updateMany.mockResolvedValue({ count: 0 });
  db.gameSnapshot.upsert.mockResolvedValue({});
});

describe("liveCrew", () => {
  it("lists each person once, preferring their assigned slot over a worker row", () => {
    expect(liveCrew(event("e1") as never)).toEqual([
      { userId: "u2", name: "Zoe", source: "assignment", area: "VIDEO", crewLabel: "Handheld", attended: true },
      { userId: "u1", name: "Avery", source: "assignment", area: "PHOTO", crewLabel: null, attended: false },
      { userId: "u3", name: "Sam", source: "worker", area: null, crewLabel: null, attended: null },
    ]);
    expect(liveCrew(event("e2", { shiftGroup: null, workers: [] }) as never)).toEqual([]);
  });
});

describe("captureGameSnapshots", () => {
  it("snapshots a finished game with its crew, venue and result", async () => {
    db.calendarEvent.findMany
      .mockResolvedValueOnce([{ id: "e1", endsAt: days(1) }])
      .mockResolvedValueOnce([event("e1")]);

    expect(await captureGameSnapshots(now)).toEqual({ captured: 1, remaining: 0, deletedMarked: 0 });

    const where = db.calendarEvent.findMany.mock.calls[0]?.[0]?.where;
    expect(where).toMatchObject({ endsAt: { lt: now }, isHidden: false, status: { not: "CANCELLED" } });
    const [args] = upserts();
    expect(args.where).toEqual({ eventId: "e1" });
    expect(args.update).toMatchObject({
      seasonKey: GAME_SNAPSHOT_SEASON_KEY,
      official: true,
      result: "WIN",
      resultRecordedAt: now,
      resultHistory: [{ result: "WIN", at: now.toISOString() }],
      crewCount: 3,
      eventDeletedAt: null,
    });
    expect(args.update.venue).toBeTruthy();
    expect(args.update.crew.map((member: { name: string }) => member.name)).toEqual(["Avery", "Sam", "Zoe"]);
    expect(args.create).toMatchObject({ eventId: "e1", crewCount: 3 });
  });

  it("re-reads a recent game, keeps people who left, and logs only a changed result", async () => {
    const recordedAt = days(3);
    db.gameSnapshot.findMany
      .mockResolvedValueOnce([{ eventId: "recent", eventDeletedAt: null }, { eventId: "old", eventDeletedAt: null }])
      .mockResolvedValueOnce([{
        eventId: "recent",
        crew: [{ userId: "u9", name: "Lee", source: "worker", area: null, crewLabel: null, attended: null, leftAt: null }],
        resultHistory: [{ result: "WIN", at: recordedAt.toISOString() }],
        resultRecordedAt: recordedAt,
      }]);
    db.calendarEvent.findMany
      .mockResolvedValueOnce([{ id: "recent", endsAt: days(2) }, { id: "old", endsAt: days(30) }])
      .mockResolvedValueOnce([event("recent", { shiftGroup: null, workers: [{ user: { id: "u1", name: "Avery" } }], rawSummary: "Football Exhibition vs Alumni" })]);

    await captureGameSnapshots(now);

    // The old game is already captured and outside the 14-day window, so it is not re-read.
    expect(db.calendarEvent.findMany.mock.calls[1]?.[0]?.where).toEqual({ id: { in: ["recent"] } });
    const data = upserts()[0].update;
    expect(data).toMatchObject({ official: false, resultRecordedAt: recordedAt, resultHistory: [{ result: "WIN", at: recordedAt.toISOString() }], crewCount: 1 });
    expect(data.crew).toEqual([
      { userId: "u1", name: "Avery", source: "worker", area: null, crewLabel: null, attended: null, leftAt: null },
      { userId: "u9", name: "Lee", source: "worker", area: null, crewLabel: null, attended: null, leftAt: now.toISOString() },
    ]);
  });

  it("flags snapshots whose event was deleted, but not ones that only stopped qualifying", async () => {
    db.gameSnapshot.findMany.mockResolvedValueOnce([
      { eventId: "deleted", eventDeletedAt: null },
      { eventId: "hidden", eventDeletedAt: null },
      { eventId: "flagged", eventDeletedAt: days(5) },
    ]);
    db.calendarEvent.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "hidden" }]);
    db.gameSnapshot.updateMany.mockResolvedValue({ count: 1 });

    expect(await captureGameSnapshots(now)).toEqual({ captured: 0, remaining: 0, deletedMarked: 1 });
    expect(db.calendarEvent.findMany.mock.calls[1]?.[0]?.where).toEqual({ id: { in: ["deleted", "hidden"] } });
    expect(db.gameSnapshot.updateMany).toHaveBeenCalledWith({ where: { eventId: { in: ["deleted"] } }, data: { eventDeletedAt: now } });
  });

  it("captures missing games first, 150 at a time, and stops at the deadline", async () => {
    const finished = Array.from({ length: 160 }, (_, i) => ({ id: `e${i}`, endsAt: days(40) }));
    db.calendarEvent.findMany
      .mockResolvedValueOnce(finished)
      .mockImplementationOnce(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => event(id)));

    const result = await captureGameSnapshots(now);

    expect(db.calendarEvent.findMany.mock.calls[1]?.[0]?.where?.id?.in).toHaveLength(150);
    expect(result).toEqual({ captured: 150, remaining: 10, deletedMarked: 0 });

    vi.clearAllMocks();
    db.gameSnapshot.findMany.mockResolvedValue([]);
    db.calendarEvent.findMany
      .mockResolvedValueOnce(finished.slice(0, 3))
      .mockResolvedValueOnce([event("e0"), event("e1"), event("e2")]);
    let calls = 0;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => (calls++ < 1 ? 0 : 10_000));
    try {
      expect(await captureGameSnapshots(now, { deadlineAt: 5_000 })).toEqual({ captured: 1, remaining: 2, deletedMarked: 0 });
    } finally {
      spy.mockRestore();
    }
  });
});
