import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { csvField } from "@/lib/csv";
import { HttpError, ok } from "@/lib/http";
import { enforceRateLimit, REPORT_EXPORT_LIMIT } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";
import {
  getCheckoutReport,
  getCheckoutReportExport,
  parseCheckoutFocusDate,
} from "@/lib/services/reports";

const DEFAULT_DAYS = 30;
const MAX_DAYS = 366;

function buildCheckoutReportCsv(rows: Awaited<ReturnType<typeof getCheckoutReportExport>>["data"]) {
  const headers = ["Title", "Requester", "Status", "Due", "Items", "Overdue"];
  const csvRows = rows.map((checkout) => [
    csvField(checkout.title),
    csvField(checkout.requester),
    csvField(checkout.status),
    csvField(checkout.endsAt),
    csvField(checkout.itemCount),
    csvField(checkout.isOverdue),
  ]);

  return [headers.join(","), ...csvRows.map((row) => row.join(","))].join("\n");
}

export const GET = withAuth(async (req, { user }) => {
  requirePermission(user.role, "report", "view");
  const { searchParams } = new URL(req.url);
  const rawDays = searchParams.get("days") || String(DEFAULT_DAYS);
  const days = Number(rawDays);
  if (!/^\d+$/.test(rawDays) || !Number.isSafeInteger(days) || days < 1 || days > MAX_DAYS) {
    throw new HttpError(400, `days must be between 1 and ${MAX_DAYS}`);
  }

  if (searchParams.get("format") === "csv") {
    await enforceRateLimit(`report:export:${user.id}`, REPORT_EXPORT_LIMIT);
    const exportData = await getCheckoutReportExport(days);
    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(`${buildCheckoutReportCsv(exportData.data)}\n`, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="checkouts-report-${date}.csv"`,
        "X-Exported-Count": String(exportData.data.length),
        "X-Total-Count": String(exportData.total),
        ...(exportData.truncated ? {
          "X-Truncated": "true",
        } : {}),
      },
    });
  }

  return ok(await getCheckoutReport(days, parseCheckoutFocusDate(searchParams.get("date"))));
});
