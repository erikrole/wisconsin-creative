import { Prisma, Role, ShiftArea, ShiftAssignmentSource, ShiftWorkerType } from "@prisma/client";
import { HttpError } from "@/lib/http";
import { ACTIVE_ASSIGNMENT_STATUSES } from "@/lib/shift-constants";
import { shiftWorkerTypeForProfile } from "@/lib/shift-display";
import { type AvailabilityBlockLike } from "@/lib/student-availability";
import { buildSchedulePublicationSnapshot } from "@/lib/services/schedule-publication";

const reservationScheduleGroupSelect = {
  id: true,
  publishedAt: true,
  workingCopy: { select: { shiftGroupId: true } },
  event: {
    select: {
      startsAt: true,
      endsAt: true,
      allDay: true,
    },
  },
  shifts: {
    orderBy: [{ startsAt: "asc" }, { area: "asc" }, { workerType: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      area: true,
      workerType: true,
      startsAt: true,
      endsAt: true,
      callStartsAt: true,
      callEndsAt: true,
      assignments: {
        where: { status: { in: ACTIVE_ASSIGNMENT_STATUSES } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          userId: true,
          status: true,
          callStartsAt: true,
          callEndsAt: true,
          callNote: true,
          acknowledgedAt: true,
        },
      },
    },
  },
} satisfies Prisma.ShiftGroupSelect;

const reservationAssignmentContextSelect = {
  id: true,
  userId: true,
  status: true,
  source: true,
  shift: {
    select: {
      id: true,
      area: true,
      workerType: true,
      shiftGroup: {
        select: {
          id: true,
          eventId: true,
          publishedAt: true,
          workingCopy: { select: { shiftGroupId: true } },
        },
      },
    },
  },
} satisfies Prisma.ShiftAssignmentSelect;

export type ReservationScheduleRequester = {
  role: Role;
  staffingType: ShiftWorkerType;
  primaryArea: ShiftArea | null;
  areaAssignments: Array<{ area: ShiftArea; isPrimary: boolean }>;
  availabilityBlocks: AvailabilityBlockLike[];
};

type ReservationAssignmentContext = Prisma.ShiftAssignmentGetPayload<{
  select: typeof reservationAssignmentContextSelect;
}>;

export type ReservationScheduleAssignment = {
  shiftAssignmentId: string;
  shiftId: string;
  eventId: string;
  userId: string;
  area: ShiftArea;
  workerType: ShiftWorkerType;
  created: boolean;
  hasConflict: boolean;
};

type ReservationScheduleRelease = {
  assignmentId: string | null;
  eventId: string | null;
  released: boolean;
  linkCleared: boolean;
  blocked: boolean;
  reason: "not_reservation_managed" | "other_reservation" | "working_copy" | "released";
};

type ReservationScheduleReconciliation = {
  status: "scheduled" | "already_scheduled" | "not_applicable" | "needs_review" | "blocked_working_copy";
  assignment: ReservationScheduleAssignment | null;
  releasedAssignmentId: string | null;
  reason?: string;
};

async function loadReservationAssignmentContext(
  tx: Prisma.TransactionClient,
  assignmentId: string,
) {
  return tx.shiftAssignment.findUnique({
    where: { id: assignmentId },
    select: reservationAssignmentContextSelect,
  });
}

async function refreshPublishedSnapshotAfterRelease(
  tx: Prisma.TransactionClient,
  groupId: string,
) {
  const group = await tx.shiftGroup.findUnique({
    where: { id: groupId },
    select: reservationScheduleGroupSelect,
  });
  if (!group) return;

  const data: Prisma.ShiftGroupUpdateInput = { manuallyEdited: true };
  if (group.publishedAt) {
    data.publishedVersion = { increment: 1 };
    data.lastPublishedSnapshot = buildSchedulePublicationSnapshot(group) as unknown as Prisma.InputJsonValue;
  }
  await tx.shiftGroup.update({ where: { id: group.id }, data });
}

/**
 * Validates an explicit booking-to-schedule link at the same transaction
 * boundary that writes the booking. A client-supplied foreign key is not
 * enough: it must belong to the requester, still be active, and match one of
 * the linked events when the booking is event-linked.
 */
export async function validateReservationScheduleAssignmentTx(
  tx: Prisma.TransactionClient,
  args: {
    assignmentId: string;
    requesterUserId: string;
    eventIds: string[];
  },
): Promise<ReservationAssignmentContext> {
  const assignment = await loadReservationAssignmentContext(tx, args.assignmentId);
  if (!assignment) {
    throw new HttpError(400, "shiftAssignmentId does not exist");
  }
  if (assignment.userId !== args.requesterUserId) {
    throw new HttpError(409, "shiftAssignmentId belongs to a different requester");
  }
  if (!ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status)) {
    throw new HttpError(409, "shiftAssignmentId is no longer active");
  }

  const assignmentEventId = assignment.shift.shiftGroup.eventId;
  if (args.eventIds.length > 0 && !args.eventIds.includes(assignmentEventId)) {
    throw new HttpError(409, "shiftAssignmentId does not belong to one of the linked events");
  }
  if (assignment.source === ShiftAssignmentSource.RESERVATION && args.eventIds.length === 0) {
    throw new HttpError(409, "Reservation-managed schedule assignments require a linked event");
  }

  return assignment;
}

/**
 * Releases only an assignment created by the reservation lifecycle. Manual or
 * auto-fill assignments are intentionally left in place. A shared assignment
 * remains active while another active reservation still points at it.
 */
export async function releaseReservationManagedAssignmentTx(
  tx: Prisma.TransactionClient,
  args: {
    bookingId: string;
    assignmentId?: string | null;
  },
): Promise<ReservationScheduleRelease> {
  const assignmentId = args.assignmentId ?? null;
  if (!assignmentId) {
    return {
      assignmentId: null,
      eventId: null,
      released: false,
      linkCleared: false,
      blocked: false,
      reason: "not_reservation_managed",
    };
  }

  const assignment = await loadReservationAssignmentContext(tx, assignmentId);
  if (
    !assignment
    || assignment.source !== ShiftAssignmentSource.RESERVATION
    || !ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status)
  ) {
    return {
      assignmentId,
      eventId: assignment?.shift.shiftGroup.eventId ?? null,
      released: false,
      linkCleared: false,
      blocked: false,
      reason: "not_reservation_managed",
    };
  }

  const otherReservationCount = await tx.booking.count({
    where: {
      id: { not: args.bookingId },
      kind: "RESERVATION",
      status: { in: ["BOOKED", "PENDING_PICKUP", "OPEN"] },
      shiftAssignmentId: assignmentId,
    },
  });
  if (otherReservationCount > 0) {
    await tx.booking.update({
      where: { id: args.bookingId },
      data: { shiftAssignmentId: null },
    });
    return {
      assignmentId,
      eventId: assignment.shift.shiftGroup.eventId,
      released: false,
      linkCleared: true,
      blocked: false,
      reason: "other_reservation",
    };
  }

  if (assignment.shift.shiftGroup.workingCopy) {
    return {
      assignmentId,
      eventId: assignment.shift.shiftGroup.eventId,
      released: false,
      linkCleared: false,
      blocked: true,
      reason: "working_copy",
    };
  }

  await tx.shiftTrade.updateMany({
    where: {
      shiftAssignmentId: assignmentId,
      status: { in: ["OPEN", "CLAIMED"] },
    },
    data: { status: "CANCELLED", resolvedAt: new Date() },
  });
  await tx.shiftAssignment.update({
    where: { id: assignmentId },
    data: { status: "DECLINED" },
  });
  await tx.booking.update({
    where: { id: args.bookingId },
    data: { shiftAssignmentId: null },
  });
  await refreshPublishedSnapshotAfterRelease(tx, assignment.shift.shiftGroup.id);

  return {
    assignmentId,
    eventId: assignment.shift.shiftGroup.eventId,
    released: true,
    linkCleared: true,
    blocked: false,
    reason: "released",
  };
}

function existingReservationAssignment(
  assignment: ReservationAssignmentContext,
): ReservationScheduleAssignment {
  return {
    shiftAssignmentId: assignment.id,
    shiftId: assignment.shift.id,
    eventId: assignment.shift.shiftGroup.eventId,
    userId: assignment.userId,
    area: assignment.shift.area,
    workerType: assignment.shift.workerType,
    created: false,
    hasConflict: false,
  };
}

/**
 * Makes event and requester changes idempotent. Reservation-created links can
 * move with their reservation; manual and auto-fill links are retained and
 * surfaced as review-needed instead of being silently overwritten.
 */
export async function reconcileReservationScheduleTx(
  tx: Prisma.TransactionClient,
  args: {
    bookingId: string;
    requesterUserId: string;
    requester: ReservationScheduleRequester | null;
    primaryEventId: string | null;
    currentAssignmentId?: string | null;
    createdBy: string;
  },
): Promise<ReservationScheduleReconciliation> {
  let current = args.currentAssignmentId
    ? await loadReservationAssignmentContext(tx, args.currentAssignmentId)
    : null;

  if (args.currentAssignmentId && !current) {
    return {
      status: "needs_review",
      assignment: null,
      releasedAssignmentId: null,
      reason: "The booking points to a schedule assignment that no longer exists.",
    };
  }

  // A manual or auto-fill assignment stays with the person it was scheduled
  // for. After an owner transfer the booking must stop pointing at it, or the
  // pickup checkout inherits a link that fails requester validation.
  if (
    current
    && current.source !== ShiftAssignmentSource.RESERVATION
    && current.userId !== args.requesterUserId
  ) {
    await tx.booking.update({
      where: { id: args.bookingId },
      data: { shiftAssignmentId: null },
    });
    current = null;
  }

  if (current && current.source !== ShiftAssignmentSource.RESERVATION) {
    const matches = Boolean(
      args.primaryEventId
      && current.shift.shiftGroup.eventId === args.primaryEventId
      && current.userId === args.requesterUserId,
    );
    return {
      status: matches ? "already_scheduled" : "needs_review",
      assignment: existingReservationAssignment(current),
      releasedAssignmentId: null,
      ...(matches
        ? {}
        : { reason: "A manual or auto-fill schedule assignment was retained for review." }),
    };
  }

  let releasedAssignmentId: string | null = null;
  if (current && (
    !args.primaryEventId
    || current.shift.shiftGroup.eventId !== args.primaryEventId
    || current.userId !== args.requesterUserId
  )) {
    const release = await releaseReservationManagedAssignmentTx(tx, {
      bookingId: args.bookingId,
      assignmentId: current.id,
    });
    if (release.blocked) {
      return {
        status: "blocked_working_copy",
        assignment: existingReservationAssignment(current),
        releasedAssignmentId: null,
        reason: "Publish or discard the event's working schedule before changing its reservation assignment.",
      };
    }
    releasedAssignmentId = release.released || release.linkCleared ? current.id : null;
    current = null;
  }

  if (!args.primaryEventId) {
    return {
      status: "not_applicable",
      assignment: null,
      releasedAssignmentId,
      reason: "No event is linked to this reservation.",
    };
  }

  if (!args.requester || args.requester.role === Role.COLLABORATOR) {
    return {
      status: "not_applicable",
      assignment: null,
      releasedAssignmentId,
      reason: "Collaborator reservations do not create internal schedule assignments.",
    };
  }

  const assignment = await assignReservationRequesterToScheduleTx(tx, {
    bookingId: args.bookingId,
    eventId: args.primaryEventId,
    requesterUserId: args.requesterUserId,
    requester: args.requester,
    createdBy: args.createdBy,
  });
  if (!assignment) {
    return {
      status: "not_applicable",
      assignment: null,
      releasedAssignmentId,
      reason: "The requester is not scheduled for this event, and reservations do not schedule people.",
    };
  }

  await tx.booking.update({
    where: { id: args.bookingId },
    data: { shiftAssignmentId: assignment.shiftAssignmentId },
  });

  return {
    status: assignment.created ? "scheduled" : "already_scheduled",
    assignment,
    releasedAssignmentId,
  };
}

/**
 * Finds the requester's existing schedule assignment for an event-linked
 * reservation. It never creates one. This runs inside the booking transaction
 * so a booking never points at an assignment from a separate write.
 */
export async function assignReservationRequesterToScheduleTx(
  tx: Prisma.TransactionClient,
  args: {
    bookingId: string;
    eventId: string;
    requesterUserId: string;
    requester: ReservationScheduleRequester;
    createdBy: string;
  },
): Promise<ReservationScheduleAssignment | null> {
  if (args.requester.role === Role.COLLABORATOR) return null;

  const workerType = shiftWorkerTypeForProfile(args.requester);
  if (!workerType) return null;

  const group = await tx.shiftGroup.findUnique({
    where: { eventId: args.eventId },
    select: reservationScheduleGroupSelect,
  });
  if (!group) return null;

  const existing = group.shifts
    .flatMap((shift) => shift.assignments.map((assignment) => ({ assignment, shift })))
    .find(({ assignment }) => assignment.userId === args.requesterUserId);
  if (existing) {
    return {
      shiftAssignmentId: existing.assignment.id,
      shiftId: existing.shift.id,
      eventId: args.eventId,
      userId: args.requesterUserId,
      area: existing.shift.area,
      workerType: existing.shift.workerType,
      created: false,
      hasConflict: false,
    };
  }

  // A gear reservation never puts anyone on the schedule. Staff decide who
  // works an event; the booking only links to a slot the requester already has.
  return null;
}
