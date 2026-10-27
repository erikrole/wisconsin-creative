"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import {
  hasDashboardCountFailure,
  type DashboardData,
  type DashboardStats,
  type DashboardStatsResponse,
} from "@/app/(app)/dashboard-types";
import { handleAuthRedirect, parseJsonSafely } from "@/lib/errors";
import { DASHBOARD_STATS_KEY, dashboardQueryKey, dashboardStatsQueryKey, normalizeDashboard } from "@/lib/dashboard-keys";
export { DASHBOARD_STATS_KEY, dashboardQueryKey, dashboardStatsQueryKey };
import { useAuthenticatedQueryUserId } from "@/components/QueryProvider";
import { peekSeededKey, takeSeededKey } from "@/components/SeedFetchCache";

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
  if (handleAuthRedirect(res)) {
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

export function dashboardStatsQueryOptions(userId: string | null) {
  return {
    queryKey: dashboardStatsQueryKey(userId),
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchDashboardStats(signal),
    staleTime: 60_000,
  };
}

/**
 * Mount refetch for a query the server may have just read. The check runs when the observer mounts, after
 * the whole page has rendered and seeded the cache, and the mark outlives the first mount by a few seconds
 * because Home can hydrate a beat after the shell does.
 */
function useMountRefetch(queryClient: QueryClient, key: readonly unknown[]) {
  useEffect(() => {
    const timer = setTimeout(() => takeSeededKey(queryClient, key), 10_000);
    return () => clearTimeout(timer);
  }, [queryClient, key]);
  return () => (peekSeededKey(queryClient, key) ? false : "always" as const);
}

export function useDashboardStats() {
  const queryClient = useQueryClient();
  const userId = useAuthenticatedQueryUserId();
  const refetchOnMount = useMountRefetch(queryClient, dashboardStatsQueryKey(userId));
  return useQuery({
    ...dashboardStatsQueryOptions(userId),
    enabled: Boolean(userId),
    refetchOnMount,
    refetchOnWindowFocus: true,
  });
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
  const refetchOnMount = useMountRefetch(queryClient, dashboardKey);

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
    refetchOnMount,
  });

  // Fast stats — single SQL query, 60-second stale time, refetch on window focus
  const {
    data: statsData,
    error: statsError,
    isFetching: isStatsFetching,
    dataUpdatedAt: statsUpdatedAt,
    refetch: refetchStats,
  } = useDashboardStats();

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
