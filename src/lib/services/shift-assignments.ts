import { Prisma, Role, ShiftAssignmentStatus, ShiftWorkerType, type CollaboratorPolicyStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { normalizeAllDayToUtcMidnight } from "@/lib/app-time";
import { ACTIVE_ASSIGNMENT_STATUSES } from "@/lib/shift-constants";
import { shiftWorkerTypeForProfile } from "@/lib/shift-display";
import { evaluateAvailabilityPreferences } from "@/lib/student-availability";
import { assertNoWorkingCopy } from "@/lib/schedule-working-copy-guard";
import { scheduleAssigneeWorkerType } from "@/lib/schedule-assignee";
import { createAuditEntryTx } from "@/lib/audit";
import { dispatchScheduleAssignmentNotifications } from "@/lib/services/notifications";

export type RoleSlotOutcome = {
  requestedShiftId: string;
  targetShiftId: string;
  originalWorkerType: ShiftWorkerType;
  assignedWorkerType: ShiftWorkerType;
  movedToMatchingSlot: boolean;
  createdMatchingSlot: boolean;
  reusedMatchingSlot: boolean;
};

export type ShiftApprovalActor = { id: string; role: Role } | null;

const DAY_MS = 24 * 60 * 60 * 1000;

const assignableShiftSelect = {
  id: true,
  shiftGroupId: true,
  area: true,
  workerType: true,
  startsAt: true,
  endsAt: true,
  callStartsAt: true,
  callEndsAt: true,
  shiftGroup: {
    select: {
      event: {
        select: {
          startsAt: true,
          endsAt: true,
          allDay: true,
        },
      },
      workingCopy: { select: { version: true } },
    },
  },
} satisfies Prisma.ShiftSelect;

type AssignableShift = Prisma.ShiftGetPayload<{ select: typeof assignableShiftSelect }>;

function explicitCallWindow(window: {
  callStartsAt?: Date | null;
  callEndsAt?: Date | null;
}) {
  if (!window.callStartsAt || !window.callEndsAt) return null;
  return { startsAt: window.callStartsAt, endsAt: window.callEndsAt };
}

function effectiveShiftWindow(shift: {
  startsAt: Date;
  endsAt: Date;
  callStartsAt?: Date | null;
  callEndsAt?: Date | null;
  shiftGroup?: {
    event: {
      startsAt: Date;
      endsAt: Date;
      allDay: boolean;
    };
  } | null;
}) {
  const explicitWindow = explicitCallWindow(shift);
  if (explicitWindow) return explicitWindow;
  if (shift.shiftGroup?.event.allDay) {
    return {
      startsAt: normalizeAllDayToUtcMidnight(shift.shiftGroup.event.startsAt),
      endsAt: normalizeAllDayToUtcMidnight(shift.shiftGroup.event.endsAt),
    };
  }
  return {
    startsAt: shift.startsAt,
    endsAt: shift.endsAt,
  };
}

function effectiveAssignmentWindow(assignment: {
  callStartsAt?: Date | null;
  callEndsAt?: Date | null;
  shift: Parameters<typeof effectiveShiftWindow>[0];
}) {
  return explicitCallWindow(assignment) ?? effectiveShiftWindow(assignment.shift);
}

async function resolveAssignableShiftForUser(
  tx: Prisma.TransactionClient,
  shift: AssignableShift,
  userProfile: {
    role: Role;
    staffingType: ShiftWorkerType;
    collaboratorPolicy?: {
      status: CollaboratorPolicyStatus;
      grants: Array<{ capabilityKey: string }>;
    } | null;
  },
) {
  const targetWorkerType = scheduleAssigneeWorkerType(userProfile);
  if (!targetWorkerType) {
    throw new HttpError(400, "This user is not eligible for schedule assignment");
  }
  if (targetWorkerType === shift.workerType) {
    return {
      shift,
      outcome: {
        requestedShiftId: shift.id,
        targetShiftId: shift.id,
        originalWorkerType: shift.workerType,
        assignedWorkerType: targetWorkerType,
        movedToMatchingSlot: false,
        createdMatchingSlot: false,
        reusedMatchingSlot: false,
      } satisfies RoleSlotOutcome,
    };
  }

  const compatibleOpenShift = await tx.shift.findFirst({
    where: {
      shiftGroupId: shift.shiftGroupId,
      area: shift.area,
      workerType: targetWorkerType,
      assignments: {
        none: {
          status: { in: ACTIVE_ASSIGNMENT_STATUSES as ShiftAssignmentStatus[] },
        },
      },
    },
    orderBy: { createdAt: "asc" },
    select: assignableShiftSelect,
  });

  if (compatibleOpenShift) {
    return {
      shift: compatibleOpenShift,
      outcome: {
        requestedShiftId: shift.id,
        targetShiftId: compatibleOpenShift.id,
        originalWorkerType: shift.workerType,
        assignedWorkerType: targetWorkerType,
        movedToMatchingSlot: true,
        createdMatchingSlot: false,
        reusedMatchingSlot: true,
      } satisfies RoleSlotOutcome,
    };
  }

  const createdShift = await tx.shift.create({
    data: {
      shiftGroupId: shift.shiftGroupId,
      area: shift.area,
      workerType: targetWorkerType,
      startsAt: shift.startsAt,
      endsAt: shift.endsAt,
      callStartsAt: shift.callStartsAt,
      callEndsAt: shift.callEndsAt,
    },
    select: assignableShiftSelect,
  });

  await tx.shiftGroup.update({
    where: { id: shift.shiftGroupId },
    data: { manuallyEdited: true },
  });

  return {
    shift: createdShift,
    outcome: {
      requestedShiftId: shift.id,
      targetShiftId: createdShift.id,
      originalWorkerType: shift.workerType,
      assignedWorkerType: targetWorkerType,
      movedToMatchingSlot: true,
      createdMatchingSlot: true,
      reusedMatchingSlot: false,
    } satisfies RoleSlotOutcome,
  };
}

/**
 * Check if a user already has an active shift assignment during the given time window.
 * Optionally exclude a specific assignment (for swap scenarios).
 */
/**
 * Non-throwing form of {@link checkTimeConflict}, returning the conflict
 * message or null. Publish preflight needs to gather every blocker in one pass
 * instead of surfacing them one exception at a time.
 */
export async function findTimeConflict(
  tx: Prisma.TransactionClient,
  userId: string,
  startsAt: Date,
  endsAt: Date,
  excludeAssignmentId?: string,
): Promise<string | null> {
  const allDayPrefilterStartsAt = new Date(startsAt.getTime() - DAY_MS);
  const allDayPrefilterEndsAt = new Date(endsAt.getTime() + DAY_MS);
  const where: Prisma.ShiftAssignmentWhereInput = {
    userId,
    status: { in: ACTIVE_ASSIGNMENT_STATUSES as ShiftAssignmentStatus[] },
    OR: [
      { shift: { startsAt: { lt: endsAt }, endsAt: { gt: startsAt } } },
      { callStartsAt: { lt: endsAt }, callEndsAt: { gt: startsAt } },
      { shift: { callStartsAt: { lt: endsAt }, callEndsAt: { gt: startsAt } } },
      {
        shift: {
          shiftGroup: {
            event: {
              allDay: true,
              startsAt: { lt: allDayPrefilterEndsAt },
              endsAt: { gt: allDayPrefilterStartsAt },
            },
          },
        },
      },
    ],
  };
  if (excludeAssignmentId) {
    where.id = { not: excludeAssignmentId };
  }
  // No row cap: the where clause is a raw-window prefilter, and a capped read
  // could return only rows the effective-window recheck filters out while a
  // real conflict sits past the cap.
  const conflicts = await tx.shiftAssignment.findMany({
    where,
    include: { shift: { select: assignableShiftSelect } },
  });
  for (const conflict of conflicts) {
    const { startsAt: conflictStartsAt, endsAt: conflictEndsAt } = effectiveAssignmentWindow(conflict);
    if (!(conflictStartsAt < endsAt && conflictEndsAt > startsAt)) continue;
    return `User already has a shift during this time (${conflict.shift.area})`;
  }
  return null;
}

export async function checkTimeConflict(
  tx: Prisma.TransactionClient,
  userId: string,
  startsAt: Date,
  endsAt: Date,
  excludeAssignmentId?: string,
) {
  const conflict = await findTimeConflict(tx, userId, startsAt, endsAt, excludeAssignmentId);
  if (conflict) throw new HttpError(409, conflict);
}

/**
 * Directly assign a user to a shift. Staff/admin action.
 * Validates no conflicting active assignment exists.
 */
export async function directAssignShift(
  shiftId: string,
  userId: string,
  assignedBy: string,
  opts: { callStartsAt?: Date | null; callEndsAt?: Date | null; callNote?: string | null; notes?: string | null } = {},
) {
  const result = await directAssignShiftWithOutcome(shiftId, userId, assignedBy, opts);
  return result.assignment;
}

export async function directAssignShiftWithOutcome(
  shiftId: string,
  userId: string,
  assignedBy: string,
  opts: { callStartsAt?: Date | null; callEndsAt?: Date | null; callNote?: string | null; notes?: string | null } = {},
) {
  return db.$transaction(async (tx) => {
    const shift = await tx.shift.findUnique({ where: { id: shiftId }, select: assignableShiftSelect });
    if (!shift) throw new HttpError(404, "Shift not found");
    assertNoWorkingCopy(shift.shiftGroup?.workingCopy);
    const assignee = await tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        staffingType: true,
        active: true,
        collaboratorPolicy: {
          select: {
            status: true,
            grants: { select: { capabilityKey: true } },
          },
        },
        availabilityBlocks: {
          select: {
            kind: true,
            intent: true,
            status: true,
            dayOfWeek: true,
            date: true,
            dateEndsOn: true,
            allDay: true,
            startsAt: true,
            endsAt: true,
            label: true,
            semesterLabel: true,
            semesterStartsOn: true,
            semesterEndsOn: true,
          },
        },
      },
    });
    if (!assignee) throw new HttpError(404, "User not found");
    if (!assignee.active) throw new HttpError(400, "Cannot assign an inactive user");

    const { shift: targetShift, outcome } = await resolveAssignableShiftForUser(tx, shift, assignee);

    // Check for existing active assignment on this shift
    const existing = await tx.shiftAssignment.findFirst({
      where: { shiftId: targetShift.id, status: { in: ACTIVE_ASSIGNMENT_STATUSES as ShiftAssignmentStatus[] } },
    });
    if (existing) {
      throw new HttpError(409, "This shift already has an active assignment");
    }

    // Check for time conflicts with the user's other shifts
    const conflictWindow = {
      startsAt: opts.callStartsAt ?? effectiveShiftWindow(targetShift).startsAt,
      endsAt: opts.callEndsAt ?? effectiveShiftWindow(targetShift).endsAt,
    };
    await checkTimeConflict(tx, userId, conflictWindow.startsAt, conflictWindow.endsAt);
    const availability = outcome.assignedWorkerType === "ST"
      ? evaluateAvailabilityPreferences(assignee.availabilityBlocks ?? [], conflictWindow)
      : null;
    if (availability?.blocking) {
      throw new HttpError(409, availability.blocking.note);
    }
    const conflictNote = availability?.advisory?.note ?? null;

    // Decline any pending requests — slot is being filled by direct assignment
    await tx.shiftAssignment.updateMany({
      where: {
        shiftId: targetShift.id,
        status: "REQUESTED",
      },
      data: { status: "DECLINED" },
    });

    const assignment = await tx.shiftAssignment.create({
      data: {
        shiftId: targetShift.id,
        userId,
        status: "DIRECT_ASSIGNED",
        assignedBy,
        callStartsAt: opts.callStartsAt,
        callEndsAt: opts.callEndsAt,
        callNote: opts.callNote,
        notes: opts.notes,
        hasConflict: Boolean(conflictNote),
        conflictNote,
      },
      include: {
        user: { select: { id: true, name: true, role: true, staffingType: true, primaryArea: true, avatarUrl: true } },
      },
    });

    return { assignment, outcome };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function repairRoleSlotMismatch(assignmentId: string) {
  return db.$transaction(async (tx) => {
    const assignment = await tx.shiftAssignment.findUnique({
      where: { id: assignmentId },
      include: {
        user: {
          select: {
            id: true,
            role: true,
            staffingType: true,
            name: true,
            collaboratorPolicy: {
              select: {
                status: true,
                grants: { select: { capabilityKey: true } },
              },
            },
          },
        },
        shift: { select: assignableShiftSelect },
      },
    });
    if (!assignment) throw new HttpError(404, "Assignment not found");
    assertNoWorkingCopy(assignment.shift.shiftGroup?.workingCopy);
    if (!(ACTIVE_ASSIGNMENT_STATUSES as readonly ShiftAssignmentStatus[]).includes(assignment.status)) {
      throw new HttpError(400, "Only active assignments can be repaired");
    }

    const targetWorkerType = scheduleAssigneeWorkerType(assignment.user);
    if (!targetWorkerType) {
      throw new HttpError(400, "This user is not eligible for schedule assignment");
    }
    if (targetWorkerType === assignment.shift.workerType) {
      return {
        assignment,
        outcome: {
          requestedShiftId: assignment.shift.id,
          targetShiftId: assignment.shift.id,
          originalWorkerType: assignment.shift.workerType,
          assignedWorkerType: targetWorkerType,
          movedToMatchingSlot: false,
          createdMatchingSlot: false,
          reusedMatchingSlot: false,
        } satisfies RoleSlotOutcome,
      };
    }

    const { shift: targetShift, outcome } = await resolveAssignableShiftForUser(tx, assignment.shift, assignment.user);

    const existing = await tx.shiftAssignment.findFirst({
      where: {
        shiftId: targetShift.id,
        id: { not: assignment.id },
        status: { in: ACTIVE_ASSIGNMENT_STATUSES as ShiftAssignmentStatus[] },
      },
    });
    if (existing) {
      throw new HttpError(409, "Matching slot already has an active assignment");
    }

    await tx.shiftAssignment.updateMany({
      where: {
        shiftId: targetShift.id,
        status: "REQUESTED",
      },
      data: { status: "DECLINED" },
    });

    const repaired = await tx.shiftAssignment.update({
      where: { id: assignment.id },
      data: { shiftId: targetShift.id },
      include: {
        user: { select: { id: true, name: true, role: true, staffingType: true, primaryArea: true, avatarUrl: true } },
      },
    });

    await tx.shiftGroup.update({
      where: { id: assignment.shift.shiftGroupId },
      data: { manuallyEdited: true },
    });

    return { assignment: repaired, outcome };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function requestShift(shiftId: string, userId: string) {
  void shiftId;
  void userId;
  throw new HttpError(410, "Shift requests are retired. Claim open shifts instead.");
}

/**
 * Approve a shift request. Staff/admin action.
 */
export async function approveRequest(assignmentId: string, actor: ShiftApprovalActor = null) {
  const result = await db.$transaction(async (tx) => {
    const assignment = await tx.shiftAssignment.findUnique({
      where: { id: assignmentId },
      include: {
        shift: { select: assignableShiftSelect },
        user: {
          select: {
            role: true,
            staffingType: true,
            active: true,
            collaboratorPolicy: {
              select: {
                status: true,
                grants: { select: { capabilityKey: true } },
              },
            },
            availabilityBlocks: {
              select: {
                kind: true,
                intent: true,
                status: true,
                dayOfWeek: true,
                date: true,
                dateEndsOn: true,
                allDay: true,
                startsAt: true,
                endsAt: true,
                label: true,
                semesterLabel: true,
                semesterStartsOn: true,
                semesterEndsOn: true,
              },
            },
          },
        },
      },
    });
    if (!assignment) throw new HttpError(404, "Assignment not found");
    assertNoWorkingCopy(assignment.shift.shiftGroup?.workingCopy);
    if (assignment.status !== "REQUESTED") {
      throw new HttpError(400, "Only REQUESTED assignments can be approved");
    }
    if (!assignment.user.active) {
      throw new HttpError(409, "This worker is no longer active");
    }
    if (scheduleAssigneeWorkerType(assignment.user) !== assignment.shift.workerType) {
      throw new HttpError(409, "This worker no longer matches the slot's scheduling class");
    }

    // Re-check time conflicts — the user may have been assigned another shift
    // between the time they requested and the time staff approves.
    const conflictWindow = effectiveShiftWindow(assignment.shift);
    await checkTimeConflict(tx, assignment.userId, conflictWindow.startsAt, conflictWindow.endsAt);
    const availability = shiftWorkerTypeForProfile(assignment.user) === "ST"
      ? evaluateAvailabilityPreferences(assignment.user.availabilityBlocks ?? [], conflictWindow)
      : null;
    if (availability?.blocking) {
      throw new HttpError(409, availability.blocking.note);
    }
    const conflictNote = availability?.advisory?.note ?? assignment.conflictNote;

    // Re-check no other active assignment was created on this shift since the request
    const existing = await tx.shiftAssignment.findFirst({
      where: {
        shiftId: assignment.shiftId,
        status: { in: ACTIVE_ASSIGNMENT_STATUSES as ShiftAssignmentStatus[] },
      },
    });
    if (existing) {
      throw new HttpError(409, "This shift already has an active assignment");
    }

    // Decline all other requests for this shift
    await tx.shiftAssignment.updateMany({
      where: {
        shiftId: assignment.shiftId,
        status: "REQUESTED",
        id: { not: assignmentId },
      },
      data: { status: "DECLINED" },
    });

    const updated = await tx.shiftAssignment.update({
      where: { id: assignmentId },
      data: { status: "APPROVED", hasConflict: Boolean(conflictNote), conflictNote },
      include: {
        user: { select: { id: true, name: true, role: true, staffingType: true, primaryArea: true } },
      },
    });
    await createAuditEntryTx(tx, {
      actorId: actor?.id ?? null,
      actorRole: actor?.role ?? null,
      entityType: "shift_assignment",
      entityId: assignmentId,
      action: actor ? "shift_request_approved" : "shift_request_auto_approved",
      before: { status: assignment.status },
      after: { status: updated.status, userId: updated.userId, shiftId: updated.shiftId },
    });
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  await dispatchScheduleAssignmentNotifications(result.id, "approved");
  return result;
}

/**
 * Decline a shift request. Staff/admin action.
 */
export async function declineRequest(assignmentId: string) {
  return db.$transaction(async (tx) => {
    const assignment = await tx.shiftAssignment.findUnique({
      where: { id: assignmentId },
      include: { shift: { select: { shiftGroup: { select: { workingCopy: { select: { version: true } } } } } } },
    });
    if (!assignment) throw new HttpError(404, "Assignment not found");
    assertNoWorkingCopy(assignment.shift?.shiftGroup?.workingCopy);
    if (assignment.status !== "REQUESTED") {
      throw new HttpError(400, "Only REQUESTED assignments can be declined");
    }

    return tx.shiftAssignment.update({
      where: { id: assignmentId },
      data: { status: "DECLINED" },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/**
 * Swap: marks old assignment as SWAPPED, creates new assignment for target user.
 */
export async function initiateSwap(
  assignmentId: string,
  targetUserId: string,
  actorId: string
) {
  return db.$transaction(async (tx) => {
    const assignment = await tx.shiftAssignment.findUnique({
      where: { id: assignmentId },
      include: { shift: { select: assignableShiftSelect } },
    });
    if (!assignment) throw new HttpError(404, "Assignment not found");
    assertNoWorkingCopy(assignment.shift.shiftGroup?.workingCopy);
    if (!(ACTIVE_ASSIGNMENT_STATUSES as readonly string[]).includes(assignment.status)) {
      throw new HttpError(400, "Only active assignments can be swapped");
    }

    const target = await tx.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        role: true,
        staffingType: true,
        active: true,
        collaboratorPolicy: {
          select: {
            status: true,
            grants: { select: { capabilityKey: true } },
          },
        },
        availabilityBlocks: {
          select: {
            kind: true,
            intent: true,
            status: true,
            dayOfWeek: true,
            date: true,
            dateEndsOn: true,
            allDay: true,
            startsAt: true,
            endsAt: true,
            label: true,
            semesterLabel: true,
            semesterStartsOn: true,
            semesterEndsOn: true,
          },
        },
      },
    });
    if (!target) throw new HttpError(404, "User not found");
    if (!target.active) throw new HttpError(400, "Cannot assign an inactive user");
    if (scheduleAssigneeWorkerType(target) !== assignment.shift.workerType) {
      throw new HttpError(409, "This worker does not match the slot's scheduling class");
    }

    // Check target user doesn't have a conflicting shift
    const conflictWindow = effectiveShiftWindow(assignment.shift);
    await checkTimeConflict(tx, targetUserId, conflictWindow.startsAt, conflictWindow.endsAt);
    const availability = shiftWorkerTypeForProfile(target) === "ST"
      ? evaluateAvailabilityPreferences(target.availabilityBlocks ?? [], conflictWindow)
      : null;
    if (availability?.blocking) {
      throw new HttpError(409, availability.blocking.note);
    }
    const conflictNote = availability?.advisory?.note ?? null;

    // The outgoing worker no longer holds this shift — a live Trade Board
    // post for it would let someone claim a slot that already changed hands.
    await tx.shiftTrade.updateMany({
      where: {
        shiftAssignmentId: assignmentId,
        status: { in: ["OPEN", "CLAIMED"] },
      },
      data: { status: "CANCELLED", resolvedAt: new Date() },
    });

    // Mark old assignment as swapped
    await tx.shiftAssignment.update({
      where: { id: assignmentId },
      data: { status: "SWAPPED" },
    });

    // Create new assignment
    return tx.shiftAssignment.create({
      data: {
        shiftId: assignment.shiftId,
        userId: targetUserId,
        status: "DIRECT_ASSIGNED",
        assignedBy: actorId,
        swapFromId: assignmentId,
        hasConflict: Boolean(conflictNote),
        conflictNote,
      },
      include: {
        user: { select: { id: true, name: true, role: true, staffingType: true, primaryArea: true } },
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/**
 * Remove an assignment (sets to DECLINED).
 * Only active or requested assignments can be removed — terminal statuses are immutable.
 */
export async function removeAssignment(assignmentId: string) {
  const REMOVABLE_STATUSES: ShiftAssignmentStatus[] = [
    "DIRECT_ASSIGNED",
    "APPROVED",
    "REQUESTED",
  ];

  return db.$transaction(async (tx) => {
    const assignment = await tx.shiftAssignment.findUnique({
      where: { id: assignmentId },
      include: { shift: { select: { shiftGroup: { select: { workingCopy: { select: { version: true } } } } } } },
    });
    if (!assignment) throw new HttpError(404, "Assignment not found");
    assertNoWorkingCopy(assignment.shift?.shiftGroup?.workingCopy);
    if (!REMOVABLE_STATUSES.includes(assignment.status)) {
      throw new HttpError(400, "This assignment cannot be removed in its current state");
    }

    // A removed assignment must not stay advertised on the Trade Board —
    // the poster no longer holds the shift a claimer would be taking over.
    await tx.shiftTrade.updateMany({
      where: {
        shiftAssignmentId: assignmentId,
        status: { in: ["OPEN", "CLAIMED"] },
      },
      data: { status: "CANCELLED", resolvedAt: new Date() },
    });

    return tx.shiftAssignment.update({
      where: { id: assignmentId },
      data: { status: "DECLINED" },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
