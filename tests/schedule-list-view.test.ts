import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CrewSummary, DateGroupHeader } from "@/app/(app)/schedule/_components/ListViewCrewRows";
import { EventGrid, EventListSkeleton } from "@/app/(app)/schedule/_components/ListViewGrid";
import {
  activeShiftAssignment,
  commonCallWindow,
  openShiftCount,
  shiftAssignee,
  workerKindForShift,
} from "@/app/(app)/schedule/_components/list-view-helpers";
import type { CalendarEntry, Shift, ShiftAssignment } from "@/app/(app)/schedule/_components/types";

function assignment(status: string, name: string, overrides: Partial<ShiftAssignment> = {}): ShiftAssignment {
  return {
    id: `a-${name}`,
    status,
    user: { id: `u-${name}`, name, role: "STUDENT", primaryArea: "VIDEO" },
    ...overrides,
  };
}

function shift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: "s-1",
    area: "VIDEO",
    workerType: "ST",
    startsAt: "2026-10-31T16:00:00.000Z",
    endsAt: "2026-10-31T20:00:00.000Z",
    notes: null,
    assignments: [],
    ...overrides,
  };
}

function entry(shifts: Shift[], overrides: Partial<CalendarEntry> = {}): CalendarEntry {
  return {
    id: "e-1",
    summary: "Football vs Iowa",
    startsAt: "2026-10-31T18:00:00.000Z",
    endsAt: "2026-10-31T21:30:00.000Z",
    allDay: false,
    status: "CONFIRMED",
    rawLocationText: null,
    sportCode: "FB",
    opponent: "Iowa",
    isHome: true,
    site: "HOME",
    subtitle: null,
    location: null,
    source: null,
    shiftGroupId: "g-1",
    coverage: null,
    shifts,
    ...overrides,
  };
}

const callWindow = { callStartsAt: "2026-10-31T15:00:00.000Z", callEndsAt: "2026-10-31T21:00:00.000Z" };

describe("schedule list crew helpers", () => {
  it("only counts direct or approved assignments as filling a shift", () => {
    const requested = shift({ assignments: [assignment("REQUESTED", "Ava")] });
    const approved = shift({ id: "s-2", assignments: [assignment("DECLINED", "Ben"), assignment("APPROVED", "Cam")] });

    expect(shiftAssignee(requested)).toBeNull();
    expect(shiftAssignee(approved)?.name).toBe("Cam");
    expect(activeShiftAssignment(approved)?.id).toBe("a-Cam");
    expect(openShiftCount(entry([requested, approved, shift({ id: "s-3" })]))).toBe(2);
  });

  it("treats only FT shifts as staff slots", () => {
    expect(workerKindForShift(shift({ workerType: "FT" }))).toBe("FT");
    expect(workerKindForShift(shift({ workerType: "ST" }))).toBe("ST");
    expect(workerKindForShift(shift({ workerType: "anything" }))).toBe("ST");
  });

  it("surfaces the student call time shared by at least two student shifts", () => {
    const shared = commonCallWindow(
      entry([
        shift({ id: "s-1", ...callWindow }),
        shift({ id: "s-2", ...callWindow }),
        shift({ id: "s-3", workerType: "FT", ...callWindow }),
      ]),
    );

    expect(shared?.count).toBe(2);
    expect(shared?.window.startsAt).toBe(callWindow.callStartsAt);
  });

  it("shows no shared call time for one student, all-day events or away games", () => {
    expect(commonCallWindow(entry([shift(callWindow)]))).toBeNull();
    expect(commonCallWindow(entry([shift(callWindow), shift({ id: "s-2", ...callWindow })], { allDay: true }))).toBeNull();
    expect(
      commonCallWindow(
        entry([shift(callWindow), shift({ id: "s-2", ...callWindow })], { isHome: false, site: "AWAY" }),
      ),
    ).toBeNull();
  });
});

describe("schedule list rows", () => {
  it("labels today's date group and counts its events", () => {
    const today = renderToStaticMarkup(createElement(DateGroupHeader, { date: new Date(2026, 9, 31), eventCount: 1, isToday: true }));
    const empty = renderToStaticMarkup(createElement(DateGroupHeader, { date: new Date(2026, 10, 1), eventCount: 0, isToday: false }));

    expect(today).toContain("Sat, Oct 31");
    expect(today).toContain("Today");
    expect(today).toContain("1 event<");
    expect(empty).toContain("No events");
    expect(empty).not.toContain("Today");
  });

  it("summarizes crew as open seats and hides it for events without shifts", () => {
    const summary = (shifts: Shift[]) =>
      renderToStaticMarkup(createElement(TooltipProvider, null, createElement(CrewSummary, { entry: entry(shifts) })));
    const staffed = shift({ assignments: [assignment("APPROVED", "Ava")] });

    expect(summary([staffed, shift({ id: "s-2" })])).toContain("1 open");
    expect(summary([staffed])).not.toContain("open");
    expect(summary([])).toBe("");
  });

  it("renders every event column in order, even when a cell is empty", () => {
    const html = renderToStaticMarkup(
      createElement(EventGrid, {
        cells: { toggle: null, time: "7:00 PM", event: "Football", coverage: null, crew: null, status: "Live", actions: null },
      }),
    );
    const columns = [...html.matchAll(/data-event-column="(\w+)"/g)].map((match) => match[1]);

    expect(columns).toEqual(["toggle", "time", "event", "coverage", "crew", "status", "actions"]);
  });

  it("announces the loading skeleton and draws the requested number of rows", () => {
    const html = renderToStaticMarkup(createElement(EventListSkeleton, { rows: 3 }));

    expect(html).toContain('aria-label="Loading schedule"');
    expect(html.match(/data-event-column="time"/g)).toHaveLength(3);
  });
});
