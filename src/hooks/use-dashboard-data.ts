"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  hasDashboardCountFailure,
  type DashboardData,
  type DashboardStats,
  type DashboardStatsResponse,
} from "@/app/(app)/dashboard-types";
import { handleAuthRedirect, parseJsonSafely } from "@/lib/errors";
import { useAuthenticatedQueryUserId } from "@/components/QueryProvider";

const DASHBOARD_KEY = ["dashboard"] as const;
export const DASHBOARD_STATS_KEY = ["dashboard-stats"] as const;
const UNRESOLVED_USER_KEY = "unresolved";

export function dashboardQueryKey(userId: string | null) {
  return [...DASHBOARD_KEY, userId ?? UNRESOLVED_USER_KEY] as const;
}

export function dashboardStatsQueryKey(userId: string | null) {
  return [...DASHBOARD_STATS_KEY, userId ?? UNRESOLVED_USER_KEY] as const;
}

/** Normalize partial API responses with safe defaults */
function normalizeDashboard(d: DashboardData): DashboardData {
  d.myCheckouts = d.myCheckouts ?? { total: 0, overdue: 0, items: [] };
  d.myCheckouts.overdue = d.myCheckouts.overdue ?? 0;
  d.myCheckouts.items = d.myCheckouts.items ?? [];
  d.teamCheckouts = d.teamCheckouts ?? { total: 0, overdue: 0, items: [] };
  d.teamCheckouts.items = d.teamCheckouts.items ?? [];
  d.teamReservations = d.teamReservations ?? { total: 0, items: [] };
  d.teamReservations.items = d.teamReservations.items ?? [];
  d.pendingPickups = d.pendingPickups ?? { total: 0, items: [] };
  d.pendingPickups.items = d.pendingPickups.items ?? [];
  d.staleReservations = d.staleReservations ?? { total: 0, items: [] };
  d.staleReservations.items = d.staleReservations.items ?? [];
  d.upcomingEvents = d.upcomingEvents ?? [];
  d.myReservations = d.myReservations ?? [];
  d.overdueItems = d.overdueItems ?? [];
  d.drafts = d.drafts ?? [];
  d.myShifts = d.myShifts ?? [];
  d.myEventWork = d.myEventWork ?? [];
  d.flaggedItems = d.flaggedItems ?? [];
  d.lostBulkUnits = d.lostBulkUnits ?? [];
  d.stats = d.stats ?? { checkedOut: 0, overdue: 0, reserved: 0, dueToday: 0 };
  return d;
}

async function fetchDashboard(signal?: AbortSignal): Promise<DashboardData> {
  const res = await fetch("/api/dashboard", { signal });
  if (handleAuthRedirect(res, "/")) {
    throw new DOMException("Auth redirect", "AbortError");
  }
  if (!res.ok) throw new Error("server");
  const json = await parseJsonSafely<{ data?: DashboardData }>(res);
  if (!json?.data) throw new Error("server");
  return normalizeDashboard(json.data as DashboardData);
}

export async function fetchDashboardStats(signal?: AbortSignal): Promise<DashboardStats> {
  const res = await fetch("/api/dashboard/stats", { signal });
  if (handleAuthRedirect(res, "/")) {
    throw new DOMException("Auth redirect", "AbortError");
  }
  if (!res.ok) throw new Error("server");
  const json = await parseJsonSafely<DashboardStatsResponse>(res);
  if (!json?.data) throw new Error("server");
  const partialFailures = Array.isArray(json.partialFailures)
    ? json.partialFailures.filter((failure) => typeof failure === "string")
    : [];
  if (hasDashboardCountFailure(partialFailures)) {
    throw new Error("counts");
  }
  return json.data;
}

type UseDashboardDataResult = {
  data: DashboardData | null;
  fastStats: DashboardStats | null;
  fetchError: false | "auth" | "network" | "server";
  refreshing: boolean;
  refreshBusy: boolean;
  statsSyncIssue: DashboardStatsSyncIssue;
  lastRefreshed: Date | null;
  loadData: () => void;
  setData: React.Dispatch<React.SetStateAction<DashboardData | null>>;
};

type DashboardStatsSyncIssue = null | {
  label: string;
  description: string;
};

export function getDashboardStatsSyncIssue(
  statsError: unknown,
  isFetching: boolean,
): DashboardStatsSyncIssue {
  if (!statsError || (statsError as Error).name === "AbortError") return null;
  return {
    label: isFetching ? "Counts retrying" : "Counts may be stale",
    description: isFetching
      ? "The latest dashboard counts were not confirmed. Trusted counts remain visible while the refresh retries."
      : "The latest dashboard counts were not confirmed. Trusted counts remain visible until the next refresh.",
  };
}

export function useDashboardData(): UseDashboardDataResult {
  const queryClient = useQueryClient();
  const userId = useAuthenticatedQueryUserId();
  const dashboardKey = useMemo(() => dashboardQueryKey(userId), [userId]);
  const statsKey = useMemo(() => dashboardStatsQueryKey(userId), [userId]);

  // Full payload — heavy queries, 5-minute stale time
  const {
    data: fullData,
    isLoading,
    isFetching,
    error: fullError,
    dataUpdatedAt,
    refetch: refetchFull,
  } = useQuery<DashboardData>({
    queryKey: dashboardKey,
    queryFn: ({ signal }) => fetchDashboard(signal),
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
    refetchOnMount: "always",
  });

  // Fast stats — single SQL query, 60-second stale time, refetch on window focus
  const {
    data: statsData,
    error: statsError,
    isFetching: isStatsFetching,
    dataUpdatedAt: statsUpdatedAt,
    refetch: refetchStats,
  } = useQuery<DashboardStats>({
    queryKey: statsKey,
    queryFn: ({ signal }) => fetchDashboardStats(signal),
    enabled: Boolean(userId),
    staleTime: 60_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  // Toast on background refresh failure (full payload only)
  const prevFetchingRef = useRef(false);
  useEffect(() => {
    if (prevFetchingRef.current && !isFetching && fullError && fullData !== undefined) {
      toast.error("Failed to refresh dashboard");
    }
    prevFetchingRef.current = isFetching;
  }, [isFetching, fullError, fullData]);

  // Classify error — only show error screen when no cached data
  const fetchError: false | "auth" | "network" | "server" =
    fullError && !fullData
      ? (fullError as Error).name === "TypeError" ? "network" : "server"
      : false;

  const statsSyncIssue = getDashboardStatsSyncIssue(statsError, isStatsFetching);

  // Merge: overlay fresh stats from the fast endpoint onto the full payload.
  // This keeps stat cards, the overdue count, and transient-lane totals
  // (awaiting pickup, stale reservations) current (60s) without re-running the
  // expensive events/shifts/flagged queries. Row item arrays stay owned by the
  // full payload — only lane totals are overlaid.
  const safeFullData = userId && fullData ? normalizeDashboard(fullData) : null;
  const data: DashboardData | null = safeFullData
    ? statsData
      ? {
          ...safeFullData,
          stats: statsData.stats,
          overdueCount: statsData.overdueCount,
          myCheckouts: {
            ...safeFullData.myCheckouts,
            total: statsData.myCheckoutsTotal,
            overdue: statsData.myOverdueCount,
          },
          teamCheckouts: {
            ...safeFullData.teamCheckouts,
            total: statsData.teamCheckoutsTotal,
            overdue: statsData.teamCheckoutsOverdue,
          },
          teamReservations: {
            ...safeFullData.teamReservations,
            total: statsData.teamReservationsTotal,
          },
          pendingPickups: {
            ...safeFullData.pendingPickups,
            total: statsData.pendingPickupTotal,
          },
          staleReservations: {
            ...safeFullData.staleReservations,
            total: statsData.staleReservationTotal,
          },
        }
      : safeFullData
    : null;

  // Preserve setData API for optimistic updates (draft deletion)
  const setData: React.Dispatch<React.SetStateAction<DashboardData | null>> = useCallback(
    (updater) => {
      if (!userId) return;
      queryClient.setQueryData<DashboardData>(dashboardKey, (prev) => {
        if (typeof updater === "function") {
          return updater(prev ?? null) ?? undefined;
        }
        return updater ?? undefined;
      });
    },
    [dashboardKey, queryClient, userId],
  );

  return {
    data,
    fastStats: userId ? statsData ?? null : null,
    fetchError,
    refreshing: (isFetching && !isLoading) || isStatsFetching,
    refreshBusy: isFetching && !isLoading,
    statsSyncIssue,
    lastRefreshed: Math.max(dataUpdatedAt, statsUpdatedAt) > 0
      ? new Date(Math.max(dataUpdatedAt, statsUpdatedAt))
      : null,
    loadData: () => {
      void refetchFull();
      void refetchStats();
    },
    setData,
  };
}
