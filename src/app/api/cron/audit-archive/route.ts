import { NextResponse } from "next/server";
import { withCron } from "@/lib/cron";
import { db } from "@/lib/db";
import { AUDIT_RETENTION_DAYS } from "@/lib/audit";
import { runApplicantRetention, type RetentionRunResult } from "@/lib/hiring/retention";

/**
 * Retention policy: delete audit log entries older than AUDIT_RETENTION_DAYS.
 * Runs weekly via Vercel Cron (see vercel.json).
 *
 * Also runs the hiring applicant retention pass (D-065: names kept, other
 * personal data purged 36 months after the last cycle closed) so it shares this
 * weekly cron instead of using another cron slot.
 *
 * Hard delete in batches to avoid locking the table for too long on large
 * datasets. For regulatory needs, a separate export-before-delete step can
 * be added later.
 */
const BATCH_SIZE = 1000;
const MAX_BATCHES_PER_RUN = 5;

export const GET = withCron(async () => {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - AUDIT_RETENTION_DAYS);

  let totalDeleted = 0;
  let batchesProcessed = 0;
  let hasMoreAuditLogs = false;
  const partialFailures: string[] = [];
  const errors: Record<string, string> = {};

  try {
    for (let batchNumber = 0; batchNumber < MAX_BATCHES_PER_RUN; batchNumber += 1) {
      const batch = await db.auditLog.findMany({
        where: { createdAt: { lt: cutoff } },
        select: { id: true },
        take: BATCH_SIZE,
      });

      if (batch.length === 0) break;

      const result = await db.auditLog.deleteMany({
        where: { id: { in: batch.map((r) => r.id) } },
      });

      batchesProcessed += 1;
      totalDeleted += result.count;

      if (batch.length < BATCH_SIZE || result.count < BATCH_SIZE) break;
      hasMoreAuditLogs = batchNumber + 1 === MAX_BATCHES_PER_RUN;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown audit archive error";
    console.error("audit-archive: audit log purge failed", err);
    partialFailures.push("auditLogs");
    errors.auditLogs = message;
  }

  let sessionsDeleted = 0;
  try {
    const expiredSessions = await db.session.deleteMany({
      where: { expiresAt: { lt: now } },
    });
    sessionsDeleted = expiredSessions.count;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown session purge error";
    console.error("audit-archive: session purge failed", err);
    partialFailures.push("sessions");
    errors.sessions = message;
  }

  let applicantRetention: RetentionRunResult | null = null;
  try {
    // Small budget: this job has already spent time on audit and session cleanup, and the
    // function limit is 10 seconds. Anything left over is continued by the nightly morning-refresh run.
    applicantRetention = await runApplicantRetention(now, { budgetMs: 2500 });
    if (applicantRetention.failed > 0) {
      partialFailures.push("applicantRetention");
      errors.applicantRetention = `${applicantRetention.failed} applicant purge(s) failed; they retry next run`;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown applicant retention error";
    console.error("audit-archive: applicant retention failed", err);
    partialFailures.push("applicantRetention");
    errors.applicantRetention = message;
  }

  return NextResponse.json({
    ok: partialFailures.length === 0,
    auditLogsDeleted: totalDeleted,
    sessionsDeleted,
    batchesProcessed,
    batchSize: BATCH_SIZE,
    maxBatchesPerRun: MAX_BATCHES_PER_RUN,
    hasMoreAuditLogs,
    cutoffDate: cutoff.toISOString(),
    retentionDays: AUDIT_RETENTION_DAYS,
    applicantRetention,
    ...(partialFailures.length > 0 ? { partialFailures, errors } : {}),
  });
});
