import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

// The 2026-10-21 Schedule review: Post trade reads the statuses the server
// actually sends, failed loads end in a retry instead of a spinner, the list
// catches up after the Trade Board, and large text keeps rows readable.
describe("iOS Schedule hardening pass", () => {
  const schedule = source("ios/Wisconsin/Views/ScheduleView.swift");
  const row = source("ios/Wisconsin/Views/Schedule/ScheduleEventRow.swift");
  const strip = source("ios/Wisconsin/Views/Schedule/ScheduleWeekStrip.swift");
  const filters = source("ios/Wisconsin/Views/Schedule/ScheduleQuickFilterBar.swift");
  const postSheet = source("ios/Wisconsin/Views/Schedule/PostTradeSheet.swift");
  const tradeBoard = source("ios/Wisconsin/Views/Schedule/TradeBoardSheet.swift");
  const calendar = source("ios/Wisconsin/Views/Schedule/ScheduleCalendarSubscriptionSheet.swift");
  const published = source("ios/Wisconsin/Views/Schedule/PublishedScheduleView.swift");
  const myShiftsRoute = source("src/app/api/my-shifts/route.ts");
  const tradeService = source("src/lib/services/shift-trades.ts");

  it("offers Post trade for the assignment statuses the server sends", () => {
    // The route returns these two, and the trade service accepts these two.
    expect(myShiftsRoute).toContain('status: { in: ["DIRECT_ASSIGNED", "APPROVED"] },');
    expect(tradeService).toContain("Only active assignments can be traded");
    expect(schedule).toContain('case directAssigned = "DIRECT_ASSIGNED"');
    expect(schedule).toContain('case approved = "APPROVED"');
    expect(schedule).not.toContain('case active = "ACTIVE"');
    expect(schedule).toContain("var isPostableForTrade: Bool");
    expect(schedule).toContain("guard let shift = vm.shiftsByEventId[eventId], shift.isPostableForTrade else { return nil }");
    expect(postSheet).toContain(".filter { $0.isPostableForTrade && !alreadyPostedIds.contains($0.id) }");
    expect(postSheet).not.toContain("statusValue == .active");
    // Shifts that already have an open post stay out of the picker.
    expect(tradeBoard).toContain("var postedAssignmentIds: Set<String>");
    expect(tradeBoard).toContain("alreadyPostedIds: vm.postedAssignmentIds,");
  });

  it("ends a failed edge load in a retry, not an endless spinner", () => {
    expect(schedule).toContain("private(set) var laterLoadFailed = false");
    expect(schedule).toContain("laterLoadFailed = true");
    expect(schedule).toContain("func retryLater() async");
    expect(schedule).toContain("} else if vm.laterLoadFailed || (!vm.hasLoaded && vm.refreshError != nil && !vm.isLoading) {");
    expect(schedule).toContain('Text("Couldn\'t load later weeks")');
    // A failed reveal folds its step back rather than drawing unread weeks
    // as "Nothing scheduled".
    expect(schedule).toContain("guard await vm.ensureLoaded(lowerBound) else {");
    expect(schedule).toContain("pastRevealSteps = max(0, pastRevealSteps - 1)");
    expect(schedule).toContain('showLoadFailure("Couldn\'t load that week. Try again.")');
    // The collaborator list's next page has the same recovery.
    expect(published).toContain("@State private var loadMoreFailed = false");
    expect(published).toContain('Text("Couldn\'t load more events")');
    expect(published).toContain(".task(id: events.count) { await loadMore() }");
  });

  it("answers a push to an event it cannot open", () => {
    expect(schedule).toContain('showLoadFailure("That event is no longer on the Schedule.", icon: "calendar.badge.exclamationmark")');
    expect(schedule).toContain('showLoadFailure("Couldn\'t open that event. Check your connection and try again.")');
  });

  it("keeps the refresh banner off the month title", () => {
    expect(schedule).toContain("private struct ScheduleRefreshFailedBanner: View");
    expect(schedule).toContain('Text("Showing the last loaded Schedule")');
    expect(schedule).not.toContain("// Non-blocking refresh-failed banner");
  });

  it("catches the list up after the Trade Board and confirms on the board", () => {
    const sheet = schedule.slice(
      schedule.indexOf(".sheet(isPresented: $showTradeBoard, onDismiss: {"),
      schedule.indexOf(".sheet(item: $shiftToPost)"),
    );
    expect(sheet).toContain("Task { await vm.load(forceRefresh: true) }");
    expect(sheet).not.toContain("onTradeClaimed");
    // A claim is a request until an Admin approves it.
    expect(tradeBoard).toContain('"Requested \\(area.shiftAreaLabel) on \\(when). An Admin reviews it next."');
    expect(tradeBoard).toContain(".toast($toast, dismissAfter: 3.5)");
    expect(schedule).not.toContain("You picked up");
  });

  it("keeps rows, headers, and filters readable at accessibility sizes", () => {
    expect(row).toContain("private var stacksTime: Bool { dynamicTypeSize.isAccessibilitySize }");
    expect(row).toContain("private var stackedTimeLine: some View");
    expect(row).toContain("AnyLayout(VStackLayout(alignment: .leading, spacing: 2))");
    expect(strip).toContain(".dynamicTypeSize(...DynamicTypeSize.xxxLarge)");
    expect(filters).toContain("private var accessibilityLayout: some View");
    expect(filters).toContain('Picker("Event type", selection: $homeAwayFilter)');
    expect(schedule).toContain('.accessibilityLabel("Dismiss Calendar suggestion")');
    // From the accessibility-size simulator pass: the badge covered the Trade
    // Board icon (system badge, left as is), the prompt title truncated, and the venue lost to the chip.
    expect(schedule).toContain('Text("Add your shifts to Calendar")\n                .font(.subheadline.weight(.bold))\n                .lineLimit(nil)\n                .fixedSize(horizontal: false, vertical: true)');
    expect(row).toContain(".lineLimit(stacksTime ? 3 : 2)");
    // "Non-game" fits the type control at the same size as its neighbours.
    expect(filters).toContain(".padding(.horizontal, compact ? 3 : 14)");
  });

  it("names a multi-day event's real end while it runs", () => {
    expect(row).toContain('return "Until " + event.endsAt.formatted(.dateTime.weekday(.abbreviated))');
  });

  it("reads headers in spoken order", () => {
    expect(row).toContain("date.formatted(.dateTime.weekday(.wide).month(.wide).day())");
    expect(row).toContain('return start + " to " + end.formatted(.dateTime.month(.wide).day())');
    // The weekday letters above the strip are decoration; each cell names its day.
    expect(strip).not.toContain(".accessibilityLabel(fullNames[");
  });

  it("drops the retired purple tint from Shift Calendar", () => {
    expect(calendar).not.toContain(".purple");
    expect(calendar).toContain(".authButton(.primary, adaptive: true)");
    expect(calendar).toContain(".flatCard(padding: 16, radius: Brand.Radius.lg)");
  });
});
