import { Prisma, Role, ShiftArea, ShiftAssignmentSource, ShiftWorkerType } from "@prisma/client";
import { normalizeAllDayToUtcMidnight } from "@/lib/app-time";
import { HttpError } from "@/lib/http";
import { ACTIVE_ASSIGNMENT_STATUSES } from "@/lib/shift-constants";
import { shiftWorkerTypeForProfile } from "@/lib/shift-display";
import { evaluateAvailabilityPreferences, type AvailabilityBlockLike } from "@/lib/student-availability";
import { checkTimeConflict } from "@/lib/services/shift-assignments";
import { buildSchedulePublicationSnapshot } from "@/lib/services/schedule-publication";
import { unique } from "@/lib/utils";

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

const reservationScheduleShiftSelect = {
  id: true,
  area: true,
  workerType: true,
  startsAt: true,
  endsAt: true,
  callStartsAt: true,
  callEndsAt: true,
} satisfies Prisma.ShiftSelect;

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

type ReservationScheduleGroup = Prisma.ShiftGroupGetPayload<{
  select: typeof reservationScheduleGroupSelect;
}>;

type ReservationScheduleShiftBase = Prisma.ShiftGetPayload<{
  select: typeof reservationScheduleShiftSelect;
}>;

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

const RESERVATION_ASSIGNMENT_NOTE = "Auto-assigned from an event gear reservation";

function preferredAreas(requester: ReservationScheduleRequester) {
  const areas = [
    requester.primaryArea,
    ...requester.areaAssignments
      .filter((assignment) => assignment.isPrimary)
      .map((assignment) => assignment.area),
    ...requester.areaAssignments.map((assignment) => assignment.area),
  ];
  return unique(areas.filter((area): area is ShiftArea => Boolean(area)));
}

function effectiveReservationShiftWindow(
  group: ReservationScheduleGroup,
  shift: Pick<ReservationScheduleShiftBase, "startsAt" | "endsAt" | "callStartsAt" | "callEndsAt">,
) {
  if (shift.callStartsAt && shift.callEndsAt) {
    return { startsAt: shift.callStartsAt, endsAt: shift.callEndsAt };
  }
  if (group.event.allDay) {
    return {
      startsAt: normalizeAllDayToUtcMidnight(group.event.startsAt),
      endsAt: normalizeAllDayToUtcMidnight(group.event.endsAt),
    };
  }
  return { startsAt: shift.startsAt, endsAt: shift.endsAt };
}

function snapshotAssignment(assignment: {
  id: string;
  userId: string;
  status: string;
  callStartsAt: Date | null;
  callEndsAt: Date | null;
  callNote: string | null;
  acknowledgedAt: Date | null;
}) {
  return {
    id: assignment.id,
    userId: assignment.userId,
    status: assignment.status,
    callStartsAt: assignment.callStartsAt,
    callEndsAt: assignment.callEndsAt,
    callNote: assignment.callNote,
    acknowledgedAt: assignment.acknowledgedAt,
  };
}

async function refreshPublishedSnapshot(
  tx: Prisma.TransactionClient,
  group: ReservationScheduleGroup,
  targetShift: ReservationScheduleShiftBase,
  assignment: ReturnType<typeof snapshotAssignment>,
  newShift: boolean,
) {
  const shifts = group.shifts.map((shift) =>
    shift.id === targetShift.id
      ? { ...shift, assignments: [...shift.assignments, assignment] }
      : shift,
  );

  if (newShift) {
    shifts.push({ ...targetShift, assignments: [assignment] });
  }

  const data: Prisma.ShiftGroupUpdateInput = { manuallyEdited: true };
  if (group.publishedAt) {
    data.publishedVersion = { increment: 1 };
    data.lastPublishedSnapshot = buildSchedulePublicationSnapshot({ shifts }) as unknown as Prisma.InputJsonValue;
  }

  await tx.shiftGroup.update({ where: { id: group.id }, data });
}

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
      status: "needs_review",
      assignment: null,
      releasedAssignmentId,
      reason: "No safe schedule slot could be inferred for this reservation.",
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
 * Infers one internal schedule assignment from an event-linked reservation.
 * This function deliberately runs inside the booking transaction so a booking
 * never points at a schedule assignment that was created by a separate write.
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

  // A private staff working copy is intentionally not mutated by a booking.
  // Staff can publish or reconcile that draft explicitly after reviewing it.
  if (group.workingCopy) return null;

  const areas = preferredAreas(args.requester);
  const openShifts = group.shifts.filter(
    (shift) => shift.workerType === workerType && shift.assignments.length === 0,
  );
  const targetShift = areas.length > 0
    ? openShifts.find((shift) => areas.includes(shift.area))
    : openShifts[0];

  let selectedShift: ReservationScheduleShiftBase | null = targetShift ?? null;
  let newShift = false;
  if (!selectedShift) {
    const template = areas.length > 0
      ? group.shifts.find((shift) => areas.includes(shift.area))
      : null;
    if (!template) return null;

    selectedShift = await tx.shift.create({
      data: {
        shiftGroupId: group.id,
        area: template.area,
        workerType,
        startsAt: template.startsAt,
        endsAt: template.endsAt,
        callStartsAt: template.callStartsAt,
        callEndsAt: template.callEndsAt,
      },
      select: reservationScheduleShiftSelect,
    });
    newShift = true;
  }
  if (!selectedShift) return null;

  const conflictWindow = effectiveReservationShiftWindow(group, selectedShift);
  await checkTimeConflict(
    tx,
    args.requesterUserId,
    conflictWindow.startsAt,
    conflictWindow.endsAt,
  );

  const availability = workerType === "ST"
    ? evaluateAvailabilityPreferences(args.requester.availabilityBlocks, conflictWindow)
    : null;
  if (availability?.blocking) {
    throw new HttpError(409, availability.blocking.note);
  }
  const conflictNote = availability?.advisory?.note ?? null;

  await tx.shiftAssignment.updateMany({
    where: {
      shiftId: selectedShift.id,
      status: "REQUESTED",
    },
    data: { status: "DECLINED" },
  });

  const assignment = await tx.shiftAssignment.create({
    data: {
      shiftId: selectedShift.id,
      userId: args.requesterUserId,
      status: "DIRECT_ASSIGNED",
      source: ShiftAssignmentSource.RESERVATION,
      assignedBy: args.createdBy,
      notes: RESERVATION_ASSIGNMENT_NOTE,
      hasConflict: Boolean(conflictNote),
      conflictNote,
    },
    select: {
      id: true,
      userId: true,
      status: true,
      callStartsAt: true,
      callEndsAt: true,
      callNote: true,
      acknowledgedAt: true,
    },
  });

  await refreshPublishedSnapshot(
    tx,
    group,
    selectedShift,
    snapshotAssignment(assignment),
    newShift,
  );

  return {
    shiftAssignmentId: assignment.id,
    shiftId: selectedShift.id,
    eventId: args.eventId,
    userId: args.requesterUserId,
    area: selectedShift.area,
    workerType: selectedShift.workerType,
    created: true,
    hasConflict: Boolean(conflictNote),
  };
}
