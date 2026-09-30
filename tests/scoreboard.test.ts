import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: { calendarEvent: { findMany: vi.fn(), groupBy: vi.fn(), count: vi.fn() } } }));
import { db } from "@/lib/db";
import { SCOREBOARD_SCOPE, getScoreboardForUser } from "@/lib/services/scoreboard";

const findMany = vi.mocked(db.calendarEvent.findMany);
const event = (id: string, result: "WIN" | "LOSS" | "TIE" | null = null, extra = {}) => ({
  id, summary: "Worked " + id, startsAt: new Date("2026-09-01T18:00:00Z"), allDay: false,
  result, sportCode: "FB", opponent: "Iowa", site: "HOME", rawLocationText: "Madison, WI, Camp Randall Stadium",
  ...extra,
});
function season(work: ReturnType<typeof event>[], official: ReturnType<typeof event>[]) {
  findMany.mockResolvedValueOnce(work as never).mockResolvedValueOnce(official as never);
}
beforeEach(() => {
  vi.resetAllMocks();
  // Keep the old read boundaries available for the isolated pre-fix regression run.
  vi.mocked(db.calendarEvent.groupBy).mockResolvedValue([]);
  vi.mocked(db.calendarEvent.count).mockResolvedValue(0);
});

describe("individual Scoreboard", () => {
  it("queries the bounded official record with count-once participation", async () => {
    season([], []);
    await getScoreboardForUser("user-1");
    const where = findMany.mock.calls[1]?.[0]?.where;
    expect(where).toMatchObject({
      result: { not: null }, isHidden: false, archivedAt: null,
      startsAt: { gte: SCOREBOARD_SCOPE.startsAt, lt: SCOREBOARD_SCOPE.endsAt },
    });
    expect(where?.OR).toEqual([
      { shiftGroup: { shifts: { some: { assignments: { some: { userId: "user-1", status: { in: ["DIRECT_ASSIGNED", "APPROVED"] } } } } } } },
      { workers: { some: { userId: "user-1" } } },
    ]);
  });

  it("keeps four dimensions on a person and filters before pagination", async () => {
    const away = event("away", "WIN", { site: "AWAY" });
    const otherVenue = event("other-venue", "WIN", { rawLocationText: "Kohl Center" });
    const otherOpponent = event("other-opponent", "WIN", { opponent: "Minnesota" });
    const otherSport = event("other-sport", "WIN", { sportCode: "VB" });
    const match = event("match", "TIE", { opponent: "#7 Iowa (Home)" });
    season([away, otherVenue, otherOpponent, otherSport, match], [away, otherVenue, otherOpponent, otherSport, match]);
    const result = await getScoreboardForUser("user-1", {
      sportCode: "FB", venue: "Camp Randall Stadium", opponent: "Iowa", site: "HOME",
    }, { offset: 0, limit: 1 });
    expect(result.events.map((row) => row.id)).toEqual(["match"]);
    expect(result.summary).toMatchObject({ eventsWorked: 5, matchingEventsWorked: 1, wins: 0, losses: 0, ties: 1, games: 1, winRate: 50 });
    expect(result.eventCount).toBe(1);
    expect(result.nextCursor).toBeNull();
    expect(result.byOpponent).toEqual([{ key: "Iowa", label: "Iowa", wins: 0, losses: 0, ties: 1, games: 1, winRate: 50 }]);
    expect(result.facets?.sports.map((row) => row.key)).toEqual(["FB", "VB"]);
    expect(result.facets?.venues.map((row) => row.key)).toEqual(["Camp Randall Stadium", "Kohl Center"]);
  });

  it("includes result-less, exhibition and archived work without crediting unofficial outcomes", async () => {
    const win = event("official", "WIN");
    season([event("ceremony"), event("exhibition", "WIN"), event("archived", "TIE"), win], [win]);
    const result = await getScoreboardForUser("user-1");
    expect(result.events.map((row) => [row.id, row.result])).toEqual([
      ["official", "WIN"], ["exhibition", null], ["ceremony", null], ["archived", null],
    ]);
    expect(result.summary).toMatchObject({ eventsWorked: 4, wins: 1, losses: 0, ties: 0, games: 1 });
    const workRead = findMany.mock.calls[0]![0]!;
    expect(workRead.where).toMatchObject({ status: "CONFIRMED", isHidden: false, endsAt: { lt: expect.any(Date) } });
    expect(workRead.where).not.toHaveProperty("archivedAt");
    expect(workRead.where).not.toHaveProperty("NOT");
    expect(workRead.where).not.toHaveProperty("AND");
    expect(result.eventCount).toBe(4);
    expect(result.recentResults?.map((row) => row.id)).toEqual(["official"]);
    expect(result.events.every((row) => row.shiftAreas.length === 0)).toBe(true);
    for (const [read] of findMany.mock.calls) {
      expect(read?.select).not.toHaveProperty("shiftGroup");
      expect(read?.select).not.toHaveProperty("workers");
    }
  });

  it("keeps a complete streak and last five results beyond the visible history page", async () => {
    const work = Array.from({ length: 30 }, (_, index) => event("work-" + index));
    const games = Array.from({ length: 7 }, (_, index) => event("game-" + index, "WIN", {
      startsAt: new Date("2026-08-" + (20 - index) + "T18:00:00Z"),
    }));
    season([...work, ...games], games);
    const result = await getScoreboardForUser("user-1", {}, { offset: 0, limit: 2 });
    expect(result.events).toHaveLength(2);
    expect(result.events.every((row) => row.result === null)).toBe(true);
    expect(result.nextCursor).toBe("2");
    expect(result.recentResults?.map((row) => row.id)).toEqual(["game-0", "game-1", "game-2", "game-3", "game-4"]);
    expect(result.streak).toEqual({ result: "WIN", count: 7 });
    expect(result.seasonGames).toBe(7);
  });

  it("keeps result filters resolved-only and deduplicates work/record overlap", async () => {
    const win = event("win", "WIN"), tie = event("tie", "TIE"), loss = event("loss", "LOSS");
    season([win, tie, loss, event("practice", "WIN")], [win, tie, loss]);
    const result = await getScoreboardForUser("user-1", { result: "WIN" });
    expect(result.events.map((row) => row.id)).toEqual(["win"]);
    expect(result.summary).toMatchObject({ eventsWorked: 4, matchingEventsWorked: 1, wins: 1, losses: 0, ties: 0, games: 1 });
  });

  it("returns honest empty intersections with stable choices and a terminal cursor", async () => {
    season([event("work")], []);
    const result = await getScoreboardForUser("user-1", { venue: "Missing venue" });
    expect(result.summary).toMatchObject({ eventsWorked: 1, matchingEventsWorked: 0, games: 0, winRate: null });
    expect(result.events).toEqual([]);
    expect(result.bySport).toEqual([]);
    expect(result.facets?.sports).toEqual([{ key: "FB", label: "Football" }]);
    expect(result.nextCursor).toBeNull();
    expect(result.streak).toBeNull();
    expect(findMany).toHaveBeenCalledTimes(2);
  });
});
