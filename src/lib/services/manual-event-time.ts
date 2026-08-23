import { Prisma, Role, ShiftAssignmentStatus } from "@prisma/client";
import { createAuditEntryTx } from "@/lib/audit";
import { ACTIVE_ASSIGNMENT_STATUSES } from "@/lib/shift-constants";
import { shiftWorkerTypeForProfile } from "@/lib/shift-display";
import { buildSchedulePublicationSnapshot } from "@/lib/services/schedule-publication";
import { updateShiftAssignmentConflictsTx } from "@/lib/services/shift-assignment-conflicts";
import { availabilityConflictNote } from "@/lib/student-availability";
import { workingSchedulePayloadSchema } from "@/lib/schedule-working-copy";
import { HttpError } from "@/lib/http";

const activeAssignmentStatuses = ACTIVE_ASSIGNMENT_STATUSES as ShiftAssignmentStatus[];

const availabilityBlockSelect = {
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
} satisfies Prisma.StudentAvailabilityBlockSelect;

const eventScheduleSelect = {
  id: true,
  publishedAt: true,
  publishedVersion: true,
  shifts: {
    select: {
      id: true,
      area: true,
      workerType: true,
      startsAt: true,
      endsAt: true,
      callStartsAt: true,
      callEndsAt: true,
      assignments: {
        where: { status: { in: activeAssignmentStatuses } },
        select: {
          id: true,
          userId: true,
          status: true,
          callStartsAt: true,
          callEndsAt: true,
          callNote: true,
          user: {
            select: {
              role: true,
              staffingType: true,
              availabilityBlocks: { select: availabilityBlockSelect },
            },
          },
        },
      },
    },
  },
  workingCopy: {
    select: {
      version: true,
      payload: true,
    },
  },
} satisfies Prisma.ShiftGroupSelect;

type EventSchedule = Prisma.ShiftGroupGetPayload<{ select: typeof eventScheduleSelect }>;

export type ManualEventScheduleShift = {
  shiftGroupId: string;
  affectedUserIds: string[];
  published: boolean;
};

function moveDate(value: Date, deltaMs: number) {
  return new Date(value.getTime() + deltaMs);
}

function moveOptionalDate(value: Date | null, deltaMs: number) {
  return value ? moveDate(value, deltaMs) : null;
}

function moveIso(value: string, deltaMs: number) {
  return new Date(new Date(value).getTime() + deltaMs).toISOString();
}

function moveOptionalIso(value: string | null, deltaMs: number) {
  return value ? moveIso(value, deltaMs) : null;
}

async function persistMovedShifts(
  tx: Prisma.TransactionClient,
  shifts: Array<{
    id: string;
    startsAt: Date;
    endsAt: Date;
    callStartsAt: Date | null;
    callEndsAt: Date | null;
  }>,
) {
  if (shifts.length === 0) return;
  const values = shifts.map((shift) => Prisma.sql`(
    CAST(${shift.id} AS TEXT),
    CAST(${shift.startsAt} AS TIMESTAMP(3)),
    CAST(${shift.endsAt} AS TIMESTAMP(3)),
    CAST(${shift.callStartsAt} AS TIMESTAMP(3)),
    CAST(${shift.callEndsAt} AS TIMESTAMP(3))
  )`);
  const updatedCount = await tx.$executeRaw(Prisma.sql`
    UPDATE "shifts" AS current
    SET
      "starts_at" = incoming.starts_at,
      "ends_at" = incoming.ends_at,
      "call_starts_at" = incoming.call_starts_at,
      "call_ends_at" = incoming.call_ends_at,
      "updated_at" = NOW()
    FROM (VALUES ${Prisma.join(values)}) AS incoming(id, starts_at, ends_at, call_starts_at, call_ends_at)
    WHERE current.id = incoming.id
  `);
  if (updatedCount !== shifts.length) {
    throw new HttpError(409, "The crew schedule changed while the event was being moved. Refresh and try again.");
  }
}

async function persistMovedAssignments(
  tx: Prisma.TransactionClient,
  assignments: Array<{ id: string; callStartsAt: Date | null; callEndsAt: Date | null }>,
) {
  if (assignments.length === 0) return;
  const values = assignments.map((assignment) => Prisma.sql`(
    CAST(${assignment.id} AS TEXT),
    CAST(${assignment.callStartsAt} AS TIMESTAMP(3)),
    CAST(${assignment.callEndsAt} AS TIMESTAMP(3))
  )`);
  const updatedCount = await tx.$executeRaw(Prisma.sql`
    UPDATE "shift_assignments" AS current
    SET
      "call_starts_at" = incoming.call_starts_at,
      "call_ends_at" = incoming.call_ends_at,
      "updated_at" = NOW()
    FROM (VALUES ${Prisma.join(values)}) AS incoming(id, call_starts_at, call_ends_at)
    WHERE current.id = incoming.id
  `);
  if (updatedCount !== assignments.length) {
    throw new HttpError(409, "The crew schedule changed while the event was being moved. Refresh and try again.");
  }
}

function moveWorkingCopy(
  group: EventSchedule,
  nextStartsAt: Date,
  nextEndsAt: Date,
  startDeltaMs: number,
  endDeltaMs: number,
) {
  if (!group.workingCopy) return null;
  const parsed = workingSchedulePayloadSchema.safeParse(group.workingCopy.payload);
  if (!parsed.success) {
    throw new HttpError(409, "The working crew schedule is invalid and must be repaired before moving this event");
  }

  return {
    ...parsed.data,
    eventStartsAt: nextStartsAt.toISOString(),
    eventEndsAt: nextEndsAt.toISOString(),
    slots: parsed.data.slots.map((slot) => ({
      ...slot,
      startsAt: moveIso(slot.startsAt, startDeltaMs),
      endsAt: moveIso(slot.endsAt, endDeltaMs),
      callStartsAt: moveOptionalIso(slot.callStartsAt, startDeltaMs),
      callEndsAt: moveOptionalIso(slot.callEndsAt, endDeltaMs),
      assignment: slot.assignment ? {
        ...slot.assignment,
        callStartsAt: moveOptionalIso(slot.assignment.callStartsAt, startDeltaMs),
        callEndsAt: moveOptionalIso(slot.assignment.callEndsAt, endDeltaMs),
      } : null,
    })),
  };
}

export async function shiftManualEventScheduleTx(
  tx: Prisma.TransactionClient,
  args: {
    eventId: string;
    previousStartsAt: Date;
    previousEndsAt: Date;
    nextStartsAt: Date;
    nextEndsAt: Date;
    actor: { id: string; role: Role };
  },
): Promise<ManualEventScheduleShift | null> {
  const startDeltaMs = args.nextStartsAt.getTime() - args.previousStartsAt.getTime();
  const endDeltaMs = args.nextEndsAt.getTime() - args.previousEndsAt.getTime();
  if (startDeltaMs === 0 && endDeltaMs === 0) return null;

  const group = await tx.shiftGroup.findUnique({
    where: { eventId: args.eventId },
    select: eventScheduleSelect,
  });
  if (!group) return null;

  const movedShifts = group.shifts.map((shift) => ({
    ...shift,
    startsAt: moveDate(shift.startsAt, startDeltaMs),
    endsAt: moveDate(shift.endsAt, endDeltaMs),
    callStartsAt: moveOptionalDate(shift.callStartsAt, startDeltaMs),
    callEndsAt: moveOptionalDate(shift.callEndsAt, endDeltaMs),
    assignments: shift.assignments.map((assignment) => ({
      ...assignment,
      callStartsAt: moveOptionalDate(assignment.callStartsAt, startDeltaMs),
      callEndsAt: moveOptionalDate(assignment.callEndsAt, endDeltaMs),
    })),
  }));

  await persistMovedShifts(tx, movedShifts);

  const movedAssignments = movedShifts.flatMap((shift) => shift.assignments.map((assignment) => ({
    ...assignment,
    effectiveStartsAt: assignment.callStartsAt ?? shift.callStartsAt ?? shift.startsAt,
    effectiveEndsAt: assignment.callEndsAt ?? shift.callEndsAt ?? shift.endsAt,
  })));
  await persistMovedAssignments(tx, movedAssignments);

  await updateShiftAssignmentConflictsTx(
    tx,
    movedAssignments.map((assignment) => {
      const conflictNote = shiftWorkerTypeForProfile(assignment.user) === "ST"
        ? availabilityConflictNote(assignment.user.availabilityBlocks, {
            startsAt: assignment.effectiveStartsAt,
            endsAt: assignment.effectiveEndsAt,
          })
        : null;
      return {
        id: assignment.id,
        hasConflict: Boolean(conflictNote),
        conflictNote,
      };
    }),
    group.publishedAt !== null,
  );

  const movedWorkingCopy = moveWorkingCopy(
    group,
    args.nextStartsAt,
    args.nextEndsAt,
    startDeltaMs,
    endDeltaMs,
  );
  if (movedWorkingCopy && group.workingCopy) {
    const updated = await tx.shiftGroupWorkingCopy.updateMany({
      where: { shiftGroupId: group.id, version: group.workingCopy.version },
      data: {
        version: { increment: 1 },
        payload: movedWorkingCopy as unknown as Prisma.InputJsonValue,
        updatedById: args.actor.id,
        ...(group.publishedAt ? { basePublishedVersion: group.publishedVersion + 1 } : {}),
      },
    });
    if (updated.count !== 1) {
      throw new HttpError(409, "The crew schedule changed while the event was being moved. Refresh and try again.");
    }
  }

  if (group.publishedAt) {
    await tx.shiftGroup.update({
      where: { id: group.id },
      data: {
        publishedVersion: { increment: 1 },
        lastPublishedSnapshot: buildSchedulePublicationSnapshot({ shifts: movedShifts }) as unknown as Prisma.InputJsonValue,
      },
    });
  }

  const affectedUserIds = [...new Set(movedAssignments.map((assignment) => assignment.userId))];
  await createAuditEntryTx(tx, {
    actorId: args.actor.id,
    actorRole: args.actor.role,
    entityType: "shift_group",
    entityId: group.id,
    action: "calendar_event_schedule_shifted",
    before: {
      eventStartsAt: args.previousStartsAt.toISOString(),
      eventEndsAt: args.previousEndsAt.toISOString(),
      shiftIds: group.shifts.map((shift) => shift.id),
    },
    after: {
      eventStartsAt: args.nextStartsAt.toISOString(),
      eventEndsAt: args.nextEndsAt.toISOString(),
      shiftIds: movedShifts.map((shift) => shift.id),
      affectedUserIds,
    },
  });

  return {
    shiftGroupId: group.id,
    affectedUserIds,
    published: group.publishedAt !== null,
  };
}
