import { Prisma, ShiftAssignmentStatus } from "@prisma/client";
import { createAuditEntryTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { ACTIVE_ASSIGNMENT_STATUSES } from "@/lib/shift-constants";
import { shareScheduleSportFamily } from "@/lib/schedule-sport-family";

const COMBINE_ASSIGNMENT_STATUSES: ShiftAssignmentStatus[] = [
  ...ACTIVE_ASSIGNMENT_STATUSES,
  ShiftAssignmentStatus.REQUESTED,
];

const eventSelect = Prisma.validator<Prisma.CalendarEventSelect>()({
  id: true,
  summary: true,
  sportCode: true,
  opponent: true,
  startsAt: true,
  endsAt: true,
  locationId: true,
  rawLocationText: true,
  combinedIntoId: true,
  combinedEvents: { select: { id: true } },
  shiftGroup: {
    select: {
      id: true,
      publishedAt: true,
      archivedAt: true,
      workingCopy: { select: { version: true } },
      shifts: {
        select: {
          id: true,
          assignments: {
            where: { status: { in: COMBINE_ASSIGNMENT_STATUSES } },
            select: { id: true, status: true },
          },
        },
      },
    },
  },
});

type CombineEvent = Prisma.CalendarEventGetPayload<{ select: typeof eventSelect }>;

export type CombinedScheduleEventPreview = ReturnType<typeof buildPreview>;

function normalizedVenue(event: CombineEvent) {
  if (event.locationId) return `location:${event.locationId}`;
  const raw = event.rawLocationText
    ?.toLowerCase()
    .replace(/\bwis\.?\b/g, "wi")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return raw ? `raw:${raw}` : null;
}

function activeAssignmentCount(event: CombineEvent) {
  return event.shiftGroup?.shifts.reduce((count, shift) => count + shift.assignments.length, 0) ?? 0;
}

function assignedCrewCount(event: CombineEvent) {
  return event.shiftGroup?.shifts.reduce(
    (count, shift) => count + shift.assignments.filter((assignment) => assignment.status !== ShiftAssignmentStatus.REQUESTED).length,
    0,
  ) ?? 0;
}

function parentRank(event: CombineEvent) {
  return [
    event.shiftGroup?.publishedAt ? 1 : 0,
    activeAssignmentCount(event) > 0 ? 1 : 0,
    event.shiftGroup ? 1 : 0,
    -event.startsAt.getTime(),
  ] as const;
}

function chooseParent(left: CombineEvent, right: CombineEvent) {
  const leftRank = parentRank(left);
  const rightRank = parentRank(right);
  for (let index = 0; index < leftRank.length; index += 1) {
    if (leftRank[index] !== rightRank[index]) return leftRank[index]! > rightRank[index]! ? left : right;
  }
  return left.id < right.id ? left : right;
}

function validatePair(left: CombineEvent, right: CombineEvent) {
  if (left.id === right.id) throw new HttpError(400, "Choose two different events.");
  if (left.combinedIntoId || right.combinedIntoId || left.combinedEvents.length || right.combinedEvents.length) {
    throw new HttpError(409, "One of these events is already combined. Choose two standalone events.");
  }
  if (!(left.startsAt < right.endsAt && right.startsAt < left.endsAt)) {
    throw new HttpError(409, "Events must overlap to share one crew.");
  }
  const leftVenue = normalizedVenue(left);
  if (!leftVenue || leftVenue !== normalizedVenue(right)) {
    throw new HttpError(409, "Events must use the same venue to share one crew.");
  }
  if (!shareScheduleSportFamily(left.sportCode, right.sportCode)) {
    throw new HttpError(409, "Events must belong to the same sport family.");
  }
  const leftOpponent = left.opponent?.trim().toLowerCase() ?? null;
  const rightOpponent = right.opponent?.trim().toLowerCase() ?? null;
  if (leftOpponent && rightOpponent && leftOpponent !== rightOpponent) {
    throw new HttpError(409, "Events must describe the same meet or opponent.");
  }
}

function buildPreview(left: CombineEvent, right: CombineEvent) {
  validatePair(left, right);
  const primary = chooseParent(left, right);
  const secondary = primary.id === left.id ? right : left;
  const secondaryAssignments = activeAssignmentCount(secondary);
  if (secondary.shiftGroup?.archivedAt) {
    throw new HttpError(409, "The secondary crew setup is already archived. Restore it before combining.");
  }
  if (secondary.shiftGroup?.publishedAt || secondaryAssignments > 0) {
    throw new HttpError(409, "Both events already have live crew work. Reconcile the crews before combining them.");
  }
  return {
    primary: {
      id: primary.id,
      summary: primary.summary,
      startsAt: primary.startsAt.toISOString(),
      endsAt: primary.endsAt.toISOString(),
      shiftGroupId: primary.shiftGroup?.id ?? null,
      assignedCrewCount: assignedCrewCount(primary),
    },
    secondary: {
      id: secondary.id,
      summary: secondary.summary,
      startsAt: secondary.startsAt.toISOString(),
      endsAt: secondary.endsAt.toISOString(),
      shiftGroupId: secondary.shiftGroup?.id ?? null,
      workingVersion: secondary.shiftGroup?.workingCopy?.version ?? null,
      draftSlotCount: secondary.shiftGroup?.shifts.length ?? 0,
    },
    combinedWindow: {
      startsAt: new Date(Math.min(left.startsAt.getTime(), right.startsAt.getTime())).toISOString(),
      endsAt: new Date(Math.max(left.endsAt.getTime(), right.endsAt.getTime())).toISOString(),
    },
  };
}

export async function uncombineScheduleEvents(input: {
  primaryEventId: string;
  secondaryEventId: string;
  actor: { id: string; role: "ADMIN" | "STAFF" };
}) {
  return db.$transaction(async (tx) => {
    const secondary = await tx.calendarEvent.findUnique({
      where: { id: input.secondaryEventId },
      select: eventSelect,
    });
    if (!secondary) throw new HttpError(404, "The combined source event was not found.");
    if (secondary.combinedIntoId !== input.primaryEventId) {
      throw new HttpError(409, "These events are no longer combined.");
    }
    const assignments = activeAssignmentCount(secondary);
    if (secondary.shiftGroup?.publishedAt || assignments > 0) {
      throw new HttpError(409, "The retained crew setup now has live crew work. Reconcile it before undoing this combination.");
    }
    if (secondary.shiftGroup && !secondary.shiftGroup.archivedAt) {
      throw new HttpError(409, "The retained crew setup is no longer archived. Reconcile it before undoing this combination.");
    }

    const separated = await tx.calendarEvent.updateMany({
      where: { id: secondary.id, combinedIntoId: input.primaryEventId },
      data: { combinedIntoId: null },
    });
    if (separated.count !== 1) throw new HttpError(409, "These events are no longer combined.");
    if (secondary.shiftGroup) {
      await tx.shiftGroup.update({
        where: { id: secondary.shiftGroup.id },
        data: { archivedAt: null, notifyAfter: null, notifyAttemptedAt: null, notifyError: null },
      });
      if (secondary.shiftGroup.workingCopy) {
        const restored = await tx.shiftGroupWorkingCopy.updateMany({
          where: {
            shiftGroupId: secondary.shiftGroup.id,
            version: secondary.shiftGroup.workingCopy.version,
          },
          data: { autoReleaseAt: null, autoReleaseRunId: null, autoReleaseError: null },
        });
        if (restored.count !== 1) {
          throw new HttpError(409, "The retained crew draft changed. Refresh and try again.");
        }
      }
    }

    const result = {
      primaryEventId: input.primaryEventId,
      secondaryEventId: secondary.id,
      restoredShiftGroupId: secondary.shiftGroup?.id ?? null,
      retainedWorkingVersion: secondary.shiftGroup?.workingCopy?.version ?? null,
    };
    await createAuditEntryTx(tx, {
      actorId: input.actor.id,
      actorRole: input.actor.role,
      entityType: "calendar_event",
      entityId: input.primaryEventId,
      action: "calendar_events_uncombined",
      before: {
        primaryEventId: input.primaryEventId,
        secondaryEventId: secondary.id,
        combinedIntoId: input.primaryEventId,
        retainedShiftGroupId: secondary.shiftGroup?.id ?? null,
      },
      after: { ...result, combinedIntoId: null, autoReleaseAt: null },
    });
    return result;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function readPair(eventIds: readonly [string, string], client: Prisma.TransactionClient | typeof db = db) {
  const events = await client.calendarEvent.findMany({
    where: { id: { in: [...eventIds] } },
    select: eventSelect,
  });
  if (events.length !== 2) throw new HttpError(404, "One or both events were not found.");
  return [events[0]!, events[1]!] as const;
}

export async function previewCombinedScheduleEvents(eventIds: readonly [string, string]) {
  const [left, right] = await readPair(eventIds);
  return buildPreview(left, right);
}

export async function combineScheduleEvents(input: {
  eventIds: readonly [string, string];
  expectedPrimaryId: string;
  expectedSecondaryWorkingVersion: number | null;
  actor: { id: string; role: "ADMIN" | "STAFF" };
}) {
  return db.$transaction(async (tx) => {
    const [left, right] = await readPair(input.eventIds, tx);
    const preview = buildPreview(left, right);
    if (preview.primary.id !== input.expectedPrimaryId) {
      throw new HttpError(409, "Crew state changed. Review the combine preview again.");
    }
    if (preview.secondary.workingVersion !== input.expectedSecondaryWorkingVersion) {
      throw new HttpError(409, "The secondary crew draft changed. Review the combine preview again.");
    }

    const combinedAt = new Date();
    if (preview.secondary.shiftGroupId) {
      if (preview.secondary.workingVersion !== null) {
        const retired = await tx.shiftGroupWorkingCopy.updateMany({
          where: {
            shiftGroupId: preview.secondary.shiftGroupId,
            version: preview.secondary.workingVersion,
          },
          data: {
            version: { increment: 1 },
            autoReleaseAt: null,
            autoReleaseRunId: null,
            autoReleaseError: "Retired when this event was combined into a shared crew.",
          },
        });
        if (retired.count !== 1) {
          throw new HttpError(409, "The secondary crew draft changed. Review the combine preview again.");
        }
      }
      await tx.shiftGroup.update({
        where: { id: preview.secondary.shiftGroupId },
        data: {
          archivedAt: combinedAt,
          notifyAfter: null,
          notifyAttemptedAt: null,
          notifyError: null,
        },
      });
    }
    await tx.calendarEvent.update({
      where: { id: preview.secondary.id },
      data: { combinedIntoId: preview.primary.id },
    });
    await createAuditEntryTx(tx, {
      actorId: input.actor.id,
      actorRole: input.actor.role,
      entityType: "calendar_event",
      entityId: preview.primary.id,
      action: "calendar_events_combined",
      before: {
        primaryEventId: preview.primary.id,
        secondaryEventId: preview.secondary.id,
        secondaryShiftGroupId: preview.secondary.shiftGroupId,
        secondaryWorkingVersion: preview.secondary.workingVersion,
        secondaryDraftSlotCount: preview.secondary.draftSlotCount,
      },
      after: {
        primaryEventId: preview.primary.id,
        combinedEventIds: [preview.primary.id, preview.secondary.id],
        sharedShiftGroupId: preview.primary.shiftGroupId,
        combinedWindow: preview.combinedWindow,
      },
    });
    return preview;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
