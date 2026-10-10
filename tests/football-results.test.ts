import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { footballDate, footballScoreForEvent, matchesFootballGame, parseEspnFootballSchedule, parseUwFootballSchedule } from "@/lib/football-results";

const uwHtml = readFileSync("tests/fixtures/football-results/uw-2026.html", "utf8");
const espnJson = JSON.parse(readFileSync("tests/fixtures/football-results/espn-2026.json", "utf8"));
const now = new Date("2026-10-02T01:00:00Z");
const uw = parseUwFootballSchedule(uwHtml, 2026);
const espn = parseEspnFootballSchedule(espnJson, 2026);
const event = { sportCode: "FB", opponent: "Penn St.", site: "AWAY", result: "WIN",
  startsAt: new Date("2026-09-26T21:00:00Z"), allDay: false, rawStartsAt: null, rawAllDay: null };
function observations() {
  return [uw.find((row) => row.externalId === "17144")!, espn.find((row) => row.externalId === "401858466")!]
    .map((snapshot) => ({ provider: snapshot.provider, externalId: snapshot.externalId, snapshot: structuredClone(snapshot),
      observedAt: now, lastAttemptAt: now, lastError: null as string | null }));
}

describe("football provider schedules", () => {
  it("reads the real four final scores in Wisconsin order and leaves eight future games unresolved", () => {
    for (const rows of [uw, espn]) {
      expect(rows).toHaveLength(12);
      expect(rows.filter((row) => row.final).map((row) => [row.wisconsin, row.opponentScore])).toEqual([[13, 41], [36, 9], [54, 10], [24, 20]]);
      expect(rows[0]).toMatchObject({ site: "NEUTRAL", outcome: "LOSS" });
      expect(rows.filter((row) => !row.final).every((row) => row.wisconsin === null && row.opponentScore === null)).toBe(true);
    }
  });
  it("does not turn a missing final score into a zero", () => {
    const input = structuredClone(espnJson);
    input.events[0].competitions[0].competitors[0].score = null;
    expect(() => parseEspnFootballSchedule(input, 2026)).toThrow("incomplete");
  });
  it("allows an empty postseason schedule without accepting an empty regular season", () => {
    const input = { ...espnJson, events: [] };
    expect(parseEspnFootballSchedule(input, 2026, true)).toEqual([]);
    expect(() => parseEspnFootballSchedule(input, 2026)).toThrow("empty");
  });
  it("accepts a real shutout but rejects a different season or team", () => {
    const input = structuredClone(espnJson);
    input.events[0].competitions[0].competitors[0].score = { value: 0 };
    expect(parseEspnFootballSchedule(input, 2026)[0]).toMatchObject({ wisconsin: 13, opponentScore: 0 });
    expect(() => parseEspnFootballSchedule(input, 2025)).toThrow("season or team");
    input.team.id = "87";
    expect(() => parseEspnFootballSchedule(input, 2026)).toThrow("season or team");
  });
  it("rejects partial HTML and contradictory duplicate provider IDs", () => {
    expect(() => parseUwFootballSchedule("<html>Unavailable</html>", 2026)).toThrow("not recognized");
    const input = structuredClone(espnJson);
    const duplicate = structuredClone(input.events[0]);
    duplicate.competitions[0].competitors[0].score.value = 40;
    input.events.push(duplicate);
    expect(() => parseEspnFootballSchedule(input, 2026)).toThrow("duplicate");
  });
});

describe("football identity and agreement", () => {
  it("requires opponent, Central date, and site even when only one game exists", () => {
    const game = espn.find((row) => row.externalId === "401858466")!;
    expect(matchesFootballGame(event, game)).toBe(true);
    expect(matchesFootballGame({ ...event, opponent: "Notre Dame" }, game)).toBe(false);
    expect(matchesFootballGame({ ...event, site: "NEUTRAL" }, game)).toBe(false);
    expect(matchesFootballGame({ ...event, startsAt: new Date("2026-09-27T21:00Z") }, game)).toBe(false);
    expect(footballDate(new Date("2026-09-27T01:00Z"))).toBe("2026-09-26");
    expect(footballDate(new Date("2026-09-27T00:00Z"), true)).toBe("2026-09-27");
  });
  it("uses imported timing when an operator adjusts the crew event", () => {
    expect(matchesFootballGame({ ...event, rawStartsAt: event.startsAt, startsAt: new Date("2026-09-27T21:00Z") }, observations()[0]!.snapshot)).toBe(true);
  });
  it("publishes matched scores with sources and a Wisconsin-relative margin", () => {
    expect(footballScoreForEvent(event, observations(), now)).toMatchObject({ status: "verified", wisconsin: 24, opponent: 20, margin: 4, stale: false,
      sources: [{ provider: "UW", url: "https://uwbadgers.com/game-center/17144" }, { provider: "ESPN", url: "https://www.espn.com/college-football/game/_/gameId/401858466" }] });
  });
  it.each(["numeric disagreement", "calendar disagreement", "changed identity", "ambiguous refresh"])("withholds the score on %s", (scenario) => {
    const rows = observations(); const current = { ...event };
    if (scenario === "numeric disagreement") rows[1]!.snapshot.wisconsin = 25;
    if (scenario === "calendar disagreement") current.result = "LOSS";
    if (scenario === "changed identity") current.opponent = "Notre Dame";
    if (scenario === "ambiguous refresh") rows[1]!.lastError = "ambiguous_match";
    expect(footballScoreForEvent(current, rows, now)).toMatchObject({ status: "disputed", wisconsin: null, opponent: null, margin: null });
  });
  it("keeps last verified data during failures but clearly marks it stale", () => {
    const rows = observations(); rows[1]!.lastError = "fetch_failed";
    expect(footballScoreForEvent(event, rows, now)).toMatchObject({ status: "verified", wisconsin: 24, stale: true });
    expect(footballScoreForEvent(event, observations(), new Date("2026-10-05T01:00Z"))).toMatchObject({ stale: true });
  });
  it("does not invent a score from one source, an ongoing game, or an unknown calendar result", () => {
    const rows = observations(); rows[1]!.snapshot.final = false;
    for (const result of [footballScoreForEvent(event, observations().slice(0, 1), now), footballScoreForEvent(event, rows, now), footballScoreForEvent({ ...event, result: null }, observations(), now)]) {
      expect(result).toMatchObject({ status: "pending", wisconsin: null });
    }
    expect(footballScoreForEvent({ ...event, sportCode: "VB" }, [], now)).toBeNull();
  });
});
