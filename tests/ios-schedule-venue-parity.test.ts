import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { venueToneFromEvent } from "@/lib/venue-tone";

function source(path: string) {
  return readFileSync(path, "utf8");
}

const models = source("ios/Wisconsin/Models/ScheduleModels.swift");
const scheduleView = source("ios/Wisconsin/Views/ScheduleView.swift");
const eventDetail = source("ios/Wisconsin/Views/EventDetailSheet.swift");
const tones = source("ios/Wisconsin/Core/SemanticTones.swift");
const eventsRoute = source("src/app/api/calendar-events/route.ts");

describe("iOS Schedule venue parity", () => {
  it("decodes the site the events API has always returned", () => {
    // The list query uses `include`, not a field `select`, so every scalar on
    // CalendarEvent — `site` among them — is already on the wire.
    expect(eventsRoute).toContain("include: {");
    expect(models).toContain("var site: String?");
  });

  it("resolves venue in the same order the web does", () => {
    // Mirrors venueToneFromEvent: opponent, then site, then title prefix, then
    // isHome.
    expect(models).toContain("enum ScheduleVenue {");
    // Blank as well as nil: web tests `!event.opponent`, so "" is a non-game
    // there too. Asserted in tests/ios-all-day-calendar-date.test.ts.
    expect(models).toContain(
      "guard let opponent, !opponent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {"
    );
    expect(models).toContain('case "HOME": return .home');
    expect(models).toContain('case "AWAY": return .away');
    expect(models).toContain('case "NEUTRAL": return .neutral');
    expect(models).toContain("switch summaryVenuePrefix {");
  });

  it("agrees with the web on the case that used to diverge", () => {
    // classifySourceEvent writes this shape for a title marked "(Neutral)":
    // the summary said "vs", so isHome stayed true while site recorded neutral.
    // iOS read isHome alone and drew a home game.
    const neutralOnHomeFlag = {
      opponent: "Duke",
      site: "NEUTRAL" as const,
      isHome: true,
      summary: "MBB vs Duke",
    };
    expect(venueToneFromEvent(neutralOnHomeFlag)).toBe("neutral");

    // Its iOS counterpart is asserted directly in
    // ios/WisconsinTests/ScheduleDateMathTests.swift → ScheduleVenueTests.
    const iosTests = source("ios/WisconsinTests/ScheduleDateMathTests.swift");
    expect(iosTests).toContain("storedNeutralSiteBeatsAHomeIsHomeFlag");
    expect(iosTests).toContain("event(isHome: true, site: \"NEUTRAL\").venue == .neutral");
  });

  it("routes every Schedule venue surface through the resolver", () => {
    expect(tones).toContain("func venueTone(_ venue: ScheduleVenue) -> StatusTone");
    expect(tones).toContain("func venueRailColor(for event: ScheduleEvent) -> Color");
    // Row rail, calendar dot, row label, filter, and Event detail all read it.
    expect(scheduleView).toContain("venueRailColor(for: event)");
    expect(scheduleView).toContain("DotInfo(color: venueRailColor(for: event)");
    expect(scheduleView).toContain("case .home: return event.venue == .home");
    expect(eventDetail).toContain("venueRailColor(for: event)");
    expect(eventDetail).toContain("switch event.venue {");
  });

  it("keeps the isHome overloads for the payloads that carry no site", () => {
    // /api/shift-trades and /api/schedule/published select isHome only, so the
    // Trade Board and the collaborator schedule must keep the narrower call.
    expect(tones).toContain("func venueTone(isHome: Bool?) -> StatusTone");
    expect(tones).toContain("func venueRailColor(isHome: Bool?) -> Color");
    expect(source("src/lib/services/shift-trades.ts")).toContain("isHome: true,");
    expect(source("src/lib/services/collaborator-schedule.ts")).toContain("isHome: true,");
  });
});

describe("iOS Schedule row restraint", () => {
  const crewRow = source("ios/Wisconsin/Views/Components/CrewRow.swift");

  it("spends colour on the rows that need crew, not every row", () => {
    // A filled capsule per row turned a fully-staffed screen into a column of
    // green pills competing with the rows that actually need someone.
    expect(crewRow).toContain("enum Emphasis {");
    expect(crewRow).toContain("if emphasis == .dense && !isShort { return .secondary }");
    expect(scheduleView).toContain("CoverageChip(coverage: cov, emphasis: .dense)");
    // The detail hero keeps the capsule -- one instance, with room for it.
    expect(eventDetail).toContain("CoverageChip(coverage: coverage, showsLabel: true)");
  });

  it("uses one border treatment for every row", () => {
    expect(scheduleView).toContain(".strokeBorder(Color.hairline, lineWidth: 0.5)");
    expect(scheduleView).not.toContain("private var rowStroke:");
    expect(scheduleView).not.toContain("private var rowStrokeWidth");
  });
});

describe("iOS Schedule calendar chrome", () => {
  it("names grey in the dot legend it draws", () => {
    expect(scheduleView).toContain('LegendDot(color: Color.statusText(.gray), label: "Other")');
    expect(scheduleView).toContain('.accessibilityLabel("Legend: my shift, home, away, other")');
  });

  it("tells a clear day apart from a filtered one", () => {
    expect(scheduleView).toContain("private func hiddenEventCount(on date: Date) -> Int");
    expect(scheduleView).toContain('return "Filters hide " + noun + " on " + dayLabel');
    expect(scheduleView).toContain('Button("Clear Filters") { onClearFilters() }');
    expect(scheduleView).toContain("onClearFilters: clearFiltersAction");
  });

  it("does not print a separator with nothing after it", () => {
    // "Away ·" rendered whenever an away or neutral game had no mapped venue.
    expect(scheduleView).toContain("if venueName != nil { metaDot }");
  });
});
