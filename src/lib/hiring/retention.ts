import { HiringCycleStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { deleteApplicantFile } from "@/lib/hiring/storage";
import { isSerializationConflict } from "@/lib/serialization";
import { recordJobRun } from "@/lib/services/job-runs";

/** D-065: names are kept forever; everything else is purged this long after the last cycle closes. */
export const APPLICANT_RETENTION_MONTHS = 36;

export function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export function retentionCutoff(now: Date = new Date()): Date {
  return addMonths(now, -APPLICANT_RETENTION_MONTHS);
}

type RetentionCycle = { status: HiringCycleStatus; closedAt: Date | null };

/**
 * When an applicant's personal data is due to be purged, or null when it is not
 * scheduled: they are linked to an account (kept while that account is active),
 * any of their cycles is still open or planned, or a cycle has no recorded close
 * time. The clock is the latest close time across all of their applications.
 */
export function purgeDate(input: { linkedToAccount: boolean; purged: boolean; cycles: RetentionCycle[] }): Date | null {
  if (input.linkedToAccount || input.purged || input.cycles.length === 0) return null;
  let latest: Date | null = null;
  for (const cycle of input.cycles) {
    if (cycle.status === "OPEN" || cycle.status === "PLANNING" || !cycle.closedAt) return null;
    if (!latest || cycle.closedAt > latest) latest = cycle.closedAt;
  }
  return latest ? addMonths(latest, APPLICANT_RETENTION_MONTHS) : null;
}

/** Applicants whose retention window has fully elapsed, oldest first. */
export async function findPurgeCandidates(now: Date, limit: number): Promise<string[]> {
  const cutoff = retentionCutoff(now);
  const rows = await db.applicant.findMany({
    where: {
      purgedAt: null,
      hiredUserId: null,
      applications: {
        some: {},
        // No application may sit in a cycle that is unclosed or closed inside the window.
        none: { cycle: { OR: [{ closedAt: null }, { closedAt: { gt: cutoff } }, { status: { in: ["OPEN", "PLANNING"] } }] } },
      },
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  return rows.map((r) => r.id);
}

export type PurgeResult = { applicantId: string; applications: number; documents: number; eventId: string; pathnames: string[] } | null;

/**
 * Purge one applicant's personal data and keep the name tombstone. Everything runs in
 * one SERIALIZABLE transaction that re-reads the applicant first, so a new application,
 * an account link, a reopened cycle, or a new upload that races with the job aborts the
 * purge (retried next run) instead of being deleted from a stale snapshot.
 *
 * Files are NOT deleted inside the transaction: storage cannot roll back, so an aborted
 * transaction must never have removed a file. The blob pathnames are written to the
 * ledger row in the same transaction (a durable queue) and deleted after commit; any
 * that fail stay queued and are retried by `sweepPendingBlobs`. Returns null when the
 * applicant is no longer eligible or the transaction lost a race.
 */
export async function purgeApplicant(applicantId: string, now: Date = new Date()): Promise<PurgeResult> {
  try {
    return await db.$transaction(
      async (tx) => {
        const applicant = await tx.applicant.findUnique({
          where: { id: applicantId },
          select: {
            id: true,
            purgedAt: true,
            hiredUserId: true,
            applications: {
              select: {
                id: true,
                allowedEmailId: true,
                cycle: { select: { status: true, closedAt: true } },
                documents: { select: { pathname: true } },
              },
            },
          },
        });
        if (!applicant || applicant.purgedAt || applicant.hiredUserId) return null;

        const due = purgeDate({ linkedToAccount: false, purged: false, cycles: applicant.applications.map((a) => a.cycle) });
        if (!due || due > now) return null;

        const pathnames = applicant.applications.flatMap((a) => a.documents.map((d) => d.pathname));
        const applicationIds = applicant.applications.map((a) => a.id);
        const inviteIds = applicant.applications.map((a) => a.allowedEmailId).filter((id): id is string => Boolean(id));

        await tx.applicantDocument.deleteMany({ where: { applicationId: { in: applicationIds } } });
        await tx.applicationNote.deleteMany({ where: { applicationId: { in: applicationIds } } });
        await tx.applicantEmail.deleteMany({ where: { applicantId } });
        // An unclaimed hire invite still holds the applicant's email and name; remove it
        // with the rest. A claimed one belongs to a real account and is never touched.
        if (inviteIds.length > 0) await tx.allowedEmail.deleteMany({ where: { id: { in: inviteIds }, claimedAt: null } });
        // Keep stage, reviewed state, decision time, cycle link, and mapped area as the final outcome.
        await tx.application.updateMany({
          where: { id: { in: applicationIds } },
          data: {
            externalApplicationId: null,
            interviewUrl: null,
            summerAvailable: null,
            rawAreas: [],
            fieldsExperience: [],
            fieldsInterested: [],
            softwareExperience: [],
            sourcePayload: Prisma.DbNull,
          },
        });
        await tx.applicant.update({
          where: { id: applicantId },
          data: {
            phone: null,
            location: null,
            portfolioUrl: null,
            socialHandles: null,
            notes: null,
            standing: null,
            gradTerm: null,
            gradYear: null,
            purgedAt: now,
          },
        });
        const event = await tx.applicantRetentionEvent.create({
          data: {
            applicantId,
            purgedAt: now,
            applicationCount: applicationIds.length,
            documentCount: pathnames.length,
            policyMonths: APPLICANT_RETENTION_MONTHS,
            pendingBlobPaths: pathnames,
          },
          select: { id: true },
        });

        return { applicantId, applications: applicationIds.length, documents: pathnames.length, eventId: event.id, pathnames };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 },
    );
  } catch (error) {
    // Concurrent hiring activity touched this applicant: skip it and retry next run.
    if (isSerializationConflict(error)) return null;
    throw error;
  }
}

/**
 * Delete the files queued on a committed purge. A blob that is already gone counts as
 * deleted. Any failure leaves the queue intact so the next sweep retries it.
 */
export async function deleteQueuedBlobs(eventId: string, pathnames: string[]): Promise<boolean> {
  if (pathnames.length === 0) return true;
  for (const pathname of pathnames) await deleteApplicantFile(pathname);
  await db.applicantRetentionEvent.update({ where: { id: eventId }, data: { pendingBlobPaths: [] } });
  return true;
}

/** Retry files left over from earlier purges (storage outage, crash between commit and delete). */
export async function sweepPendingBlobs(limit = 25): Promise<{ swept: number; failed: number }> {
  const pending = await db.applicantRetentionEvent.findMany({
    where: { pendingBlobPaths: { isEmpty: false } },
    select: { id: true, pendingBlobPaths: true },
    orderBy: { purgedAt: "asc" },
    take: limit,
  });
  let swept = 0;
  let failed = 0;
  for (const event of pending) {
    try {
      await deleteQueuedBlobs(event.id, event.pendingBlobPaths);
      swept += 1;
    } catch (error) {
      console.error("applicant-retention: blob sweep failed", event.id, error);
      failed += 1;
    }
  }
  return { swept, failed };
}

export const RETENTION_BATCH_SIZE = 25;
/** Per-run ceilings so the weekly job drains a backlog without running unbounded. */
export const RETENTION_MAX_BATCHES = 20;
export const RETENTION_TIME_BUDGET_MS = 40_000;

export type RetentionRunResult = {
  dryRun: boolean;
  due: number;
  purged: number;
  documentsDeleted: number;
  failed: number;
  hasMore: boolean;
  blobsSwept: number;
};

/**
 * One retention pass, run from the weekly audit-archive cron so no extra cron slot is
 * used. It drains every due batch (up to a batch and time ceiling) so a whole cycle that
 * reaches its deadline together is purged in one run, retries queued file deletions, and
 * never lets one applicant's failure block the rest. `dryRun` only reports how many are due.
 */
export async function runApplicantRetention(now: Date = new Date(), options: { dryRun?: boolean } = {}): Promise<RetentionRunResult> {
  const result: RetentionRunResult = {
    dryRun: Boolean(options.dryRun),
    due: 0,
    purged: 0,
    documentsDeleted: 0,
    failed: 0,
    hasMore: false,
    blobsSwept: 0,
  };

  const first = await findPurgeCandidates(now, RETENTION_BATCH_SIZE);
  result.due = first.length;
  if (options.dryRun) {
    result.hasMore = first.length === RETENTION_BATCH_SIZE;
    return result;
  }

  const started = Date.now();
  let batch = first;
  for (let batchNumber = 0; batchNumber < RETENTION_MAX_BATCHES && batch.length > 0; batchNumber += 1) {
    let progressed = 0;
    for (const applicantId of batch) {
      try {
        const purged = await purgeApplicant(applicantId, now);
        if (!purged) continue;
        progressed += 1;
        result.purged += 1;
        result.documentsDeleted += purged.documents;
        try {
          await deleteQueuedBlobs(purged.eventId, purged.pathnames);
        } catch (error) {
          // Rows are already purged and the paths stay queued; the sweep retries them.
          console.error("applicant-retention: file deletion deferred", purged.eventId, error);
          result.failed += 1;
        }
      } catch (error) {
        console.error("applicant-retention: purge failed", applicantId, error);
        result.failed += 1;
      }
    }
    // Stop when a full batch made no progress (every candidate lost a race or failed),
    // when the last batch was short (nothing more is due), or when the time budget is spent.
    if (progressed === 0 || batch.length < RETENTION_BATCH_SIZE) break;
    if (Date.now() - started > RETENTION_TIME_BUDGET_MS) {
      result.hasMore = true;
      break;
    }
    batch = await findPurgeCandidates(now, RETENTION_BATCH_SIZE);
    if (batchNumber === RETENTION_MAX_BATCHES - 1 && batch.length > 0) result.hasMore = true;
  }

  const sweep = await sweepPendingBlobs();
  result.blobsSwept = sweep.swept;
  result.failed += sweep.failed;

  if (result.purged > 0 || result.failed > 0 || sweep.swept > 0) {
    await recordJobRun({
      job: "applicant_retention",
      outcome: result.failed === 0 ? "succeeded" : "failed",
      detail: `purged:${result.purged} failed:${result.failed}`,
    });
  }
  return result;
}
