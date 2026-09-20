/**
 * Auto-assignment service.
 *
 * For each unassigned shift in a ShiftGroup, finds users who are:
 *   - Sport-assigned to the event's sportCode
 *   - Area-assigned (or area-matched) to the shift's area
 *   - Not already DIRECT_ASSIGNED or APPROVED on a conflicting shift
 *
 * Creates DIRECT_ASSIGNED ShiftAssignment rows and checks each user's
 * StudentAvailabilityBlock schedule, marking hasConflict + conflictNote
 * when the shift overlaps a class block.
 *
 * ST shifts → users with Student scheduling class
 * FT shifts → users with Staff scheduling class
 *
 * Wraps the read-of-unassigned + createMany in a single SERIALIZABLE
 * transaction to prevent duplicate assignments under concurrent requests.
 */

import { Prisma, ShiftAssignmentSource } from "@prisma/client";
import { db } from "@/lib/db";
import { getAutoFillPreview } from "@/lib/services/auto-fill-preview";

/* ── Helpers ─────────────────────────────────────────── */

/* ── Main export ─────────────────────────────────────── */

type AutoAssignResult = {
  assigned: number;
  conflicts: number;
  skipped: number;
};

/**
 * Auto-assign all unassigned shifts in a ShiftGroup.
 *
 * @param shiftGroupId  The group to fill.
 * @param actorId       Staff user triggering the action (recorded as assignedBy).
 */
export async function autoAssignShiftGroup(
  shiftGroupId: string,
  actorId: string,
): Promise<AutoAssignResult> {
  const preview = await getAutoFillPreview(shiftGroupId);
  const pending = preview.proposals.map((proposal) => ({
    shiftId: proposal.shiftId,
    userId: proposal.userId,
    hasConflict: proposal.advisoryConflict,
    conflictNote: proposal.advisoryConflictNote,
  }));

  if (pending.length === 0) {
    return { assigned: 0, conflicts: 0, skipped: preview.summary.openSlots };
  }

  let created = 0;
  let createdConflicts = 0;
  await db.$transaction(async (tx) => {
    const alreadyAssigned = await tx.shiftAssignment.findMany({
      where: {
        shiftId: { in: pending.map((p) => p.shiftId) },
        status: { in: ["DIRECT_ASSIGNED", "APPROVED"] },
      },
      select: { shiftId: true },
    });
    const alreadySet = new Set(alreadyAssigned.map((a) => a.shiftId));

    const toCreate = pending.filter((p) => !alreadySet.has(p.shiftId));
    if (toCreate.length === 0) return;
    created = toCreate.length;
    createdConflicts = toCreate.filter((p) => p.hasConflict).length;

    await tx.shiftAssignment.createMany({
      data: toCreate.map((p) => ({
        shiftId: p.shiftId,
        userId: p.userId,
        status: "DIRECT_ASSIGNED" as const,
        source: ShiftAssignmentSource.AUTO_FILL,
        assignedBy: actorId,
        hasConflict: p.hasConflict,
        conflictNote: p.conflictNote,
      })),
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  return {
    assigned: created,
    conflicts: createdConflicts,
    skipped: preview.summary.openSlots - created,
  };
}
