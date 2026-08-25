import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  readDashboardCounts,
  zeroDashboardCounts,
  type DashboardCounts,
} from "@/lib/services/dashboard-counts";
import { startOfDayInAppTz } from "@/lib/app-time";
import { hasCollaboratorCapability } from "@/lib/collaborator-access";

const STATS_LIMIT = { max: 180, windowMs: 60_000 };

function settledValue<T>(
  result: PromiseSettledResult<T>,
  fallback: T,
  label: string,
  partialFailures: string[],
): T {
  if (result.status === "fulfilled") return result.value;
  console.error(`[dashboard/stats] ${label} failed`, result.reason);
  partialFailures.push(label);
  return fallback;
}

// Lightweight stats-only endpoint — runs the single shared count aggregate and
// returns nothing else. Used by the dashboard to keep stat cards, the overdue
// count, and the transient-lane totals (awaiting pickup, stale reservations)
// fresh (60s TTL) without re-running the expensive full-payload row queries.
export const GET = withAuth(async (req, { user }) => {
  const { allowed } = await checkRateLimit(`dashboard:stats:${user.id}`, STATS_LIMIT);
  if (!allowed) throw new HttpError(429, "Too many requests. Please wait a moment.");

  const now = new Date();
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Institution-timezone day bounds (not the server's UTC).
  const startOfToday = startOfDayInAppTz(now, 0);
  const startOfTomorrow = startOfDayInAppTz(now, 1);
  const isCollaborator = user.role === "COLLABORATOR";
  const canViewMyGear = !isCollaborator || hasCollaboratorCapability(user, "MY_GEAR_VIEW");
  // Same scope switch `/api/dashboard` reads. The iOS tab badge and the Home
  // stat rows are the same number for the explicit personal scope, while the
  // regular web dashboard remains team-visible for internal roles.
  const isPersonalOnly = new URL(req.url).searchParams.get("scope") === "ios-home"
    || isCollaborator;

  const [countsResult, myShiftsCountResult, myShiftsTodayCountResult] = await Promise.allSettled([
    readDashboardCounts({
      userId: user.id,
      now,
      sevenDaysFromNow,
      startOfToday,
      startOfTomorrow,
    }),
    // Kept for iOS/Profile: upcoming/on-deck shift count without loading the full dashboard.
    isCollaborator ? Promise.resolve(0) : db.shiftAssignment.count({
      where: {
        userId: user.id,
        status: { in: ["DIRECT_ASSIGNED", "APPROVED"] },
        shift: { shiftGroup: { event: { endsAt: { gt: startOfToday }, status: "CONFIRMED", archivedAt: null } } },
      },
    }),
    // Drives the iOS Schedule tab badge only when the user has work today.
    isCollaborator ? Promise.resolve(0) : db.shiftAssignment.count({
      where: {
        userId: user.id,
        status: { in: ["DIRECT_ASSIGNED", "APPROVED"] },
        shift: {
          shiftGroup: {
            event: {
              startsAt: { lt: startOfTomorrow },
              endsAt: { gt: startOfToday },
              status: "CONFIRMED",
              archivedAt: null,
            },
          },
        },
      },
    }),
  ]);
  const partialFailures: string[] = [];
  const c: DashboardCounts = settledValue(countsResult, zeroDashboardCounts, "counts", partialFailures);
  const myShiftsCount = settledValue(myShiftsCountResult, 0, "myShiftsCount", partialFailures);
  const myShiftsTodayCount = settledValue(myShiftsTodayCountResult, 0, "myShiftsTodayCount", partialFailures);
  const visibleMyCheckoutsTotal = canViewMyGear ? c.myCheckoutsTotal : 0;
  const visibleMyOverdueCount = canViewMyGear ? c.myOverdue : 0;
  const visibleMyDueTodayCount = canViewMyGear ? c.myDueToday : 0;

  return ok({
    data: {
      role: user.role,
      stats: {
        checkedOut: canViewMyGear ? (isPersonalOnly ? c.myCheckoutsTotal : c.totalCheckedOut) : 0,
        overdue: canViewMyGear ? (isPersonalOnly ? c.myOverdue : c.totalOverdue) : 0,
        reserved: canViewMyGear ? (isPersonalOnly ? Math.max(0, c.totalReserved - c.teamReservationsTotal) : c.totalReserved) : 0,
        dueToday: canViewMyGear ? (isPersonalOnly ? c.myDueToday : c.dueToday) : 0,
      },
      overdueCount: canViewMyGear ? (isPersonalOnly ? c.myOverdue : c.totalOverdue) : 0,
      myCheckoutsTotal: visibleMyCheckoutsTotal,
      myOverdueCount: visibleMyOverdueCount,
      myDueTodayCount: visibleMyDueTodayCount,
      teamCheckoutsTotal: isPersonalOnly ? 0 : c.teamCheckoutsTotal,
      teamCheckoutsOverdue: isPersonalOnly ? 0 : c.teamCheckoutsOverdue,
      teamReservationsTotal: isPersonalOnly ? 0 : c.teamReservationsTotal,
      ...(isPersonalOnly
        ? { pendingPickupTotal: 0, staleReservationTotal: 0 }
        : {
            pendingPickupTotal: c.pendingPickupTotal,
            staleReservationTotal: c.staleReservationTotal,
          }),
      myShiftsCount,
      myShiftsTodayCount,
    },
    partialFailures,
  });
});
