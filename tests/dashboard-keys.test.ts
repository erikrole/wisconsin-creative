import { describe, expect, it } from "vitest";
import { dashboardQueryKey, dashboardStatsQueryKey, normalizeDashboard } from "@/lib/dashboard-keys";
import type { DashboardData } from "@/app/(app)/dashboard-types";

describe("dashboard query keys", () => {
  it("scope the cache per signed-in user and share an 'unresolved' slot before the user is known", () => {
    expect(dashboardQueryKey("u1")).toEqual(["dashboard", "u1"]);
    expect(dashboardQueryKey(null)).toEqual(["dashboard", "unresolved"]);
    expect(dashboardStatsQueryKey("u1")).toEqual(["dashboard-stats", "u1"]);
    expect(dashboardStatsQueryKey(null)).toEqual(["dashboard-stats", "unresolved"]);
  });
});

describe("normalizeDashboard", () => {
  it("fills every missing section so a partial payload never crashes Home", () => {
    const data = normalizeDashboard({} as DashboardData);

    expect(data.myCheckouts).toEqual({ total: 0, overdue: 0, items: [] });
    expect(data.teamCheckouts).toEqual({ total: 0, overdue: 0, items: [] });
    expect(data.teamReservations).toEqual({ total: 0, items: [] });
    expect(data.pendingPickups).toEqual({ total: 0, items: [] });
    expect(data.staleReservations).toEqual({ total: 0, items: [] });
    expect(data.stats).toEqual({ checkedOut: 0, overdue: 0, reserved: 0, dueToday: 0 });
    for (const list of ["upcomingEvents", "myReservations", "overdueItems", "drafts", "myShifts", "myEventWork", "flaggedItems", "lostBulkUnits"] as const) {
      expect(data[list]).toEqual([]);
    }
  });

  it("keeps the data it was given and only patches holes inside a section", () => {
    const partial = {
      myCheckouts: { total: 2, items: undefined, overdue: undefined },
      stats: { checkedOut: 2, overdue: 1, reserved: 0, dueToday: 1 },
      drafts: [{ id: "d1" }],
    } as unknown as DashboardData;

    const data = normalizeDashboard(partial);

    expect(data).toBe(partial);
    expect(data.myCheckouts).toEqual({ total: 2, overdue: 0, items: [] });
    expect(data.stats).toEqual({ checkedOut: 2, overdue: 1, reserved: 0, dueToday: 1 });
    expect(data.drafts).toEqual([{ id: "d1" }]);
  });
});
