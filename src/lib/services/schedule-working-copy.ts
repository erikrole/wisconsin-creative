import { randomUUID } from "node:crypto";
import { Prisma, Role, ShiftAssignmentStatus, ShiftWorkerType } from "@prisma/client";
import { createAuditEntryTx } from "@/lib/audit";
import { ACTIVE_BOOKING_STATUSES } from "@/lib/booking-statuses";
import { db } from "@/lib/db";
import { canonicalFootballGameDayRoles, isFootballSportCode } from "@/lib/football-roles";
import { HttpError } from "@/lib/http";
import { scheduleAssigneeWorkerType } from "@/lib/schedule-assignee";
import { normalizeFootballSheetPersonName } from "@/lib/football-staffing-sheet";
import { sportDefaultShiftWindow } from "@/lib/schedule-defaults";
import {
  applyWorkingScheduleCommand,
  reconcileWorkingAssignmentSources,
  summarizeWorkingScheduleChanges,
  type WorkingScheduleCommand,
  type WorkingScheduleDefaultWindow,
  type WorkingSchedulePayload,
  workingSchedulePayloadSchema,
} from "@/lib/schedule-working-copy";
import { ACTIVE_ASSIGNMENT_STATUSES } from "@/lib/shift-constants";
import { checkTimeConflict } from "@/lib/services/shift-assignments";
import { getCandidateScoresForTarget } from "@/lib/services/candidate-scoring";
import { evaluateAvailabilityPreferences } from "@/lib/student-availability";

const groupEditorSelect = {
  id: true,
  publishedAt: true,
  publishedVersion: true,
  event: {
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      allDay: true,
      sportCode: true,
      opponent: true,
      isHome: true,
    },
  },
  shifts: {
    orderBy: [{ startsAt: "asc" }, { area: "asc" }, { workerType: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      createdAt: true,
      area: true,
      workerType: true,
      startsAt: true,
      endsAt: true,
      callStartsAt: true,
      callEndsAt: true,
      notes: true,
      _count: { select: { assignments: true } },
      assignments: {
        where: { status: { in: ACTIVE_ASSIGNMENT_STATUSES as ShiftAssignmentStatus[] } },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: {
          id: true,
          userId: true,
          status: true,
          source: true,
          callStartsAt: true,
          callEndsAt: true,
          callNote: true,
          footballRoles: true,
          trades: {
            where: { status: { in: ["OPEN", "CLAIMED"] } },
            select: { id: true },
            take: 1,
          },
          _count: {
            select: {
              bookings: { where: { status: { in: ACTIVE_BOOKING_STATUSES } } },
            },
          },
        },
      },
    },
  },
  workingCopy: {
    select: {
      version: true,
      basePublishedVersion: true,
      payloadVersion: true,
      payload: true,
      autoReleaseAt: true,
      autoReleaseRunId: true,
      autoReleaseError: true,
      createdAt: true,
      updatedAt: true,
      updatedById: true,
    },
  },
} satisfies Prisma.ShiftGroupSelect;

type EditorGroup = Prisma.ShiftGroupGetPayload<{ select: typeof groupEditorSelect }>;

type WorkingScheduleAutoRelease = { at: Date; runId: string };

function iso(value: Date | null) {
  return value?.toISOString() ?? null;
}

function effectiveSlotWindow(slot: WorkingSchedulePayload["slots"][number]) {
  if (slot.workerType === "FT") {
    return { startsAt: slot.startsAt, endsAt: slot.endsAt };
  }
  return {
    startsAt: slot.assignment?.callStartsAt ?? slot.callStartsAt ?? slot.startsAt,
    endsAt: slot.assignment?.callEndsAt ?? slot.callEndsAt ?? slot.endsAt,
  };
}

/**
 * Working-copy payloads intentionally preserve staff intent, but relationship
 * facts such as active trades and linked bookings belong to the live rows.
 * Refresh those facts before guards run so a canceled booking kept for audit
 * cannot remain a live edit blocker in an older draft.
 */
function refreshLiveAssignmentMetadata(
  payload: WorkingSchedulePayload,
  group: EditorGroup,
): WorkingSchedulePayload {
  const liveAssignments = new Map(
    group.shifts.flatMap((shift) =>
      shift.assignments.map((assignment) => [assignment.id, assignment] as const),
    ),
  );

  return {
    ...payload,
    slots: payload.slots.map((slot) => {
      const assignment = slot.assignment;
      if (!assignment?.sourceAssignmentId) return slot;
      const live = liveAssignments.get(assignment.sourceAssignmentId);
      return {
        ...slot,
        assignment: {
          ...assignment,
          activeTradeId: live?.trades[0]?.id ?? null,
          bookingCount: live?._count.bookings ?? 0,
        },
      };
    }),
  };
}

async function resolveWorkingScheduleDefaultWindow(
  group: EditorGroup,
  tx: Prisma.TransactionClient = db,
): Promise<WorkingScheduleDefaultWindow> {
  const config = group.event.sportCode
    ? await tx.sportConfig.findUnique({
      where: { sportCode: group.event.sportCode },
      select: { shiftStartOffset: true, shiftEndOffset: true },
    })
    : null;
  const window = config
    ? sportDefaultShiftWindow(group.event, config)
    : { startsAt: group.event.startsAt, endsAt: group.event.endsAt };
  return {
    startsAt: window.startsAt.toISOString(),
    endsAt: window.endsAt.toISOString(),
  };
}

export function buildWorkingSchedulePayload(group: EditorGroup): WorkingSchedulePayload {
  return workingSchedulePayloadSchema.parse({
    eventStartsAt: group.event.startsAt.toISOString(),
    eventEndsAt: group.event.endsAt.toISOString(),
    baseShiftIds: group.shifts.map((shift) => shift.id),
    slots: group.shifts.map((shift) => {
      const assignment = shift.assignments[0] ?? null;
      return {
        key: shift.id,
        sourceShiftId: shift.id,
        area: shift.area,
        workerType: shift.workerType,
        startsAt: shift.workerType === "FT" ? group.event.startsAt.toISOString() : shift.startsAt.toISOString(),
        endsAt: shift.workerType === "FT" ? group.event.endsAt.toISOString() : shift.endsAt.toISOString(),
        callStartsAt: shift.workerType === "FT" ? null : iso(shift.callStartsAt),
        callEndsAt: shift.workerType === "FT" ? null : iso(shift.callEndsAt),
        notes: shift.notes,
        assignmentHistoryCount: shift._count.assignments,
        assignment: assignment ? {
          sourceAssignmentId: assignment.id,
          source: assignment.source,
          userId: assignment.userId,
          status: assignment.status === "APPROVED" ? "APPROVED" : "DIRECT_ASSIGNED",
          callStartsAt: shift.workerType === "FT" ? null : iso(assignment.callStartsAt),
          callEndsAt: shift.workerType === "FT" ? null : iso(assignment.callEndsAt),
          callNote: assignment.callNote,
          activeTradeId: assignment.trades[0]?.id ?? null,
          bookingCount: assignment._count.bookings,
          footballRoles: isFootballSportCode(group.event.sportCode)
            ? canonicalFootballGameDayRoles(assignment.footballRoles)
            : [],
        } : null,
      };
    }),
  });
}

function parseStoredPayload(value: Prisma.JsonValue): WorkingSchedulePayload {
  const parsed = workingSchedulePayloadSchema.safeParse(value);
  if (!parsed.success) {
    throw new HttpError(409, "This working schedule is invalid. Discard it or contact Erik Role.");
  }
  return parsed.data;
}

function assertFootballRoleScope(
  sportCode: string | null,
  payload: WorkingSchedulePayload,
) {
  const hasFootballRoles = payload.slots.some((slot) => (slot.assignment?.footballRoles?.length ?? 0) > 0);
  if (hasFootballRoles && !isFootballSportCode(sportCode)) {
    throw new HttpError(409, "Football game-day roles can only be used on Football events.");
  }
}

async function editorResponse(group: EditorGroup, tx: Prisma.TransactionClient = db) {
  const published = buildWorkingSchedulePayload(group);
  const working = group.workingCopy
    ? refreshLiveAssignmentMetadata(
      reconcileWorkingAssignmentSources(parseStoredPayload(group.workingCopy.payload), group.shifts),
      group,
    )
    : published;
  assertFootballRoleScope(group.event.sportCode, working);
  const defaultWindow = await resolveWorkingScheduleDefaultWindow(group, tx);
  const assignedUserIds = [...new Set(
    working.slots.flatMap((slot) => slot.assignment ? [slot.assignment.userId] : []),
  )];
  const assignedUsers = assignedUserIds.length > 0
    ? await tx.user.findMany({
      where: { id: { in: assignedUserIds } },
      select: {
        id: true,
        name: true,
        role: true,
        staffingType: true,
        primaryArea: true,
        avatarUrl: true,
      },
    })
    : [];
  const changes = summarizeWorkingScheduleChanges(published, working);
  const affectedWorkerIds = new Set<string>();
  const publishedBySourceId = new Map(
    published.slots.flatMap((slot) => slot.sourceShiftId ? [[slot.sourceShiftId, slot] as const] : []),
  );
  for (const slot of working.slots) {
    const previous = slot.sourceShiftId ? publishedBySourceId.get(slot.sourceShiftId) : null;
    const previousWindow = previous ? effectiveSlotWindow(previous) : null;
    const workingWindow = effectiveSlotWindow(slot);
    if (
      previous?.assignment?.userId !== slot.assignment?.userId
      || previous?.assignment?.callStartsAt !== slot.assignment?.callStartsAt
      || previous?.assignment?.callEndsAt !== slot.assignment?.callEndsAt
      || previous?.assignment?.callNote !== slot.assignment?.callNote
      || previousWindow?.startsAt !== workingWindow.startsAt
      || previousWindow?.endsAt !== workingWindow.endsAt
    ) {
      if (previous?.assignment?.userId) affectedWorkerIds.add(previous.assignment.userId);
      if (slot.assignment?.userId) affectedWorkerIds.add(slot.assignment.userId);
    }
  }
  for (const slot of published.slots) {
    if (slot.sourceShiftId && !working.slots.some((candidate) => candidate.sourceShiftId === slot.sourceShiftId)) {
      if (slot.assignment?.userId) affectedWorkerIds.add(slot.assignment.userId);
    }
  }
  const initialPublishWorkerCount = group.publishedAt
    ? 0
    : new Set(working.slots.flatMap((slot) => slot.assignment ? [slot.assignment.userId] : [])).size;
  return {
    shiftGroupId: group.id,
    sportCode: group.event.sportCode,
    allDay: group.event.allDay,
    eventStartsAt: group.event.startsAt.toISOString(),
    eventEndsAt: group.event.endsAt.toISOString(),
    publicationState: group.workingCopy
      ? "unpublished_changes"
      : group.publishedAt
        ? "published"
        : "draft",
    publishedAt: group.publishedAt?.toISOString() ?? null,
    publishedVersion: group.publishedVersion,
    workingVersion: group.workingCopy?.version ?? 0,
    basePublishedVersion: group.workingCopy?.basePublishedVersion ?? group.publishedVersion,
    hasWorkingCopy: Boolean(group.workingCopy),
    updatedAt: group.workingCopy?.updatedAt.toISOString() ?? null,
    updatedById: group.workingCopy?.updatedById ?? null,
    // A finished event never releases -- the flush skips it rather than paging
    // the crew about a game they already worked -- so no countdown is reported
    // for one. Reporting it here would have every surface promise a
    // notification that is not coming.
    autoReleaseAt: group.event.endsAt.getTime() <= Date.now()
      ? null
      : group.workingCopy?.autoReleaseAt?.toISOString() ?? null,
    autoReleaseRunId: group.workingCopy?.autoReleaseRunId ?? null,
    autoReleaseError: group.workingCopy?.autoReleaseError ?? null,
    changes,
    affectedWorkerCount: group.publishedAt ? affectedWorkerIds.size : initialPublishWorkerCount,
    assignedUsers,
    defaultWindow,
    schedule: working,
  };
}

async function findEditorGroup(shiftGroupId: string, tx: Prisma.TransactionClient = db) {
  const group = await tx.shiftGroup.findUnique({ where: { id: shiftGroupId }, select: groupEditorSelect });
  if (!group) throw new HttpError(404, "Shift group not found");
  return group;
}

export async function getWorkingScheduleEditor(shiftGroupId: string) {
  return editorResponse(await findEditorGroup(shiftGroupId));
}

export type FootballStaffingWorkingContext = {
  shiftGroupId: string;
  sportCode: string | null;
  workingVersion: number;
  slots: Array<{
    key: string;
    area: string;
    workerType: string;
    assignment: {
      userId: string;
      userName: string;
      footballRoles: string[];
    } | null;
  }>;
};

/**
 * Bounded read model for the Football staffing-sheet review. Loading all
 * groups and assignee names in two queries keeps the preview from turning one
 * sheet column into an editor-response N+1.
 */
export async function getFootballStaffingWorkingContexts(
  shiftGroupIds: string[],
): Promise<FootballStaffingWorkingContext[]> {
  if (shiftGroupIds.length === 0) return [];
  const groups = await db.shiftGroup.findMany({
    where: { id: { in: [...new Set(shiftGroupIds)] } },
    select: groupEditorSelect,
  });
  const schedules = groups.map((group) => ({
    group,
    working: group.workingCopy
      ? refreshLiveAssignmentMetadata(
        reconcileWorkingAssignmentSources(parseStoredPayload(group.workingCopy.payload), group.shifts),
        group,
      )
      : buildWorkingSchedulePayload(group),
  }));
  const userIds = [...new Set(schedules.flatMap(({ working }) =>
    working.slots.flatMap((slot) => slot.assignment ? [slot.assignment.userId] : []),
  ))];
  const users = userIds.length > 0
    ? await db.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true },
    })
    : [];
  const userNames = new Map(users.map((user) => [user.id, user.name]));

  return schedules.map(({ group, working }) => {
    assertFootballRoleScope(group.event.sportCode, working);
    return {
      shiftGroupId: group.id,
      sportCode: group.event.sportCode,
      workingVersion: group.workingCopy?.version ?? 0,
      slots: working.slots.map((slot) => ({
        key: slot.key,
        area: slot.area,
        workerType: slot.workerType,
        assignment: slot.assignment
          ? {
              userId: slot.assignment.userId,
              userName: userNames.get(slot.assignment.userId) ?? "Current assignee",
              footballRoles: canonicalFootballGameDayRoles(slot.assignment.footballRoles ?? []),
            }
          : null,
      })),
    };
  });
}

/** Read the live event boundary used to choose between release and backfill. */
export async function getWorkingScheduleEventEndsAt(shiftGroupId: string): Promise<Date> {
  const group = await db.shiftGroup.findUnique({
    where: { id: shiftGroupId },
    select: { event: { select: { endsAt: true } } },
  });
  if (!group) throw new HttpError(404, "Shift group not found");
  return group.event.endsAt;
}

export async function getWorkingScheduleCandidateScores(
  shiftGroupId: string,
  slotKey: string,
  workerTypeOverride?: ShiftWorkerType,
) {
  const group = await findEditorGroup(shiftGroupId);
  const schedule = group.workingCopy
    ? parseStoredPayload(group.workingCopy.payload)
    : buildWorkingSchedulePayload(group);
  const slot = schedule.slots.find((candidate) => candidate.key === slotKey);
  if (!slot) throw new HttpError(404, "Working slot not found");

  return getCandidateScoresForTarget({
    id: slot.sourceShiftId ?? slot.key,
    area: slot.area,
    workerType: workerTypeOverride ?? slot.workerType,
    startsAt: new Date(slot.startsAt),
    endsAt: new Date(slot.endsAt),
    callStartsAt: slot.workerType === "ST" && slot.callStartsAt ? new Date(slot.callStartsAt) : null,
    callEndsAt: slot.workerType === "ST" && slot.callEndsAt ? new Date(slot.callEndsAt) : null,
    sportCode: group.event.sportCode,
  });
}

export async function mutateWorkingSchedule(
  shiftGroupId: string,
  expectedVersion: number,
  command: WorkingScheduleCommand,
  actor: { id: string; role: Role },
  autoRelease?: WorkingScheduleAutoRelease | null,
) {
  return db.$transaction(async (tx) => {
    const group = await findEditorGroup(shiftGroupId, tx);
    const actualVersion = group.workingCopy?.version ?? 0;
    if (expectedVersion !== actualVersion) {
      throw new HttpError(409, "This schedule changed in another session. Refresh before editing again.");
    }

    const beforePayload = group.workingCopy
      ? refreshLiveAssignmentMetadata(
        reconcileWorkingAssignmentSources(parseStoredPayload(group.workingCopy.payload), group.shifts),
        group,
      )
      : buildWorkingSchedulePayload(group);
    assertFootballRoleScope(group.event.sportCode, beforePayload);
    const isFootballRoleCommand = command.type === "setFootballRoles"
      || command.type === "applyFootballSheetAssignment"
      || command.type === "clearFootballSheetRole";
    if (isFootballRoleCommand) {
      if (actor.role !== Role.ADMIN) {
        throw new HttpError(403, "Only Admins can edit Football game-day roles.");
      }
      if (!isFootballSportCode(group.event.sportCode)) {
        throw new HttpError(409, "Football game-day roles are available only for Football events.");
      }
    }
    if (command.type === "applyFootballSheetAssignment" || command.type === "clearFootballSheetRole") {
      const reviewedEvent = command.proof.event;
      if (
        group.event.id !== reviewedEvent.id
        || group.event.startsAt.toISOString() !== reviewedEvent.startsAt
        || group.event.opponent !== reviewedEvent.opponent
        || group.event.isHome !== reviewedEvent.isHome
      ) {
        throw new HttpError(409, "This Football event changed after review. Preview the sheet again.");
      }
    }
    if (command.type === "setFootballRoles") {
      const slot = beforePayload.slots.find((candidate) => candidate.key === command.slotKey);
      if (!slot) throw new HttpError(404, "Working slot not found");
      if (!slot.assignment) throw new HttpError(409, "Assign a person before adding Football game-day roles.");
    }
    if (command.type === "applyFootballSheetAssignment") {
      const slot = beforePayload.slots.find((candidate) => candidate.key === command.slotKey);
      if (!slot) throw new HttpError(404, "Working slot not found");
      if (slot.assignment && slot.assignment.userId !== command.userId) {
        throw new HttpError(409, "The selected working slot is no longer available.");
      }
      if (slot.assignment?.footballRoles?.includes(command.role)) {
        throw new HttpError(409, `${command.role} is already staged for this person.`);
      }
      const assignee = await tx.user.findUnique({
        where: { id: command.userId },
        select: {
          id: true,
          name: true,
          active: true,
          hiddenFromRoster: true,
          role: true,
          staffingType: true,
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
      if (!assignee || !assignee.active || assignee.hiddenFromRoster) {
        throw new HttpError(409, "The reviewed person is no longer active and visible.");
      }
      if (normalizeFootballSheetPersonName(assignee.name) !== normalizeFootballSheetPersonName(command.proof.sourceRaw)) {
        throw new HttpError(409, "The reviewed person's exact name no longer matches this source cell.");
      }
      if (!slot.assignment) {
        if (scheduleAssigneeWorkerType(assignee) !== slot.workerType) {
          throw new HttpError(409, `Choose a ${slot.workerType === "FT" ? "Staff" : "Student"} worker for this slot.`);
        }
        if (beforePayload.slots.some((candidate) => candidate.assignment?.userId === assignee.id)) {
          throw new HttpError(409, "This person is already assigned within this event draft.");
        }
        const startsAt = new Date(slot.callStartsAt ?? slot.startsAt);
        const endsAt = new Date(slot.callEndsAt ?? slot.endsAt);
        await checkTimeConflict(tx, assignee.id, startsAt, endsAt);
        if (slot.workerType === "ST") {
          const availability = evaluateAvailabilityPreferences(assignee.availabilityBlocks, { startsAt, endsAt });
          if (availability.blocking) throw new HttpError(409, availability.blocking.note);
        }
      }
    }
    if (command.type === "clearFootballSheetRole") {
      const holders = beforePayload.slots.filter((slot) => slot.assignment?.footballRoles?.includes(command.role));
      if (holders.length === 0) {
        throw new HttpError(409, `${command.role} is already intentionally vacant in this working schedule.`);
      }
    }
    const defaultWindow = command.type === "adjustSlots" && command.delta === 1
      ? await resolveWorkingScheduleDefaultWindow(group, tx)
      : undefined;

    if (command.type === "convertAndReplace") {
      const slot = beforePayload.slots.find((candidate) => candidate.key === command.slotKey);
      if (!slot) throw new HttpError(404, "Working slot not found");
      if (!slot.assignment) throw new HttpError(409, "This slot is not assigned");
      if (slot.workerType === command.workerType) {
        throw new HttpError(400, "Choose the other worker class when converting this slot.");
      }
      if (slot.assignment.activeTradeId) {
        throw new HttpError(409, "Cancel the active trade before replacing this person.");
      }
      if ((slot.assignment.bookingCount ?? 0) > 0) {
        throw new HttpError(409, "Unlink the assignment's booking before replacing this person.");
      }
      const replacement = await tx.user.findUnique({
        where: { id: command.userId },
        select: {
          id: true,
          active: true,
          role: true,
          staffingType: true,
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
      if (!replacement) throw new HttpError(404, "User not found");
      if (!replacement.active) throw new HttpError(400, "Cannot assign an inactive user");
      if (scheduleAssigneeWorkerType(replacement) !== command.workerType) {
        throw new HttpError(409, `Choose a ${command.workerType === "FT" ? "Staff" : "Student"} worker for this slot.`);
      }
      if (beforePayload.slots.some((candidate) =>
        candidate.key !== slot.key && candidate.assignment?.userId === replacement.id,
      )) {
        throw new HttpError(409, "This person is already assigned within this event draft.");
      }
      const startsAt = new Date(slot.callStartsAt ?? slot.startsAt);
      const endsAt = new Date(slot.callEndsAt ?? slot.endsAt);
      await checkTimeConflict(tx, replacement.id, startsAt, endsAt);
      if (command.workerType === "ST") {
        const availability = evaluateAvailabilityPreferences(replacement.availabilityBlocks, { startsAt, endsAt });
        if (availability.blocking) throw new HttpError(409, availability.blocking.note);
      }
    }

    if (command.type === "assign") {
      const slot = beforePayload.slots.find((candidate) => candidate.key === command.slotKey);
      if (!slot) throw new HttpError(404, "Working slot not found");
      if (slot.assignment) throw new HttpError(409, "This slot is already assigned");
      const assignee = await tx.user.findUnique({
        where: { id: command.userId },
        select: {
          id: true,
          active: true,
          role: true,
          staffingType: true,
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
      if (scheduleAssigneeWorkerType(assignee) !== slot.workerType) {
        throw new HttpError(409, `Choose a ${slot.workerType === "FT" ? "Staff" : "Student"} worker for this slot.`);
      }
      if (beforePayload.slots.some((candidate) => candidate.assignment?.userId === assignee.id)) {
        throw new HttpError(409, "This person is already assigned within this event draft.");
      }
      const startsAt = new Date(slot.callStartsAt ?? slot.startsAt);
      const endsAt = new Date(slot.callEndsAt ?? slot.endsAt);
      await checkTimeConflict(tx, assignee.id, startsAt, endsAt);
      if (slot.workerType === "ST") {
        const availability = evaluateAvailabilityPreferences(assignee.availabilityBlocks, { startsAt, endsAt });
        if (availability.blocking) throw new HttpError(409, availability.blocking.note);
      }
    }

    if (command.type === "unassign") {
      const slot = beforePayload.slots.find((candidate) => candidate.key === command.slotKey);
      if (!slot) throw new HttpError(404, "Working slot not found");
      if (slot.assignment?.activeTradeId) {
        throw new HttpError(409, "Cancel the active trade before unassigning this person.");
      }
      if ((slot.assignment?.bookingCount ?? 0) > 0) {
        throw new HttpError(409, "Unlink the assignment's booking before unassigning this person.");
      }
    }
    if (command.type === "adjustSlots" && command.delta === 1) {
      if (command.workerType === "FT" && (command.callStartsAt || command.callEndsAt)) {
        throw new HttpError(400, "Call times apply only to Student slots.");
      }
      if (group.event.allDay && (command.callStartsAt || command.callEndsAt)) {
        throw new HttpError(400, "All-day events do not have call times.");
      }
      if (Boolean(command.callStartsAt) !== Boolean(command.callEndsAt)) {
        throw new HttpError(400, "Call start and release time must both be set or both be cleared.");
      }
      if (
        command.callStartsAt
        && command.callEndsAt
        && new Date(command.callEndsAt) <= new Date(command.callStartsAt)
      ) {
        throw new HttpError(400, "Release time must be after call time.");
      }
    }
    if (command.type === "setCallWindow") {
      const slot = beforePayload.slots.find((candidate) => candidate.key === command.slotKey);
      if (!slot) throw new HttpError(404, "Working slot not found");
      if (slot.workerType !== "ST") {
        throw new HttpError(400, "Call times apply only to Student slots.");
      }
      // Same rule as `setCallWindowForAll`: the event, not the slot, decides
      // whether a call time can exist at all.
      if (group.event.allDay && (command.callStartsAt || command.callEndsAt)) {
        throw new HttpError(400, "All-day events do not have call times.");
      }
      if (Boolean(command.callStartsAt) !== Boolean(command.callEndsAt)) {
        throw new HttpError(400, "Call start and release time must both be set or both be cleared.");
      }
      if (
        command.callStartsAt
        && command.callEndsAt
        && new Date(command.callEndsAt) <= new Date(command.callStartsAt)
      ) {
        throw new HttpError(400, "Release time must be after call time.");
      }
      if (slot.assignment) {
        const assignee = await tx.user.findUnique({
          where: { id: slot.assignment.userId },
          select: {
            id: true,
            staffingType: true,
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
        if (!assignee) throw new HttpError(404, "Assigned user not found");
        // Clearing a personal override drops back to the slot's own call
        // window, not the raw shift window — the command only touches
        // `slot.assignment` when the slot is assigned.
        const startsAt = new Date(command.callStartsAt ?? slot.callStartsAt ?? slot.startsAt);
        const endsAt = new Date(command.callEndsAt ?? slot.callEndsAt ?? slot.endsAt);
        await checkTimeConflict(tx, assignee.id, startsAt, endsAt, slot.assignment.sourceAssignmentId ?? undefined);
        if (slot.workerType === "ST") {
          const availability = evaluateAvailabilityPreferences(assignee.availabilityBlocks, { startsAt, endsAt });
          if (availability.blocking) throw new HttpError(409, availability.blocking.note);
        }
      }
    }
    if (command.type === "setCallWindowForAll") {
      if (group.event.allDay && (command.callStartsAt || command.callEndsAt)) {
        throw new HttpError(400, "All-day events do not have call times.");
      }
      if (Boolean(command.callStartsAt) !== Boolean(command.callEndsAt)) {
        throw new HttpError(400, "Call start and release time must both be set or both be cleared.");
      }
      if (
        command.callStartsAt
        && command.callEndsAt
        && new Date(command.callEndsAt) <= new Date(command.callStartsAt)
      ) {
        throw new HttpError(400, "Release time must be after call time.");
      }
      // Staff and collaborators follow the event window. This command changes
      // only Student slots and their personal overrides.
      const assignedSlots = beforePayload.slots.filter((slot) => slot.workerType === "ST" && slot.assignment);
      const userIds = [...new Set(assignedSlots.map((slot) => slot.assignment!.userId))];
      const users = userIds.length > 0
        ? await tx.user.findMany({
          where: { id: { in: userIds } },
          select: {
            id: true,
            staffingType: true,
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
        })
        : [];
      const userById = new Map(users.map((user) => [user.id, user]));
      for (const slot of assignedSlots) {
        const assignee = userById.get(slot.assignment!.userId);
        if (!assignee) throw new HttpError(404, "Assigned user not found");
        const startsAt = new Date(command.callStartsAt ?? slot.startsAt);
        const endsAt = new Date(command.callEndsAt ?? slot.endsAt);
        await checkTimeConflict(tx, assignee.id, startsAt, endsAt, slot.assignment!.sourceAssignmentId ?? undefined);
        if (slot.workerType === "ST") {
          const availability = evaluateAvailabilityPreferences(assignee.availabilityBlocks, { startsAt, endsAt });
          if (availability.blocking) throw new HttpError(409, availability.blocking.note);
        }
      }
    }
    let afterPayload: WorkingSchedulePayload;
    try {
      afterPayload = applyWorkingScheduleCommand(
        beforePayload,
        command,
        () => `draft:${randomUUID()}`,
        defaultWindow,
      );
    } catch (error) {
      if (error instanceof Error && error.message === "UNASSIGN_BEFORE_REDUCING") {
        throw new HttpError(409, "Unassign an open matching slot before reducing this crew count.");
      }
      if (error instanceof Error && error.message === "UNASSIGN_BEFORE_CONVERTING") {
        throw new HttpError(409, "Unassign this person before converting the slot.");
      }
      if (error instanceof Error && error.message === "CONVERT_AND_REPLACE_REQUIRES_CONVERSION") {
        throw new HttpError(400, "Choose the other worker class when converting this slot.");
      }
      if (error instanceof Error && error.message === "CANCEL_TRADE_BEFORE_REPLACING") {
        throw new HttpError(409, "Cancel the active trade before replacing this person.");
      }
      if (error instanceof Error && error.message === "UNLINK_BOOKING_BEFORE_REPLACING") {
        throw new HttpError(409, "Unlink the assignment's booking before replacing this person.");
      }
      if (error instanceof Error && error.message === "WORKING_SLOT_NOT_FOUND") {
        throw new HttpError(404, "Working slot not found");
      }
      if (error instanceof Error && error.message === "WORKING_SLOT_ALREADY_ASSIGNED") {
        throw new HttpError(409, "This slot is already assigned");
      }
      if (error instanceof Error && error.message === "WORKING_SLOT_NOT_ASSIGNED") {
        throw new HttpError(
          409,
          isFootballRoleCommand
            ? "Assign a person before adding Football game-day roles."
            : "This slot is not assigned",
        );
      }
      if (error instanceof Error && error.message === "CALL_TIME_STUDENT_ONLY") {
        throw new HttpError(400, "Call times apply only to Student slots.");
      }
      throw error;
    }

    assertFootballRoleScope(group.event.sportCode, afterPayload);

    const nextVersion = actualVersion + 1;
    if (group.workingCopy) {
      const updated = await tx.shiftGroupWorkingCopy.updateMany({
        where: { shiftGroupId, version: expectedVersion },
        data: {
          version: nextVersion,
          payload: afterPayload as unknown as Prisma.InputJsonValue,
          updatedById: actor.id,
          ...(autoRelease !== undefined ? {
            autoReleaseAt: autoRelease?.at ?? null,
            autoReleaseRunId: autoRelease?.runId ?? null,
            autoReleaseError: null,
          } : {}),
        },
      });
      if (updated.count !== 1) {
        throw new HttpError(409, "This schedule changed in another session. Refresh before editing again.");
      }
    } else {
      try {
        await tx.shiftGroupWorkingCopy.create({
          data: {
            shiftGroupId,
            version: nextVersion,
            basePublishedVersion: group.publishedVersion,
            payloadVersion: 2,
            payload: afterPayload as unknown as Prisma.InputJsonValue,
            ...(autoRelease !== undefined ? {
              autoReleaseAt: autoRelease?.at ?? null,
              autoReleaseRunId: autoRelease?.runId ?? null,
              autoReleaseError: null,
            } : {}),
            createdById: actor.id,
            updatedById: actor.id,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new HttpError(409, "This schedule changed in another session. Refresh before editing again.");
        }
        throw error;
      }
    }

    const roleChangeBefore = command.type === "setFootballRoles" || command.type === "applyFootballSheetAssignment"
      ? {
          slotKey: command.slotKey,
          roles: beforePayload.slots.find((slot) => slot.key === command.slotKey)?.assignment?.footballRoles ?? [],
        }
      : command.type === "clearFootballSheetRole"
        ? {
            role: command.role,
            holders: beforePayload.slots
              .filter((slot) => slot.assignment?.footballRoles?.includes(command.role))
              .map((slot) => ({ slotKey: slot.key, userId: slot.assignment!.userId })),
          }
        : null;
    const roleChangeAfter = command.type === "setFootballRoles" || command.type === "applyFootballSheetAssignment"
      ? {
          slotKey: command.slotKey,
          roles: afterPayload.slots.find((slot) => slot.key === command.slotKey)?.assignment?.footballRoles ?? [],
        }
      : command.type === "clearFootballSheetRole"
        ? {
            role: command.role,
            holders: afterPayload.slots
              .filter((slot) => slot.assignment?.footballRoles?.includes(command.role))
              .map((slot) => ({ slotKey: slot.key, userId: slot.assignment!.userId })),
          }
        : null;
    const sheetProof = command.type === "applyFootballSheetAssignment" || command.type === "clearFootballSheetRole"
      ? command.proof
      : null;

    await createAuditEntryTx(tx, {
      actorId: actor.id,
      actorRole: actor.role,
      entityType: "shift_group_working_copy",
      entityId: shiftGroupId,
      action: `working_schedule_${command.type}`,
      before: {
        version: actualVersion,
        command,
        changes: summarizeWorkingScheduleChanges(buildWorkingSchedulePayload(group), beforePayload),
        ...(roleChangeBefore ? { footballRoleChange: roleChangeBefore } : {}),
        ...(sheetProof ? { footballStaffingSheet: sheetProof } : {}),
      },
      after: {
        version: nextVersion,
        changes: summarizeWorkingScheduleChanges(buildWorkingSchedulePayload(group), afterPayload),
        ...(roleChangeAfter ? { footballRoleChange: roleChangeAfter } : {}),
        ...(sheetProof ? { footballStaffingSheet: sheetProof } : {}),
      },
    });

    return editorResponse(await findEditorGroup(shiftGroupId, tx), tx);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export type WorkingScheduleRebaseSummary = {
  adoptedSlots: number;
  droppedSlots: number;
  /** Staged slots removed because an adopted live slot already holds that person. */
  deduplicatedSlots: number;
  refreshedAssignments: number;
  refreshedHistoryCounts: number;
  rebasedToPublishedVersion: number;
};

/**
 * Re-seat a private working schedule on the current live schedule.
 *
 * Every staleness guard on the publish path tells staff to refresh before
 * publishing, but until this existed the only exit was Discard, which threw
 * away the whole draft. Rebase keeps the draft's intent and re-reads the facts
 * the server owns:
 *
 * - draft-only slots are kept as-is; they are the staff member's additions
 * - slots whose live shift was deleted are dropped, because there is nothing
 *   left to reconcile them against
 * - a draft assignment that merely mirrors a live one is re-pointed at the live
 *   row, which is what the "an assignment changed after this draft started"
 *   publish guard was complaining about
 * - a draft-only assignment is preserved, because staging a replacement is a
 *   deliberate edit that publish already knows how to apply
 * - live shifts created after this draft started are adopted, since the draft
 *   never had an opinion about them; shifts that predate the draft and are
 *   absent from it were genuinely removed and stay removed
 *
 * Assignment history counts are re-read for every surviving slot so the editor
 * stops guarding removals with a frozen snapshot while publish uses live rows.
 */
export async function rebaseWorkingSchedule(
  shiftGroupId: string,
  expectedVersion: number,
  actor: { id: string; role: Role },
  autoRelease?: WorkingScheduleAutoRelease | null,
) {
  return db.$transaction(async (tx) => {
    const group = await findEditorGroup(shiftGroupId, tx);
    if (!group.workingCopy) {
      throw new HttpError(409, "This event has no unpublished changes to refresh.");
    }
    if (group.workingCopy.version !== expectedVersion) {
      throw new HttpError(409, "This schedule changed in another session. Refresh before editing again.");
    }

    const draft = refreshLiveAssignmentMetadata(
      reconcileWorkingAssignmentSources(parseStoredPayload(group.workingCopy.payload), group.shifts),
      group,
    );
    const live = buildWorkingSchedulePayload(group);
    const liveBySourceId = new Map(
      live.slots.flatMap((slot) => slot.sourceShiftId ? [[slot.sourceShiftId, slot] as const] : []),
    );
    const shiftCreatedAt = new Map(group.shifts.map((shift) => [shift.id, shift.createdAt]));
    const draftSourceIds = new Set(
      draft.slots.flatMap((slot) => slot.sourceShiftId ? [slot.sourceShiftId] : []),
    );
    const draftStartedAt = group.workingCopy.createdAt;

    const summary: WorkingScheduleRebaseSummary = {
      adoptedSlots: 0,
      droppedSlots: 0,
      deduplicatedSlots: 0,
      refreshedAssignments: 0,
      refreshedHistoryCounts: 0,
      rebasedToPublishedVersion: group.publishedVersion,
    };

    const slots: WorkingSchedulePayload["slots"] = [];
    for (const slot of draft.slots) {
      if (!slot.sourceShiftId) {
        slots.push(slot);
        continue;
      }
      const liveSlot = liveBySourceId.get(slot.sourceShiftId);
      if (!liveSlot) {
        summary.droppedSlots += 1;
        continue;
      }
      const next = structuredClone(slot);
      if (next.assignmentHistoryCount !== liveSlot.assignmentHistoryCount) {
        next.assignmentHistoryCount = liveSlot.assignmentHistoryCount;
        summary.refreshedHistoryCounts += 1;
      }
      if (
        slot.assignment?.sourceAssignmentId
        && slot.assignment.sourceAssignmentId !== (liveSlot.assignment?.sourceAssignmentId ?? null)
      ) {
        next.assignment = liveSlot.assignment ? structuredClone(liveSlot.assignment) : null;
        summary.refreshedAssignments += 1;
      }
      slots.push(next);
    }

    // A live shift the draft never saw gets adopted; one the draft did see and
    // no longer lists was deliberately removed. `baseShiftIds` answers that
    // exactly; drafts predating payloadVersion 2 fall back to the timestamp.
    const baseShiftIds = draft.baseShiftIds ? new Set(draft.baseShiftIds) : null;
    const neverInDraft = (shiftId: string) => baseShiftIds
      ? !baseShiftIds.has(shiftId)
      : (shiftCreatedAt.get(shiftId)?.getTime() ?? 0) > draftStartedAt.getTime();

    const adopted: WorkingSchedulePayload["slots"] = [];
    for (const liveSlot of live.slots) {
      if (!liveSlot.sourceShiftId || draftSourceIds.has(liveSlot.sourceShiftId)) continue;
      if (neverInDraft(liveSlot.sourceShiftId)) {
        adopted.push(structuredClone(liveSlot));
        summary.adoptedSlots += 1;
      }
    }

    // Staff commonly stage a person in the draft and, separately, assign that
    // same person on the live schedule. Adopting the live slot while keeping
    // the staged one would put the worker in the event twice, which publish
    // then reports as them conflicting with themselves. The live slot already
    // holds a real assignment, so the staged duplicate is the redundant one.
    for (const adoptedSlot of adopted) {
      const userId = adoptedSlot.assignment?.userId;
      if (!userId) continue;
      const duplicateIndex = slots.findIndex((slot) =>
        !slot.sourceShiftId
        && slot.area === adoptedSlot.area
        && slot.assignment?.sourceAssignmentId === null
        && slot.assignment.userId === userId,
      );
      if (duplicateIndex !== -1) {
        slots.splice(duplicateIndex, 1);
        summary.deduplicatedSlots += 1;
      }
    }
    slots.push(...adopted);

    const rebased = workingSchedulePayloadSchema.parse({
      eventStartsAt: live.eventStartsAt,
      eventEndsAt: live.eventEndsAt,
      // The draft is now seated on this shift set, so the base moves with it.
      baseShiftIds: live.baseShiftIds ?? group.shifts.map((shift) => shift.id),
      slots,
    });

    const nextVersion = expectedVersion + 1;
    const updated = await tx.shiftGroupWorkingCopy.updateMany({
      where: { shiftGroupId, version: expectedVersion },
      data: {
        version: nextVersion,
        basePublishedVersion: group.publishedVersion,
        payload: rebased as unknown as Prisma.InputJsonValue,
        // The rebased payload carries baseShiftIds, so a payloadVersion 1 draft
        // becomes a version 2 draft the moment it is refreshed.
        payloadVersion: 2,
        updatedById: actor.id,
        ...(autoRelease !== undefined ? {
          autoReleaseAt: autoRelease?.at ?? null,
          autoReleaseRunId: autoRelease?.runId ?? null,
          autoReleaseError: null,
        } : {}),
      },
    });
    if (updated.count !== 1) {
      throw new HttpError(409, "This schedule changed in another session. Refresh before editing again.");
    }

    await createAuditEntryTx(tx, {
      actorId: actor.id,
      actorRole: actor.role,
      entityType: "shift_group_working_copy",
      entityId: shiftGroupId,
      action: "working_schedule_rebased",
      before: {
        version: expectedVersion,
        basePublishedVersion: group.workingCopy.basePublishedVersion,
        slots: draft.slots.length,
      },
      after: { version: nextVersion, slots: rebased.slots.length, ...summary },
    });

    const editor = await editorResponse(await findEditorGroup(shiftGroupId, tx), tx);
    return { ...editor, rebase: summary };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function discardWorkingSchedule(
  shiftGroupId: string,
  expectedVersion: number,
  actor: { id: string; role: Role },
) {
  return db.$transaction(async (tx) => {
    const group = await findEditorGroup(shiftGroupId, tx);
    if (!group.workingCopy) return editorResponse(group, tx);
    if (group.workingCopy.version !== expectedVersion) {
      throw new HttpError(409, "This schedule changed in another session. Refresh before discarding it.");
    }

    const deleted = await tx.shiftGroupWorkingCopy.deleteMany({
      where: { shiftGroupId, version: expectedVersion },
    });
    if (deleted.count !== 1) {
      throw new HttpError(409, "This schedule changed in another session. Refresh before discarding it.");
    }
    await createAuditEntryTx(tx, {
      actorId: actor.id,
      actorRole: actor.role,
      entityType: "shift_group_working_copy",
      entityId: shiftGroupId,
      action: "working_schedule_discarded",
      before: {
        version: expectedVersion,
        changes: summarizeWorkingScheduleChanges(buildWorkingSchedulePayload(group), parseStoredPayload(group.workingCopy.payload)),
      },
      after: { version: 0 },
    });

    return editorResponse(await findEditorGroup(shiftGroupId, tx), tx);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
