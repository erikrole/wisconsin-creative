import { Role, ShiftArea, ShiftAssignmentStatus, ShiftWorkerType } from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { ACTIVE_ASSIGNMENT_STATUSES, allowsOverlappingShifts } from "@/lib/shift-constants";
import { evaluateAvailabilityPreferences, type AvailabilityBlockLike } from "@/lib/student-availability";
import { shiftWorkerTypeForProfile } from "@/lib/shift-display";
import { endOfAppMonth, endOfAppWeek, startOfAppMonth, startOfAppWeek } from "@/lib/app-time";
import { visibleActiveUserWhere } from "@/lib/user-visibility";
import { sportLabel } from "@/lib/sports";
import { AREA_LABELS } from "@/types/areas";
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

type CandidateScoringAssignment = {
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
// Fair rotation: every shift already on someone's week costs a little, and
// people above the pool's typical season load cost a little more, so ties stop
// landing on the same person until they hit the overload line.
const WEEK_ASSIGNMENT_PENALTY = 6;
const WEEK_ASSIGNMENT_PENALTY_CAP = 18;
const SEASON_BALANCE_WEIGHT = 2;
const SEASON_BALANCE_CAP = 12;

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
  return startOfAppWeek(value);
}

function endOfWeek(value: Date) {
  return endOfAppWeek(value);
}

function startOfMonth(value: Date) {
  return startOfAppMonth(value);
}

function endOfMonth(value: Date) {
  return endOfAppMonth(value);
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

// A typical strong fit lands near 120 raw points; scaling into 0-100 keeps
// strong candidates distinguishable instead of all clamping to 100.
const RAW_SCORE_CEILING = 130;

function displayScore(raw: number) {
  return Math.round((Math.max(0, Math.min(RAW_SCORE_CEILING, raw)) / RAW_SCORE_CEILING) * 100);
}

function areaName(area: string) {
  return AREA_LABELS[area] ?? area;
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 : sorted[middle] ?? 0;
}

/** Stable per-slot rotation so equal candidates do not always resolve to the same id. */
function rotationKey(shiftId: string, userId: string) {
  let hash = 2166136261;
  for (const char of `${shiftId}:${userId}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pastAssignmentCount(candidate: CandidateScoringUser, before: Date, shiftId: string) {
  return candidate.assignments.filter((assignment) =>
    assignment.shift.id !== shiftId && assignmentWindow(assignment).startsAt < before,
  ).length;
}

export function scoreCandidatesForShift({ shift, candidates, now }: ScoreArgs): CandidateRecommendation[] {
  const targetWindow = effectiveWindow(shift);
  const weekStart = startOfWeek(targetWindow.startsAt);
  const weekEnd = endOfWeek(targetWindow.startsAt);
  const monthStart = startOfMonth(targetWindow.startsAt);
  const monthEnd = endOfMonth(targetWindow.startsAt);
  const referenceNow = now ?? new Date();
  const sportName = shift.sportCode ? sportLabel(shift.sportCode) : null;
  const seasonCounts = new Map(candidates.map((candidate) => [
    candidate.id,
    pastAssignmentCount(candidate, targetWindow.startsAt, shift.id),
  ]));
  // Compare season load only against people who could fill this kind of slot.
  const typicalSeasonCount = median(candidates
    .filter((candidate) => shiftWorkerTypeForProfile(candidate) === shift.workerType)
    .map((candidate) => seasonCounts.get(candidate.id) ?? 0));

  // Ranking uses the raw score: strong fits all clamp to 100 for display, and
  // sorting on the clamped value left every one of them tied.
  const rawScores = new Map<string, number>();

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
        addReason("role_fit", shift.workerType === "ST" ? "Student" : "Staff", 24);
      } else {
        addWarning(
          "role_mismatch",
          shift.workerType === "ST" ? "Staff, so this uses a Staff slot" : "Student, so this uses a Student slot",
          -18,
        );
      }

      const assignedArea = candidate.areaAssignments.find((area) => area.area === shift.area);
      if (assignedArea?.isPrimary || candidate.primaryArea === shift.area) {
        addReason("primary_area", `${areaName(shift.area)} is their main area`, 20);
      } else if (assignedArea) {
        addReason("area_assignment", `Also works ${areaName(shift.area)}`, 14);
      } else {
        addWarning("area_gap", `Not on the ${areaName(shift.area)} team`, -12);
      }

      const hasSportRoster = Boolean(shift.sportCode)
        && candidate.sportAssignments.some((sport) => sport.sportCode === shift.sportCode);
      if (hasSportRoster) {
        addReason("sport_roster", `On the ${sportName} roster`, 16);
      } else if (shift.sportCode) {
        addWarning("sport_gap", `Not on the ${sportName} roster`, -10);
      }

      const previousSameSport = Boolean(shift.sportCode)
        && candidate.assignments.some((assignment) => {
          const window = assignmentWindow(assignment);
          return window.startsAt < targetWindow.startsAt
            && assignment.shift.shiftGroup?.event?.sportCode === shift.sportCode;
        });
      if (previousSameSport) {
        addReason("prior_sport_assignment", `Has worked ${sportName} before`, 8);
      }

      const blockingConflict = candidate.assignments.some((assignment) => {
        if (assignment.shift.id === shift.id) return false;
        return overlaps(targetWindow, assignmentWindow(assignment));
      });
      if (blockingConflict && !allowsOverlappingShifts(candidate.role)) {
        addWarning("overlapping_assignment", "Already working during this time", -60);
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
        addWarning(
          "workload_overloaded",
          weekAssignments >= WEEK_ASSIGNMENT_OVERLOAD || weekHours >= WEEK_HOUR_OVERLOAD
            ? `Heavy week: ${weekAssignments} ${weekAssignments === 1 ? "shift" : "shifts"} already`
            : `Heavy month: ${monthAssignments} ${monthAssignments === 1 ? "shift" : "shifts"} already`,
          -28,
        );
      } else if (upcomingAssignments >= UPCOMING_ASSIGNMENT_WARNING) {
        addWarning("upcoming_load", `${upcomingAssignments} shifts coming up`, -12);
      } else if (weekAssignments === 0 && monthAssignments <= 2) {
        addReason("fresh_capacity", "Nothing else this week", 8);
      }
      if (!overloaded && weekAssignments > 0) {
        score -= Math.min(WEEK_ASSIGNMENT_PENALTY_CAP, weekAssignments * WEEK_ASSIGNMENT_PENALTY);
      }

      const seasonCount = seasonCounts.get(candidate.id) ?? 0;
      const seasonGap = typicalSeasonCount - seasonCount;
      const seasonAdjustment = Math.max(-SEASON_BALANCE_CAP, Math.min(SEASON_BALANCE_CAP, seasonGap * SEASON_BALANCE_WEIGHT));
      if (seasonAdjustment >= 4) {
        addReason("season_balance", "Fewer shifts than most this season", seasonAdjustment);
      } else {
        score += seasonAdjustment;
      }

      rawScores.set(candidate.id, score);
      return {
        userId: candidate.id,
        bucket: bucketFor(score, warnings, overloaded),
        score: displayScore(score),
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
    .sort((a, b) => (rawScores.get(b.userId) ?? b.score) - (rawScores.get(a.userId) ?? a.score)
      || (seasonCounts.get(a.userId) ?? 0) - (seasonCounts.get(b.userId) ?? 0)
      || rotationKey(shift.id, a.userId) - rotationKey(shift.id, b.userId));
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

function rangesOverlap(
  start: Date | null | undefined,
  end: Date | null | undefined,
  recentStart: Date,
  futureEnd: Date,
) {
  return Boolean(start && end && start < futureEnd && end > recentStart);
}

/** Same window the per-shift loader uses, so a shared snapshot does not change scores. */
function assignmentInScoringWindow(
  assignment: CandidateScoringAssignment,
  recentStart: Date,
  futureEnd: Date,
) {
  return rangesOverlap(assignment.shift.startsAt, assignment.shift.endsAt, recentStart, futureEnd)
    || rangesOverlap(assignment.callStartsAt, assignment.callEndsAt, recentStart, futureEnd)
    || rangesOverlap(assignment.shift.callStartsAt, assignment.shift.callEndsAt, recentStart, futureEnd);
}

/**
 * Score several shifts from one candidate snapshot. Calling
 * `getCandidateScoresForShift` once per open slot reloads every person and
 * their assignments for each slot.
 */
export async function getCandidateScoresForShiftIds(
  shiftIds: string[],
  opts: { now?: Date } = {},
) {
  const uniqueIds = [...new Set(shiftIds)];
  const scores = new Map<string, CandidateRecommendation[]>();
  if (uniqueIds.length === 0) return scores;

  const shifts = await db.shift.findMany({
    where: { id: { in: uniqueIds } },
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
  const inputs = shifts.map(loadedShiftToInput);
  if (inputs.length === 0) return scores;

  const windows = inputs.map(effectiveWindow);
  const candidates = await loadCandidateScoringUsersForRange({
    startsAt: new Date(Math.min(...windows.map((window) => window.startsAt.getTime()))),
    endsAt: new Date(Math.max(...windows.map((window) => window.endsAt.getTime()))),
  });

  for (const shift of inputs) {
    const window = effectiveWindow(shift);
    const recentStart = addDays(window.startsAt, -RECENT_LOOKBACK_DAYS);
    const futureEnd = addDays(window.endsAt, FUTURE_LOOKAHEAD_DAYS);
    scores.set(shift.id, scoreCandidatesForShift({
      shift,
      now: opts.now,
      candidates: candidates.map((candidate) => ({
        ...candidate,
        assignments: candidate.assignments.filter((assignment) =>
          assignmentInScoringWindow(assignment, recentStart, futureEnd),
        ),
      })),
    }));
  }

  return scores;
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
