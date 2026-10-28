import type { DashboardData } from "@/app/(app)/dashboard-types";

// Query keys and payload defaults shared by the Home hooks and the server render that seeds them.
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
export function normalizeDashboard(d: DashboardData): DashboardData {
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
