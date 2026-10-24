import { db } from "@/lib/db";
import { metricKitDiagnosticToReport, parseMetricKitPayload, type MetricKitSession } from "@/lib/error-reporting/metrickit";
import type { ErrorPlatform } from "@/lib/error-reporting/grouping";
import { recordErrorReports, type ReportActor } from "@/lib/services/error-reports";

export { getCrashCountsByVersion } from "@/lib/services/error-reports";

/**
 * MetricKit diagnostic payloads from the Apple apps: crashes, hangs, and
 * resource exceptions. They are grouped into issues with the rest of the
 * error reports (see error-reports.ts).
 */

const LEGACY_KIND_KEYS: Record<string, string> = {
  crash: "crash",
  hang: "hang",
  cpu_exception: "cpu_exception",
  disk_write_exception: "disk_write_exception",
  app_launch: "app_launch",
};

export async function storeMetricKitPayload(
  payload: unknown,
  platform: ErrorPlatform,
  actor: ReportActor,
  sessions: MetricKitSession[] = [],
  context?: Record<string, unknown>,
): Promise<number> {
  const reports = parseMetricKitPayload(payload, platform, sessions).map((report) =>
    context ? { ...report, context: { ...report.context, ...context } } : report,
  );
  const results = await recordErrorReports(reports, actor);
  return results.filter((result) => result.stored).length;
}

/**
 * Moves rows from the superseded app_diagnostics table into issues, then
 * deletes them. Runs from morning-refresh until the table is empty.
 */
export async function migrateLegacyAppDiagnostics(limit = 100): Promise<number> {
  const rows = await db.appDiagnostic.findMany({ orderBy: { receivedAt: "asc" }, take: limit });
  if (rows.length === 0) return 0;
  for (const row of rows) {
    const report = metricKitDiagnosticToReport(
      { diagnosticMetaData: row.metadata ?? {}, callStackTree: row.callStack ?? undefined },
      LEGACY_KIND_KEYS[row.kind] ?? row.kind,
      // The legacy route only ever accepted iOS uploads.
      "ios",
      row.receivedAt,
    );
    await recordErrorReports([report], null);
  }
  await db.appDiagnostic.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } });
  return rows.length;
}
