import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

// Native Schedule reads events in week windows: the future loads ahead of the
// reader so it feels endless, and the past sits behind a deliberate pull at
// the top of the list so a status-bar tap or a hard flick stops on today.
describe("iOS Schedule windowed scrolling", () => {
  const schedule = source("ios/Wisconsin/Views/ScheduleView.swift");
  const apiClient = source("ios/Wisconsin/Core/APIClient.swift");
  const myShiftsRoute = source("src/app/api/my-shifts/route.ts");
  const strip = source("ios/Wisconsin/Views/Schedule/ScheduleWeekStrip.swift");

  it("reads events and personal shifts for the same date window", () => {
    expect(apiClient).toContain("private static func windowQueryItems(_ window: DateInterval?) -> [URLQueryItem]");
    expect(apiClient).toContain('.init(name: "startDate", value: formatter.string(from: window.start))');
    expect(apiClient).toContain("func allCalendarEvents(\n        includePast: Bool = false,\n        window: DateInterval? = nil,");
    expect(apiClient).toContain("func allMyShifts(\n        userId: String? = nil,\n        window: DateInterval? = nil,");
    // Past rows keep their "you worked this" tint only if the shifts route can
    // answer for past weeks; without a window it still returns upcoming work.
    expect(myShiftsRoute).toContain('parseOptionalDate(url.searchParams.get("startDate"), "startDate")');
    expect(myShiftsRoute).toContain("assertDateOrder(windowStart, windowEnd);");
    expect(myShiftsRoute).toContain("...(windowStart ? { endsAt: { gt: windowStart } } : {}),");
    expect(myShiftsRoute).toContain("...(windowEnd ? { startsAt: { lte: windowEnd } } : {}),");
    expect(myShiftsRoute).toContain(': { endsAt: { gt: startOfTodayInAppTz(now) }, status: "CONFIRMED", archivedAt: null },');
  });

  it("grows the loaded window in whole weeks and prefetches the future", () => {
    expect(schedule).toContain("private(set) var loadedStart: Date");
    expect(schedule).toContain("private(set) var loadedEnd: Date");
    expect(schedule).toContain("func loadEarlier() async -> Bool");
    expect(schedule).toContain("func loadLater() async");
    expect(schedule).toContain("func prefetchLater(near day: Date)");
    expect(schedule).toContain("func ensureLoaded(_ day: Date) async -> Bool");
    expect(schedule).toContain("vm.prefetchLater(near: date)");
    // Empty weeks are placeholders, not gaps, so scrolling never dead-ends.
    expect(schedule).toContain("case emptyWeeks(start: Date, count: Int)");
    expect(schedule).toContain("sections[sections.count - 1] = .emptyWeeks(start: start, count: count + 1)");
    expect(schedule).toContain('"No events this week"');
    // Every role scrolls into the past; the staff-only toggle is gone.
    expect(schedule).not.toContain("canSeePastEvents");
    expect(schedule).not.toContain("includePast = ");
  });

  it("makes the past an intentional pull with a haptic threshold", () => {
    expect(schedule).toContain("private var visibleLowerBound: Date");
    expect(schedule).toContain("guard pastRevealSteps > 0 else { return today }");
    expect(schedule).toContain("private static let pullThreshold: CGFloat = 96");
    // Only a held drag arms the reveal; momentum from a flick cannot.
    expect(schedule).toContain("guard isDraggingList, canRevealMorePast else { return }");
    expect(schedule).toContain("Haptics.threshold()");
    expect(schedule).toContain('isPullArmed ? "Release for earlier weeks" : "Pull for earlier weeks"');
    expect(schedule).toContain("revealPast(keeping: sections.first?.firstAnchor)");
    // Once the reader is back on today or later and at rest, the past folds
    // away again, holding the list on the top visible row.
    expect(schedule).toContain("if phase == .idle { collapsePastIfOutOfView() }");
    expect(schedule).toContain("guard !scrollTracker.hasVisibleRow(before: today),");
    expect(strip).toContain("var topAnchor: AnyHashable?");
    // The pull replaces pull-to-refresh on this list.
    expect(schedule).not.toContain(".refreshable { await vm.load(forceRefresh: true) }");
  });

  it("returns to today from the strip and folds the past away", () => {
    expect(strip).toContain("let onToday: () -> Void");
    expect(schedule).toContain("onToday: { jump(to: .now) }");
    expect(schedule).toContain("} else if target == today {\n            pastRevealSteps = 0");
    // The pager rebuilds when earlier weeks are prepended, so it never rests
    // between pages.
    expect(strip).toContain(".id(weeks.first)");
  });
});

describe("iOS Schedule follow-ups", () => {
  const schedule = source("ios/Wisconsin/Views/ScheduleView.swift");
  const apiClient = source("ios/Wisconsin/Core/APIClient.swift");
  const eventsRoute = source("src/app/api/calendar-events/route.ts");
  const cache = source("ios/Wisconsin/Core/ScheduleWindowCache.swift");
  const app = source("ios/Wisconsin/App/WisconsinApp.swift");
  const strip = source("ios/Wisconsin/Views/Schedule/ScheduleWeekStrip.swift");

  it("opens a pushed event outside the loaded weeks", () => {
    // The list route answers one id, whatever its date, for every internal
    // role; a combined secondary resolves to its canonical row.
    expect(eventsRoute).toContain('const eventId = searchParams.get("eventId");');
    expect(eventsRoute).toContain("includePast: eventId ? true : includePast,");
    expect(eventsRoute).toContain("{ OR: [{ id: eventId }, { combinedEvents: { some: { id: eventId } } }] }");
    expect(apiClient).toContain("func scheduleEvent(id: String) async throws -> ScheduleEvent?");
    expect(schedule).toContain("func event(forLink id: String) async -> ScheduleEvent?");
    expect(schedule).toContain("await ensureLoaded(fetched.startsAt)");
    expect(schedule).toContain("if let event = await vm.event(forLink: eventId) {");
  });

  it("opens on the last saved window, per user, cleared at sign-out", () => {
    expect(cache).toContain("snapshot.userId == userId");
    expect(cache).toContain("static let maxAge: TimeInterval = 7 * 24 * 60 * 60");
    expect(cache).toContain(".completeFileProtectionUntilFirstUserAuthentication");
    expect(app).toContain("ScheduleWindowCache.clear()");
    expect(schedule).toContain("vm.cacheOwnerId = session.currentUser?.id");
    expect(schedule).toContain("vm.restoreCachedWindow()");
    expect(schedule).toContain("if !vm.hasLoaded && vm.events.isEmpty && vm.error == nil {");
  });

  it("keeps the strip and sport menu independent of the loaded window", () => {
    expect(strip).toContain("var onReachEnd: () -> Void = {}");
    expect(strip).toContain("if week == weeks.last {\n                onReachEnd()");
    expect(schedule).toContain("onReachEnd: { Task { await vm.loadLater() } }");
    expect(schedule).toContain("Set(scheduleCurrentSportCodes).union(vm.events.compactMap { $0.sportCode })");
  });

  it("draws one venue dot across Schedule surfaces instead of edge bars", () => {
    const row = source("ios/Wisconsin/Views/Schedule/ScheduleEventRow.swift");
    const tradeBoard = source("ios/Wisconsin/Views/Schedule/TradeBoardSheet.swift");
    const published = source("ios/Wisconsin/Views/Schedule/PublishedScheduleView.swift");
    const detail = source("ios/Wisconsin/Views/EventDetailSheet.swift");
    expect(row).toContain("struct VenueDot: View");
    expect(tradeBoard.match(/VenueDot\(color: shift\.classificationColor\)/g)?.length).toBe(3);
    expect(tradeBoard).not.toContain(".frame(width: 4, height: 76)");
    expect(published).toContain("VenueDot(color: publishedEventRailColor(event.event))");
    expect(published).not.toContain("StatusRail(");
    expect(detail).toContain("VenueDot(color: eventRailColor, topPadding: 6)");
    for (const file of ["PostTradeSheet", "AddShiftSheet", "AssignStudentSheet"]) {
      expect(source(`ios/Wisconsin/Views/Schedule/${file}.swift`)).not.toContain(".frame(width: 4, height:");
    }
    // Your own shift reads the same on the list row and the detail card.
    expect(row).toContain("(isMine ? Color.myShiftSurface : Color.cardSurface)");
    expect(detail).toContain(".brandCard(fill: Color.myShiftSurface)");
  });
});
