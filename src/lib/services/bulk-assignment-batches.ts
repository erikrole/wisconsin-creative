/**
 * The staging window, made visible and reversible.
 *
 * Applying an auto assignment does not publish anything: it writes one working
 * copy per event and enqueues a release ten minutes out. That window is the
 * only chance to take a batch back, and until now nothing showed it existed.
 * This module lists batches that are still in flight and cancels one by
 * discarding the working copies its release is waiting on.
 *
 * Cancelling records itself on the audit trail rather than in a status column:
 * `ScheduleBulkAssignmentStatus` has no `CANCELLED` member, and adding one is a
 * migration. The audit entry is the durable record, and the listing derives the
 * cancelled state from it.
 */

import { Prisma, type Role } from "@prisma/client";
import { createAuditEntriesTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { finalizeBulkScheduleAssignment } from "@/lib/services/bulk-schedule-assignment";

export const BULK_ASSIGNMENT_CANCEL_ACTION = "schedule_bulk_assignment_cancelled";
export const BULK_ASSIGNMENT_AUDIT_ENTITY = "schedule_bulk_assignment";

const DEFAULT_BATCH_LIMIT = 20;

export type BulkAssignmentBatchStatus = "PENDING" | "RELEASED" | "PARTIAL" | "BLOCKED" | "CANCELLED";

export type BulkAssignmentBatchEvent = {
  shiftGroupId: string;
  eventId: string | null;
  summary: string | null;
  startsAt: string | null;
  status: string;
  assignmentCount: number;
};

export type BulkAssignmentBatch = {
  id: string;
  status: BulkAssignmentBatchStatus;
  createdAt: string;
  createdByName: string | null;
  releaseAt: string;
  /** True while the release timer has not fired and work remains to undo. */
  cancellable: boolean;
  sportCodes: string[];
  rangeStartsAt: string;
  rangeEndsAt: string;
  eventCount: number;
  assignmentCount: number;
  events: BulkAssignmentBatchEvent[];
};

type ProposalRecord = { shiftId: string; userId: string };

function parseProposals(value: unknown): ProposalRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const proposal = item as { shiftId?: unknown; userId?: unknown };
    return typeof proposal.shiftId === "string" && typeof proposal.userId === "string"
      ? [{ shiftId: proposal.shiftId, userId: proposal.userId }]
      : [];
  });
}

/** Sport codes come off the audit entry, which records the whole scope. */
function scopeSportCodes(afterJson: unknown, fallback: string | null): string[] {
  if (afterJson && typeof afterJson === "object") {
    const scope = (afterJson as { scope?: { sportCodes?: unknown } }).scope;
    if (scope && Array.isArray(scope.sportCodes)) {
      const codes = scope.sportCodes.filter((code): code is string => typeof code === "string");
      if (codes.length > 0) return codes;
    }
  }
  return fallback ? [fallback] : [];
}

export async function listBulkAssignmentBatches(limit = DEFAULT_BATCH_LIMIT): Promise<BulkAssignmentBatch[]> {
  const batches = await db.scheduleBulkAssignment.findMany({
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 50),
    select: {
      id: true,
      status: true,
      createdAt: true,
      releaseAt: true,
      sportCode: true,
      rangeStartsAt: true,
      rangeEndsAt: true,
      createdById: true,
      items: {
        select: {
          shiftGroupId: true,
          status: true,
          proposalPayload: true,
          shiftGroup: {
            select: { event: { select: { id: true, summary: true, startsAt: true } } },
          },
        },
      },
    },
  });
  if (batches.length === 0) return [];

  const actors = await db.user.findMany({
    where: { id: { in: [...new Set(batches.map((batch) => batch.createdById))] } },
    select: { id: true, name: true },
  });
  const actorNameById = new Map(actors.map((actor) => [actor.id, actor.name]));

  const auditEntries = await db.auditLog.findMany({
    where: {
      entityType: BULK_ASSIGNMENT_AUDIT_ENTITY,
      entityId: { in: batches.map((batch) => batch.id) },
    },
    orderBy: { createdAt: "asc" },
    select: { entityId: true, action: true, afterJson: true },
  });
  const cancelledIds = new Set(
    auditEntries.filter((entry) => entry.action === BULK_ASSIGNMENT_CANCEL_ACTION).map((entry) => entry.entityId),
  );
  const scopeByBatch = new Map(
    auditEntries.filter((entry) => entry.action !== BULK_ASSIGNMENT_CANCEL_ACTION)
      .map((entry) => [entry.entityId, entry.afterJson]),
  );

  const now = Date.now();
  return batches.map((batch) => {
    const events = batch.items.map((item) => ({
      shiftGroupId: item.shiftGroupId,
      eventId: item.shiftGroup?.event?.id ?? null,
      summary: item.shiftGroup?.event?.summary ?? null,
      startsAt: item.shiftGroup?.event?.startsAt?.toISOString() ?? null,
      status: item.status,
      assignmentCount: parseProposals(item.proposalPayload).length,
    }));
    const cancelled = cancelledIds.has(batch.id);
    return {
      id: batch.id,
      status: cancelled ? "CANCELLED" : batch.status,
      createdAt: batch.createdAt.toISOString(),
      createdByName: actorNameById.get(batch.createdById) ?? null,
      releaseAt: batch.releaseAt.toISOString(),
      cancellable: !cancelled
        && batch.status === "PENDING"
        && batch.items.some((item) => item.status === "PENDING")
        && batch.releaseAt.getTime() > now,
      sportCodes: scopeSportCodes(scopeByBatch.get(batch.id), batch.sportCode),
      rangeStartsAt: batch.rangeStartsAt.toISOString(),
      rangeEndsAt: batch.rangeEndsAt.toISOString(),
      eventCount: events.length,
      assignmentCount: events.reduce((sum, event) => sum + event.assignmentCount, 0),
      events,
    };
  });
}

export type CancelBulkAssignmentResult = {
  batchId: string;
  cancelledEvents: number;
  /** Events left alone because someone edited or released them after staging. */
  untouchedEvents: number;
  assignmentsWithdrawn: number;
};

/**
 * Take a staged batch back before its release fires.
 *
 * Only working copies still at the version this batch wrote are discarded: if
 * someone has edited an event since, their work wins and the item is simply
 * marked superseded, which is what the release workflow would have concluded
 * on its own.
 */
export async function cancelBulkAssignmentBatch(
  batchId: string,
  actor: { id: string; role: Role },
): Promise<CancelBulkAssignmentResult> {
  const result = await db.$transaction(async (tx) => {
    const batch = await tx.scheduleBulkAssignment.findUnique({
      where: { id: batchId },
      select: {
        id: true,
        status: true,
        releaseAt: true,
        items: {
          where: { status: "PENDING" },
          select: { shiftGroupId: true, expectedVersion: true, proposalPayload: true },
        },
      },
    });
    if (!batch) throw new HttpError(404, "That auto assignment batch no longer exists.");
    if (batch.status !== "PENDING") {
      throw new HttpError(409, "This batch has already finished releasing and can no longer be cancelled.");
    }
    if (batch.items.length === 0) {
      throw new HttpError(409, "Every event in this batch has already been resolved.");
    }

    let cancelledEvents = 0;
    let assignmentsWithdrawn = 0;
    const auditEntries: Parameters<typeof createAuditEntriesTx>[1] = [];

    for (const item of batch.items) {
      const deleted = await tx.shiftGroupWorkingCopy.deleteMany({
        where: { shiftGroupId: item.shiftGroupId, version: item.expectedVersion },
      });
      if (deleted.count === 1) {
        cancelledEvents += 1;
        assignmentsWithdrawn += parseProposals(item.proposalPayload).length;
        auditEntries.push({
          actorId: actor.id,
          actorRole: actor.role,
          entityType: "shift_group_working_copy",
          entityId: item.shiftGroupId,
          action: "working_schedule_discarded",
          before: { version: item.expectedVersion, batchId },
          after: { version: 0, cancelledBulkAssignment: batchId },
        });
      }
    }

    await tx.scheduleBulkAssignmentItem.updateMany({
      where: { bulkAssignmentId: batchId, status: "PENDING" },
      data: { status: "SUPERSEDED" },
    });

    auditEntries.push({
      actorId: actor.id,
      actorRole: actor.role,
      entityType: BULK_ASSIGNMENT_AUDIT_ENTITY,
      entityId: batchId,
      action: BULK_ASSIGNMENT_CANCEL_ACTION,
      before: { status: batch.status, pendingEvents: batch.items.length },
      after: { cancelledEvents, assignmentsWithdrawn },
    });
    await createAuditEntriesTx(tx, auditEntries);

    return {
      batchId,
      cancelledEvents,
      untouchedEvents: batch.items.length - cancelledEvents,
      assignmentsWithdrawn,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  // Resolves the batch now that no item is pending. Nothing released, so the
  // worker notification builder finds no assignments and stays silent.
  await finalizeBulkScheduleAssignment(batchId);
  return result;
}
