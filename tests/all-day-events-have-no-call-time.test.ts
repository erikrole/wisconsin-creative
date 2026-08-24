import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

/**
 * An all-day event is a date, not a window. Its generated shifts inherit the
 * event's own boundary, which is stored at UTC midnight — so any surface that
 * reads a clock off that boundary prints "7:00 PM" for the evening before and
 * states a call time nobody was ever given. Every read path must suppress the
 * call window on the event's `allDay` flag, and every write path must refuse
 * to set one.
 */
describe("all-day events carry no call time", () => {
  it("suppresses the call window in every API payload that emits one", () => {
    const myShifts = source("src/app/api/my-shifts/route.ts");
    const dashboard = source("src/app/api/dashboard/route.ts");
    const kiosk = source("src/app/api/kiosk/dashboard/route.ts");
    const published = source("src/lib/services/collaborator-schedule.ts");

    // The flag has to be selected before it can gate anything.
    expect(myShifts).toContain("allDay: true,");
    expect(myShifts).toContain('a.shift.workerType === "ST" && !event.allDay');
    expect(myShifts).toContain("allDay: event.allDay,");

    // Personal shift rows and event-work rows, each guarding start and end,
    // plus the today-event call chip.
    expect(dashboard.match(/a\.shift\.workerType === "ST" && !ev\.allDay/g)?.length).toBe(4);
    expect(dashboard).toContain("e.isHome === true && !e.allDay && earliestShift");

    // The kiosk route already nulled these; keep it that way.
    expect(kiosk).toContain("callStartsAt: allDay ? null : callStartsAt");

    // Published collaborator crew, read by both web and iOS.
    expect(published).toContain("callStartsAt: group.event.allDay");
    expect(published).toContain("callEndsAt: group.event.allDay");
  });

  it("refuses to write a call window onto an all-day event", () => {
    const workingCopy = source("src/lib/services/schedule-working-copy.ts");
    // adjustSlots (seeding a new slot), setCallWindow (one slot or personal
    // override), and setCallWindowForAll must all reject it.
    expect(
      workingCopy.match(/All-day events do not have call times\./g)?.length,
    ).toBe(3);
  });

  it("leaves the call columns empty in schedule exports", () => {
    const exports = source("src/lib/services/schedule-exports.ts");
    expect(exports).toContain("if (allDay || shift.workerType !== \"ST\") return null;");
    expect(exports).toContain("group.event.allDay");
  });

  it("hides the call time on every web surface that renders one", () => {
    const assignmentCell = source("src/app/(app)/schedule/assign/_components/AssignmentCell.tsx");
    const assignmentGrid = source("src/app/(app)/schedule/assign/_components/AssignmentGrid.tsx");
    const collaborator = source("src/app/(app)/schedule/_components/CollaboratorSchedule.tsx");
    const tradeBoard = source("src/components/TradeBoard.tsx");

    expect(assignmentCell).toContain("const callWindow = allDay ? null : effectiveCallWindow(shift, assignment);");
    expect(assignmentCell).toContain('shift.workerType === "ST" && callWindow ?');
    expect(assignmentGrid).toContain("allDay={ev.allDay}");

    expect(collaborator).toContain("member.callStartsAt && member.callEndsAt ?");
    expect(tradeBoard).toContain("shift.shiftGroup?.event.allDay");
  });

  it("keeps an all-day event out of the schedule-health next-call instant", () => {
    const health = source("src/lib/services/schedule-health.ts");
    expect(health).toContain("event.allDay ? undefined : event.shiftGroup?.shifts");
  });
});

/**
 * The server has no timezone of its own, so a bare `toLocale*` there renders
 * UTC. Strings a person reads must name the institution timezone explicitly —
 * except all-day boundaries, which are encoded dates and read back in UTC.
 */
describe("server-rendered dates state their timezone", () => {
  it("formats schedule health, change history, and email in the app timezone", () => {
    expect(source("src/lib/services/schedule-health.ts")).toContain("return formatAppDateTime(startsAt);");
    expect(source("src/lib/services/schedule-change-history.ts")).toContain("timeZone: env.appTimezone,");
    expect(source("src/lib/email.ts")).toContain("timeZone: env.appTimezone,");
  });

  it("buckets report days on the app timezone, not UTC", () => {
    const reports = source("src/lib/services/reports.ts");
    expect(reports).not.toContain("date_trunc('day', \"created_at\" AT TIME ZONE 'UTC')");
    expect(
      reports.match(/AT TIME ZONE 'UTC' AT TIME ZONE \$\{env\.appTimezone\}::text/g)?.length,
    ).toBe(2);
    // The JS cursor that fills gap days must key the same way as the SQL.
    expect(reports).toContain("const sinceKey = appTzDateKey(since);");
    expect(reports).toContain("const key = appTzDateKey(cursor);");
    // A clicked heatmap cell opens the Central day, not the UTC one.
    expect(reports).toContain("return appTzDayRange(focusDate);");
  });
});
