import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  normalizeBookingTitle,
  normalizeManualEventTitle,
  STATE_ABBREVIATION_TERMS,
  normalizeTeamAbbreviations,
} from "@/lib/title-normalization";
import { splitEventsForSync } from "@/lib/services/calendar-sync";

describe("operational title normalization", () => {
  it.each([
    ["MBB practice", "MBB Practice"],
    ["MBB GOLF", "MBB Golf"],
    ["wbb recruit shoot", "WBB Recruit Shoot"],
    ["  WHKY   GAME DAY  ", "WHKY Game Day"],
    ["MBB vs IOWA", "MBB vs Iowa"],
    ["WSOC at NORTHWESTERN", "WSOC at Northwestern"],
    ["WBB/MBB PRACTICE", "WBB/MBB Practice"],
    ["iPad and YouTube setup", "iPad and YouTube Setup"],
    ["Women's Soccer vs Tcu", "Women's Soccer vs TCU"],
    ["WSOC at Ucla", "WSOC at UCLA"],
  ])("normalizes booking title %j to %j", (input, expected) => {
    expect(normalizeBookingTitle(input)).toBe(expected);
  });

  it.each([
    ["b1g media days", "B1G Media Days"],
    ["B1g Media Days", "B1G Media Days"],
    ["ncaa tournament", "NCAA Tournament"],
    ["avca first serve", "AVCA First Serve"],
    ["MSOC vs Saint Mary's (Ca)", "MSOC vs Saint Mary's (CA)"],
    ["wbb b1g championship", "WBB B1G Championship"],
    ["espn setup", "ESPN Setup"],
    ["av cart pull", "AV Cart Pull"],
    ["4k camera test", "4K Camera Test"],
    ["b1g's media room", "B1G's Media Room"],
    ["fb dji mic 1", "FB DJI Mic 1"],
    ["new ad staff", "New AD Staff"],
    ["ux checkout guard smoke", "UX Checkout Guard Smoke"],
  ])("always capitalizes known terms: %j to %j", (input, expected) => {
    expect(normalizeBookingTitle(input)).toBe(expected);
  });

  it("uses the same rule for manually authored event titles", () => {
    expect(normalizeManualEventTitle("mbb PRACTICE")).toBe("MBB Practice");
  });

  it("corrects known team abbreviations in existing display values", () => {
    expect(normalizeTeamAbbreviations("Women's Soccer vs Tcu / Usc / Ucla")).toBe(
      "Women's Soccer vs TCU / USC / UCLA",
    );
    expect(normalizeTeamAbbreviations("Iowa at UConn")).toBe("Iowa at UConn");
  });

  it("preserves all 50 state postal abbreviations without uppercasing normal words", () => {
    expect(STATE_ABBREVIATION_TERMS.size).toBe(50);
    expect(normalizeBookingTitle("Women's Soccer vs Iowa (WI) at Madison, WI")).toBe(
      "Women's Soccer vs Iowa (WI) at Madison, WI",
    );
    expect(normalizeBookingTitle("Football in Indiana or Ohio")).toBe("Football in Indiana or Ohio");
  });

  it("preserves non-UW acronyms in imported event summaries", () => {
    const result = splitEventsForSync([
      {
        uid: "event-1",
        summary: "MBB vs USC / UCLA / TCU",
        description: "",
        location: "",
        dtstart: "20260716T150000Z",
        dtend: "20260716T170000Z",
        status: "CONFIRMED",
      },
    ], [], []);

    expect(result.toCreate[0]?.summary).toBe("MBB vs USC / UCLA / TCU");
    expect(result.toCreate[0]?.rawSummary).toBe("MBB vs USC / UCLA / TCU");
  });

  it("wires the normalizer into manual create and edit writes", () => {
    const createRoute = readFileSync("src/app/api/calendar-events/route.ts", "utf8");
    const editRoute = readFileSync("src/app/api/calendar-events/[id]/route.ts", "utf8");

    expect(createRoute).toContain("summary: normalizeManualEventTitle(body.summary)");
    expect(editRoute).toContain("existing.sourceId === null");
    expect(editRoute).toContain("? normalizeManualEventTitle(body.summary)");
    expect(editRoute).toContain("patch.summary = derived");
  });

describe("title case hardening", () => {
  it.each([
    ["1st round", "1st Round"],
    ["texas a&m vs at&t", "Texas A&M vs AT&T"],
    ["q&a with the ad", "Q&A with the AD"],
    ["vs iowa", "vs Iowa"],
    ["DJ night", "DJ Night"],
    ["MEDIA DAY", "Media Day"],
    ["o'brien's retirement", "O'Brien's Retirement"],
    ["mcdonald's all-american game", "McDonald's All-American Game"],
    ["it's a go", "It's a Go"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeManualEventTitle(input)).toBe(expected);
  });
});
});
