import { describe, expect, it } from "vitest";
import { funFactWindow, scoreboardFunFacts } from "@/lib/scoreboard-fun-facts";

function person(userId: string, name: string, eventsWorked: number, wins: number, losses: number, ties = 0) {
  const games = wins + losses + ties;
  const winRate = games ? Math.round(((wins + ties / 2) / games) * 1000) / 10 : null;
  const summary = { eventsWorked, wins, losses, ties, games, winRate };
  return { userId, name, avatarUrl: null, summary, bySport: [] };
}

function bucket(key: string | null, label: string, eventsCovered: number, wins: number, losses: number) {
  const games = wins + losses;
  return {
    key, label, contributors: 3, eventsCovered, eventCredits: eventsCovered * 3,
    wins, losses, ties: 0, games, winRate: games ? Math.round((wins / games) * 1000) / 10 : null, gameCredits: games * 3,
  };
}

const base = {
  summary: { contributors: 3, eventsCovered: 10, eventCredits: 25, wins: 6, losses: 4, ties: 0, games: 10, winRate: 60, gameCredits: 25 },
  leaderboard: [
    person("a", "Ava Stone", 9, 7, 1),
    person("b", "Ben Ruiz", 8, 4, 3),
    person("c", "Cal Ng", 3, 1, 1),
  ],
  bySport: [bucket("FB", "Football", 6, 5, 1), bucket("VB", "Volleyball", 4, 1, 3)],
  byVenue: [bucket("Camp Randall", "Camp Randall", 6, 5, 1)],
  byOpponent: [bucket("Iowa", "Iowa", 3, 2, 1), bucket("Ohio State", "Ohio State", 1, 0, 1)],
  bySite: [bucket("HOME", "Home", 7, 6, 1), bucket("AWAY", "Away", 3, 0, 3)],
  filters: { sportCode: null, venue: null, opponent: null, site: null },
  methodology: { eventsCovered: "", eventCredits: "", record: "", gameCredits: "", minimumGamesForWinRate: 3 },
};

describe("scoreboardFunFacts", () => {
  it("finds the stories in the aggregate, each with something to explore", () => {
    const facts = scoreboardFunFacts(base, null);
    const byId = Object.fromEntries(facts.map((fact) => [fact.id, fact]));

    expect(byId["iron-crew"]).toMatchObject({ value: "9 events", action: { type: "person", userId: "a" } });
    expect(byId["tight-race"]?.sentence).toContain("Ben is chasing Ava");
    expect(byId["lucky-charm"]).toMatchObject({ value: "7–1", action: { type: "person", userId: "a" } });
    expect(byId["home-away"]).toMatchObject({ label: "Home cooking", action: { type: "filter", key: "site", value: "HOME" } });
    expect(byId["familiar-face"]).toMatchObject({ value: "Iowa", action: { type: "filter", key: "opponent", value: "Iowa" } });
    expect(byId["hot-sport"]).toMatchObject({ value: "Football", action: { type: "filter", key: "sportCode", value: "FB" } });
    expect(byId["crew-size"]).toMatchObject({ value: "2.5 people", action: null });
  });

  it("leads with your spot when you are on the board", () => {
    const facts = scoreboardFunFacts(base, "c");
    expect(facts[0]).toMatchObject({ id: "your-spot", value: "#3", sentence: "5 events behind Ben." });
    expect(scoreboardFunFacts(base, "a")[0]).toMatchObject({ id: "your-spot", value: "#1" });
  });

  it("skips facts that the active filter already answers", () => {
    const facts = scoreboardFunFacts({ ...base, filters: { ...base.filters, site: "HOME", opponent: "Iowa" } }, null);
    expect(facts.map((fact) => fact.id)).not.toContain("home-away");
    expect(facts.map((fact) => fact.id)).not.toContain("familiar-face");
  });

  it("never calls someone a lucky charm on a tiny sample or below the team rate", () => {
    const small = { ...base, leaderboard: [person("x", "Xi", 2, 2, 0), person("y", "Yo", 6, 2, 3)] };
    expect(scoreboardFunFacts(small, null).map((fact) => fact.id)).not.toContain("lucky-charm");
  });

  it("returns nothing for an empty board", () => {
    expect(scoreboardFunFacts({ ...base, leaderboard: [] }, null)).toEqual([]);
  });
});

describe("funFactWindow", () => {
  it("walks through every fact before repeating", () => {
    const items = [1, 2, 3, 4, 5, 6];
    expect(funFactWindow(items, 0, 4)).toEqual([1, 2, 3, 4]);
    expect(funFactWindow(items, 1, 4)).toEqual([5, 6, 1, 2]);
    expect(funFactWindow([1, 2], 3, 4)).toEqual([1, 2]);
  });
});
