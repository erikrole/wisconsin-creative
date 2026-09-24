import { describe, expect, it } from "vitest";
import { scheduleSurfaceSource, source } from "./_helpers/source";

describe("iOS Schedule filters and calendar management", () => {
  const schedule = scheduleSurfaceSource();
  const tokenRoute = source("src/app/api/shifts/ics-token/route.ts");

  it("keeps neutral games separate from non-game events", () => {
    expect(schedule).toContain('case nonGame = "Non-game"');
    // Both now read the resolved venue rather than the raw isHome tri-state,
    // which could not tell a neutral site from an unclassified one.
    expect(schedule).toContain("case .neutral: return event.venue == .neutral");
    expect(schedule).toContain("case .nonGame: return event.venue == .nonGame");
    expect(schedule.match(/scheduleEventMatches\(\$0, filter: homeAwayFilter\)/g)?.length).toBe(1);
  });

  it("keeps every filter one tap away without a sheet", () => {
    const filterBar = source("ios/Wisconsin/Views/Schedule/ScheduleQuickFilterBar.swift");
    expect(schedule).toContain('"My Shifts"');
    // Past events are reached by pulling past the top, not a toggle.
    expect(schedule).not.toContain("Include Past Events");
    expect(schedule).toContain('Picker("Sport", selection: sportSelection)');
    expect(filterBar).toContain("ForEach(HomeAwayFilter.allCases");
    expect(schedule).not.toContain("ScheduleFilterSheet");
    expect(schedule).not.toContain('Picker("Venue", selection: $homeAwayFilter)');
    // An empty filtered list still offers the way back.
    expect(schedule).toContain('Button("Clear Filters") { clearScheduleFilters() }');
  });

  it("opens an honest, recoverable Shift Calendar management sheet", () => {
    expect(schedule).toContain("@State private var showCalendarSetup = false");
    expect(schedule).toContain('Label("Shift Calendar", systemImage: "calendar.badge.plus")');
    expect(schedule).toContain("struct ScheduleCalendarSubscriptionSheet: View");
    expect(schedule).toContain("APIClient.shared.icsTokenStatus(checking: saved)");
    expect(schedule).toContain("APIClient.shared.generateICSToken()");
    expect(schedule).toContain('AppEnvironment.webcalURL(path: "/api/shifts/ics/\\(activeToken)")');
    expect(schedule).toContain("guard await UIApplication.shared.open(url)");
    // "Last opened" is per account.
    expect(schedule).toContain('"scheduleCalendarLastOpenedAt." + (session.currentUser?.id ?? "signed-out")');
    expect(schedule).toContain('Text(token != nil ? "Private feed ready" : hasServerToken ? "Feed active elsewhere" : "Ready to set up")');
    expect(schedule).toContain("Apple Calendar controls when subscribed calendars refresh.");
    expect(schedule).not.toContain("Subscription active");
    expect(schedule).not.toContain("Subscribed successfully");
  });

  it("protects private-feed rotation and exposes recovery", () => {
    expect(schedule).toContain('Button("Reset Private Link", role: .destructive)');
    expect(schedule).toContain("Existing calendar subscriptions will stop updating.");
    expect(schedule).toContain('Button("Retry") { Task { await loadStatus() } }');
    // Only a failed status check blocks opening: without a known token the
    // button would mint a new one and break an existing subscription.
    expect(schedule).toContain(".disabled(isLoading || isOpening || isResetting || loadFailed)");
    expect(schedule).toContain("guard !isOpening, !isResetting else { return }");
    expect(tokenRoute).toContain("enforceRateLimit");
    expect(tokenRoute).toContain('action: "ics_token_rotated"');
  });
});
