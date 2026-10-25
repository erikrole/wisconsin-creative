import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ListView } from "@/app/(app)/schedule/_components/ListView";
import type { CalendarEntry } from "@/app/(app)/schedule/_components/types";
import { assignment, event, groupByDay } from "./fixtures/schedule-entries";

// The whole Schedule list rendered from props. Scroll and layout behavior is
// proven in Chromium by tests/browser/schedule-list.spec.ts.

type Props = ComponentProps<typeof ListView>;

function render(entries: CalendarEntry[], overrides: Partial<Props> = {}) {
  const props: Props = {
    entries, filteredEntries: entries, groupedEntries: groupByDay(entries),
    loading: false, refreshing: false, loadError: false, loadData: () => undefined,
    myShiftsOnly: false, setMyShiftsOnly: () => undefined, clearFilters: () => undefined, hasFilters: false,
    timelineTruncated: false, isTimeline: true, hasMorePast: false, hasMoreFuture: false,
    loadingPast: false, loadingFuture: false, loadPastError: false, loadFutureError: false,
    onLoadOlder: () => undefined, onLoadNewer: () => undefined, fillingWindow: false,
    hasContentFilters: false, includeArchived: false, setIncludeArchived: () => undefined,
    activeQueueMeta: null, clearQueue: () => undefined, currentUserId: "u-viewer", isStaff: false,
    expandedRowId: null, setExpandedRowId: () => undefined, onSelectGroup: () => undefined,
    ...overrides,
  };
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client: new QueryClient() },
      createElement(TooltipProvider, null, createElement(ListView, props))),
  );
}

/** Visible text in document order, so assertions read like the screen. */
function text(html: string) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

const today = event(0, 0);
const noCrew = event(1, 1, { shiftGroupId: null, shifts: [], coverage: null });

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-22T15:00:00Z"));
});
afterAll(() => { vi.useRealTimers(); });

describe("schedule list surface", () => {
  it("names its columns and marks today's group", () => {
    const html = render([today, noCrew]);
    const screen = text(html);

    expect(html).toContain('data-schedule-view="list"');
    expect(screen).toContain("Time Event Coverage Crew Status Actions");
    expect(screen).toContain("Thu, Oct 22 Today Past above · upcoming below 1 event 12:00 PM Football vs Ohio State");
    expect(screen).toContain("Fri, Oct 23");
  });

  it("keeps a Today row, and says so, when nothing is scheduled today", () => {
    const screen = text(render([noCrew]));

    expect(screen).toContain("Thu, Oct 22 Today Past above · upcoming below No events Nothing scheduled today.");
  });

  it("shows coverage as open seats beside the crew, with no class-specific needs copy", () => {
    const screen = text(render([today]));

    expect(screen).toContain("1 open");
    expect(screen).toContain("AR");
    for (const copy of ["Needs students", "Needs 1 people", "Assign 1 open"]) expect(screen).not.toContain(copy);
  });

  it("tags older records and events that run across days", () => {
    const multiDay = event(2, 0, { endsAt: new Date(Date.parse(event(2, 0).startsAt) + 30 * 3_600_000).toISOString() });
    const screen = text(render([today, event(-1, 0, { eventArchivedAt: "2026-06-01T00:00:00Z" }), multiDay]));

    expect(screen).toContain("Older record");
    expect(screen).toContain("Football vs Ohio State Home Oct 24-25");
  });

  it("keeps reservation prep, custody actions and draft review out of the list", () => {
    const html = render([today, noCrew], { isStaff: true, expandedRowId: today.id, onSetupCrew: () => undefined, onHideEvent: () => undefined });

    for (const copy of ["Reserve gear", "/reservations/new", "/checkouts/new", "Review changes", "Unpublished changes", "Changed recently"]) {
      expect(html).not.toContain(copy);
    }
  });
});

describe("schedule list timeline edges", () => {
  it("names the archive floor and offers the way through it", () => {
    expect(text(render([today]))).toContain("Older records are archived Load older records");
    expect(text(render([today], { includeArchived: true }))).toContain("Beginning of records");
    expect(text(render([today], { includeArchived: true }))).not.toContain("Load older records");
  });

  it("does not offer the archive while a filter narrows the list", () => {
    expect(text(render([today], { hasContentFilters: true }))).not.toContain("Older records are archived");
  });

  it("offers older and later pages, and a retry when one fails", () => {
    expect(text(render([today], { hasMorePast: true, hasMoreFuture: true }))).toContain("Scroll for older events");
    expect(text(render([today], { hasMorePast: true, hasMoreFuture: true }))).toContain("Scroll for later events");
    expect(text(render([today], { loadPastError: true }))).toContain("Could not load older events. Try again");
    expect(text(render([today], { loadFutureError: true }))).toContain("Could not load later events. Try again");
    expect(text(render([today]))).toContain("End of scheduled events");
  });

  it("reports hitting the page cap instead of silently truncating", () => {
    expect(text(render([today], { timelineTruncated: true }))).toContain("Showing a limited stretch of the schedule");
  });

  it("shows a row-shaped skeleton while loading and a retry when loading fails", () => {
    expect(render([today], { loading: true })).toContain('aria-label="Loading schedule"');
    expect(text(render([today], { loadError: "network" }))).toContain("You appear to be offline. Check your connection and try again. Retry");
    expect(text(render([today], { loadError: "server" }))).toContain("Something went wrong loading schedule data. Retry");
  });

  it("explains an empty list by what is narrowing it", () => {
    expect(text(render([], { isTimeline: false, hasFilters: true }))).toContain("No events match these filters Try adjusting or clearing filters");
    expect(text(render([], { isTimeline: false, myShiftsOnly: true }))).toContain("No shifts assigned");
  });
});

describe("schedule list crew rows", () => {
  it("lists every slot as Area, Type, Person and offers open slots to students", () => {
    const screen = text(render([today], { expandedRowId: today.id }));

    expect(screen).toContain("Video Student AR Alex Rivera");
    expect(screen).toContain("Video Student slot Claim shift");
  });

  it("states the shared Student call once instead of on every row", () => {
    const screen = text(render([today], { expandedRowId: today.id }));

    expect(screen.match(/Most rows Call 12:00 PM/g)).toHaveLength(2);
    expect(screen).not.toContain("Video Call 12:00 PM");
  });

  it("shows the call on a Student row that differs from the shared call", () => {
    const [first, second] = today.shifts;
    const early = { ...today, id: "ev-early", shifts: [first!, second!, { ...second!, id: "s3", callStartsAt: "2026-10-22T15:30:00Z", callEndsAt: "2026-10-22T20:00:00Z" }] };
    const screen = text(render([early], { expandedRowId: early.id }));

    expect(screen).toContain("Most rows Call 12:00 PM");
    expect(screen).toContain("10:30 AM");
  });

  it("never shows call times for Staff rows or all-day events", () => {
    const staffRows = { ...today, id: "ev-staff", shifts: today.shifts.map((s) => ({ ...s, workerType: "FT" })) };
    const allDay = { ...event(0, 1), id: "ev-all-day", allDay: true };

    expect(text(render([staffRows], { expandedRowId: staffRows.id }))).not.toContain("Call ");
    expect(text(render([allDay], { expandedRowId: allDay.id }))).not.toContain("Most rows");
  });

  it("labels a filled row with the assignee's class when it differs from the slot", () => {
    const [filled, open] = today.shifts;
    const staffInStudentSlot = {
      ...today, id: "ev-mixed",
      shifts: [{ ...filled!, assignments: [assignment("Sam", { user: { id: "u-sam", name: "Sam Lee", role: "STAFF", primaryArea: "VIDEO" } })] }, open!],
    };
    const screen = text(render([staffInStudentSlot], { expandedRowId: staffInStudentSlot.id }));

    expect(screen).toContain("Video Staff SL Sam Lee");
  });

  it("pauses claims with a notice while staff edit the crew", () => {
    const paused = { ...today, claimsPaused: true };
    const screen = text(render([paused], { expandedRowId: paused.id }));

    expect(screen).toContain("Staff are updating this crew. Claims open after the changes are released.");
    expect(screen).not.toContain("Claim shift");
  });

  it("gives staff the shared crew editor instead of the worker rows", () => {
    const screen = text(render([today], { isStaff: true, expandedRowId: today.id }));

    expect(screen).not.toContain("Claim shift");
    expect(screen).not.toContain("Most rows");
  });

  it("makes a mobile card a disclosure only when it has crew to reveal", () => {
    const html = render([today, noCrew]);

    expect(html).toContain(`aria-controls="schedule-event-${today.id}-details"`);
    expect(html).not.toContain(`aria-controls="schedule-event-${noCrew.id}-details"`);
  });
});
