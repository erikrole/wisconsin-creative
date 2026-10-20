import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { DashboardStats, DashboardStatsResponse } from "@/app/(app)/dashboard-types";
import { hasDashboardCountFailure } from "@/app/(app)/dashboard-types";
import {
  dashboardQueryKey,
  dashboardStatsQueryKey,
  dashboardStatsQueryOptions,
  fetchDashboardStats,
  getDashboardStatsSyncIssue,
} from "@/hooks/use-dashboard-data";

function stats(overdue: number): DashboardStats {
  return {
    role: "STAFF",
    stats: { checkedOut: overdue + 3, overdue, reserved: 4, dueToday: 2 },
    overdueCount: overdue,
    myCheckoutsTotal: 3,
    myOverdueCount: overdue,
    myDueTodayCount: 1,
    teamCheckoutsTotal: 5,
    teamCheckoutsOverdue: overdue,
    teamReservationsTotal: 4,
    pendingPickupTotal: 2,
    staleReservationTotal: 1,
    myShiftsCount: 6,
    myShiftsTodayCount: 2,
  };
}

function response(body: DashboardStatsResponse) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("dashboard fast-count trust boundary", () => {
  it("shares concurrent reads while allowing navigation to request fresh custody counts", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => response({ data: stats(3), partialFailures: [] }));
    const [home, shell] = await Promise.all([
      client.fetchQuery(dashboardStatsQueryOptions("user-a")),
      client.fetchQuery(dashboardStatsQueryOptions("user-a")),
    ]);
    expect(home).toEqual(shell);
    await client.fetchQuery(dashboardStatsQueryOptions("user-a"));
    expect(fetch).toHaveBeenCalledTimes(1);
    await client.fetchQuery({ ...dashboardStatsQueryOptions("user-a"), staleTime: 0 });
    expect(fetch).toHaveBeenCalledTimes(2);
    await client.invalidateQueries({ queryKey: dashboardStatsQueryKey("user-a") });
    await client.fetchQuery(dashboardStatsQueryOptions("user-a"));
    expect(fetch).toHaveBeenCalledTimes(3);
    client.clear();
  });

  it("keeps the current route and search when a shared stats read expires", async () => {
    const location = { pathname: "/schedule", search: "?view=week", href: "" };
    vi.stubGlobal("window", { location });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 401 }));
    await expect(fetchDashboardStats()).rejects.toMatchObject({ name: "AbortError" });
    expect(location.href).toBe("/login?returnTo=%2Fschedule%3Fview%3Dweek");
  });
  it("classifies aggregate and future failures as unsafe but shift-only failures as safe", () => {
    expect(hasDashboardCountFailure(["counts"])).toBe(true);
    expect(hasDashboardCountFailure(["futureOperationalCount"])).toBe(true);
    expect(hasDashboardCountFailure(["myShiftsCount", "myShiftsTodayCount"])).toBe(false);

    const page = readFileSync("src/app/(app)/page.tsx", "utf8");
    expect(page).not.toContain("DASHBOARD_STATS_KEY");
    expect(page).not.toContain("/api/dashboard/stats");
  });

  it("preserves trusted cached counts through invalidation failure, then recovers", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const trusted = stats(7);
    const recovered = stats(2);
    const statsKey = dashboardStatsQueryKey("user-a");
    let nextResponse: DashboardStatsResponse = {
      data: { ...stats(0), myShiftsCount: 0, myShiftsTodayCount: 0 },
      partialFailures: ["counts"],
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => response(nextResponse));
    queryClient.setQueryData(statsKey, trusted);

    const observer = new QueryObserver(queryClient, {
      queryKey: statsKey,
      queryFn: ({ signal }) => fetchDashboardStats(signal),
      retry: false,
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => undefined);

    await queryClient.invalidateQueries({
      queryKey: statsKey,
      refetchType: "active",
    });

    const failedState = queryClient.getQueryState<DashboardStats>(statsKey);
    expect(failedState?.data).toEqual(trusted);
    expect(failedState?.data?.overdueCount).toBe(7);
    expect(failedState?.status).toBe("error");
    expect(getDashboardStatsSyncIssue(failedState?.error, failedState?.fetchStatus === "fetching"))
      .toMatchObject({ label: "Counts may be stale" });

    nextResponse = { data: recovered, partialFailures: [] };
    await queryClient.invalidateQueries({
      queryKey: statsKey,
      refetchType: "active",
    });

    const recoveredState = queryClient.getQueryState<DashboardStats>(statsKey);
    expect(recoveredState?.data).toEqual(recovered);
    expect(recoveredState?.status).toBe("success");
    expect(getDashboardStatsSyncIssue(recoveredState?.error, false)).toBeNull();

    unsubscribe();
    queryClient.clear();
  });

  it("never exposes user A dashboard caches through user B query keys", () => {
    const queryClient = new QueryClient();
    const userAStats = stats(9);
    const userAData = { role: "ADMIN", stats: userAStats.stats };

    queryClient.setQueryData(dashboardQueryKey("user-a"), userAData);
    queryClient.setQueryData(dashboardStatsQueryKey("user-a"), userAStats);

    expect(queryClient.getQueryData(dashboardQueryKey("user-b"))).toBeUndefined();
    expect(queryClient.getQueryData(dashboardStatsQueryKey("user-b"))).toBeUndefined();
    expect(queryClient.getQueryData(dashboardQueryKey(null))).toBeUndefined();
    expect(queryClient.getQueryData(dashboardStatsQueryKey(null))).toBeUndefined();
  });

  it("accepts shift-only partial responses without changing unrelated totals", async () => {
    const shiftPartial = {
      ...stats(4),
      myShiftsCount: 0,
      myShiftsTodayCount: 0,
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response({
      data: shiftPartial,
      partialFailures: ["myShiftsCount", "myShiftsTodayCount"],
    }));

    await expect(fetchDashboardStats()).resolves.toEqual(shiftPartial);
    expect(shiftPartial.overdueCount).toBe(4);
  });
});
