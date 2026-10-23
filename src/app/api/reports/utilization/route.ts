import { appTzDateKey } from "@/lib/app-time";
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { csvField } from "@/lib/csv";
import { ok } from "@/lib/http";
import { enforceRateLimit, REPORT_EXPORT_LIMIT } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";
import {
  getUtilizationReport,
  getUtilizationReportExport,
  parseUtilizationReportPeriod,
} from "@/lib/services/reports";

function buildUtilizationReportCsv(rows: Awaited<ReturnType<typeof getUtilizationReportExport>>["data"]) {
  const headers = [
    "Asset Tag",
    "Name",
    "Type",
    "Brand",
    "Model",
    "Derived Status",
    "Stored Status",
    "Location",
    "Department",
    "Category",
    "Reservable",
    "Checkoutable",
    "Custody",
    "Checkouts (period)",
    "Custody Days (period)",
    "Utilization (period)",
    "Last Checked Out",
    "Updated At",
  ];
  const csvRows = rows.map((asset) => [
    csvField(asset.assetTag),
    csvField(asset.name),
    csvField(asset.type),
    csvField(asset.brand),
    csvField(asset.model),
    csvField(asset.computedStatus),
    csvField(asset.storedStatus),
    csvField(asset.location),
    csvField(asset.department),
    csvField(asset.category),
    csvField(asset.availableForReservation),
    csvField(asset.availableForCheckout),
    csvField(asset.availableForCustody),
    csvField(asset.periodCheckouts),
    csvField(asset.periodCustodyDays),
    csvField(asset.periodUtilizationRate),
    csvField(asset.lastCheckedOutAt),
    csvField(asset.updatedAt),
  ]);

  return [headers.join(","), ...csvRows.map((row) => row.join(","))].join("\n");
}

export const GET = withAuth(async (req, { user }) => {
  requirePermission(user.role, "report", "view");
  const { searchParams } = new URL(req.url);
  const days = parseUtilizationReportPeriod(searchParams.get("days"));

  if (searchParams.get("format") === "csv") {
    await enforceRateLimit(`report:export:${user.id}`, REPORT_EXPORT_LIMIT);
    const exportData = await getUtilizationReportExport(days);
    const date = appTzDateKey(new Date());
    return new NextResponse(`${buildUtilizationReportCsv(exportData.data)}\n`, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="utilization-report-${days}d-${date}.csv"`,
        "X-Exported-Count": String(exportData.data.length),
        "X-Total-Count": String(exportData.total),
        ...(exportData.truncated ? {
          "X-Truncated": "true",
        } : {}),
      },
    });
  }

  return ok(await getUtilizationReport(days));
});
