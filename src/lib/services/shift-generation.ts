import { Prisma, ShiftArea, ShiftWorkerType } from "@prisma/client";
import { db } from "@/lib/db";
import { sportDefaultShiftWindow } from "@/lib/schedule-defaults";
import { getNonGameScheduleDefaults } from "@/lib/services/non-game-schedule-defaults";
import { unique } from "@/lib/utils";

const WRITE_CHUNK_SIZE = 500;

type ShiftToCreate = {
  shiftGroupId: string;
  area: ShiftArea;
  workerType: ShiftWorkerType;
  startsAt: Date;
  endsAt: Date;
};

type TemplateShiftConfig = {
  area: ShiftArea;
  homeCount: number;
  awayCount: number;
  homeStaffCount?: number | null;
  homeStudentCount?: number | null;
  awayStaffCount?: number | null;
  awayStudentCount?: number | null;
};

export function sportTemplateCounts(sc: TemplateShiftConfig, isHome: boolean): Record<ShiftWorkerType, number> {
  if (isHome) {
    return {
      FT: sc.homeStaffCount ?? 0,
      ST: sc.homeStudentCount ?? sc.homeCount,
    };
  }
  return {
    FT: sc.awayStaffCount ?? 0,
    ST: sc.awayStudentCount ?? sc.awayCount,
  };
}

function addTemplateShifts(
  target: Omit<ShiftToCreate, "shiftGroupId">[],
  sc: TemplateShiftConfig,
  isHome: boolean,
  event: { startsAt: Date; endsAt: Date },
  studentWindow: { startsAt: Date; endsAt: Date },
) {
  const counts = sportTemplateCounts(sc, isHome);
  for (const workerType of ["FT", "ST"] as const) {
    for (let i = 0; i < counts[workerType]; i++) {
      target.push({
        area: sc.area,
        workerType,
        startsAt: workerType === "ST" ? studentWindow.startsAt : event.startsAt,
        endsAt: workerType === "ST" ? studentWindow.endsAt : event.endsAt,
      });
    }
  }
}

/**
 * Generate shifts for a single calendar event based on sport config.
 * Idempotent: skips events that already have a ShiftGroup.
 */
export async function generateShiftsForEvent(eventId: string): Promise<{
  created: boolean;
  shiftGroupId: string | null;
  shiftCount: number;
}> {
  const event = await db.calendarEvent.findUnique({
    where: { id: eventId },
    include: { shiftGroup: true },
  });

  if (!event) {
    return { created: false, shiftGroupId: null, shiftCount: 0 };
  }

  // Skip if already has a ShiftGroup (never overwrite manual edits)
  if (event.shiftGroup) {
    return { created: false, shiftGroupId: event.shiftGroup.id, shiftCount: 0 };
  }

  const shiftsData: Omit<ShiftToCreate, "shiftGroupId">[] = [];
  const isNonGame = !event.opponent;
  if (isNonGame) {
    const defaults = await getNonGameScheduleDefaults();
    const studentWindow = sportDefaultShiftWindow(event, defaults);
    for (const row of defaults.shiftConfigs) {
      for (const workerType of ["FT", "ST"] as const) {
        const count = workerType === "FT" ? row.staffCount : row.studentCount;
        for (let index = 0; index < count; index++) {
          shiftsData.push({
            area: row.area,
            workerType,
            startsAt: workerType === "ST" ? studentWindow.startsAt : event.startsAt,
            endsAt: workerType === "ST" ? studentWindow.endsAt : event.endsAt,
          });
        }
      }
    }
  } else {
    if (!event.sportCode) {
      return { created: false, shiftGroupId: null, shiftCount: 0 };
    }
    const sportConfig = await db.sportConfig.findUnique({
      where: { sportCode: event.sportCode },
      include: { shiftConfigs: true },
    });
    if (!sportConfig || !sportConfig.active || sportConfig.shiftConfigs.length === 0) {
      return { created: false, shiftGroupId: null, shiftCount: 0 };
    }
    const defaultWindow = sportDefaultShiftWindow(event, sportConfig);
    for (const row of sportConfig.shiftConfigs) {
      addTemplateShifts(shiftsData, row, event.isHome === true, event, defaultWindow);
    }
  }

  if (shiftsData.length === 0) {
    return { created: false, shiftGroupId: null, shiftCount: 0 };
  }

  const group = await db.$transaction(async (tx) => {
    // Re-check inside transaction to prevent race condition (two concurrent requests)
    const recheck = await tx.calendarEvent.findUnique({
      where: { id: eventId },
      include: { shiftGroup: true },
    });
    if (recheck?.shiftGroup) {
      return { sg: recheck.shiftGroup, alreadyExisted: true };
    }

    const sg = await tx.shiftGroup.create({
      data: {
        eventId: event.id,
        generatedAt: new Date(),
      },
    });

    await tx.shift.createMany({
      data: shiftsData.map((s) => ({
        shiftGroupId: sg.id,
        area: s.area,
        workerType: s.workerType,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        templateManaged: true,
      })),
    });

    return { sg, alreadyExisted: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  if (group.alreadyExisted) {
    return { created: false, shiftGroupId: group.sg.id, shiftCount: 0 };
  }
  return { created: true, shiftGroupId: group.sg.id, shiftCount: shiftsData.length };
}

/**
 * Maximum events to process per invocation. Prevents Vercel serverless
 * timeout (10s Hobby / 60s Pro) when the backlog is large. Callers that
 * need to process more should call in a loop or via a cron job.
 */
const EVENT_BATCH_LIMIT = 200;

/**
 * Batch generate shifts for calendar events matching a WHERE clause.
 *
 * Performance: 2 DB reads (events + sport configs) + 1 transaction for
 * all writes. No N+1 — sport configs are pre-loaded into a Map before
 * the event loop. Writes are chunked in groups of WRITE_CHUNK_SIZE.
 *
 * The event query is capped at EVENT_BATCH_LIMIT to stay within Vercel
 * serverless timeouts. The `hasMore` flag signals whether another call
 * is needed to finish processing.
 *
 * Used by both the backfill route and the post-sync hook.
 */
export async function generateShiftsForEvents(opts: {
  where: Prisma.CalendarEventWhereInput;
  limit?: number;
}): Promise<{
  eventsMatched: number;
  groupsCreated: number;
  shiftsCreated: number;
  hasMore: boolean;
}> {
  const take = Math.min(opts.limit ?? EVENT_BATCH_LIMIT, EVENT_BATCH_LIMIT);

  const events = await db.calendarEvent.findMany({
    where: opts.where,
    select: {
      id: true,
      sportCode: true,
      opponent: true,
      isHome: true,
      allDay: true,
      startsAt: true,
      endsAt: true,
    },
    orderBy: { startsAt: "asc" },
    take: take + 1, // fetch one extra to detect whether more remain
  });

  const hasMore = events.length > take;
  if (hasMore) events.pop(); // remove the extra sentinel row

  if (events.length === 0) {
    return { eventsMatched: 0, groupsCreated: 0, shiftsCreated: 0, hasMore: false };
  }

  // Load all active sport configs in one query
  const sportCodes = unique(events.filter((e) => e.sportCode).map((e) => e.sportCode!));
  const [sportConfigs, nonGameDefaults] = await Promise.all([
    db.sportConfig.findMany({
      where: { sportCode: { in: sportCodes }, active: true },
      include: { shiftConfigs: true },
    }),
    getNonGameScheduleDefaults(),
  ]);
  const configMap = new Map(sportConfigs.map((c) => [c.sportCode, c]));

  // Build all shift groups and shifts to create
  const groupsToCreate: Array<{ eventId: string; generatedAt: Date }> = [];
  const pendingShifts: Array<{
    eventIndex: number;
    area: ShiftArea;
    workerType: ShiftWorkerType;
    startsAt: Date;
    endsAt: Date;
  }> = [];

  for (let i = 0; i < events.length; i++) {
    const event = events[i]!; // in-bounds by loop condition
    let hasShifts = false;
    const isNonGame = !event.opponent;
    const config = event.sportCode ? configMap.get(event.sportCode) : undefined;
    if (!isNonGame && (!config || config.shiftConfigs.length === 0)) continue;
    const defaults = isNonGame ? nonGameDefaults : config!;
    const defaultWindow = sportDefaultShiftWindow(event, defaults);
    const rows = isNonGame ? nonGameDefaults.shiftConfigs : config!.shiftConfigs;
    for (const sc of rows) {
      const counts = "staffCount" in sc
        ? { FT: sc.staffCount, ST: sc.studentCount }
        : sportTemplateCounts(sc, event.isHome === true);
      for (const workerType of ["FT", "ST"] as const) {
        for (let j = 0; j < counts[workerType]; j++) {
          pendingShifts.push({
            eventIndex: groupsToCreate.length,
            area: sc.area,
            workerType,
            startsAt: workerType === "ST" ? defaultWindow.startsAt : event.startsAt,
            endsAt: workerType === "ST" ? defaultWindow.endsAt : event.endsAt,
          });
          hasShifts = true;
        }
      }
    }

    if (hasShifts) {
      groupsToCreate.push({ eventId: event.id, generatedAt: new Date() });
    }
  }

  if (groupsToCreate.length === 0) {
    return { eventsMatched: events.length, groupsCreated: 0, shiftsCreated: 0, hasMore };
  }

  // Create all shift groups and shifts in a transaction
  const result = await db.$transaction(async (tx) => {
    // Create groups one by one to get their IDs (createMany doesn't return IDs)
    const createdGroups: string[] = [];
    for (let i = 0; i < groupsToCreate.length; i += WRITE_CHUNK_SIZE) {
      const chunk = groupsToCreate.slice(i, i + WRITE_CHUNK_SIZE);
      for (const g of chunk) {
        const sg = await tx.shiftGroup.create({ data: g });
        createdGroups.push(sg.id);
      }
    }

    // Map pendingShifts to actual shift group IDs
    const allShifts = pendingShifts.map((s) => ({
      shiftGroupId: createdGroups[s.eventIndex]!, // eventIndex is set to groupsToCreate.length at push time
      area: s.area,
      workerType: s.workerType,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      templateManaged: true,
    }));

    // Batch create shifts
    for (let i = 0; i < allShifts.length; i += WRITE_CHUNK_SIZE) {
      const chunk = allShifts.slice(i, i + WRITE_CHUNK_SIZE);
      await tx.shift.createMany({ data: chunk });
    }

    return { groupsCreated: createdGroups.length, shiftsCreated: allShifts.length };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  return { eventsMatched: events.length, ...result, hasMore };
}

/**
 * Generate shifts for all calendar events from a source that don't have shifts yet.
 * Called as a post-sync hook after ICS sync completes.
 */
export async function generateShiftsForNewEvents(sourceId: string): Promise<{
  groupsCreated: number;
  shiftsCreated: number;
}> {
  const result = await generateShiftsForEvents({
    where: {
      sourceId,
      shiftGroup: null,
      startsAt: { gte: new Date() },
    },
  });
  return { groupsCreated: result.groupsCreated, shiftsCreated: result.shiftsCreated };
}

/**
 * Regenerate shifts for an event from its sport config template.
 * Only adds missing area positions — does not remove existing shifts with assignments.
 */
export async function regenerateShiftsForEvent(eventId: string): Promise<{
  added: number;
}> {
  const event = await db.calendarEvent.findUnique({
    where: { id: eventId },
    include: {
      shiftGroup: {
        include: { shifts: true },
      },
    },
  });

  if (!event || !event.sportCode || !event.shiftGroup) {
    return { added: 0 };
  }

  // Skip regeneration for manually-edited shift groups
  if (event.shiftGroup.manuallyEdited) {
    return { added: 0 };
  }

  const sportConfig = await db.sportConfig.findUnique({
    where: { sportCode: event.sportCode },
    include: { shiftConfigs: true },
  });

  if (!sportConfig || !sportConfig.active) {
    return { added: 0 };
  }

  const isHome = event.isHome === true;
  const existingShifts = event.shiftGroup.shifts;

  // Count existing shifts per area and planned worker kind.
  const existingCounts = new Map<string, number>();
  for (const shift of existingShifts) {
    const key = `${shift.area}:${shift.workerType}`;
    existingCounts.set(key, (existingCounts.get(key) ?? 0) + 1);
  }

  // Add missing positions
  const newShifts: Array<{
    shiftGroupId: string;
    area: ShiftArea;
    workerType: ShiftWorkerType;
    startsAt: Date;
    endsAt: Date;
    templateManaged: boolean;
  }> = [];

  for (const sc of sportConfig.shiftConfigs) {
    const counts = sportTemplateCounts(sc, isHome);
    for (const workerType of ["FT", "ST"] as const) {
      const currentCount = existingCounts.get(`${sc.area}:${workerType}`) ?? 0;
      const toAdd = Math.max(0, counts[workerType] - currentCount);

      for (let i = 0; i < toAdd; i++) {
        const defaultWindow = sportDefaultShiftWindow(event, sportConfig);
        newShifts.push({
          shiftGroupId: event.shiftGroup.id,
          area: sc.area,
          workerType,
          startsAt: workerType === "ST" ? defaultWindow.startsAt : event.startsAt,
          endsAt: workerType === "ST" ? defaultWindow.endsAt : event.endsAt,
          templateManaged: true,
        });
      }
    }
  }

  if (newShifts.length === 0) {
    return { added: 0 };
  }

  await db.shift.createMany({ data: newShifts });

  return { added: newShifts.length };
}

type SportDefaultRebaseSummary = {
  eventsMatched: number;
  groupsCreated: number;
  groupsRebased: number;
  slotsAdded: number;
  slotsRemoved: number;
  slotsRetimed: number;
  protectedSlots: number;
  protectedOverageSlots: number;
  publishedSkipped: number;
  workingCopiesSkipped: number;
  neutralSkipped: number;
};

/**
 * Reconcile upcoming unpublished schedules to newly saved sport defaults.
 *
 * Generated, never-edited, unassigned slots may be removed or retimed. Every
 * slot with assignment history or an event-level edit is protected and counts
 * toward the target for its current area and worker type. Published schedules
 * and active working copies stay in the explicit review/publish workflow.
 */
export async function rebaseUpcomingShiftsForSportCodes(
  sportCodes: string[],
  now = new Date(),
): Promise<SportDefaultRebaseSummary> {
  return db.$transaction(async (tx) => {
    const [configs, events] = await Promise.all([
      tx.sportConfig.findMany({
        where: { sportCode: { in: sportCodes }, active: true },
        include: { shiftConfigs: true },
      }),
      tx.calendarEvent.findMany({
        where: {
          sportCode: { in: sportCodes },
          startsAt: { gte: now },
          status: { not: "CANCELLED" },
          isHidden: false,
          archivedAt: null,
        },
        select: {
          id: true,
          sportCode: true,
          isHome: true,
          allDay: true,
          startsAt: true,
          endsAt: true,
          shiftGroup: {
            select: {
              id: true,
              publishedAt: true,
              workingCopy: { select: { shiftGroupId: true } },
              shifts: {
                select: {
                  id: true,
                  area: true,
                  workerType: true,
                  startsAt: true,
                  endsAt: true,
                  callStartsAt: true,
                  callEndsAt: true,
                  notes: true,
                  templateManaged: true,
                  createdAt: true,
                  assignments: { select: { id: true } },
                },
              },
            },
          },
        },
        orderBy: { startsAt: "asc" },
      }),
    ]);

    const configByCode = new Map(configs.map((config) => [config.sportCode, config]));
    const summary: SportDefaultRebaseSummary = {
      eventsMatched: events.length,
      groupsCreated: 0,
      groupsRebased: 0,
      slotsAdded: 0,
      slotsRemoved: 0,
      slotsRetimed: 0,
      protectedSlots: 0,
      protectedOverageSlots: 0,
      publishedSkipped: 0,
      workingCopiesSkipped: 0,
      neutralSkipped: 0,
    };

    for (const event of events) {
      const config = event.sportCode ? configByCode.get(event.sportCode) : undefined;
      if (!config) continue;
      if (event.shiftGroup?.publishedAt) {
        summary.publishedSkipped += 1;
        continue;
      }
      if (event.shiftGroup?.workingCopy) {
        summary.workingCopiesSkipped += 1;
        continue;
      }

      const defaultWindow = sportDefaultShiftWindow(event, config);
      const targets = new Map<string, { area: ShiftArea; workerType: ShiftWorkerType; count: number }>();
      for (const row of config.shiftConfigs) {
        const counts = sportTemplateCounts(row, event.isHome === true);
        for (const workerType of ["FT", "ST"] as const) {
          targets.set(`${row.area}:${workerType}`, {
            area: row.area,
            workerType,
            count: counts[workerType],
          });
        }
      }

      if (!event.shiftGroup) {
        const slots = [...targets.values()].flatMap((target) =>
          Array.from({ length: target.count }, () => ({
            area: target.area,
            workerType: target.workerType,
            startsAt: target.workerType === "ST" ? defaultWindow.startsAt : event.startsAt,
            endsAt: target.workerType === "ST" ? defaultWindow.endsAt : event.endsAt,
            templateManaged: true,
          })),
        );
        if (slots.length === 0) continue;
        const group = await tx.shiftGroup.create({
          data: { eventId: event.id, generatedAt: now },
        });
        await tx.shift.createMany({
          data: slots.map((slot) => ({ ...slot, shiftGroupId: group.id })),
        });
        summary.groupsCreated += 1;
        summary.slotsAdded += slots.length;
        continue;
      }

      const shiftsByKey = new Map<string, typeof event.shiftGroup.shifts>();
      for (const shift of event.shiftGroup.shifts) {
        const key = `${shift.area}:${shift.workerType}`;
        shiftsByKey.set(key, [...(shiftsByKey.get(key) ?? []), shift]);
        if (
          shift.assignments.length > 0
          || !shift.templateManaged
          || shift.notes !== null
          || shift.callStartsAt !== null
          || shift.callEndsAt !== null
        ) {
          summary.protectedSlots += 1;
        }
      }

      const allKeys = new Set([...targets.keys(), ...shiftsByKey.keys()]);
      let groupChanged = false;
      for (const key of allKeys) {
        const target = targets.get(key);
        const current = shiftsByKey.get(key) ?? [];
        const targetCount = target?.count ?? 0;
        const removable = current
          .filter((shift) =>
            shift.templateManaged
            && shift.assignments.length === 0
            && shift.notes === null
            && shift.callStartsAt === null
            && shift.callEndsAt === null
          )
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
        const removeCount = Math.min(Math.max(0, current.length - targetCount), removable.length);
        const removeIds = removable.slice(0, removeCount).map((shift) => shift.id);
        if (removeIds.length > 0) {
          const removed = await tx.shift.deleteMany({
            where: { id: { in: removeIds }, assignments: { none: {} } },
          });
          summary.slotsRemoved += removed.count;
          groupChanged ||= removed.count > 0;
        }

        const remainingCount = current.length - removeCount;
        summary.protectedOverageSlots += Math.max(0, remainingCount - targetCount);
        const addCount = Math.max(0, targetCount - remainingCount);
        if (target && addCount > 0) {
          const targetStartsAt = target.workerType === "ST" ? defaultWindow.startsAt : event.startsAt;
          const targetEndsAt = target.workerType === "ST" ? defaultWindow.endsAt : event.endsAt;
          await tx.shift.createMany({
            data: Array.from({ length: addCount }, () => ({
              shiftGroupId: event.shiftGroup!.id,
              area: target.area,
              workerType: target.workerType,
              startsAt: targetStartsAt,
              endsAt: targetEndsAt,
              templateManaged: true,
            })),
          });
          summary.slotsAdded += addCount;
          groupChanged = true;
        }

        const removeSet = new Set(removeIds);
        const targetStartsAt = target?.workerType === "ST" ? defaultWindow.startsAt : event.startsAt;
        const targetEndsAt = target?.workerType === "ST" ? defaultWindow.endsAt : event.endsAt;
        const retimeIds = current
          .filter((shift) =>
            !removeSet.has(shift.id)
            && shift.templateManaged
            && shift.assignments.length === 0
            && shift.notes === null
            && shift.callStartsAt === null
            && shift.callEndsAt === null
            && (shift.startsAt.getTime() !== targetStartsAt.getTime() || shift.endsAt.getTime() !== targetEndsAt.getTime())
          )
          .map((shift) => shift.id);
        if (retimeIds.length > 0) {
          const retimed = await tx.shift.updateMany({
            where: { id: { in: retimeIds }, assignments: { none: {} } },
            data: { startsAt: targetStartsAt, endsAt: targetEndsAt },
          });
          summary.slotsRetimed += retimed.count;
          groupChanged ||= retimed.count > 0;
        }
      }
      if (groupChanged) summary.groupsRebased += 1;
    }

    return summary;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
