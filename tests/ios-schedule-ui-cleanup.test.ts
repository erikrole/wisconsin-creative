import { describe, expect, it } from "vitest";
import { scheduleSurfaceSource, source } from "./_helpers/source";

function sliceBetween(sourceText: string, start: string, end: string) {
  const startIndex = sourceText.indexOf(start);
  const endIndex = sourceText.indexOf(end, startIndex);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return sourceText.slice(startIndex, endIndex);
}

describe("iOS Schedule UI cleanup", () => {
  it("keeps filters visible as toolbar toggles and chips, not a sheet", () => {
    const scheduleView = source("ios/Wisconsin/Views/ScheduleView.swift");
    const filterBar = source("ios/Wisconsin/Views/Schedule/ScheduleQuickFilterBar.swift");
    const toolbar = sliceBetween(
      scheduleView,
      "private struct ScheduleRootToolbar: ToolbarContent",
      "private struct InternalScheduleView: View",
    );

    // One master list: no List/Calendar mode switch and no filter sheet.
    expect(scheduleView).not.toContain("enum ScheduleViewMode");
    expect(scheduleView).not.toContain('Picker("Schedule view"');
    expect(scheduleView).not.toContain("ScheduleFilterSheet");
    expect(scheduleView).not.toContain("showFilters");
    expect(scheduleView).toContain("@State private var myShiftsOnly = false");
    // My Shifts and Sport are toolbar list controls with the shared tint.
    expect(toolbar).toContain('"My Shifts"');
    expect(toolbar).toContain(".listControlTint(isActive: myShiftsOnly)");
    expect(toolbar).toContain('Picker("Sport", selection: sportSelection)');
    expect(toolbar).toContain(".listControlTint(isActive: sportFilter != nil)");
    expect(toolbar).not.toContain("Include Past Events");
    expect(toolbar).not.toContain("canSeePastEvents");
    expect(toolbar).toContain(".badge(openTradeCount)");
    expect(toolbar).toContain("ToolbarSpacer(.fixed, placement: .topBarTrailing)");
    // Event type is a row of chips; toolbar-set filters show as removable chips.
    expect(filterBar).toContain("ForEach(HomeAwayFilter.allCases");
    expect(filterBar).toContain("RemovableFilterChip(title: sportLabel");
    expect(filterBar).not.toContain("Past events");
    expect(filterBar).toContain(".accessibilityAddTraits(isOn ? .isSelected : [])");
    expect(scheduleView).toContain('case .home: return event.venue == .home');
    expect(scheduleView).toContain('case .nonGame: return event.venue == .nonGame');
  });

  it("gives personal work priority without stealing the venue dot", () => {
    const scheduleView = source("ios/Wisconsin/Views/ScheduleView.swift");
    const rowFile = source("ios/Wisconsin/Views/Schedule/ScheduleEventRow.swift");
    const eventRow = sliceBetween(rowFile, "struct EventRow: View", "private func calendarSame");

    expect(scheduleView).toContain("contentMargins(.bottom, 24, for: .scrollContent)");
    // Rows draw slices of a rounded day group rather than bordered cards; the
    // list stays plain so day headers pin while their rows scroll.
    expect(scheduleView).toContain(".listStyle(.plain)");
    expect(rowFile).toContain("enum EventRowGroupPosition");
    expect(rowFile).toContain("UnevenRoundedRectangle(");
    expect(eventRow).not.toContain("StatusRail(");
    expect(eventRow).not.toContain(".strokeBorder(Color.hairline");
    expect(eventRow).toContain("VenueDot(color: venueRailColor(for: event))");
    expect(eventRow).toContain("if let eventTypeLabel { parts.append(eventTypeLabel) }");
    expect(eventRow).toContain("if let venueName { parts.append(venueName) }");
    // Your own work is a tinted row, not a line of text: no "You · area ·
    // gear" line and no edge bar. A Student call time takes the second time
    // line; area and gear stay in the VoiceOver label.
    expect(eventRow).not.toContain("personalWorkLine");
    expect(eventRow).not.toContain('["You"]');
    expect(eventRow).toContain('return "Call " + callStartsAt.formatted(date: .omitted, time: .shortened)');
    expect(eventRow).toContain("parts.append(shift.gear.gearLabel)");
    expect(rowFile).toContain("(isMine ? Color.myShiftSurface : Color.cardSurface)");
    expect(rowFile).not.toContain(".frame(width: 3)");
    expect(scheduleView).toContain(".listRowBackground(EventRowBackground(isMine: myShift != nil, position: position))");
    expect(rowFile).toContain("struct EventRowBackground: View");
    // Coverage shows for every role, not only staff.
    expect(eventRow).toContain("if let cov = event.coverage, cov.total > 0 {");
    expect(scheduleView).not.toContain("showsCrewCoverage");
  });

  it("keeps the week strip and list on one venue vocabulary", () => {
    const scheduleView = source("ios/Wisconsin/Views/ScheduleView.swift");
    const strip = source("ios/Wisconsin/Views/Schedule/ScheduleWeekStrip.swift");

    // Both day indexes sort chronologically.
    expect(scheduleView).toContain("eventsByDay = byDay.mapValues { $0.sorted { $0.startsAt < $1.startsAt } }");
    // The shift mark covers every event that day, not only the drawn dots.
    expect(strip).toContain(".fill(hasShift ? Color.statusText(.blue) : Color.clear)");
    // Strip dots and row dots both read the shared `venueRailColor`, so
    // alignment is structural rather than asserted.
    expect(scheduleView).toContain("color: venueRailColor(for: event)");
    expect(strip).toContain('.accessibilityLabel(label)');
    expect(strip).toContain('label: "Previous month"');
    expect(strip).toContain('label: "Next month"');
    expect(strip).toContain('LegendAssignmentMark(label: "My shift")');
    // The strip jumps the list; it never filters it to one day.
    expect(scheduleView).toContain("proxy.scrollTo(request.anchor");
    expect(scheduleView).toContain("let anchor = ScheduleRowAnchor(day: date, eventId: event.id)");
    expect(scheduleView).toContain(".id(anchor)");
    expect(strip).toContain(".scrollTargetBehavior(.paging)");
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
    expect(eventDetail).toContain("Button(\"Retry\")");
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
    // NavigationLink, which would add a system disclosure chevron.
    expect(scheduleView).toContain("navigationPath.append(ScheduleEventRoute(id: event.id))");
    expect(scheduleView).toContain(".navigationDestination(for: ScheduleEventRoute.self)");
    expect(scheduleView).not.toContain(".sheet(item: $selectedEvent)");
    expect(homeView).toContain("EventDetailView(event: work.asScheduleEvent");
    expect(homeView).not.toContain("EventDetailSheet(");
    expect(scheduleSurfaceSource()).toContain("year == currentYear");
    expect(scheduleView).not.toContain("Updated \\(loadedAt.formatted");
  });
});
