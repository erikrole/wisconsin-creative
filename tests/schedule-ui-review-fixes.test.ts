import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

const filters = source("src/app/(app)/schedule/_components/ScheduleFilters.tsx");
const readiness = source("src/app/(app)/schedule/_components/ScheduleReadiness.tsx");
const calendar = source("src/app/(app)/schedule/_components/CalendarView.tsx");
const list = source("src/app/(app)/schedule/_components/ListView.tsx");
const week = source("src/app/(app)/schedule/_components/WeekView.tsx");
const page = source("src/app/(app)/schedule/page.tsx");

describe("schedule browse fixes", () => {
  it("keeps every sport reachable while a sport filter is applied", () => {
    // Sport is applied server-side, so the loaded window only contains the
    // selected sport. Deriving the options from it offered the reader nothing
    // but the sport they were already on.
    expect(filters).toContain("if (filters.sportFilter || entries.length === 0) return undefined;");
    expect(filters).toContain("allowedCodes={sportCodesInWindow}");
    expect(filters).toContain("}, [entries, filters.sportFilter]);");
  });

  it("sizes the shareable queue banner from the rows it actually matched", () => {
    expect(filters).toContain("filteredEntries: CalendarEntry[];");
    expect(filters).toContain("events in this shareable queue.");
    expect(page).toContain("filteredEntries={data.filteredEntries}");
  });

  it("keeps the Schedule command row compact and the overflow filters honest", () => {
    expect(filters).toContain("Searching remaining events");
    expect(filters).toContain("sourceSignal");
    expect(filters).toContain('aria-pressed={filters.myShiftsOnly}');
    expect(filters).toContain("onClick={filters.clearAll}");
    expect(filters).toContain('label="Venue"');
    expect(filters).toContain('label="Area"');
    expect(filters).toContain('label="Coverage"');
    expect(filters).toContain("Dates:");
    expect(page).toContain("fillingWindow={data.fillingWindow}");
    expect(page).toContain("sourceSignal={data.sourceSignal}");
    const picker = source("src/components/SportPicker.tsx");
    expect(picker).toContain('heading="Men"');
    expect(picker).toContain('heading="Women"');
    // cmdk walks CommandList children; wrapping groups in a layout div
    // infinite-loops and trips the workspace error boundary.
    expect(picker).not.toMatch(/<div className=\{cn\(columnCount/);
    expect(picker).toContain("[&_[cmdk-list-sizer]]:grid");
    expect(picker).toContain("<Popover modal");
    const hook = source("src/hooks/use-schedule-data.ts");
    expect(hook).toContain("dateRange: deepLink.dateRange");
    expect(hook).toContain("clearDateRange");
    expect(hook).not.toContain("setMyShiftsOnlyRaw(false)");
    const clearAll = hook.slice(hook.indexOf("clearAll: () => {"));
    expect(clearAll).not.toContain('params.delete("myShifts")');
  });

  it("leads the readiness rail with recent crew and calendar activity", () => {
    // Standing queue counts stay in Details. The default strip is skinny
    // icon+count indicators; click reveals crew, combine, or sync diffs.
    expect(readiness).toContain("<ScheduleRecentActivity");
    expect(readiness).toContain("feed={(");
    expect(readiness).toContain("items={[]}");
    expect(readiness).toContain("recentScheduleActivityItems(health)");
    expect(readiness).toContain("recentScheduleSyncItems(health)");
    expect(readiness).toContain("coalesceScheduleChanges(recentSyncChanges)");
    expect(readiness).not.toContain("Nothing needs attention");
    const activity = source("src/app/(app)/schedule/_components/ScheduleRecentActivity.tsx");
    expect(activity).toContain("Crew not released");
    expect(activity).toContain("May share a crew");
    expect(activity).toContain("Schedule updates");
    expect(activity).toContain('aria-expanded={active}');
    expect(activity).toContain("toggle(\"updates\")");
    expect(activity).toContain("<ScheduleSyncDiff");
    expect(activity).toContain("No recent schedule updates");
    expect(activity).not.toContain('variant="red"');
    expect(activity).not.toContain('variant="blue"');
    const syncDiff = source("src/app/(app)/schedule/_components/ScheduleSyncDiff.tsx");
    expect(syncDiff).toContain("bg-[var(--red-bg)] text-[var(--red-text)] line-through");
    expect(syncDiff).toContain("bg-[var(--green-bg)] font-medium text-[var(--green-text)]");
    const rail = source("src/components/OperationalStatusRail.tsx");
    expect(rail).toContain('feed ? "border-0" : "border-y border-border/50"');
    expect(page).not.toContain("2 related events may share a crew");
    expect(page).not.toContain("changes have not been released");
    expect(page).toContain("combineSuggestion={isStaff ? leadingCombineSuggestion : null}");
    expect(page).toContain("onReviewPendingCrew={openCrewSheet}");
    const stickyStart = page.indexOf("data-schedule-sticky-frame");
    const listStart = page.indexOf("{canDisplaySchedule && data.filters.viewMode === \"calendar\"");
    expect(page.indexOf("<ScheduleReadiness", stickyStart)).toBeGreaterThan(stickyStart);
    expect(page.indexOf("<ScheduleReadiness", stickyStart)).toBeLessThan(listStart);
  });

  it("scopes control-room readiness metrics to staff", () => {
    // The health snapshot behind these is staff/admin-only, so for a student
    // each card read zero and still routed into a staff queue.
    expect(readiness).toContain("const items: ReadinessItem[] = isStaff");
    expect(readiness).toContain("? [...staffItems, ...sharedItems, ...staffQueueItems, ...tradeItems]");
    expect(readiness).toContain(": [...sharedItems, ...tradeItems];");
    // Every queue route stays defined; only the audience changes.
    for (const queue of ["needs-staffing", "gear-gaps", "data-quality", "my-calls-today"]) {
      expect(readiness).toContain(`"${queue}"`);
    }
  });

  it("does not repeat the view's own empty state above it", () => {
    expect(readiness).not.toContain("Filters hide every event");
    expect(readiness).not.toContain("notice={");
  });

  it("ends the calendar month on a complete week row", () => {
    expect(calendar).toContain("while (cells.length % 7 !== 0) cells.push({ day: null });");
  });

  it("drops the expanded calendar day when the month changes", () => {
    // The expanded cell is tracked by day-of-month, which means nothing in a
    // different month.
    expect(calendar).toContain("function goToMonth(next: Date) {");
    expect(calendar).toContain("setExpandedDay(null);");
    expect(calendar).not.toContain("function prevMonth() {\n    setCalMonth(");
  });

  it("aligns the list column headers with the rows they name", () => {
    // Body rows carry a 3px venue rail on the <tr>; the header needs the same
    // reserve or every label sits 3px left of its column.
    expect(list).toContain("border-b border-l-[3px] border-border/50 border-l-transparent");
  });

  it("does not put an inert control in the mobile tab order", () => {
    expect(list).toContain("{canExpand ? (");
    expect(list).toContain("onClick={() => toggleExpandedRow(entry.id)}");
    expect(list).toContain('<div className="w-full px-4 py-3 pr-14 text-left">');
    expect(list).not.toContain("canExpand\n                        ? toggleExpandedRow(entry.id)");
  });

  it("only clears the expanded-row pointer for the row that owns it", () => {
    expect(list).toContain("if (expandedRowId === entryId) setExpandedRowId(null);");
    expect(list).toContain("}, [expandedRowId, setExpandedRowId]);");
  });

  it("dates both halves of a week that crosses New Year", () => {
    expect(week).toContain("weekStart.getFullYear() !== end.getFullYear()");
  });
});
