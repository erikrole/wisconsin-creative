import { describe, expect, it } from "vitest";
import { resolvedEventSite, venueToneFromEvent } from "@/lib/venue-tone";

describe("venueToneFromEvent", () => {
  it.each([
    [{ isHome: true, opponent: "Iowa" }, "home"],
    [{ isHome: false, opponent: "Iowa" }, "away"],
    [{ isHome: null, opponent: "Iowa" }, "neutral"],
    [{ isHome: null, opponent: null }, "non-game"],
  ] as const)("classifies %j as %s", (event, expected) => {
    expect(venueToneFromEvent(event)).toBe(expected);
  });

  it("keeps opponent-free media days non-game even with a legacy neutral prefix", () => {
    expect(venueToneFromEvent({
      isHome: null,
      opponent: null,
      rawSummary: "[N] Volleyball Media Day",
    })).toBe("non-game");
  });

  it("uses the canonical site from Schedule before the legacy isHome fallback", () => {
    expect(venueToneFromEvent({ site: "AWAY", isHome: true, opponent: "Iowa" })).toBe("away");
    expect(venueToneFromEvent({ site: "NEUTRAL", isHome: true, opponent: "Iowa" })).toBe("neutral");
  });
});

describe("resolvedEventSite", () => {
  it("keeps a stored site authoritative", () => {
    // A site an operator or the classifier already settled is never re-derived.
    expect(resolvedEventSite({ site: "NEUTRAL", isHome: true, opponent: "Iowa" })).toBe("NEUTRAL");
    expect(resolvedEventSite({ site: "AWAY", isHome: true, opponent: "Iowa" })).toBe("AWAY");
  });

  it("reads a missing site the way Schedule reads the same row", () => {
    // `isHome` cannot say NEUTRAL, which is exactly why `site` exists. Deriving
    // a missing site from `isHome` alone turned every neutral game into an
    // unknown one on the Scoreboard while Schedule showed it as neutral.
    expect(resolvedEventSite({ site: null, isHome: true, opponent: "Iowa" })).toBe("HOME");
    expect(resolvedEventSite({ site: null, isHome: false, opponent: "Iowa" })).toBe("AWAY");
    expect(resolvedEventSite({ site: null, isHome: null, opponent: "Iowa" })).toBe("NEUTRAL");
  });

  it("gives a non-game no venue direction at all", () => {
    // No opponent is not an unclassified game; it is not a game.
    expect(resolvedEventSite({ site: null, isHome: null, opponent: null })).toBeNull();
  });

  it("agrees with the tone Schedule renders for every shape", () => {
    const rows = [
      { site: null, isHome: true, opponent: "Iowa" },
      { site: null, isHome: false, opponent: "Iowa" },
      { site: null, isHome: null, opponent: "Iowa" },
      { site: "HOME" as const, isHome: null, opponent: "Iowa" },
      { site: null, isHome: null, opponent: null },
    ];
    const toneOf = { HOME: "home", AWAY: "away", NEUTRAL: "neutral" } as const;
    for (const row of rows) {
      const site = resolvedEventSite(row);
      const expected = site === null ? "non-game" : toneOf[site];
      expect(venueToneFromEvent(row)).toBe(expected);
    }
  });
});
