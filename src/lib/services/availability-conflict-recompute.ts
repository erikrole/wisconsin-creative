import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ACTIVE_ASSIGNMENT_STATUSES } from "@/lib/shift-constants";
import { shiftWorkerTypeForProfile } from "@/lib/shift-display";
import { evaluateAvailabilityPreferences } from "@/lib/student-availability";

type RecomputeClient = {
  user: Pick<typeof db.user, "findUnique">;
  shiftAssignment: Pick<typeof db.shiftAssignment, "findMany" | "update">;
};

const availabilityBlockSelect = {
  id: true,
  userId: true,
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

const futureActiveAssignmentSelect = {
  id: true,
  hasConflict: true,
  conflictNote: true,
  callStartsAt: true,
  callEndsAt: true,
  shift: {
    select: {
      startsAt: true,
      endsAt: true,
      callStartsAt: true,
      callEndsAt: true,
    },
  },
} satisfies Prisma.ShiftAssignmentSelect;

type FutureActiveAssignment = Prisma.ShiftAssignmentGetPayload<{
  select: typeof futureActiveAssignmentSelect;
}>;

type AvailabilityConflictRecomputeResult = {
  checked: number;
  updated: number;
};

function futureActiveAssignmentWhere(userId: string, now: Date): Prisma.ShiftAssignmentWhereInput {
  return {
    userId,
    status: { in: ACTIVE_ASSIGNMENT_STATUSES },
    OR: [
      { callEndsAt: { gt: now } },
      {
        callEndsAt: null,
        shift: { callEndsAt: { gt: now } },
      },
      {
        callEndsAt: null,
        shift: { callEndsAt: null, endsAt: { gt: now } },
      },
    ],
  };
}

function effectiveAssignmentWindow(assignment: FutureActiveAssignment) {
  return {
    startsAt: assignment.callStartsAt ?? assignment.shift.callStartsAt ?? assignment.shift.startsAt,
    endsAt: assignment.callEndsAt ?? assignment.shift.callEndsAt ?? assignment.shift.endsAt,
  };
}

export async function recomputeFutureAssignmentAvailabilityConflictsForUser(
  userId: string,
  options: { now?: Date; client?: RecomputeClient } = {},
): Promise<AvailabilityConflictRecomputeResult> {
  const client = options.client ?? db;
  const now = options.now ?? new Date();

  const user = await client.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      staffingType: true,
      availabilityBlocks: {
        select: availabilityBlockSelect,
      },
    },
  });

  if (!user || shiftWorkerTypeForProfile(user) !== "ST") {
    return { checked: 0, updated: 0 };
  }

  const assignments = await client.shiftAssignment.findMany({
    where: futureActiveAssignmentWhere(userId, now),
    select: futureActiveAssignmentSelect,
  });

  let updated = 0;
  for (const assignment of assignments) {
    const availability = evaluateAvailabilityPreferences(
      user.availabilityBlocks ?? [],
      effectiveAssignmentWindow(assignment),
    );
    const conflictNote = availability.blocking?.note ?? availability.advisory?.note ?? null;
    const hasConflict = conflictNote !== null;

    if (assignment.hasConflict === hasConflict && assignment.conflictNote === conflictNote) {
      continue;
    }

    await client.shiftAssignment.update({
      where: { id: assignment.id },
      data: { hasConflict, conflictNote },
    });
    updated += 1;
  }

  return { checked: assignments.length, updated };
}
