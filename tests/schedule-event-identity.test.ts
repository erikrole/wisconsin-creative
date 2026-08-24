import { describe, expect, it } from "vitest";
import {
  buildVenueSearchText,
  cleanSourceSummary,
  normalizeOpponentName,
  classifySourceEvent,
  normalizeVenueText,
  parseEventResult,
  scheduleVenueDisplayName,
} from "@/lib/schedule-event-identity";

describe("schedule event identity normalization", () => {
  it("cleans source summaries without removing real event qualifiers", () => {
    expect(cleanSourceSummary("[A] Wisconsin Athletics Volleyball vs Kentucky (Neutral)")).toBe("Volleyball vs Kentucky");
  });

  it("normalizes rankings and school-name boilerplate from opponents", () => {
    expect(normalizeOpponentName("No. 9 University of Illinois")).toBe("Illinois");
    expect(normalizeOpponentName("#12 Louisville University - Invitational")).toBe("Louisville - Invitational");
  });

  it("keeps abbreviated team names in all caps", () => {
    expect(normalizeOpponentName("Tcu - Big 12")).toBe("TCU - Big 12");
    expect(normalizeOpponentName("Usc / Ucla")).toBe("USC / UCLA");
  });

  it("normalizes venue spelling for matching while preserving city context", () => {
    expect(normalizeVenueText("Green Bay, Wis.,  Lambeau Field")).toBe("Green Bay, WI, Lambeau Field");
    expect(buildVenueSearchText("Madison, Wis., Mcclimon Track / Soccer Complex")).toBe(
      "madison, wi, mcclimon track/soccer complex",
    );
  });

  it("shows imported schedule locations as their venue component", () => {
    expect(scheduleVenueDisplayName("Madison, Wis., UW Field House")).toBe("UW Field House");
    expect(scheduleVenueDisplayName("Madison, WI, McClimon Track/Soccer Complex")).toBe("McClimon Track/Soccer Complex");
    expect(scheduleVenueDisplayName("Camp Randall Stadium, Madison, WI")).toBe("Camp Randall Stadium");
    expect(scheduleVenueDisplayName("Iowa City, IA")).toBe("Iowa City, IA");
    expect(scheduleVenueDisplayName("   ")).toBeNull();
  });
});

describe("parseEventResult", () => {
  it("reads the source W, L, and T markers", () => {
    expect(parseEventResult("[W] Wisconsin Athletics MBB vs Purdue")).toBe("WIN");
    expect(parseEventResult("[L] MBB at Purdue")).toBe("LOSS");
    expect(parseEventResult("[T] Women's Soccer vs Marquette")).toBe("TIE");
  });

  it("accepts a lowercase marker and leading whitespace", () => {
    expect(parseEventResult("  [w] MBB vs Purdue")).toBe("WIN");
    expect(parseEventResult("[l] MBB vs Purdue")).toBe("LOSS");
  });

  it("matches a bare marker with no trailing text", () => {
    expect(parseEventResult("[W]")).toBe("WIN");
  });

  it("returns null when no marker is present", () => {
    expect(parseEventResult("MBB vs Purdue")).toBeNull();
    expect(parseEventResult("")).toBeNull();
    expect(parseEventResult(null)).toBeNull();
    expect(parseEventResult(undefined)).toBeNull();
  });

  it("ignores non-result bracket markers and mid-title markers", () => {
    expect(parseEventResult("[A] MBB vs Purdue")).toBeNull();
    expect(parseEventResult("MBB vs Purdue [W]")).toBeNull();
  });

  it("does not match a bracketed word that merely starts with W or L", () => {
    expect(parseEventResult("[Wisconsin] MBB vs Purdue")).toBeNull();
    expect(parseEventResult("[W]atch Party")).toBeNull();
  });

  it("agrees with the title cleaner, which strips the marker it reads", () => {
    const raw = "[W] Wisconsin Athletics MBB vs Purdue";
    expect(parseEventResult(raw)).toBe("WIN");
    expect(cleanSourceSummary(raw)).toBe("MBB vs Purdue");
    expect(parseEventResult(cleanSourceSummary(raw))).toBeNull();
  });
});

// Pins the transform that migration 0123 mirrors in SQL. Inputs are real stored
// titles from synced rows that predate the cleaning and have left the feed.
describe("cleanSourceSummary — legacy stored titles the re-clean repairs", () => {
  const cases: Array<[string, string]> = [
    ["[L] Wisconsin Athletics Softball vs Baylor", "Softball vs Baylor"],
    ["[N] Wisconsin Athletics Men's Rowing at Eastern Sprints", "Men's Rowing at Eastern Sprints"],
    ["[W] Wisconsin Athletics Volleyball vs Butler  (Exhibition)", "Volleyball vs Butler"],
    [
      "Wisconsin Athletics Women's Track & Field  NCAA Outdoor Championships",
      "Women's Track & Field NCAA Outdoor Championships",
    ],
    [
      "Wisconsin Badgers Women's Track & Field  NCAA Outdoor Championships",
      "Women's Track & Field NCAA Outdoor Championships",
    ],
    ["Women's Rowing vs San Diego State (Scrimmage)", "Women's Rowing vs San Diego State"],
  ];

  it.each(cases)("cleans %j", (raw, expected) => {
    expect(cleanSourceSummary(raw)).toBe(expected);
  });

  it("is idempotent, so a repeated repair is a no-op", () => {
    for (const [raw] of cases) {
      const once = cleanSourceSummary(raw);
      expect(cleanSourceSummary(once)).toBe(once);
    }
  });

  it("leaves an already-clean title alone", () => {
    expect(cleanSourceSummary("MBB vs Purdue")).toBe("MBB vs Purdue");
  });
});

describe("classifySourceEvent", () => {
  const MADISON = "Madison, WI, Kohl Center";
  const AWAY_VENUE = "West Lafayette, IN, Mackey Arena";

  it("reads outcome, sport, opponent, and a home site together", () => {
    expect(
      classifySourceEvent({
        rawSummary: "[W] Wisconsin Athletics MBB vs Purdue",
        rawLocationText: MADISON,
      }),
    ).toEqual({
      summary: "MBB vs Purdue",
      sportCode: "MBB",
      opponent: "Purdue",
      isHome: true,
      site: "HOME",
      result: "WIN",
    });
  });

  it("reads an away game from the 'at' preposition", () => {
    const c = classifySourceEvent({ rawSummary: "[L] MBB at Purdue", rawLocationText: AWAY_VENUE });
    expect(c).toMatchObject({ result: "LOSS", sportCode: "MBB", isHome: false, site: "AWAY" });
  });

  it("preserves a source tie alongside the game identity", () => {
    const c = classifySourceEvent({
      rawSummary: "[T] Wisconsin Athletics Women's Soccer vs Marquette",
      rawLocationText: "Madison, WI, McClimon Track/Soccer Complex",
    });
    expect(c).toMatchObject({ result: "TIE", sportCode: "WSOC", opponent: "Marquette", site: "HOME" });
  });

  it("calls a 'vs' game at someone else's venue a neutral site", () => {
    const c = classifySourceEvent({ rawSummary: "MBB vs Purdue", rawLocationText: AWAY_VENUE });
    expect(c.isHome).toBeNull();
    expect(c.site).toBe("NEUTRAL");
  });

  it("keeps explicit neutral evidence that the title cleaner removes", () => {
    const c = classifySourceEvent({ rawSummary: "MBB vs Purdue (Neutral)" });
    expect(c.summary).toBe("MBB vs Purdue");
    expect(c.site).toBe("NEUTRAL");
  });

  it("separates unknown from neutral when there is no evidence either way", () => {
    const c = classifySourceEvent({ rawSummary: "Football Senior Day" });
    expect(c.isHome).toBeNull();
    // isHome collapses neutral and unknown; site does not.
    expect(c.site).toBeNull();
  });

  it("treats a mapped home venue as home even without Madison text", () => {
    const c = classifySourceEvent({
      rawSummary: "Volleyball Practice",
      rawLocationText: "Somewhere Else",
      mappedIsHomeVenue: true,
    });
    expect(c.isHome).toBe(true);
    expect(c.site).toBe("HOME");
  });

  it("classifies a real legacy row that sync can no longer reach", () => {
    expect(
      classifySourceEvent({ rawSummary: "[L] Wisconsin Athletics Softball vs Baylor" }),
    ).toMatchObject({ summary: "Softball vs Baylor", sportCode: "SB", opponent: "Baylor", result: "LOSS" });
  });

  it("leaves outcome unknown when the feed published no marker", () => {
    expect(classifySourceEvent({ rawSummary: "MBB vs Purdue" }).result).toBeNull();
  });
});
