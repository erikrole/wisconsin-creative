import type { Prisma } from "@prisma/client";
import { normalizeAllDayToUtcMidnight } from "@/lib/app-time";
import { ACTIVE_ASSIGNMENT_STATUSES } from "@/lib/shift-constants";

export type ScheduleWindow = {
  startsAt: Date;
  endsAt: Date;
};

export type ScheduleEventTiming = {
  startsAt: Date;
  endsAt: Date;
  allDay?: boolean | null;
};

export type ScheduleShiftTiming = ScheduleWindow & {
  callStartsAt?: Date | null;
  callEndsAt?: Date | null;
  event?: ScheduleEventTiming | null;
  shiftGroup?: {
    event?: ScheduleEventTiming | null;
  } | null;
};

export type ScheduleAssignmentTiming = {
  callStartsAt?: Date | null;
  callEndsAt?: Date | null;
  shift: ScheduleShiftTiming;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function completeCallWindow(window: {
  callStartsAt?: Date | null;
  callEndsAt?: Date | null;
}): ScheduleWindow | null {
  if (!window.callStartsAt || !window.callEndsAt) return null;
  return {
    startsAt: window.callStartsAt,
    endsAt: window.callEndsAt,
  };
}

function eventTimingForShift(shift: ScheduleShiftTiming) {
  return shift.event ?? shift.shiftGroup?.event ?? null;
}

/**
 * Resolve the window that governs a shift when no assignment-specific window
 * exists. Explicit shift call times win; inherited all-day events use their
 * date boundaries; ordinary shifts use their generated/default boundaries.
 */
export function resolveEffectiveShiftWindow(shift: ScheduleShiftTiming): ScheduleWindow {
  const explicitWindow = completeCallWindow(shift);
  if (explicitWindow) return explicitWindow;

  const event = eventTimingForShift(shift);
  if (event?.allDay) {
    return {
      startsAt: normalizeAllDayToUtcMidnight(event.startsAt),
      endsAt: normalizeAllDayToUtcMidnight(event.endsAt),
    };
  }

  return {
    startsAt: shift.startsAt,
    endsAt: shift.endsAt,
  };
}

/** Assignment-level call times override the shift's effective window. */
export function resolveEffectiveAssignmentWindow(
  assignment: ScheduleAssignmentTiming,
): ScheduleWindow {
  return completeCallWindow(assignment) ?? resolveEffectiveShiftWindow(assignment.shift);
}

/** Schedule intervals use half-open overlap semantics: [start, end). */
export function scheduleWindowsOverlap(a: ScheduleWindow, b: ScheduleWindow): boolean {
  return a.startsAt < b.endsAt && a.endsAt > b.startsAt;
}

export function scheduleWindowDurationHours(window: ScheduleWindow): number {
  return Math.max(0, (window.endsAt.getTime() - window.startsAt.getTime()) / 3_600_000);
}

/**
 * Expand a window for the broad database prefilter used before effective
 * windows are rechecked in memory. The padding prevents all-day event rows
 * whose stored shift boundaries are narrower than their event date span from
 * being omitted by the query.
 */
export function expandScheduleWindow(window: ScheduleWindow, days = 1): ScheduleWindow {
  const paddingMs = days * DAY_MS;
  return {
    startsAt: new Date(window.startsAt.getTime() - paddingMs),
    endsAt: new Date(window.endsAt.getTime() + paddingMs),
  };
}

/**
 * Build the broad assignment overlap predicate. Callers must still resolve
 * every returned row with resolveEffectiveAssignmentWindow and recheck it in
 * memory; raw shift/call columns are only an index-friendly prefilter.
 */
export function buildShiftAssignmentOverlapWhere(args: {
  userId: string;
  window: ScheduleWindow;
  excludeAssignmentId?: string;
}): Prisma.ShiftAssignmentWhereInput {
  const padded = expandScheduleWindow(args.window);
  const where: Prisma.ShiftAssignmentWhereInput = {
    userId: args.userId,
    status: { in: ACTIVE_ASSIGNMENT_STATUSES },
    OR: [
      {
        shift: {
          startsAt: { lt: args.window.endsAt },
          endsAt: { gt: args.window.startsAt },
        },
      },
      {
        callStartsAt: { lt: args.window.endsAt },
        callEndsAt: { gt: args.window.startsAt },
      },
      {
        shift: {
          callStartsAt: { lt: args.window.endsAt },
          callEndsAt: { gt: args.window.startsAt },
        },
      },
      {
        shift: {
          shiftGroup: {
            event: {
              allDay: true,
              startsAt: { lt: padded.endsAt },
              endsAt: { gt: padded.startsAt },
            },
          },
        },
      },
    ],
  };

  if (args.excludeAssignmentId) {
    where.id = { not: args.excludeAssignmentId };
  }

  return where;
}
