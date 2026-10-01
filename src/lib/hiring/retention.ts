import { HiringCycleStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { deleteApplicantFile } from "@/lib/hiring/storage";
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

export type PurgeResult = { applicantId: string; applications: number; documents: number } | null;

/**
 * Purge one applicant's personal data and keep the name tombstone: files are
 * deleted first, then rows are cleared in one transaction that also records the
 * non-PII ledger entry. Returns null when the applicant is no longer eligible.
 */
export async function purgeApplicant(applicantId: string, now: Date = new Date()): Promise<PurgeResult> {
  const applicant = await db.applicant.findUnique({
    where: { id: applicantId },
    select: {
      id: true,
      purgedAt: true,
      hiredUserId: true,
      applications: {
        select: { id: true, cycle: { select: { status: true, closedAt: true } }, documents: { select: { pathname: true } } },
      },
    },
  });
  if (!applicant || applicant.purgedAt || applicant.hiredUserId) return null;

  const due = purgeDate({
    linkedToAccount: false,
    purged: false,
    cycles: applicant.applications.map((a) => a.cycle),
  });
  if (!due || due > now) return null;

  // Files first: if storage fails the rows stay intact and the next run retries.
  const pathnames = applicant.applications.flatMap((a) => a.documents.map((d) => d.pathname));
  for (const pathname of pathnames) await deleteApplicantFile(pathname);

  const applicationIds = applicant.applications.map((a) => a.id);
  await db.$transaction(async (tx) => {
    await tx.applicantDocument.deleteMany({ where: { applicationId: { in: applicationIds } } });
    await tx.applicationNote.deleteMany({ where: { applicationId: { in: applicationIds } } });
    await tx.applicantEmail.deleteMany({ where: { applicantId } });
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
    await tx.applicantRetentionEvent.create({
      data: {
        applicantId,
        purgedAt: now,
        applicationCount: applicationIds.length,
        documentCount: pathnames.length,
        policyMonths: APPLICANT_RETENTION_MONTHS,
      },
    });
  });

  return { applicantId, applications: applicationIds.length, documents: pathnames.length };
}

export const RETENTION_BATCH_SIZE = 25;

export type RetentionRunResult = {
  dryRun: boolean;
  due: number;
  purged: number;
  documentsDeleted: number;
  failed: number;
  hasMore: boolean;
};

/**
 * One retention pass, run from the weekly audit-archive cron so no extra cron
 * slot is used. A failure on one applicant never blocks the rest; its rows are
 * untouched and the next run retries it. `dryRun` only reports how many are due.
 */
export async function runApplicantRetention(now: Date = new Date(), options: { dryRun?: boolean } = {}): Promise<RetentionRunResult> {
  const due = await findPurgeCandidates(now, RETENTION_BATCH_SIZE);
  const result: RetentionRunResult = {
    dryRun: Boolean(options.dryRun),
    due: due.length,
    purged: 0,
    documentsDeleted: 0,
    failed: 0,
    hasMore: due.length === RETENTION_BATCH_SIZE,
  };
  if (options.dryRun || due.length === 0) return result;

  for (const applicantId of due) {
    try {
      const purged = await purgeApplicant(applicantId, now);
      if (purged) {
        result.purged += 1;
        result.documentsDeleted += purged.documents;
      }
    } catch (error) {
      console.error("applicant-retention: purge failed", applicantId, error);
      result.failed += 1;
    }
  }

  await recordJobRun({
    job: "applicant_retention",
    outcome: result.failed === 0 ? "succeeded" : "failed",
    detail: `purged:${result.purged} failed:${result.failed}`,
  });
  return result;
}
