import { Role, ShiftArea, ShiftAssignmentStatus, ShiftWorkerType } from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { ACTIVE_ASSIGNMENT_STATUSES, allowsOverlappingShifts } from "@/lib/shift-constants";
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
const MIN_REST_HOURS = 8;
const SHORT_TURNAROUND_PENALTY = -10;
const FAIRNESS_MAX_BONUS = 8;
const FAIRNESS_MAX_PENALTY = -8;

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** Month hours already on the books for a candidate, excluding the target shift. */
function monthHoursFor(candidate: CandidateScoringUser, shiftId: string, monthStart: Date, monthEnd: Date) {
  let hours = 0;
  for (const assignment of candidate.assignments) {
    if (assignment.shift.id === shiftId) continue;
    const window = assignmentWindow(assignment);
    if (window.startsAt >= monthStart && window.startsAt < monthEnd) {
      hours += hoursBetween(window.startsAt, window.endsAt);
    }
  }
  return hours;
}

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
  // Fairness is relative to the people competing for this slot, so a heavy
  // month for everyone does not push every candidate into "overloaded".
  const peerMedianMonthHours = median(
    candidates
      .filter((candidate) => shiftWorkerTypeForProfile(candidate) === shift.workerType)
      .map((candidate) => monthHoursFor(candidate, shift.id, monthStart, monthEnd)),
  );

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
        const priorCount = candidate.assignments.filter((assignment) =>
          assignmentWindow(assignment).startsAt < targetWindow.startsAt
          && assignment.shift.shiftGroup?.event?.sportCode === shift.sportCode,
        ).length;
        addReason(
          "prior_sport_assignment",
          priorCount >= 3 ? "Experienced with this sport" : "Has worked this sport recently",
          priorCount >= 3 ? 12 : 6,
        );
      }

      const shortTurnaround = candidate.assignments.some((assignment) => {
        if (assignment.shift.id === shift.id) return false;
        const window = assignmentWindow(assignment);
        if (overlaps(targetWindow, window)) return false;
        const gapBefore = hoursBetween(window.endsAt, targetWindow.startsAt);
        const gapAfter = hoursBetween(targetWindow.endsAt, window.startsAt);
        return (window.endsAt <= targetWindow.startsAt && gapBefore < MIN_REST_HOURS)
          || (window.startsAt >= targetWindow.endsAt && gapAfter < MIN_REST_HOURS);
      });
      if (shortTurnaround) {
        addWarning("short_turnaround", "Less than 8 hours between assignments", SHORT_TURNAROUND_PENALTY);
      }

      const blockingConflict = candidate.assignments.some((assignment) => {
        if (assignment.shift.id === shift.id) return false;
        return overlaps(targetWindow, assignmentWindow(assignment));
      });
      if (blockingConflict && !allowsOverlappingShifts(candidate.role)) {
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

      // Graded load: a steady nudge toward whoever has the most headroom,
      // instead of a cliff at the overload thresholds.
      if (!overloaded) {
        const loadDelta = peerMedianMonthHours - monthHours;
        const fairness = Math.max(FAIRNESS_MAX_PENALTY, Math.min(FAIRNESS_MAX_BONUS, Math.round(loadDelta / 2)));
        if (fairness >= 3) addReason("below_peer_load", "Fewer hours than peers this month", fairness);
        else if (fairness <= -3) addWarning("above_peer_load", "More hours than peers this month", fairness);
      }

      const blocked = blockingConflict || Boolean(availability?.blocking);
      return {
        rawScore: score,
        userId: candidate.id,
        bucket: bucketFor(score, warnings, overloaded),
        score: Math.max(0, Math.min(100, score)),
        reasons: reasons.sort(sortSignals),
        warnings: warnings.sort(sortSignals),
        blockingConflict: blocked,
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
    // Unavailable people always sort last, and ranking uses the unclamped
    // score so strong candidates stay distinguishable above 100.
    .sort((a, b) =>
      Number(a.blockingConflict) - Number(b.blockingConflict)
      || b.rawScore - a.rawScore
      || a.userId.localeCompare(b.userId))
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    .map(({ rawScore: _rawScore, ...recommendation }) => recommendation);
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
