import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("iOS Schedule filters and calendar management", () => {
  const schedule = source("ios/Wisconsin/Views/ScheduleView.swift");
  const tokenRoute = source("src/app/api/shifts/ics-token/route.ts");

  it("keeps neutral games separate from non-game events in both schedule modes", () => {
    expect(schedule).toContain('case nonGame = "Non-game"');
    // Both now read the resolved venue rather than the raw isHome tri-state,
    // which could not tell a neutral site from an unclassified one.
    expect(schedule).toContain("case .neutral: return event.venue == .neutral");
    expect(schedule).toContain("case .nonGame: return event.venue == .nonGame");
    expect(schedule.match(/scheduleEventMatches\(\$0, filter: homeAwayFilter\)/g)?.length).toBe(2);
  });

  it("uses a result-oriented filter sheet without permanent filter clutter", () => {
    expect(schedule).toContain('Text("Scope")');
    expect(schedule).toContain('Label("Only my shifts"');
    expect(schedule).toContain('Label("Include past events"');
    expect(schedule).toContain('Text("Event Type")');
    expect(schedule).toContain("ForEach(HomeAwayFilter.allCases");
    expect(schedule).toContain("matchingEventCount");
    expect(schedule).toContain('matchingEventCount == 1 ? "Show 1 Event"');
    expect(schedule).toContain(".presentationDetents([.large])");
    expect(schedule).not.toContain('Picker("Venue", selection: $homeAwayFilter)');
  });

  it("opens an honest, recoverable Shift Calendar management sheet", () => {
    expect(schedule).toContain("@State private var showCalendarSetup = false");
    expect(schedule).toContain('Label("Shift Calendar", systemImage: "calendar.badge.plus")');
    expect(schedule).toContain("private struct ScheduleCalendarSubscriptionSheet");
    expect(schedule).toContain("APIClient.shared.icsToken()");
    expect(schedule).toContain("APIClient.shared.generateICSToken()");
    expect(schedule).toContain('AppEnvironment.webcalURL(path: "/api/shifts/ics/\\(activeToken)")');
    expect(schedule).toContain("guard await UIApplication.shared.open(url)");
    expect(schedule).toContain('@AppStorage("scheduleCalendarLastOpenedAt")');
    expect(schedule).toContain('Text(token == nil ? "Ready to set up" : "Private feed ready")');
    expect(schedule).toContain("Apple Calendar controls when subscribed calendars refresh.");
    expect(schedule).not.toContain("Subscription active");
    expect(schedule).not.toContain("Subscribed successfully");
  });

  it("protects private-feed rotation and exposes recovery", () => {
    expect(schedule).toContain('Button("Reset Private Link", role: .destructive)');
    expect(schedule).toContain("Existing calendar subscriptions will stop updating.");
    expect(schedule).toContain('Button("Retry") { Task { await loadStatus() } }');
    expect(schedule).toContain(".disabled(isLoading || isOpening || isResetting || error != nil)");
    expect(schedule).toContain("guard !isOpening, !isResetting else { return }");
    expect(tokenRoute).toContain("enforceRateLimit");
    expect(tokenRoute).toContain('action: "ics_token_rotated"');
  });
});
