import { describe, expect, it } from "vitest";
import {
  EMPTY_PERSON_SCOREBOARD_FILTERS,
  EMPTY_TEAM_SCOREBOARD_FILTERS,
  SCOREBOARD_ALL_FILTER,
  filtersFromTeamScoreboardResponse,
  parsePersonScoreboardFilters,
  parseTeamScoreboardFilters,
  parseTeamScoreboardSort,
  personScoreboardHasFilters,
  personScoreboardPath,
  scoreboardPersonMatches,
  teamScoreboardApiUrl,
  teamScoreboardFiltersEqual,
  teamScoreboardPath,
  writePersonScoreboardSearchParams,
  writeTeamScoreboardSearchParams,
} from "@/lib/scoreboard-explorer";

describe("team Scoreboard explorer URL", () => {
  it("keeps stacked filters and rank in one shareable query", () => {
    const params = new URLSearchParams("sportCode=FB&venue=Camp Randall Stadium&opponent=Iowa&site=HOME&rank=rate");
    const filters = parseTeamScoreboardFilters(params);

    expect(filters).toEqual({
      sportCode: "FB",
      venue: "Camp Randall Stadium",
      opponent: "Iowa",
      site: "HOME",
    });
    expect(parseTeamScoreboardSort(params)).toBe("rate");
    expect(teamScoreboardApiUrl(filters)).toBe(
      "/api/scoreboard?sportCode=FB&venue=Camp+Randall+Stadium&opponent=Iowa&site=HOME",
    );
  });

  it("ignores blank, sentinel, and unknown site values instead of sending them to the API", () => {
    expect(parseTeamScoreboardFilters(new URLSearchParams("sportCode=&venue=__all__&site=ROAD"))).toEqual(
      EMPTY_TEAM_SCOREBOARD_FILTERS,
    );
    expect(parseTeamScoreboardSort(new URLSearchParams("rank=streak"))).toBe("events");
    expect(teamScoreboardApiUrl(EMPTY_TEAM_SCOREBOARD_FILTERS)).toBe("/api/scoreboard");
  });

  it("omits default rank and all-filters from the written URL", () => {
    const params = new URLSearchParams("tab=scoreboard");
    writeTeamScoreboardSearchParams(params, {
      sportCode: "VB",
      venue: SCOREBOARD_ALL_FILTER,
      opponent: SCOREBOARD_ALL_FILTER,
      site: SCOREBOARD_ALL_FILTER,
    }, "events");

    expect(params.toString()).toBe("tab=scoreboard&sportCode=VB");
  });

  it("restores the last valid intersection after a failed filtered read", () => {
    const restored = filtersFromTeamScoreboardResponse({
      sportCode: "FB",
      venue: null,
      opponent: "Iowa",
      site: "AWAY",
    });

    expect(restored.sportCode).toBe("FB");
    expect(restored.venue).toBe(SCOREBOARD_ALL_FILTER);
    expect(restored.site).toBe("AWAY");
    expect(teamScoreboardFiltersEqual(restored, {
      ...EMPTY_TEAM_SCOREBOARD_FILTERS,
      sportCode: "FB",
      opponent: "Iowa",
      site: "AWAY",
    })).toBe(true);
  });

  it("carries the stacked view onto a person Scoreboard and back to All leaders", () => {
    const filters = {
      sportCode: "FB",
      venue: "Lambeau Field",
      opponent: SCOREBOARD_ALL_FILTER,
      site: "NEUTRAL",
    };

    expect(personScoreboardPath("user-1", filters, "rate")).toBe(
      "/scoreboard/user-1?sportCode=FB&venue=Lambeau+Field&site=NEUTRAL&rank=rate",
    );
    expect(teamScoreboardPath(filters, "rate")).toBe(
      "/scoreboard?sportCode=FB&venue=Lambeau+Field&site=NEUTRAL&rank=rate",
    );
    expect(teamScoreboardPath(EMPTY_TEAM_SCOREBOARD_FILTERS)).toBe("/scoreboard");
  });

  it("finds people by name without changing rank math", () => {
    expect(scoreboardPersonMatches("Maddy Pehler", "pehl")).toBe(true);
    expect(scoreboardPersonMatches("Maddy Pehler", "nolan")).toBe(false);
    expect(scoreboardPersonMatches("Maddy Pehler", "  ")).toBe(true);
  });
});

describe("person Scoreboard explorer URL", () => {
  it("keeps result, sport, and site without disturbing unrelated params", () => {
    const parsed = parsePersonScoreboardFilters(
      new URLSearchParams("tab=scoreboard&result=WIN&sportCode=FB&site=AWAY"),
    );

    expect(parsed).toEqual({ result: "WIN", sport: "FB", site: "AWAY" });
    expect(personScoreboardHasFilters(parsed)).toBe(true);

    const params = new URLSearchParams("tab=scoreboard&result=LOSS");
    writePersonScoreboardSearchParams(params, EMPTY_PERSON_SCOREBOARD_FILTERS);
    expect(params.toString()).toBe("tab=scoreboard");
  });

  it("treats unknown result and site values as the unfiltered stack", () => {
    expect(parsePersonScoreboardFilters(new URLSearchParams("result=DRAW&site=ROAD&sportCode="))).toEqual(
      EMPTY_PERSON_SCOREBOARD_FILTERS,
    );
    expect(personScoreboardHasFilters(EMPTY_PERSON_SCOREBOARD_FILTERS)).toBe(false);
  });
});
