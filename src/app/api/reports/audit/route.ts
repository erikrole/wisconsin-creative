import { appTzDateKey } from "@/lib/app-time";
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { csvField } from "@/lib/csv";
import { HttpError, ok, parsePagination } from "@/lib/http";
import { parseOptionalDateParam } from "@/lib/api-dates";
import { enforceRateLimit, REPORT_EXPORT_LIMIT } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";
import { AUDIT_CATEGORIES, type AuditCategory } from "@/lib/audit-actions";
import { getAuditReport, getAuditReportExport } from "@/lib/services/reports";

function buildAuditReportCsv(rows: Awaited<ReturnType<typeof getAuditReportExport>>["data"]) {
  const headers = ["Timestamp", "Actor", "Action", "Entity Type", "Entity ID"];
  const csvRows = rows.map((entry) => [
    csvField(entry.createdAt),
    csvField(entry.actor),
    csvField(entry.action),
    csvField(entry.entityType),
    csvField(entry.entityId),
  ]);

  return [headers.join(","), ...csvRows.map((row) => row.join(","))].join("\n");
}

export const GET = withAuth(async (req, { user }) => {
  requirePermission(user.role, "report", "audit");
  const { searchParams } = new URL(req.url);
  const { limit, offset } = parsePagination(searchParams);
  const startDate = parseOptionalDateParam(searchParams, "startDate");
  const endDate = parseOptionalDateParam(searchParams, "endDate");
  const action = searchParams.get("action");
  const entityType = searchParams.get("entityType");
  const actorId = searchParams.get("actor");
  const category = searchParams.get("category") as AuditCategory | null;

  if (category && !AUDIT_CATEGORIES.includes(category)) {
    throw new HttpError(400, "Unknown audit category");
  }

  if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
    throw new HttpError(400, "startDate must be before endDate");
  }

  if (searchParams.get("format") === "csv") {
    await enforceRateLimit(`report:export:${user.id}`, REPORT_EXPORT_LIMIT);
    const exportData = await getAuditReportExport(startDate, endDate, action, entityType, category, actorId);
    const date = appTzDateKey(new Date());
    return new NextResponse(`${buildAuditReportCsv(exportData.data)}\n`, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="audit-report-${date}.csv"`,
        "X-Exported-Count": String(exportData.data.length),
        "X-Total-Count": String(exportData.total),
        ...(exportData.truncated ? {
          "X-Truncated": "true",
        } : {}),
      },
    });
  }

  return ok(await getAuditReport(limit, offset, startDate, endDate, action, entityType, category, actorId));
});
