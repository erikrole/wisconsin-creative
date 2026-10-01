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

/** The account a hired applicant became; its deactivation date starts their retention clock. */
export type LinkedAccount = { active: boolean; deactivatedAt: Date | null };

/**
 * When an applicant's personal data is due to be purged, or null when it is not
 * scheduled: any of their cycles is still open or planned, a cycle has no recorded close
 * time, or they are linked to an account that is still active (or whose deactivation date
 * is unknown). The clock is the latest close time across all of their applications; for
 * a hired student it starts no earlier than their account's deactivation (D-065).
 */
export function purgeDate(input: { linkedAccount: LinkedAccount | null; purged: boolean; cycles: RetentionCycle[] }): Date | null {
  if (input.purged || input.cycles.length === 0) return null;
  let latest: Date | null = null;
  for (const cycle of input.cycles) {
    if (cycle.status === "OPEN" || cycle.status === "PLANNING" || !cycle.closedAt) return null;
    if (!latest || cycle.closedAt > latest) latest = cycle.closedAt;
  }
  if (!latest) return null;
  if (input.linkedAccount) {
    // A current worker's record is kept; so is one whose deactivation date was never recorded.
    if (input.linkedAccount.active || !input.linkedAccount.deactivatedAt) return null;
    if (input.linkedAccount.deactivatedAt > latest) latest = input.linkedAccount.deactivatedAt;
  }
  return addMonths(latest, APPLICANT_RETENTION_MONTHS);
}

/** Applicants whose retention window has fully elapsed, oldest first. */
export async function findPurgeCandidates(now: Date, limit: number): Promise<string[]> {
  const cutoff = retentionCutoff(now);
  const rows = await db.applicant.findMany({
    where: {
      purgedAt: null,
      // Unlinked applicants, or hired students whose account was deactivated long enough ago.
      OR: [{ hiredUserId: null }, { hiredUser: { is: { active: false, deactivatedAt: { lte: cutoff } } } }],
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
            hiredUser: { select: { active: true, deactivatedAt: true } },
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
        if (!applicant || applicant.purgedAt) return null;

        const due = purgeDate({ linkedAccount: applicant.hiredUser, purged: false, cycles: applicant.applications.map((a) => a.cycle) });
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
            interviewedAt: null,
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
      // A purge is a handful of statements. Cap the transaction well below the function limit so a
      // slow database fails this applicant (retried next run) instead of consuming the whole budget.
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 5_000 },
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
/** Per-run ceiling on batches so a run is bounded even without the time budget. */
export const RETENTION_MAX_BATCHES = 20;
/**
 * Default wall-clock budget for one pass. The crons that run this are sized for the Hobby
 * 10-second function limit (the repo's other crons reserve 8 seconds in total), and the
 * weekly audit-archive job spends time before it gets here, so the default is small. A
 * caller with more room passes a larger `budgetMs`; whatever is left carries to the next run.
 */
export const RETENTION_TIME_BUDGET_MS = 3_000;
/**
 * Room reserved for the item in flight. An applicant is only started when at least this
 * much of the budget remains, so even a slow purge (transaction capped at 5 seconds) cannot
 * run past the caller's budget and prevent the response and job evidence from being written.
 */
export const RETENTION_ITEM_MARGIN_MS = 1_500;

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
 * One retention pass, run from existing crons so no extra cron slot is used (the weekly
 * audit-archive job and the nightly morning-refresh job both call it). It purges due
 * applicants in batches until the time budget, the batch ceiling, or the due list is
 * exhausted, checking the clock before every applicant so it never overruns the platform
 * limit; retries queued file deletions if time remains; and never lets one applicant's
 * failure block the rest. `hasMore` reports that work was left for the next run.
 * `dryRun` only reports how many are due.
 */
export async function runApplicantRetention(
  now: Date = new Date(),
  options: { dryRun?: boolean; budgetMs?: number } = {},
): Promise<RetentionRunResult> {
  const budgetMs = options.budgetMs ?? RETENTION_TIME_BUDGET_MS;
  const result: RetentionRunResult = {
    dryRun: Boolean(options.dryRun),
    due: 0,
    purged: 0,
    documentsDeleted: 0,
    failed: 0,
    hasMore: false,
    blobsSwept: 0,
  };

  const started = Date.now();
  const outOfTime = () => Date.now() - started >= budgetMs - RETENTION_ITEM_MARGIN_MS;

  const first = await findPurgeCandidates(now, RETENTION_BATCH_SIZE);
  result.due = first.length;
  if (options.dryRun) {
    result.hasMore = first.length === RETENTION_BATCH_SIZE;
    return result;
  }

  let batch = first;
  let timedOut = false;
  for (let batchNumber = 0; batchNumber < RETENTION_MAX_BATCHES && batch.length > 0 && !timedOut; batchNumber += 1) {
    let progressed = 0;
    for (const applicantId of batch) {
      if (outOfTime()) {
        timedOut = true;
        break;
      }
      try {
        const purged = await purgeApplicant(applicantId, now);
        if (!purged) continue;
        progressed += 1;
        result.purged += 1;
        result.documentsDeleted += purged.documents;
        // The rows are purged and the paths are already queued durably, so when time is short the
        // file deletion simply waits for the next run instead of risking the deadline.
        if (outOfTime()) {
          timedOut = true;
          break;
        }
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
    if (timedOut) break;
    // Stop when a full batch made no progress (every candidate lost a race or failed) or
    // when the last batch was short (nothing more is due).
    if (progressed === 0 || batch.length < RETENTION_BATCH_SIZE) break;
    batch = await findPurgeCandidates(now, RETENTION_BATCH_SIZE);
    if (batchNumber === RETENTION_MAX_BATCHES - 1 && batch.length > 0) result.hasMore = true;
  }
  if (timedOut) result.hasMore = true;

  // Retry queued file deletions only when there is time left to do it safely.
  if (!outOfTime()) {
    const sweep = await sweepPendingBlobs();
    result.blobsSwept = sweep.swept;
    result.failed += sweep.failed;
  } else {
    result.hasMore = true;
  }

  if (result.purged > 0 || result.failed > 0 || result.blobsSwept > 0) {
    await recordJobRun({
      job: "applicant_retention",
      outcome: result.failed === 0 ? "succeeded" : "failed",
      detail: `purged:${result.purged} failed:${result.failed}`,
    });
  }
  return result;
}
