import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(path, "utf8");
}

const calendar = source("src/app/(app)/schedule/_components/CalendarView.tsx");
const hook = source("src/hooks/use-schedule-data.ts");
const list = source("src/app/(app)/schedule/_components/ListView.tsx");
const navigator = source("src/app/(app)/schedule/_components/SchedulePeriodNavigator.tsx");
const timeline = source("src/lib/schedule-timeline-position.ts");
const week = source("src/app/(app)/schedule/_components/WeekView.tsx");

describe("Schedule three-view polish", () => {
  it("gives every view an explicit, testable surface", () => {
    expect(list).toContain('data-schedule-view="list"');
    expect(week).toContain('data-schedule-view="week"');
    expect(calendar).toContain('data-schedule-view="calendar"');
  });

  it("hands the active date between List, Week, and Calendar", () => {
    expect(hook).toContain("const capturedSnapshot = viewMode === \"list\" ? captureScheduleTimelinePosition() : null;");
    expect(hook).toContain("readScheduleTimelineReadingPosition");
    expect(hook).toContain("saveScheduleTimelinePosition(listSnapshot)");
    expect(hook).toContain("chooseScheduleViewContextDate");
    expect(hook).toContain("listViewRoundTripRef");
    expect(hook).toContain("periodContextDateRef.current ?? chooseScheduleViewContextDate");
    expect(hook).toContain("setCalMonth: setCalendarMonth");
    expect(hook).toContain("setWeekStart: setScheduleWeek");
    expect(hook).toContain("if (!listViewRoundTripRef.current) {");
    expect(hook).toContain("discardScheduleTimelineReadingPosition();");
    expect(hook).toContain("setCalMonth(new Date(contextDate.getFullYear(), contextDate.getMonth(), 1))");
    expect(hook).toContain("setWeekStart(getMonday(contextDate))");
  });

  it("retains hidden period state until the URL explicitly replaces it", () => {
    expect(hook).toContain("if (requestedMonth) {");
    expect(hook).toContain("setCalMonth(requestedMonth);");
    expect(hook).toContain("if (requestedWeek) {");
    expect(hook).toContain("setWeekStart(requestedWeek);");
    expect(hook).not.toContain("setCalMonth(parseScheduleMonth(query.get(\"month\")) ?? defaultScheduleMonth());");
    expect(hook).not.toContain("setWeekStart(parseScheduleWeek(query.get(\"week\")) ?? defaultScheduleWeek());");
    expect(hook).toContain("scheduleSearchSignatureRef.current = query;");
  });

  it("measures the live sticky frame during a pinned-state transition", () => {
    expect(timeline).toContain('querySelector<HTMLElement>("[data-schedule-sticky-frame]")');
    expect(timeline).toContain("return Math.max(publishedBottom, liveBottom);");
    expect(list).toContain("return Math.max(publishedBottom, liveBottom);");
  });

  it("keeps a saved List anchor while its view control is taking focus", () => {
    expect(source("src/app/(app)/schedule/_components/ScheduleFilters.tsx")).toContain("data-schedule-view-controls");
    expect(list).toContain('target.closest("[data-schedule-view-controls]")');
    expect(list).toContain("rememberScheduleTimelineReadingPosition");
    expect(list).toContain("window.setTimeout(rememberScheduleTimelineReadingPosition, 160)");
  });

  it("uses one period navigator with orientation and live coverage context", () => {
    expect(week).toContain("<SchedulePeriodNavigator");
    expect(calendar).toContain("<SchedulePeriodNavigator");
    expect(navigator).toContain("data-schedule-period-nav");
    expect(navigator).toContain('aria-live="polite"');
    expect(week).toContain('previousLabel="Previous week"');
    expect(calendar).toContain('previousLabel="Previous month"');
  });

  it("makes Week cards readable and opens active mobile days", () => {
    expect(week).toContain("min-h-[86px]");
    expect(week).toContain("line-clamp-2");
    expect(week).toContain("Your shift");
    expect(week).toContain("{openSlots} open");
    expect(week).toContain("defaultExpanded={isDayToday || dayEntries.length > 0}");
  });

  it("makes Calendar a complete mobile view instead of a desktop dead end", () => {
    expect(calendar).toContain("function MobileCalendarEvent");
    expect(calendar).toContain("md:hidden");
    expect(calendar).toContain("calEntriesByDay.entries()");
    expect(calendar).toContain("{openSlots} open");
    expect(calendar).not.toContain("Calendar view is best on desktop");
    expect(calendar).not.toContain("onSwitchToList");
  });
});
