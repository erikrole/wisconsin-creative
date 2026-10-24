import { appTzDateKey } from "@/lib/app-time";
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { csvField } from "@/lib/csv";
import { ok } from "@/lib/http";
import { enforceRateLimit, REPORT_EXPORT_LIMIT } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";
import { getBulkLossReport, getBulkLossReportExport } from "@/lib/services/reports";

function buildBulkLossReportCsv(rows: Awaited<ReturnType<typeof getBulkLossReportExport>>["data"]) {
  const headers = [
    "Section",
    "Item Family",
    "Category",
    "Location",
    "Unit Number",
    "Person",
    "Booking",
    "Timestamp",
    "Count",
    "Status",
    "Detail",
    "Notes",
  ];
  const csvRows = rows.map((row) => [
    csvField(row.section),
    csvField(row.itemFamily),
    csvField(row.category),
    csvField(row.location),
    csvField(row.unitNumber),
    csvField(row.person),
    csvField(row.booking),
    csvField(row.timestamp),
    csvField(row.count),
    csvField(row.status),
    csvField(row.detail),
    csvField(row.notes),
  ]);

  return [headers.join(","), ...csvRows.map((row) => row.join(","))].join("\n");
}

export const GET = withAuth(async (req, { user }) => {
  requirePermission(user.role, "report", "view");
  const { searchParams } = new URL(req.url);
  const filters = {
    categoryId: searchParams.get("category") || null,
    locationId: searchParams.get("location") || null,
  };

  if (searchParams.get("format") === "csv") {
    await enforceRateLimit(`report:export:${user.id}`, REPORT_EXPORT_LIMIT);
    const exportData = await getBulkLossReportExport(filters);
    const date = appTzDateKey(new Date());
    return new NextResponse(`${buildBulkLossReportCsv(exportData.data)}\n`, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="missing-units-report-${date}.csv"`,
        "X-Exported-Count": String(exportData.data.length),
        "X-Total-Count": String(exportData.total),
        ...(exportData.truncated ? {
          "X-Truncated": "true",
        } : {}),
      },
    });
  }

  return ok(await getBulkLossReport(filters));
});
