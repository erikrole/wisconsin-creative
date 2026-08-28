import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

function sliceBetween(sourceText: string, start: string, end: string) {
  const startIndex = sourceText.indexOf(start);
  const endIndex = sourceText.indexOf(end, startIndex);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return sourceText.slice(startIndex, endIndex);
}

describe("iOS Schedule UI cleanup", () => {
  it("keeps dense filters behind one native filter sheet", () => {
    const scheduleView = source("ios/Wisconsin/Views/ScheduleView.swift");
    const controlStrip = sliceBetween(
      scheduleView,
      "private var scheduleControlStrip: some View",
      "@ViewBuilder\n    private func eventList",
    );
    const filterSheet = sliceBetween(
      scheduleView,
      "private struct ScheduleFilterSheet",
      "// MARK: - Calendar Subscription",
    );

    expect(scheduleView).toContain("@State private var showFilters = false");
    expect(scheduleView).toContain("@State private var myShiftsOnly = false");
    expect(scheduleView).toContain(".sheet(isPresented: $showFilters)");
    expect(scheduleView).toContain("private struct ScheduleFilterSheet");
    expect(scheduleView).toContain("Toggle(isOn: $myShiftsOnly)");
    expect(scheduleView).toContain("Label(\"Include past events\"");
    expect(scheduleView).toContain("Text(\"Event Type\")");
    expect(scheduleView).toContain("ForEach(HomeAwayFilter.allCases");
    expect(scheduleView).toContain("Picker(\"Sport\", selection: sportSelection)");
    expect(scheduleView).toContain("activeFilterSummary");
    expect(scheduleView).not.toContain("FilterChip(");
    // Filters is a list control, so it lives in the navigation toolbar with
    // the same tint contract Items and Users use, not in a hand-rolled capsule
    // sharing a content row with the view switcher.
    expect(controlStrip).toContain("Picker(\"Schedule view\", selection: $viewMode)");
    expect(controlStrip).toContain(".pickerStyle(.segmented)");
    expect(controlStrip).toContain("ActiveControlBar(summary: activeFilterSummary, clear: clearScheduleFilters)");
    expect(controlStrip).toContain(".padding(.bottom, Brand.Space.xs)");
    expect(controlStrip).not.toContain("Capsule()");
    expect(controlStrip).not.toContain(".buttonStyle(.plain)");
    expect(controlStrip).not.toContain(".buttonStyle(.bordered)");
    expect(scheduleView).toContain(".listControlTint(isActive: activeFilterCount > 0)");
    expect(scheduleView).toContain("ToolbarSpacer(.fixed, placement: .topBarTrailing)");
    expect(filterSheet).toContain("ToolbarItem(placement: .cancellationAction)");
    expect(filterSheet).toContain("Button(\"Clear\") { onClear() }");
    expect(filterSheet).toContain("Text(showResultsTitle)");
    expect(filterSheet).toContain(".safeAreaInset(edge: .bottom)");
    expect(scheduleView).toContain('case .home: return "Home"');
    expect(scheduleView).toContain('case .away: return "Away"');
    expect(scheduleView).toContain('case .neutral: return "Neutral"');
    expect(scheduleView).toContain('case .nonGame: return "Non-game"');
  });

  it("gives personal work priority without stealing the venue rail", () => {
    const scheduleView = source("ios/Wisconsin/Views/ScheduleView.swift");
    const eventRow = sliceBetween(
      scheduleView,
      "struct EventRow: View",
      "private func calendarSame",
    );

    expect(scheduleView.match(/contentMargins\(\.bottom, 96, for: \.scrollContent\)/g)?.length).toBeGreaterThanOrEqual(2);
    // The venue accent stays the shared inner rail, like every other list in
    // the app. Drawing it as the card's leading edge instead escaped the
    // rounded corner and put green against the live row's tint.
    expect(eventRow).toContain("StatusRail(color: barColor)");
    expect(eventRow).not.toContain(".background(alignment: .leading)");
    expect(eventRow).toContain("Text(eventTypeLabel)");
    // Venue shares the meta line with the home/away word now that the time has
    // moved to the gutter, so it is an inline icon + text rather than a Label.
    expect(eventRow).toContain("Image(systemName: \"mappin.and.ellipse\")");
    expect(eventRow).toContain("Text(venueName)");
    expect(eventRow).toContain("personalWorkLine(myShift)");
    expect(eventRow).toContain("parts.append(shift.gear.gearLabel)");
    // One border and one surface for every row. My shift is carried by the blue
    // personal-work line alone, which names the call time and area rather than
    // washing the card; live is carried by the red time and "Now".
    expect(eventRow).toContain(".strokeBorder(Color.hairline, lineWidth: 0.5)");
    expect(eventRow).toContain(".background(Color.cardSurface)");
    expect(eventRow).not.toContain("Color.statusBackground(.blue).opacity(0.34)");
    expect(eventRow).not.toContain("private var rowStrokeWidth");
    expect(eventRow).not.toContain("private var rowBackground");
    expect(eventRow).toContain(".foregroundStyle(Color.statusText(.blue))");
    expect(eventRow).toContain("if showsCrewCoverage, let cov = event.coverage");
  });

  it("keeps calendar and agenda semantics aligned", () => {
    const scheduleView = source("ios/Wisconsin/Views/ScheduleView.swift");

    expect(scheduleView.match(/EventRow\(/g)?.length).toBeGreaterThanOrEqual(2);
    expect(scheduleView).toContain("showsCrewCoverage: showsCrewCoverage");
    expect(scheduleView).toContain("coverageChip(cov)");
    // Both day indexes sort chronologically. Calendar mode reads `eventsByDay`,
    // which was rendering in API insertion order while the list groups sorted --
    // a day could read 11:00 AM, 4:00 PM, 7:30 PM, 5:50 PM.
    expect(scheduleView).toContain("eventsByDay = allByDay.mapValues { $0.sorted { $0.startsAt < $1.startsAt } }");
    expect(scheduleView).toContain("dots.contains(where: \\.isShift)");
    // Calendar dots and agenda rails must speak the same venue vocabulary.
    // They used to assert it by each spelling out green/orange/grey inline,
    // which is what let the two drift onto different greys; both now read the
    // shared `venueRailColor`, so alignment is structural rather than asserted.
    expect(scheduleView).toContain("DotInfo(color: venueRailColor(for: event)");
    expect(scheduleView).toMatch(
      /private var barColor: Color \{\s*venueRailColor\(for: event\)/,
    );
    // Month arrows are deliberately unfilled (no raised circle) and compact so
    // the header reads lighter above a dense grid. Asserting their exact frame
    // would be a false positive -- the toolbar buttons share that string.
    expect(scheduleView).toContain('.accessibilityLabel("Previous month")');
    expect(scheduleView).toContain('.accessibilityLabel("Next month")');
    expect(scheduleView).toContain(".listRowBackground(Color.clear)");
    expect(scheduleView).toContain("LegendAssignmentMark(label: \"My shift\")");
  });

  it("routes Event detail full-screen with adaptive actions and retry", () => {
    const eventDetail = source("ios/Wisconsin/Views/EventDetailSheet.swift");
    const brand = source("ios/Wisconsin/Core/Brand.swift");
    const eventDetailView = sliceBetween(
      eventDetail,
      "struct EventDetailView: View",
      "// MARK: - Area Block",
    );
    const crewSection = sliceBetween(
      eventDetail,
      "private var crewSection: some View",
      "    @ViewBuilder\n    private var crewBody",
    );
    const shiftRow = sliceBetween(
      eventDetail,
      "struct ShiftRow: View",
      "// MARK: - Edit Shift Times Sheet",
    );

    expect(eventDetail).toContain("struct EventDetailView: View");
    expect(eventDetail).not.toContain("struct EventDetailSheet: View");
    expect(eventDetail).not.toContain("Button(\"Done\")");
    expect(eventDetailView).not.toContain("@Environment(\\.dismiss)");
    expect(eventDetail).toContain("assignmentSection");
    expect(eventDetail).toContain("openShiftSection");
    // Add Shift lives in the Crew section header. The separate "Staffing" card
    // was removed: it restated the coverage the Crew pill already shows.
    expect(eventDetail).not.toContain("staffingActionSection");
    // Add Shift is a screen-level action and now lives in the navigation bar.
    expect(eventDetail).toContain("addShiftToolbarButton");
    expect(eventDetail).toContain("Label(\"Add Shift\", systemImage: \"plus\")");
    expect(eventDetail).toContain("Button(\"Try Again\")");
    expect(eventDetail).toContain('return "Today, \\(date.formatted');
    expect(eventDetail).toContain('return "Tomorrow, \\(date.formatted');
    // Gear is gone from this screen; a shift's gear no longer routes anywhere
    // from here. "Your Shift" keeps only call time and area.
    expect(eventDetail).not.toContain("myShift?.gear");
    expect(eventDetail).not.toContain("BookingDetailView");
    expect(eventDetail).not.toContain("ToolbarItem(placement: .bottomBar)");
    // One section-header vocabulary. This screen carried a private near-clone
    // of BrandSectionHeader -- same job, different icon tint, no subtitle slot,
    // and it was the only detail screen not using the shared component.
    expect(crewSection).toContain('BrandSectionHeader(\n                "Crew"');
    expect(crewSection).toContain('systemImage: "person.2.fill"');
    // The shared call window rides in the header's own subtitle slot -- it had
    // been a full-width line of its own between the header and the roster.
    expect(crewSection).toContain("subtitle: callWindowIsHoisted ? callWindowSummary : nil");
    // Coverage moved to the hero, where "is this event ready?" is actually
    // asked, and is no longer staff-gated -- the Schedule list row had been
    // showing it to every role while the detail screen hid it.
    expect(crewSection).not.toContain("coverage");
    expect(eventDetail).toContain("CoverageChip(coverage: coverage, showsLabel: true)");
    expect(eventDetail).toContain("crewReadinessSummary(vm.shiftGroup?.coverage)");
    expect(eventDetail).not.toContain("EventDetailSectionHeader");
    // The clone carried .isHeader and the shared component didn't, so adopting
    // it would have been a quiet VoiceOver-rotor regression without this.
    expect(brand).toContain(".accessibilityAddTraits(.isHeader)");
    expect(shiftRow).toContain("Text(\"You\")");
    expect(shiftRow).toContain("Color.statusBackground(.blue)");
    expect(shiftRow).not.toContain("Color.statusText(.blue).opacity(0.06)");
    expect(shiftRow).not.toContain(".frame(width: 7, height: 7)");
  });

  it("preserves Schedule state through navigation and omits current-year noise", () => {
    const scheduleView = source("ios/Wisconsin/Views/ScheduleView.swift");
    const homeView = source("ios/Wisconsin/Views/HomeView.swift");

    expect(scheduleView).toContain("NavigationStack(path: $navigationPath)");
    // The list row pushes by appending to the path rather than using a
    // NavigationLink: inside a List, NavigationLink also renders a system
    // disclosure indicator outside the card, on top of EventRow's own chevron.
    expect(scheduleView).toContain("navigationPath.append(ScheduleEventRoute(id: event.id))");
    expect(scheduleView).toContain(".navigationDestination(for: ScheduleEventRoute.self)");
    expect(scheduleView).not.toContain(".sheet(item: $selectedEvent)");
    expect(homeView).toContain("EventDetailView(event: work.asScheduleEvent");
    expect(homeView).not.toContain("EventDetailSheet(");
    expect(scheduleView).toContain("year == currentYear");
    expect(scheduleView).not.toContain("Updated \\(loadedAt.formatted");
  });
});
