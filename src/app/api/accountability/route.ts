import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { selectAccountabilityJeers } from "@/lib/accountability-jeers";
import { csvField } from "@/lib/csv";
import { HttpError, ok } from "@/lib/http";
import { getAllowedRoles } from "@/lib/permissions";
import { requirePermission } from "@/lib/rbac";
import { enforceRateLimit, REPORT_EXPORT_LIMIT } from "@/lib/rate-limit";
import {
  getAccountabilityReport,
  getCurrentAcademicYearStart,
  type AccountabilityIncidentState,
  type AccountabilitySort,
  type AccountabilityUserState,
} from "@/lib/services/accountability";

const INCIDENT_STATES = new Set(["all", "active", "resolved", "extended"]);
const USER_STATES = new Set(["all", "active", "inactive"]);
const SORTS = new Set(["events", "time", "recent"]);

function parseFilters(searchParams: URLSearchParams) {
  const year = searchParams.get("year");
  let startYear: number | null = getCurrentAcademicYearStart();
  if (year === "all") startYear = null;
  else if (year !== null) {
    if (!/^\d{4}$/.test(year)) throw new HttpError(400, "year must be a four-digit year or all");
    startYear = Number(year);
    if (startYear < 2000 || startYear > 2100) throw new HttpError(400, "year is out of range");
  }

  const incidentState = searchParams.get("state") ?? "all";
  if (!INCIDENT_STATES.has(incidentState)) throw new HttpError(400, "Invalid incident state");
  const userState = searchParams.get("users") ?? "all";
  if (!USER_STATES.has(userState)) throw new HttpError(400, "Invalid user state");
  const sort = searchParams.get("sort") ?? "events";
  if (!SORTS.has(sort)) throw new HttpError(400, "Invalid sort");

  return {
    startYear,
    locationId: searchParams.get("locationId") || undefined,
    incidentState: incidentState as AccountabilityIncidentState,
    userState: userState as AccountabilityUserState,
    sort: sort as AccountabilitySort,
  };
}

function toCsv(report: Awaited<ReturnType<typeof getAccountabilityReport>>) {
  const headers = [
    "Rank",
    "Person",
    "Active User",
    "Primary Area",
    "Late Events",
    "Active Overdue",
    "Total Late Hours",
    "Median Late Hours",
    "Worst Late Hours",
    "Total Checkouts",
    "Completed Checkouts",
    "On-Time Rate",
    "Last Incident",
  ];
  const rows = report.leaderboard.map((person, index) => [
    index + 1,
    person.name,
    person.active ? "Yes" : "No",
    person.primaryArea ?? "",
    person.lateEventCount,
    person.activeOverdueCount,
    person.totalLateHours,
    person.medianLateHours,
    person.worstLateHours,
    person.checkoutCount,
    person.completedCount,
    person.onTimeRate === null ? "" : `${person.onTimeRate}%`,
    person.lastIncidentAt,
  ]);
  return [headers, ...rows].map((row) => row.map(csvField).join(",")).join("\n");
}

export const GET = withAuth(async (req, { user }) => {
  requirePermission(user.role, "accountability", "view");
  const searchParams = new URL(req.url).searchParams;
  const canManageExclusions = getAllowedRoles("accountability", "manage_exclusions").includes(
    user.role,
  );
  const wantsCsv = searchParams.get("format") === "csv";

  if (wantsCsv) {
    requirePermission(user.role, "accountability", "manage_exclusions");
  }

  const report = await getAccountabilityReport(parseFilters(searchParams));

  if (wantsCsv) {
    await enforceRateLimit(`report:export:${user.id}`, REPORT_EXPORT_LIMIT);
    return new NextResponse(`${toCsv(report)}\n`, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="accountability-${report.academicYear?.label ?? "all-time"}.csv"`,
      },
    });
  }

  const { excluded, metrics, ...sharedReport } = report;
  const sharedMetrics = {
    peopleNeedingAttention: metrics.peopleNeedingAttention,
    lateEvents: metrics.lateEvents,
    activeOverdue: metrics.activeOverdue,
    totalLateHours: metrics.totalLateHours,
  };
  const spotlightJeers = selectAccountabilityJeers(report.leaderboard);

  return ok({
    ...sharedReport,
    spotlightJeers,
    metrics: canManageExclusions ? metrics : sharedMetrics,
    capabilities: {
      canExport: canManageExclusions,
      canManageExclusions,
    },
    ...(canManageExclusions ? { excluded } : {}),
  });
});
