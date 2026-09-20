import { Prisma, Role, ShiftAssignmentStatus } from "@prisma/client";
import { createAuditEntriesTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { sportDefaultShiftWindow } from "@/lib/schedule-defaults";
import { workingSchedulePayloadSchema } from "@/lib/schedule-working-copy";
import { ACTIVE_ASSIGNMENT_STATUSES } from "@/lib/shift-constants";
import { availabilityConflictNote } from "@/lib/student-availability";
import { buildSchedulePublicationSnapshot } from "@/lib/services/schedule-publication";
import { updateShiftAssignmentConflictsTx } from "@/lib/services/shift-assignment-conflicts";
import { shiftWorkerTypeForProfile } from "@/lib/shift-display";
import { unique } from "@/lib/utils";

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

const syncGroupSelect = {
  id: true,
  publishedAt: true,
  publishedVersion: true,
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
        where: { status: { in: activeAssignmentStatuses } },
        orderBy: { createdAt: "asc" },
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

type SyncGroup = Prisma.ShiftGroupGetPayload<{ select: typeof syncGroupSelect }>;
type SyncEvent = {
  id: string;
  sportCode: string | null;
  allDay: boolean;
  startsAt: Date;
  endsAt: Date;
  shiftGroup: SyncGroup | null;
};

type CurrentCallTimeSyncOptions = {
  now?: Date;
  actor?: { id: string; role: Role } | null;
  dryRun?: boolean;
  overrideExistingCallTimes?: boolean;
};

type PublishedCallTimeChange = {
  shiftGroupId: string;
  affectedUserIds: string[];
};

type CurrentCallTimeSyncSummary = {
  eventsMatched: number;
  groupsInspected: number;
  groupsUpdated: number;
  shiftsUpdated: number;
  workingCopiesUpdated: number;
  publishedGroupsUpdated: number;
  assignmentsAcknowledgementReset: number;
  shiftCallOverridesCleared: number;
  assignmentCallOverridesCleared: number;
  allDayEventsSkipped: number;
  missingConfigs: number;
  invalidWorkingCopies: number;
  changedGroupIds: string[];
  publishedChanges: PublishedCallTimeChange[];
};

function effectiveWindow(
  shift: { startsAt: Date; endsAt: Date; callStartsAt: Date | null; callEndsAt: Date | null },
  assignment?: { callStartsAt: Date | null; callEndsAt: Date | null } | null,
) {
  return {
    startsAt: assignment?.callStartsAt ?? shift.callStartsAt ?? shift.startsAt,
    endsAt: assignment?.callEndsAt ?? shift.callEndsAt ?? shift.endsAt,
  };
}

function windowsDiffer(
  before: { startsAt: Date; endsAt: Date },
  after: { startsAt: Date; endsAt: Date },
) {
  return before.startsAt.getTime() !== after.startsAt.getTime()
    || before.endsAt.getTime() !== after.endsAt.getTime();
}

function conflictRefresh(
  shift: SyncGroup["shifts"][number],
  assignment: SyncGroup["shifts"][number]["assignments"][number],
) {
  const window = effectiveWindow(shift, assignment);
  const conflictNote = shiftWorkerTypeForProfile(assignment.user) === "ST"
    ? availabilityConflictNote(assignment.user.availabilityBlocks, window)
    : null;
  return {
    id: assignment.id,
    hasConflict: Boolean(conflictNote),
    conflictNote,
  };
}

function syncWorkingCopyPayload(
  group: SyncGroup,
  event: SyncEvent,
  defaultWindow: { startsAt: Date; endsAt: Date },
  overrideExistingCallTimes: boolean,
) {
  if (!group.workingCopy) {
    return { payload: null, changed: false, invalid: false };
  }

  const parsed = workingSchedulePayloadSchema.safeParse(group.workingCopy.payload);
  if (!parsed.success) {
    return { payload: null, changed: false, invalid: true };
  }

  const next = structuredClone(parsed.data);
  let changed = false;
  const startsAt = defaultWindow.startsAt.toISOString();
  const endsAt = defaultWindow.endsAt.toISOString();
  for (const slot of next.slots) {
    const targetStartsAt = slot.workerType === "ST" ? startsAt : event.startsAt.toISOString();
    const targetEndsAt = slot.workerType === "ST" ? endsAt : event.endsAt.toISOString();
    if (!event.allDay && (slot.startsAt !== targetStartsAt || slot.endsAt !== targetEndsAt)) {
      slot.startsAt = targetStartsAt;
      slot.endsAt = targetEndsAt;
      changed = true;
    }
    if (overrideExistingCallTimes || slot.workerType === "FT") {
      if (slot.callStartsAt !== null || slot.callEndsAt !== null) {
        slot.callStartsAt = null;
        slot.callEndsAt = null;
        changed = true;
      }
      if (slot.assignment && (slot.assignment.callStartsAt !== null || slot.assignment.callEndsAt !== null)) {
        slot.assignment.callStartsAt = null;
        slot.assignment.callEndsAt = null;
        changed = true;
      }
    }
  }

  return { payload: next, changed, invalid: false };
}

/**
 * Synchronize upcoming timed shift defaults from Settings > Sports.
 *
 * Explicit slot and personal call overrides remain authoritative. The shift
 * coverage fallback and private working-copy fallback are updated together so
 * a later publish cannot restore stale settings-derived times.
 */
export async function syncCurrentSportCallTimes(
  sportCodes: string[],
  options: CurrentCallTimeSyncOptions = {},
): Promise<CurrentCallTimeSyncSummary> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun === true;
  const overrideExistingCallTimes = options.overrideExistingCallTimes === true;
  const uniqueCodes = unique(sportCodes);
  if (uniqueCodes.length === 0) {
    return {
      eventsMatched: 0,
      groupsInspected: 0,
      groupsUpdated: 0,
      shiftsUpdated: 0,
      workingCopiesUpdated: 0,
      publishedGroupsUpdated: 0,
      assignmentsAcknowledgementReset: 0,
      shiftCallOverridesCleared: 0,
      assignmentCallOverridesCleared: 0,
      allDayEventsSkipped: 0,
      missingConfigs: 0,
      invalidWorkingCopies: 0,
      changedGroupIds: [],
      publishedChanges: [],
    };
  }

  return db.$transaction(async (tx) => {
    const [configs, events] = await Promise.all([
      tx.sportConfig.findMany({
        where: { sportCode: { in: uniqueCodes } },
        select: { sportCode: true, shiftStartOffset: true, shiftEndOffset: true },
      }),
      tx.calendarEvent.findMany({
        where: {
          sportCode: { in: uniqueCodes },
          startsAt: { gte: now },
          status: { not: "CANCELLED" },
          isHidden: false,
          archivedAt: null,
        },
        select: {
          id: true,
          sportCode: true,
          allDay: true,
          startsAt: true,
          endsAt: true,
          shiftGroup: { select: syncGroupSelect },
        },
        orderBy: { startsAt: "asc" },
      }),
    ]);

    const configByCode = new Map(configs.map((config) => [config.sportCode, config]));
    const summary: CurrentCallTimeSyncSummary = {
      eventsMatched: events.length,
      groupsInspected: 0,
      groupsUpdated: 0,
      shiftsUpdated: 0,
      workingCopiesUpdated: 0,
      publishedGroupsUpdated: 0,
      assignmentsAcknowledgementReset: 0,
      shiftCallOverridesCleared: 0,
      assignmentCallOverridesCleared: 0,
      allDayEventsSkipped: 0,
      missingConfigs: 0,
      invalidWorkingCopies: 0,
      changedGroupIds: [],
      publishedChanges: [],
    };
    const auditEntries: Array<Parameters<typeof createAuditEntriesTx>[1][number]> = [];

    for (const event of events as SyncEvent[]) {
      if (event.allDay) {
        summary.allDayEventsSkipped += 1;
        if (!overrideExistingCallTimes) continue;
      }
      const config = event.sportCode ? configByCode.get(event.sportCode) : undefined;
      if (!event.allDay && !config) {
        summary.missingConfigs += 1;
        continue;
      }
      const group = event.shiftGroup;
      if (!group) continue;
      summary.groupsInspected += 1;

      const defaultWindow = event.allDay
        ? { startsAt: event.startsAt, endsAt: event.endsAt }
        : sportDefaultShiftWindow(event, config!);
      let updatedShiftCount = 0;
      let updatedAssignmentCount = 0;
      const changedAssignments: Array<SyncGroup["shifts"][number]["assignments"][number]> = [];
      const conflictRefreshes: Array<{ id: string; hasConflict: boolean; conflictNote: string | null }> = [];
      const assignmentCallOverrideIds: string[] = [];
      const changedShiftWindows: Array<{
        shiftId: string;
        startsAt: string;
        endsAt: string;
      }> = [];
      const changedShiftCallWindows: Array<{
        shiftId: string;
        callStartsAt: string | null;
        callEndsAt: string | null;
      }> = [];

      for (const shift of group.shifts) {
        const beforeShiftWindow = { startsAt: shift.startsAt, endsAt: shift.endsAt };
        const beforeShiftCallWindow = {
          startsAt: shift.callStartsAt,
          endsAt: shift.callEndsAt,
        };
        const beforeAssignmentWindows = new Map(
          shift.assignments.map((assignment) => [assignment.id, effectiveWindow(shift, assignment)]),
        );
        const targetWindow = shift.workerType === "ST"
          ? defaultWindow
          : { startsAt: event.startsAt, endsAt: event.endsAt };
        const shiftWindowChanged = !event.allDay && windowsDiffer(beforeShiftWindow, targetWindow);
        const shiftCallOverrideChanged = (overrideExistingCallTimes || shift.workerType === "FT")
          && (shift.callStartsAt !== null || shift.callEndsAt !== null);
        const shiftChanged = shiftWindowChanged || shiftCallOverrideChanged;

        if (shiftChanged && !dryRun) {
          const data = {
            ...(shiftWindowChanged ? { startsAt: targetWindow.startsAt, endsAt: targetWindow.endsAt } : {}),
            ...(shiftCallOverrideChanged ? { callStartsAt: null, callEndsAt: null } : {}),
          };
          await tx.shift.update({
            where: { id: shift.id },
            data,
          });
        }
        if (shiftWindowChanged) {
          changedShiftWindows.push({
            shiftId: shift.id,
            startsAt: beforeShiftWindow.startsAt.toISOString(),
            endsAt: beforeShiftWindow.endsAt.toISOString(),
          });
          shift.startsAt = targetWindow.startsAt;
          shift.endsAt = targetWindow.endsAt;
        }
        if (shiftCallOverrideChanged) {
          changedShiftCallWindows.push({
            shiftId: shift.id,
            callStartsAt: beforeShiftCallWindow.startsAt?.toISOString() ?? null,
            callEndsAt: beforeShiftCallWindow.endsAt?.toISOString() ?? null,
          });
          shift.callStartsAt = null;
          shift.callEndsAt = null;
          summary.shiftCallOverridesCleared += 1;
        }
        if (shiftChanged) updatedShiftCount += 1;

        for (const assignment of shift.assignments) {
          const before = beforeAssignmentWindows.get(assignment.id)!;
          const assignmentCallOverrideChanged = (overrideExistingCallTimes || shift.workerType === "FT")
            && (assignment.callStartsAt !== null || assignment.callEndsAt !== null);
          if (assignmentCallOverrideChanged) {
            assignmentCallOverrideIds.push(assignment.id);
            assignment.callStartsAt = null;
            assignment.callEndsAt = null;
            summary.assignmentCallOverridesCleared += 1;
            updatedAssignmentCount += 1;
          }
          if (shiftChanged || assignmentCallOverrideChanged) {
            conflictRefreshes.push(conflictRefresh(shift, assignment));
          }
          const after = effectiveWindow(shift, assignment);
          if (windowsDiffer(before, after)) changedAssignments.push(assignment);
        }
      }

      if (conflictRefreshes.length > 0 && !dryRun) {
        await updateShiftAssignmentConflictsTx(tx, conflictRefreshes, false);
      }

      if (assignmentCallOverrideIds.length > 0 && !dryRun) {
        await tx.shiftAssignment.updateMany({
          where: { id: { in: assignmentCallOverrideIds } },
          data: { callStartsAt: null, callEndsAt: null },
        });
      }

      const affectedUserIds = unique(changedAssignments.map((assignment) => assignment.userId));
      if (group.publishedAt && changedAssignments.length > 0) {
        if (!dryRun) {
          await tx.shiftAssignment.updateMany({
            where: { id: { in: changedAssignments.map((assignment) => assignment.id) } },
            data: { acknowledgedAt: null, acknowledgedById: null },
          });
        }
        summary.assignmentsAcknowledgementReset += changedAssignments.length;
      }

      const workingCopy = syncWorkingCopyPayload(group, event, defaultWindow, overrideExistingCallTimes);
      if (workingCopy.invalid) {
        summary.invalidWorkingCopies += 1;
      }
      const relationalChanges = updatedShiftCount > 0 || updatedAssignmentCount > 0;
      const workingCopyNeedsUpdate = Boolean(
        workingCopy.payload
        && (workingCopy.changed || (group.publishedAt && relationalChanges)),
      );
      if (workingCopyNeedsUpdate && workingCopy.payload) {
        if (!dryRun) {
          const updated = await tx.shiftGroupWorkingCopy.updateMany({
            where: { shiftGroupId: group.id, version: group.workingCopy!.version },
            data: {
              version: { increment: 1 },
              payload: workingCopy.payload as unknown as Prisma.InputJsonValue,
              ...(group.publishedAt && (updatedShiftCount > 0 || updatedAssignmentCount > 0)
                ? { basePublishedVersion: group.publishedVersion + 1 }
                : {}),
              ...(options.actor?.id ? { updatedById: options.actor.id } : {}),
            },
          });
          if (updated.count !== 1) {
            throw new Error("A working schedule changed while call times were being synchronized");
          }
        }
        summary.workingCopiesUpdated += 1;
      }

      if (!relationalChanges && !workingCopyNeedsUpdate) continue;
      summary.shiftsUpdated += updatedShiftCount;
      summary.groupsUpdated += 1;
      summary.changedGroupIds.push(group.id);

      if (group.publishedAt && (updatedShiftCount > 0 || updatedAssignmentCount > 0)) {
        const snapshot = buildSchedulePublicationSnapshot(group);
        if (!dryRun) {
          await tx.shiftGroup.update({
            where: { id: group.id },
            data: {
              publishedVersion: { increment: 1 },
              lastPublishedSnapshot: snapshot as unknown as Prisma.InputJsonValue,
            },
          });
        }
        summary.publishedGroupsUpdated += 1;
        summary.publishedChanges.push({ shiftGroupId: group.id, affectedUserIds });
      }

      auditEntries.push({
        actorId: options.actor?.id ?? null,
        actorRole: options.actor?.role ?? null,
        entityType: "shift_group",
        entityId: group.id,
        action: overrideExistingCallTimes
          ? "shift_call_times_overridden_from_sport_settings"
          : "shift_call_times_synced_from_sport_settings",
        before: {
          sportCode: event.sportCode,
          defaultStartsAt: defaultWindow.startsAt.toISOString(),
          defaultEndsAt: defaultWindow.endsAt.toISOString(),
          changedShiftWindows,
          changedShiftCallWindows,
          publishedVersion: group.publishedVersion,
        },
        after: {
          shiftsUpdated: updatedShiftCount,
          assignmentsUpdated: updatedAssignmentCount,
          workingCopyUpdated: workingCopyNeedsUpdate,
          publishedVersion: group.publishedAt ? group.publishedVersion + 1 : group.publishedVersion,
          affectedUserIds,
        },
      });
    }

    if (!dryRun) await createAuditEntriesTx(tx, auditEntries);
    return summary;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
