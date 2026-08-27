import { Prisma, type Role, type ShiftArea, type ShiftAssignmentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { ACTIVE_ASSIGNMENT_STATUSES } from "@/lib/shift-constants";
import {
  buildShiftAssignmentOverlapWhere,
  resolveEffectiveAssignmentWindow,
  resolveEffectiveShiftWindow,
  scheduleWindowsOverlap,
  type ScheduleShiftTiming,
} from "@/lib/schedule-window";
import { scoreCandidatesForShift, type CandidateScoringUser } from "@/lib/services/candidate-scoring";
import { evaluateAvailabilityPreferences } from "@/lib/student-availability";
import { availabilityContextFromCandidate } from "@/lib/schedule-availability-context";
import { shiftWorkerTypeForProfile } from "@/lib/shift-display";
import { withSerializationRetry } from "@/lib/serialization";
import { assertNoWorkingCopy } from "@/lib/schedule-working-copy-guard";
import { createAuditEntryTx } from "@/lib/audit";
import { claimReviewDeadlines } from "@/lib/claim-review-deadlines";

const ACTIVE_STATUSES = ACTIVE_ASSIGNMENT_STATUSES as ShiftAssignmentStatus[];

type OpenWorkFilters = {
  userId: string;
  role: Role;
  area?: ShiftArea;
  now?: Date;
  limit?: number;
};

type OpenWorkShift = Awaited<ReturnType<typeof loadOpenShiftRows>>[number];

function effectiveWindow(item: ScheduleShiftTiming) {
  return resolveEffectiveShiftWindow(item);
}

function futureEffectiveShiftWhere(now: Date): Prisma.ShiftWhereInput {
  return {
    OR: [
      { callStartsAt: null, startsAt: { gt: now } },
      { callStartsAt: { gt: now } },
      { shiftGroup: { event: { allDay: true, startsAt: { gt: now } } } },
    ],
  };
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function openShiftSelect() {
  return {
    id: true,
    area: true,
    workerType: true,
    startsAt: true,
    endsAt: true,
    callStartsAt: true,
    callEndsAt: true,
    assignments: {
      where: { status: "REQUESTED" as const },
      select: {
        id: true,
        userId: true,
        status: true,
        hasConflict: true,
        conflictNote: true,
        user: { select: { id: true, name: true, primaryArea: true, avatarUrl: true } },
      },
      orderBy: { createdAt: "asc" as const },
    },
    shiftGroup: {
      select: {
        id: true,
        publishedAt: true,
        event: {
          select: {
            id: true,
            summary: true,
            startsAt: true,
            endsAt: true,
            allDay: true,
            sportCode: true,
            opponent: true,
            isHome: true,
          },
        },
      },
    },
  };
}

async function loadCurrentCandidate(userId: string, now: Date, futureEnd: Date): Promise<CandidateScoringUser | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      staffingType: true,
      active: true,
      primaryArea: true,
      areaAssignments: { select: { area: true, isPrimary: true } },
      sportAssignments: { select: { sportCode: true } },
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
  if (!user || !user.active) return null;

  const assignments = await db.shiftAssignment.findMany({
    where: {
      userId,
      status: { in: ACTIVE_STATUSES },
      OR: [
        { shift: { startsAt: { lt: futureEnd }, endsAt: { gt: now } } },
        { callStartsAt: { lt: futureEnd }, callEndsAt: { gt: now } },
        { shift: { callStartsAt: { lt: futureEnd }, callEndsAt: { gt: now } } },
      ],
    },
    select: {
      id: true,
      status: true,
      callStartsAt: true,
      callEndsAt: true,
      shift: {
        select: {
          id: true,
          area: true,
          startsAt: true,
          endsAt: true,
          callStartsAt: true,
          callEndsAt: true,
          shiftGroup: {
            select: { event: { select: { sportCode: true } } },
          },
        },
      },
    },
  });

  return {
    id: user.id,
    role: user.role,
    staffingType: user.staffingType,
    primaryArea: user.primaryArea,
    areaAssignments: user.areaAssignments,
    sportAssignments: user.sportAssignments,
    availabilityBlocks: user.availabilityBlocks,
    assignments,
  };
}

async function loadOpenShiftRows(filters: OpenWorkFilters) {
  const now = filters.now ?? new Date();
  return db.shift.findMany({
    where: {
      AND: [futureEffectiveShiftWhere(now)],
      ...(filters.area ? { area: filters.area } : {}),
      workerType: "ST",
      assignments: {
        none: { status: { in: ACTIVE_STATUSES } },
      },
      shiftGroup: {
        publishedAt: { not: null },
        archivedAt: null,
        event: {
          isHidden: false,
          archivedAt: null,
          status: { not: "CANCELLED" },
        },
      },
    },
    select: openShiftSelect(),
    orderBy: { startsAt: "asc" },
    take: filters.limit ?? 50,
  });
}

function shiftToScoreInput(shift: OpenWorkShift) {
  return {
    id: shift.id,
    area: shift.area,
    workerType: shift.workerType,
    startsAt: shift.startsAt,
    endsAt: shift.endsAt,
    callStartsAt: shift.callStartsAt,
    callEndsAt: shift.callEndsAt,
    sportCode: shift.shiftGroup.event.sportCode,
  };
}

function openShiftBlockedReason(recommendation: ReturnType<typeof scoreCandidatesForShift>[number] | null) {
  const approvedTimeOff = recommendation?.warnings.find((warning) => warning.code === "approved_time_off");
  if (approvedTimeOff) return approvedTimeOff.label;
  const overlappingAssignment = recommendation?.warnings.find((warning) => warning.code === "overlapping_assignment");
  if (overlappingAssignment) return overlappingAssignment.label;
  if (recommendation?.blockingConflict) return recommendation.advisoryConflictNote ?? "This shift is blocked by your current schedule.";
  return null;
}

function serializeOpenShift(shift: OpenWorkShift, args: {
  userId: string;
  role: Role;
  candidate: CandidateScoringUser | null;
  now: Date;
}) {
  const recommendation = args.candidate
    ? scoreCandidatesForShift({
      shift: shiftToScoreInput(shift),
      candidates: [args.candidate],
      now: args.now,
    })[0] ?? null
    : null;
  const ownRequest = shift.assignments.find((assignment) => assignment.userId === args.userId) ?? null;
  const isStudentWorker = args.candidate?.staffingType === "ST";
  const availabilityContext = availabilityContextFromCandidate(recommendation);
  const blockedReason = openShiftBlockedReason(recommendation);
  const canAct = isStudentWorker && shift.workerType === "ST" && !recommendation?.blockingConflict;
  const action = !canAct || !isStudentWorker || shift.workerType !== "ST" || recommendation?.blockingConflict
    ? "none"
    : "claim";

  return {
    id: shift.id,
    kind: "open_shift" as const,
    action,
    canAct,
    reason: blockedReason
        ? blockedReason
        : "Admin approval required",
    availabilityContext,
    score: recommendation?.score ?? null,
    bucket: recommendation?.bucket ?? null,
    advisoryConflict: recommendation?.advisoryConflict ?? false,
    advisoryConflictNote: recommendation?.advisoryConflictNote ?? null,
    warnings: recommendation?.warnings ?? [],
    reasons: recommendation?.reasons ?? [],
    ownRequestId: ownRequest?.id ?? null,
    requestCount: args.role === "ADMIN" ? shift.assignments.length : ownRequest ? 1 : 0,
    shift: {
      id: shift.id,
      area: shift.area,
      workerType: shift.workerType,
      startsAt: shift.startsAt.toISOString(),
      endsAt: shift.endsAt.toISOString(),
      callStartsAt: shift.callStartsAt?.toISOString() ?? null,
      callEndsAt: shift.callEndsAt?.toISOString() ?? null,
      shiftGroup: {
        id: shift.shiftGroup.id,
        publishedAt: shift.shiftGroup.publishedAt?.toISOString() ?? null,
        event: {
          ...shift.shiftGroup.event,
          startsAt: shift.shiftGroup.event.startsAt.toISOString(),
          endsAt: shift.shiftGroup.event.endsAt.toISOString(),
        },
      },
    },
  };
}

export async function getScheduleOpenWork(filters: OpenWorkFilters) {
  const now = filters.now ?? new Date();
  const futureEnd = addDays(now, 120);
  const [candidate, shifts, pickupRequests] = await Promise.all([
    loadCurrentCandidate(filters.userId, now, futureEnd),
    loadOpenShiftRows({ ...filters, now }),
    // Admins see every request because they own review. Everyone else sees only
    // their own — without it, claiming a shift looks like nothing happened.
    db.shiftAssignment.findMany({
        where: {
          status: "REQUESTED",
          ...(filters.role === "ADMIN"
            ? {}
            : { userId: filters.userId }),
          shift: {
            AND: [futureEffectiveShiftWhere(now)],
            ...(filters.area ? { area: filters.area } : {}),
            shiftGroup: {
              publishedAt: { not: null },
              archivedAt: null,
              event: { isHidden: false, archivedAt: null, status: { not: "CANCELLED" } },
            },
          },
        },
        select: {
          id: true,
          status: true,
          hasConflict: true,
          conflictNote: true,
          createdAt: true,
          user: { select: { id: true, name: true, primaryArea: true, avatarUrl: true } },
          shift: { select: openShiftSelect() },
        },
        orderBy: { createdAt: "asc" },
        take: filters.limit ?? 50,
      }),
  ]);

  return {
    openShifts: shifts.map((shift) => serializeOpenShift(shift, {
      userId: filters.userId,
      role: filters.role,
      candidate,
      now,
    })),
    pickupRequests: pickupRequests.map((request) => {
      const deadlines = claimReviewDeadlines(effectiveWindow(request.shift).startsAt, request.createdAt);
      return {
        id: request.id,
        kind: "pickup_request" as const,
        status: request.status,
        hasConflict: request.hasConflict,
        conflictNote: request.conflictNote,
        reviewEscalatesAt: deadlines?.escalateAt.toISOString() ?? null,
        reviewAutoApprovesAt: deadlines?.autoApproveAt.toISOString() ?? null,
        createdAt: request.createdAt.toISOString(),
        user: request.user,
        shift: serializeOpenShift(request.shift, {
          userId: request.user.id,
          role: "STUDENT",
          candidate: null,
          now,
        }).shift,
      };
    }),
  };
}

/**
 * File a student's request for a published open Student slot. The request holds
 * no slot — `REQUESTED` is outside `ACTIVE_ASSIGNMENT_STATUSES` — so it raises no
 * conflict, stays out of My Shifts and the personal ISC feed, and never blocks
 * staff from assigning the slot directly. `approveRequest` turns it into real
 * coverage.
 */
export async function pickupOpenShift(shiftId: string, userId: string) {
  // Requests no longer race each other for the slot, but they still race staff
  // filling it directly, so a lost serialization conflict retries once and the
  // second attempt returns the 409 against the assignment that landed first.
  return withSerializationRetry(() => db.$transaction(async (tx) => {
    const [shift, user] = await Promise.all([
      tx.shift.findUnique({
        where: { id: shiftId },
        include: {
          assignments: {
            where: { status: { in: ["DIRECT_ASSIGNED", "APPROVED", "REQUESTED"] } },
          },
          shiftGroup: {
            include: {
              workingCopy: { select: { version: true } },
              event: {
                select: {
                  startsAt: true,
                  endsAt: true,
                  allDay: true,
                  isHidden: true,
                  archivedAt: true,
                  status: true,
                },
              },
            },
          },
        },
      }),
      tx.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          role: true,
          staffingType: true,
          active: true,
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
      }),
    ]);

    if (!shift) throw new HttpError(404, "Shift not found");
    assertNoWorkingCopy(shift.shiftGroup.workingCopy);
    if (!user || !user.active) throw new HttpError(400, "Cannot claim a shift for an inactive user");
    if (shiftWorkerTypeForProfile(user) !== "ST" || shift.workerType !== "ST") {
      throw new HttpError(400, "Open pickup is available for Student slots only");
    }
    if (!shift.shiftGroup.publishedAt) throw new HttpError(400, "Draft shifts are not open for pickup");
    if (shift.shiftGroup.archivedAt || shift.shiftGroup.event.archivedAt || shift.shiftGroup.event.isHidden || shift.shiftGroup.event.status === "CANCELLED") {
      throw new HttpError(400, "This shift is not open for pickup");
    }
    const window = effectiveWindow(shift);
    if (window.startsAt <= new Date()) throw new HttpError(400, "This shift has already started");

    const activeAssignment = shift.assignments.find((assignment) =>
      (ACTIVE_STATUSES as readonly ShiftAssignmentStatus[]).includes(assignment.status)
    );
    if (activeAssignment) throw new HttpError(409, "This shift already has an active assignment");

    const conflictCandidates = await tx.shiftAssignment.findMany({
      where: buildShiftAssignmentOverlapWhere({ userId, window }),
      select: {
        id: true,
        callStartsAt: true,
        callEndsAt: true,
        shift: {
          select: {
            area: true,
            startsAt: true,
            endsAt: true,
            callStartsAt: true,
            callEndsAt: true,
            shiftGroup: {
              select: {
                event: { select: { startsAt: true, endsAt: true, allDay: true } },
              },
            },
          },
        },
      },
    });
    const hardConflict = conflictCandidates.find((assignment) =>
      scheduleWindowsOverlap(window, resolveEffectiveAssignmentWindow(assignment))
    );
    if (hardConflict) {
      throw new HttpError(409, `User already has a shift during this time (${hardConflict.shift.area})`);
    }

    const availability = evaluateAvailabilityPreferences(user.availabilityBlocks, window);
    if (availability.blocking) {
      throw new HttpError(409, availability.blocking.note);
    }
    const conflictNote = availability.advisory?.note ?? null;

    // Competing requests are the point now: several students may want the same
    // slot and staff pick one. `approveRequest` declines the rest when it lands,
    // so nothing here may pre-empt that choice.
    const alreadyRequested = await tx.shiftAssignment.findFirst({
      where: { shiftId, userId, status: "REQUESTED" },
      select: { id: true },
    });
    if (alreadyRequested) {
      throw new HttpError(409, "You already have a request waiting on this shift");
    }

    return tx.shiftAssignment.create({
      data: {
        shiftId,
        userId,
        status: "REQUESTED",
        assignedBy: userId,
        hasConflict: Boolean(conflictNote),
        conflictNote,
        // Deliberately no acknowledgement: there is nothing to acknowledge until
        // Admin approves. Stamping it here would show the student as confirmed
        // for a slot they do not hold.
      },
      include: {
        user: { select: { id: true, name: true, role: true, staffingType: true, primaryArea: true, avatarUrl: true } },
        shift: {
          include: {
            shiftGroup: { include: { event: true } },
          },
        },
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

/**
 * Withdraw a student's pending open-slot request. REQUESTED is intentionally
 * retained as the only pending state, so the existing DECLINED terminal state
 * records the withdrawal without a schema migration; the audit action carries
 * the more precise reason.
 */
export async function withdrawPickupRequest(
  assignmentId: string,
  actor: { id: string; role: Role },
) {
  return withSerializationRetry(() => db.$transaction(async (tx) => {
    const assignment = await tx.shiftAssignment.findUnique({
      where: { id: assignmentId },
      include: {
        shift: {
          select: {
            id: true,
            shiftGroup: { select: { workingCopy: { select: { version: true } } } },
          },
        },
      },
    });
    if (!assignment) throw new HttpError(404, "Assignment not found");
    assertNoWorkingCopy(assignment.shift?.shiftGroup?.workingCopy);
    if (assignment.userId !== actor.id) {
      throw new HttpError(403, "You can only withdraw your own shift request");
    }
    if (assignment.status !== "REQUESTED") {
      throw new HttpError(400, "Only pending requests can be withdrawn");
    }

    const updated = await tx.shiftAssignment.update({
      where: { id: assignmentId },
      data: { status: "DECLINED" },
    });
    await createAuditEntryTx(tx, {
      actorId: actor.id,
      actorRole: actor.role,
      entityType: "shift_assignment",
      entityId: assignmentId,
      action: "shift_request_withdrawn",
      before: { status: assignment.status, userId: assignment.userId, shiftId: assignment.shiftId },
      after: { status: updated.status, userId: updated.userId, shiftId: updated.shiftId },
    });
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}
