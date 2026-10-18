import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { assertDateOrder, parseOptionalDate } from "@/lib/api-dates";
import { HttpError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { enforceRateLimit } from "@/lib/rate-limit";
import { buildScheduleExport, parseScheduleExportType } from "@/lib/services/schedule-exports";
import { startOfDayInAppTz, startOfTodayInAppTz } from "@/lib/app-time";
import { optionalSportCodeSchema } from "@/lib/validation";

/** Inclusive end of the Chicago day seven days after `start`. */
function defaultEndDate(start: Date) {
  return new Date(startOfDayInAppTz(start, 8).getTime() - 1);
}

export const GET = withAuth(async (req, { user }) => {
  requirePermission(user.role, "report", "view");
  await enforceRateLimit(`schedule:export:${user.id}`, { max: 10, windowMs: 60_000 });

  const { searchParams } = new URL(req.url);
  const type = parseScheduleExportType(searchParams.get("type"));
  const defaultStart = startOfTodayInAppTz(new Date());
  const parsedStartDate = parseOptionalDate(searchParams.get("startDate"), "startDate") ?? defaultStart;
  const parsedEndDate = parseOptionalDate(searchParams.get("endDate"), "endDate") ?? defaultEndDate(parsedStartDate);
  assertDateOrder(parsedStartDate, parsedEndDate);
  if (searchParams.get("includeArchived") === "true" && searchParams.get("includePast") !== "true") {
    throw new HttpError(400, "includeArchived requires includePast=true");
  }

  const exportData = await buildScheduleExport({
    type,
    parsedStartDate,
    parsedEndDate,
    includeArchived: searchParams.get("includeArchived") === "true",
    sportCode: optionalSportCodeSchema.parse(searchParams.get("sportCode") ?? undefined) ?? null,
  });

  return new NextResponse(exportData.csv, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportData.filename}"`,
      "X-Exported-Count": String(exportData.exportedCount),
      "X-Total-Count": String(exportData.total),
      ...(exportData.truncated ? { "X-Truncated": "true" } : {}),
    },
  });
});
