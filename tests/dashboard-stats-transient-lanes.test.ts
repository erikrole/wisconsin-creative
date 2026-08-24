import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("dashboard stats transient-lane counts", () => {
  it("stats endpoint returns pendingPickupTotal and staleReservationTotal", () => {
    const route = source("src/app/api/dashboard/stats/route.ts");
    expect(route).toContain("pendingPickupTotal: c.pendingPickupTotal");
    expect(route).toContain("staleReservationTotal: c.staleReservationTotal");
  });

  it("stats endpoint exposes a user-scoped due-today count for sidebar chrome", () => {
    const route = source("src/app/api/dashboard/stats/route.ts");
    const reader = source("src/lib/services/dashboard-counts.ts");

    expect(reader).toContain("AS my_due_today");
    expect(reader).toContain("myDueToday: Number(c.my_due_today)");
    expect(route).toContain("myDueTodayCount: visibleMyDueTodayCount");
  });

  it("stats endpoint exposes separate upcoming and today shift counts", () => {
    const route = source("src/app/api/dashboard/stats/route.ts");
    const types = source("src/app/(app)/dashboard-types.ts");

    expect(route).toContain("myShiftsCount");
    expect(route).toContain("myShiftsTodayCount");
    expect(route).toContain("startsAt: { lt: startOfTomorrow }");
    expect(route).toContain("endsAt: { gt: startOfToday }");
    expect(types).toContain("myShiftsCount: number");
    expect(types).toContain("myShiftsTodayCount: number");
  });

  it("both dashboard routes consume the shared count reader", () => {
    const stats = source("src/app/api/dashboard/stats/route.ts");
    const full = source("src/app/api/dashboard/route.ts");
    expect(stats).toContain("readDashboardCounts");
    expect(full).toContain("readDashboardCounts");
  });

  it("stats endpoint does not fetch row-level booking details", () => {
    const route = source("src/app/api/dashboard/stats/route.ts");
    expect(route).not.toContain("findMany");
    expect(route).not.toContain("toBookingSummary");
    expect(route).not.toContain("serializedItems");
  });

  it("shared reader keeps the count query as one bounded aggregate", () => {
    const reader = source("src/lib/services/dashboard-counts.ts");
    const selectCount = (reader.match(/SELECT/g) ?? []).length;
    const fromBookings = (reader.match(/FROM bookings/g) ?? []).length;
    expect(selectCount).toBe(1);
    expect(fromBookings).toBe(1);
    expect(reader).toContain("AS pending_pickup");
    expect(reader).toContain("AS stale_reservations");
  });

  it("DashboardStats type carries the two transient-lane totals", () => {
    const types = source("src/app/(app)/dashboard-types.ts");
    expect(types).toContain("pendingPickupTotal: number");
    expect(types).toContain("staleReservationTotal: number");
  });

  it("useDashboardData overlays the totals into pendingPickups and staleReservations", () => {
    const hook = source("src/hooks/use-dashboard-data.ts");
    expect(hook).toContain("pendingPickups: {");
    expect(hook).toContain("total: statsData.pendingPickupTotal");
    expect(hook).toContain("staleReservations: {");
    expect(hook).toContain("total: statsData.staleReservationTotal");
  });

  it("pending-pickup count lane includes due reservations and legacy staged checkouts", () => {
    const reader = source("src/lib/services/dashboard-counts.ts");
    expect(reader).toContain("(kind = 'RESERVATION' AND status = 'BOOKED' AND starts_at <= ${now})");
    expect(reader).toContain("OR (kind = 'CHECKOUT' AND status = 'PENDING_PICKUP')");
    expect(reader).toContain("0::bigint AS stale_reservations");
  });
});

describe("dashboard archived-event exclusion", () => {
  it("dashboard upcoming events exclude archived events like Schedule does", () => {
    const route = source("src/app/api/dashboard/route.ts");
    const queryStart = route.indexOf("db.calendarEvent.findMany");
    const upcomingEventsQuery = route.slice(
      queryStart,
      route.indexOf("take: 20", queryStart),
    );
    expect(queryStart).toBeGreaterThan(-1);
    expect(upcomingEventsQuery).toContain("archivedAt: null");
  });

  it("every personal shift filter excludes archived events", () => {
    const dashboard = source("src/app/api/dashboard/route.ts");
    const stats = source("src/app/api/dashboard/stats/route.ts");
    const myShifts = source("src/app/api/my-shifts/route.ts");

    // dashboard myShifts + upcoming events
    expect((dashboard.match(/archivedAt: null/g) ?? []).length).toBeGreaterThanOrEqual(2);
    // stats: both the upcoming and the today shift counts
    expect((stats.match(/archivedAt: null/g) ?? []).length).toBe(2);
    // my-shifts non-eventId branch
    expect(myShifts).toContain("archivedAt: null");
  });

  it("my-shifts clamps the limit param to a sane positive range", () => {
    const myShifts = source("src/app/api/my-shifts/route.ts");
    expect(myShifts).toContain("Math.min(Math.max(Math.trunc(rawLimit), 1), 20)");
    expect(myShifts).toContain("Number.isFinite(rawLimit)");
  });
});

describe("dashboard My Shifts date contract", () => {
  it("preserves an event's all-day calendar date for staff shift rows", () => {
    const route = source("src/app/api/dashboard/route.ts");
    const types = source("src/app/(app)/dashboard-types.ts");
    const column = source("src/app/(app)/dashboard/my-gear-column.tsx");
    const myShiftType = types.slice(
      types.indexOf("export type MyShift ="),
      types.indexOf("export type MyEventWork ="),
    );
    const myShiftsPayload = route.slice(
      route.indexOf("const myShifts = myShiftsRaw.map"),
      route.indexOf("const assignmentByEvent =", route.indexOf("const myShifts = myShiftsRaw.map")),
    );

    expect(myShiftType).toContain("allDay: boolean;");
    expect(myShiftsPayload).toContain("allDay: ev.allDay");
    // The event's own flag decides the all-day treatment, so a stray call
    // window on an all-day event cannot restore a clock time to the row.
    expect(column).toContain("const isAllDayDisplay = s.event.allDay || isFullDayDefault;");
    expect(column).toContain("formatDayLabel(displayDate, now, isAllDayDisplay)");
    // ...and the same flag suppresses the call window itself.
    expect(column).toContain('s.workerType === "ST" && !s.event.allDay');
    // The payload never sends a call window for an all-day event to begin with.
    expect(myShiftsPayload).toContain('a.shift.workerType === "ST" && !ev.allDay');
  });
});
