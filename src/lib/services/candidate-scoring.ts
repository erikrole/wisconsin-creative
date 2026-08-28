import { Role, ShiftArea, ShiftAssignmentStatus, ShiftWorkerType, type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { ACTIVE_ASSIGNMENT_STATUSES } from "@/lib/shift-constants";
import { evaluateAvailabilityPreferences, type AvailabilityBlockLike } from "@/lib/student-availability";
import { shiftWorkerTypeForProfile } from "@/lib/shift-display";
import { visibleActiveUserWhere } from "@/lib/user-visibility";
import type {
  CandidateRecommendation,
  CandidateScoreBucket,
  CandidateScoreSignal,
} from "@/lib/candidate-scoring-types";

export type CandidateScoringShift = {
  id: string;
  area: ShiftArea;
  workerType: ShiftWorkerType;
  startsAt: Date;
  endsAt: Date;
  callStartsAt?: Date | null;
  callEndsAt?: Date | null;
  sportCode?: string | null;
};

export type CandidateScoringAssignment = {
  id: string;
  status: ShiftAssignmentStatus;
  callStartsAt?: Date | null;
  callEndsAt?: Date | null;
  shift: {
    id: string;
    area: ShiftArea;
    startsAt: Date;
    endsAt: Date;
    callStartsAt?: Date | null;
    callEndsAt?: Date | null;
    shiftGroup?: { event?: { sportCode?: string | null } | null } | null;
  };
};

export type CandidateScoringUser = {
  id: string;
  name?: string;
  email?: string | null;
  role: Role;
  staffingType: ShiftWorkerType;
  primaryArea?: ShiftArea | null;
  areaAssignments: Array<{ area: ShiftArea; isPrimary: boolean }>;
  sportAssignments: Array<{ sportCode: string; defaultTraveler: boolean }>;
  availabilityBlocks: AvailabilityBlockLike[];
  assignments: CandidateScoringAssignment[];
};

type ScoreArgs = {
  shift: CandidateScoringShift;
  candidates: CandidateScoringUser[];
  now?: Date;
};

const ACTIVE_STATUSES = ACTIVE_ASSIGNMENT_STATUSES as ShiftAssignmentStatus[];
const RECENT_LOOKBACK_DAYS = 180;
const FUTURE_LOOKAHEAD_DAYS = 30;
const WEEK_ASSIGNMENT_OVERLOAD = 4;
const WEEK_HOUR_OVERLOAD = 12;
const MONTH_ASSIGNMENT_OVERLOAD = 12;
const MONTH_HOUR_OVERLOAD = 36;
const UPCOMING_ASSIGNMENT_WARNING = 5;

function effectiveWindow(item: {
  startsAt: Date;
  endsAt: Date;
  callStartsAt?: Date | null;
  callEndsAt?: Date | null;
}) {
  return {
    startsAt: item.callStartsAt ?? item.startsAt,
    endsAt: item.callEndsAt ?? item.endsAt,
  };
}

function assignmentWindow(assignment: CandidateScoringAssignment) {
  return {
    startsAt: assignment.callStartsAt ?? assignment.shift.callStartsAt ?? assignment.shift.startsAt,
    endsAt: assignment.callEndsAt ?? assignment.shift.callEndsAt ?? assignment.shift.endsAt,
  };
}

function overlaps(a: { startsAt: Date; endsAt: Date }, b: { startsAt: Date; endsAt: Date }) {
  return a.startsAt < b.endsAt && a.endsAt > b.startsAt;
}

function hoursBetween(startsAt: Date, endsAt: Date) {
  return Math.max(0, (endsAt.getTime() - startsAt.getTime()) / 3_600_000);
}

function startOfWeek(value: Date) {
  const start = new Date(value);
  start.setUTCHours(0, 0, 0, 0);
  const day = start.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  return start;
}

function endOfWeek(value: Date) {
  const end = startOfWeek(value);
  end.setUTCDate(end.getUTCDate() + 7);
  return end;
}

function startOfMonth(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function endOfMonth(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 1));
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function bucketFor(score: number, warnings: CandidateScoreSignal[], workloadOverloaded: boolean): CandidateScoreBucket {
  if (workloadOverloaded) return "overloaded";
  if (warnings.length > 0) return "warning";
  if (score >= 85) return "recommended";
  return "good_fit";
}

function sortSignals(a: CandidateScoreSignal, b: CandidateScoreSignal) {
  return Math.abs(b.weight ?? 0) - Math.abs(a.weight ?? 0);
}

export function scoreCandidatesForShift({ shift, candidates, now }: ScoreArgs): CandidateRecommendation[] {
  const targetWindow = effectiveWindow(shift);
  const weekStart = startOfWeek(targetWindow.startsAt);
  const weekEnd = endOfWeek(targetWindow.startsAt);
  const monthStart = startOfMonth(targetWindow.startsAt);
  const monthEnd = endOfMonth(targetWindow.startsAt);
  const referenceNow = now ?? new Date();

  return candidates
    .map((candidate) => {
      let score = 50;
      const candidateWorkerType = shiftWorkerTypeForProfile(candidate);
      const reasons: CandidateScoreSignal[] = [];
      const warnings: CandidateScoreSignal[] = [];
      const addReason = (code: string, label: string, weight: number) => {
        score += weight;
        reasons.push({ code, label, weight });
      };
      const addWarning = (code: string, label: string, weight: number) => {
        score += weight;
        warnings.push({ code, label, weight });
      };

      if (candidateWorkerType === shift.workerType) {
        addReason("role_fit", shift.workerType === "ST" ? "Student slot fit" : "Staff slot fit", 24);
      } else {
        addWarning(
          "role_mismatch",
          shift.workerType === "ST" ? "Selecting this person may use a Staff slot" : "Selecting this person may use a Student slot",
          -18,
        );
      }

      const assignedArea = candidate.areaAssignments.find((area) => area.area === shift.area);
      if (assignedArea?.isPrimary || candidate.primaryArea === shift.area) {
        addReason("primary_area", "Primary area match", 20);
      } else if (assignedArea) {
        addReason("area_assignment", "Area assignment match", 14);
      } else {
        addWarning("area_gap", "No area assignment match", -12);
      }

      const hasSportRoster = Boolean(shift.sportCode)
        && candidate.sportAssignments.some((sport) => sport.sportCode === shift.sportCode);
      if (hasSportRoster) {
        addReason("sport_roster", "On this sport roster", 16);
      } else if (shift.sportCode) {
        addWarning("sport_gap", "Not on this sport roster", -10);
      }

      const previousSameSport = Boolean(shift.sportCode)
        && candidate.assignments.some((assignment) => {
          const window = assignmentWindow(assignment);
          return window.startsAt < targetWindow.startsAt
            && assignment.shift.shiftGroup?.event?.sportCode === shift.sportCode;
        });
      if (previousSameSport) {
        addReason("prior_sport_assignment", "Has worked this sport recently", 8);
      }

      const blockingConflict = candidate.assignments.some((assignment) => {
        if (assignment.shift.id === shift.id) return false;
        return overlaps(targetWindow, assignmentWindow(assignment));
      });
      if (blockingConflict) {
        addWarning("overlapping_assignment", "Already assigned during this call window", -60);
      }

      // Approved time off blocks staff exactly as it blocks students. Gating
      // this on the scheduling class let an approved staff absence through as a
      // mere warning, and the apply transaction would then reject the write.
      const availability = evaluateAvailabilityPreferences(candidate.availabilityBlocks, targetWindow);
      if (availability?.blocking) {
        addWarning("approved_time_off", availability.blocking.note, -70);
      } else if (availability?.advisory) {
        addWarning(
          availability.advisory.intent === "TIME_OFF" ? "pending_time_off" : "availability_conflict",
          availability.advisory.note,
          availability.advisory.intent === "DISLIKE" ? -14 : -25,
        );
      }
      if (availability?.preferred) {
        addReason("preferred_window", availability.preferred.note, 10);
      }

      let weekAssignments = 0;
      let weekHours = 0;
      let monthAssignments = 0;
      let monthHours = 0;
      let upcomingAssignments = 0;

      for (const assignment of candidate.assignments) {
        if (assignment.shift.id === shift.id) continue;
        const window = assignmentWindow(assignment);
        const assignmentHours = hoursBetween(window.startsAt, window.endsAt);
        if (window.startsAt >= weekStart && window.startsAt < weekEnd) {
          weekAssignments += 1;
          weekHours += assignmentHours;
        }
        if (window.startsAt >= monthStart && window.startsAt < monthEnd) {
          monthAssignments += 1;
          monthHours += assignmentHours;
        }
        if (window.startsAt >= referenceNow && window.startsAt <= addDays(referenceNow, FUTURE_LOOKAHEAD_DAYS)) {
          upcomingAssignments += 1;
        }
      }

      const overloaded = weekAssignments >= WEEK_ASSIGNMENT_OVERLOAD
        || weekHours >= WEEK_HOUR_OVERLOAD
        || monthAssignments >= MONTH_ASSIGNMENT_OVERLOAD
        || monthHours >= MONTH_HOUR_OVERLOAD;
      if (overloaded) {
        addWarning("workload_overloaded", "Workload is already heavy", -28);
      } else if (upcomingAssignments >= UPCOMING_ASSIGNMENT_WARNING) {
        addWarning("upcoming_load", "Many upcoming assignments", -12);
      } else if (weekAssignments === 0 && monthAssignments <= 2) {
        addReason("fresh_capacity", "Light recent schedule", 8);
      }

      return {
        userId: candidate.id,
        bucket: bucketFor(score, warnings, overloaded),
        score: Math.max(0, Math.min(100, score)),
        reasons: reasons.sort(sortSignals),
        warnings: warnings.sort(sortSignals),
        blockingConflict: blockingConflict || Boolean(availability?.blocking),
        advisoryConflict: Boolean(availability?.blocking || availability?.advisory),
        advisoryConflictNote: availability?.blocking?.note ?? availability?.advisory?.note ?? null,
        workload: {
          weekAssignments,
          weekHours: Number(weekHours.toFixed(1)),
          monthAssignments,
          monthHours: Number(monthHours.toFixed(1)),
          upcomingAssignments,
        },
      };
    })
    .sort((a, b) => b.score - a.score || a.userId.localeCompare(b.userId));
}

type LoadedShift = NonNullable<Awaited<ReturnType<typeof loadShiftForScoring>>>;

async function loadShiftForScoring(shiftId: string) {
  return db.shift.findUnique({
    where: { id: shiftId },
    select: {
      id: true,
      area: true,
      workerType: true,
      startsAt: true,
      endsAt: true,
      callStartsAt: true,
      callEndsAt: true,
      shiftGroup: {
        select: {
          event: { select: { sportCode: true } },
        },
      },
    },
  });
}

function loadedShiftToInput(shift: LoadedShift): CandidateScoringShift {
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

export async function getCandidateScoresForShift(shiftId: string, opts: { now?: Date } = {}) {
  const shift = await loadShiftForScoring(shiftId);
  if (!shift) throw new HttpError(404, "Shift not found");

  return getCandidateScoresForTarget(loadedShiftToInput(shift), opts);
}

export async function getCandidateScoresForTarget(
  shift: CandidateScoringShift,
  opts: { now?: Date } = {},
) {
  const targetWindow = effectiveWindow(shift);
  const candidates = await loadCandidateScoringUsersForRange({
    startsAt: targetWindow.startsAt,
    endsAt: targetWindow.endsAt,
  });

  return scoreCandidatesForShift({
    shift,
    candidates,
    now: opts.now,
  });
}

/**
 * Load the candidate snapshot once for a bounded scheduling window. Bulk
 * preview uses this instead of querying users and assignments once per slot.
 */
export async function loadCandidateScoringUsersForRange(args: {
  startsAt: Date;
  endsAt: Date;
}) {
  const recentStart = addDays(args.startsAt, -RECENT_LOOKBACK_DAYS);
  const futureEnd = addDays(args.endsAt, FUTURE_LOOKAHEAD_DAYS);
  const users = await db.user.findMany({
    where: visibleActiveUserWhere(),
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      staffingType: true,
      primaryArea: true,
      areaAssignments: { select: { area: true, isPrimary: true } },
      sportAssignments: { select: { sportCode: true, defaultTraveler: true } },
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

  const userIds = users.map((user) => user.id);
  const assignments = userIds.length === 0
    ? []
    : await db.shiftAssignment.findMany({
      where: {
        userId: { in: userIds },
        status: { in: ACTIVE_STATUSES },
        OR: [
          { shift: { startsAt: { lt: futureEnd }, endsAt: { gt: recentStart } } },
          { callStartsAt: { lt: futureEnd }, callEndsAt: { gt: recentStart } },
          { shift: { callStartsAt: { lt: futureEnd }, callEndsAt: { gt: recentStart } } },
        ],
      },
      select: {
        id: true,
        userId: true,
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
              select: {
                event: { select: { sportCode: true } },
              },
            },
          },
        },
      },
    });

  const assignmentsByUser = new Map<string, CandidateScoringAssignment[]>();
  for (const assignment of assignments) {
    const list = assignmentsByUser.get(assignment.userId) ?? [];
    list.push(assignment);
    assignmentsByUser.set(assignment.userId, list);
  }

  const candidates: CandidateScoringUser[] = users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    staffingType: user.staffingType,
    primaryArea: user.primaryArea,
    areaAssignments: user.areaAssignments,
    sportAssignments: user.sportAssignments,
    availabilityBlocks: user.availabilityBlocks,
    assignments: assignmentsByUser.get(user.id) ?? [],
  }));

  return candidates;
}

export type CandidateScoresQuery = Prisma.PromiseReturnType<typeof getCandidateScoresForShift>;
