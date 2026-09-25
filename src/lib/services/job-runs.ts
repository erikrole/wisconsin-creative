import { db } from "@/lib/db";

/**
 * Background job health: one row per workflow step or cron sub-job, with how
 * late it ran and whether it worked. Best-effort; never fails the job itself.
 */

export const JOB_RUN_RETENTION_DAYS = 90;

export type JobName =
  | "checkout_escalation"
  | "claim_review"
  | "schedule_release"
  | "shift_reminder"
  | "morning_refresh";

export function latenessBucket(dueAt: Date | null | undefined, now = new Date()): string | null {
  if (!dueAt) return null;
  const lateMs = now.getTime() - dueAt.getTime();
  if (lateMs < 60_000) return "on_time";
  if (lateMs < 5 * 60_000) return "under_5m";
  if (lateMs < 60 * 60_000) return "5_60m";
  return "over_1h";
}

export async function recordJobRun(args: {
  job: JobName;
  outcome: "succeeded" | "failed" | "skipped";
  dueAt?: Date | null;
  detail?: string | null;
}): Promise<void> {
  try {
    await db.jobRun.create({
      data: {
        job: args.job,
        outcome: args.outcome,
        latenessBucket: latenessBucket(args.dueAt),
        detail: args.detail?.slice(0, 64) ?? null,
      },
    });
  } catch (err) {
    console.error("[JOBS] Failed to record job run:", err);
  }
}

export async function pruneJobRuns(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - JOB_RUN_RETENTION_DAYS * 86_400_000);
  const { count } = await db.jobRun.deleteMany({ where: { occurredAt: { lt: cutoff } } });
  return count;
}
