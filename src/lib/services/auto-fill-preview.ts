import { ShiftAssignmentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import type { CandidateRecommendation } from "@/lib/candidate-scoring-types";
import type {
  AutoFillPreviewProposal,
  AutoFillPreviewResponse,
  AutoFillPreviewSkippedReasonCode,
  AutoFillPreviewSkippedSlot,
} from "@/lib/auto-fill-preview-types";
import { getCandidateScoresForShift } from "@/lib/services/candidate-scoring";
import { isSportRosterEligible, isTravelEligible } from "@/lib/schedule-assignment-eligibility";
import {
  policyAllowsWorkerType,
  resolveSportAutoAssignPolicy,
  SportAutoAssignPolicy,
  SPORT_AUTO_ASSIGN_POLICY_DESCRIPTIONS,
} from "@/lib/sport-auto-assign-policy";
import { loadSportAutoAssignPolicies, loadTravelRosterCounts } from "@/lib/services/sport-auto-assign-policies";
import { ACTIVE_ASSIGNMENT_STATUSES } from "@/lib/shift-constants";
import { shiftWorkerLabel, shiftWorkerTypeForProfile } from "@/lib/shift-display";
import { visibleActiveUserWhere } from "@/lib/user-visibility";

type PreviewShift = {
  id: string;
  area: string;
  workerType: string;
  startsAt: Date;
  assignments: Array<{ status: ShiftAssignmentStatus | string }>;
};

type PreviewUser = {
  id: string;
  name: string;
  role: string;
  staffingType?: string | null;
  sportAssignments?: Array<{ sportCode: string; defaultTraveler: boolean }>;
};

type BuildPreviewArgs = {
  shiftGroupId: string;
  eventId: string;
  eventSummary: string;
  eventSportCode: string | null;
  policy: SportAutoAssignPolicy;
  /** Null for a home game or an event with no venue side recorded. */
  eventIsHome: boolean | null;
  eventHasTravelRoster: boolean;
  generatedAt: Date;
  shifts: PreviewShift[];
  users: PreviewUser[];
  scoresByShiftId: Record<string, CandidateRecommendation[]>;
};

const ACTIVE_STATUSES = new Set<string>(ACTIVE_ASSIGNMENT_STATUSES);
const AREA_ORDER = ["VIDEO", "PHOTO", "GRAPHICS", "SOCIAL", "COMMS", "LIVE_PRODUCTION"] as const;
const AREA_RANK = new Map<string, number>(AREA_ORDER.map((area, index) => [area, index]));

function userMatchesShift(workerType: string, user: PreviewUser) {
  return shiftWorkerTypeForProfile(user) === workerType;
}

function isOpenShift(shift: PreviewShift) {
  return !shift.assignments.some((assignment) => ACTIVE_STATUSES.has(assignment.status));
}

function hasAreaFit(score: CandidateRecommendation) {
  return score.reasons.some((reason) => reason.code === "primary_area" || reason.code === "area_assignment");
}

function hasWarning(score: CandidateRecommendation, code: string) {
  return score.warnings.some((warning) => warning.code === code);
}

function formatAreaLabel(area: string) {
  return area.charAt(0) + area.slice(1).toLowerCase();
}

function plural(count: number, singular: string, pluralValue = `${singular}s`) {
  return count === 1 ? singular : pluralValue;
}

function buildSkippedSlot(shift: PreviewShift, scores: CandidateRecommendation[], usersById: Map<string, PreviewUser>, usedUserIds: Set<string>, eventSportCode: string | null): AutoFillPreviewSkippedSlot {
  const visibleScores = scores.filter((score) => usersById.has(score.userId));
  const rosterScores = visibleScores.filter((score) => isSportRosterEligible(score, eventSportCode));
  const schedulingClassScores = rosterScores.filter((score) => userMatchesShift(shift.workerType, usersById.get(score.userId)!));
  const areaFitScores = schedulingClassScores.filter(hasAreaFit);
  const safeAreaFitScores = areaFitScores.filter((score) => !score.blockingConflict);
  const unusedSafeAreaFitScores = safeAreaFitScores.filter((score) => !usedUserIds.has(score.userId));
  const workerLabel = shiftWorkerLabel(shift.workerType);
  const workerLabelLower = workerLabel.toLowerCase();
  const areaLabel = formatAreaLabel(shift.area);
  const approvedTimeOffBlockCount = areaFitScores.filter((score) => hasWarning(score, "approved_time_off")).length;
  const overlappingAssignmentBlockCount = areaFitScores.filter((score) => hasWarning(score, "overlapping_assignment")).length;
  const alreadyProposedCount = safeAreaFitScores.filter((score) => usedUserIds.has(score.userId)).length;
  let reasonCode: AutoFillPreviewSkippedReasonCode = "no_safe_candidate";
  let reason = "No eligible candidate met the auto-fill safety rules.";

  if (visibleScores.length === 0) {
    reasonCode = "no_visible_candidates";
    reason = `No active candidates were available for this ${workerLabelLower} slot.`;
  } else if (rosterScores.length === 0) {
    reasonCode = "no_sport_roster";
    reason = "Nobody is assigned to this sport.";
  } else if (schedulingClassScores.length === 0) {
    reasonCode = "no_scheduling_class_match";
    reason = `No ${workerLabelLower} scheduling-class candidates were available.`;
  } else if (areaFitScores.length === 0) {
    reasonCode = "no_area_fit";
    reason = `No ${workerLabelLower} candidate had ${areaLabel} area fit.`;
  } else if (safeAreaFitScores.length === 0 && approvedTimeOffBlockCount >= overlappingAssignmentBlockCount && approvedTimeOffBlockCount > 0) {
    reasonCode = "approved_time_off_blocked";
    reason = "Approved time off blocked the available candidate pool.";
  } else if (safeAreaFitScores.length === 0 && overlappingAssignmentBlockCount > 0) {
    reasonCode = "overlapping_assignment_blocked";
    reason = "Existing assignments blocked the available candidate pool.";
  } else if (unusedSafeAreaFitScores.length === 0 && alreadyProposedCount > 0) {
    reasonCode = "already_proposed";
    reason = "Eligible candidates were already proposed for earlier slots in this preview.";
  }

  const reasonDetails = [
    `${visibleScores.length} active ${plural(visibleScores.length, "candidate")} considered.`,
    eventSportCode && visibleScores.length > rosterScores.length
      ? `${visibleScores.length - rosterScores.length} are not on the ${eventSportCode} roster.`
      : null,
    rosterScores.length > schedulingClassScores.length
      ? `${rosterScores.length - schedulingClassScores.length} did not match the ${workerLabelLower} scheduling class.`
      : null,
    schedulingClassScores.length > areaFitScores.length
      ? `${schedulingClassScores.length - areaFitScores.length} ${workerLabelLower} ${plural(schedulingClassScores.length - areaFitScores.length, "candidate")} lacked ${areaLabel} area fit.`
      : null,
    approvedTimeOffBlockCount > 0
      ? `${approvedTimeOffBlockCount} blocked by approved time off.`
      : null,
    overlappingAssignmentBlockCount > 0
      ? `${overlappingAssignmentBlockCount} already assigned during this call window.`
      : null,
    alreadyProposedCount > 0
      ? `${alreadyProposedCount} already proposed for another open slot.`
      : null,
  ].filter((detail): detail is string => Boolean(detail));

  return {
    shiftId: shift.id,
    area: shift.area,
    workerType: shift.workerType,
    reasonCode,
    reason,
    reasonDetails,
    candidateCount: visibleScores.length,
    schedulingClassMatchCount: schedulingClassScores.length,
    areaFitCount: areaFitScores.length,
    blockingCandidateCount: areaFitScores.filter((score) => score.blockingConflict).length,
    approvedTimeOffBlockCount,
    overlappingAssignmentBlockCount,
    alreadyProposedCount,
  };
}

function sortOpenShifts(a: PreviewShift, b: PreviewShift) {
  return a.startsAt.getTime() - b.startsAt.getTime()
    || (AREA_RANK.get(a.area) ?? AREA_ORDER.length) - (AREA_RANK.get(b.area) ?? AREA_ORDER.length)
    || a.workerType.localeCompare(b.workerType)
    || a.id.localeCompare(b.id);
}

export function buildAutoFillPreview({
  shiftGroupId,
  eventId,
  eventSummary,
  eventSportCode,
  policy,
  eventIsHome,
  eventHasTravelRoster,
  generatedAt,
  shifts,
  users,
  scoresByShiftId,
}: BuildPreviewArgs): AutoFillPreviewResponse {
  const usersById = new Map(users.map((user) => [user.id, user]));
  const usedUserIds = new Set<string>();
  const proposals: AutoFillPreviewProposal[] = [];
  const skipped: AutoFillPreviewSkippedSlot[] = [];
  const openShifts = shifts.filter(isOpenShift).sort(sortOpenShifts);

  for (const shift of openShifts) {
    // A slot the sport's policy leaves open on purpose is reported as such
    // rather than as a slot auto-fill failed to fill.
    if (!policyAllowsWorkerType(policy, shift.workerType as "FT" | "ST")) {
      skipped.push({
        shiftId: shift.id,
        area: shift.area,
        workerType: shift.workerType,
        reasonCode: policy === SportAutoAssignPolicy.HOLD ? "sport_policy_hold" : "sport_policy_staff_only",
        reason: policy === SportAutoAssignPolicy.HOLD
          ? `${eventSportCode} is on hold for auto assignment.`
          : "Student slots stay open for students to request on this sport.",
        reasonDetails: [SPORT_AUTO_ASSIGN_POLICY_DESCRIPTIONS[policy]],
        candidateCount: 0,
        schedulingClassMatchCount: 0,
        areaFitCount: 0,
        blockingCandidateCount: 0,
        approvedTimeOffBlockCount: 0,
        overlappingAssignmentBlockCount: 0,
        alreadyProposedCount: 0,
      });
      continue;
    }
    const scores = scoresByShiftId[shift.id] ?? [];
    const eligibleScores = scores.filter((score) => {
      const user = usersById.get(score.userId);
      if (!user) return false;
      if (usedUserIds.has(score.userId)) return false;
      // The sport roster is the pool, not a tiebreaker.
      if (!isSportRosterEligible(score, eventSportCode)) return false;
      // Away games narrow that pool to whoever travels.
      if (!isTravelEligible(user.sportAssignments ?? [], eventSportCode, eventIsHome, eventHasTravelRoster)) return false;
      if (score.blockingConflict) return false;
      if (!userMatchesShift(shift.workerType, user)) return false;
      if (!hasAreaFit(score)) return false;
      return true;
    });
    const chosen = eligibleScores[0];

    if (!chosen) {
      skipped.push(buildSkippedSlot(shift, scores, usersById, usedUserIds, eventSportCode));
      continue;
    }

    const user = usersById.get(chosen.userId)!;
    usedUserIds.add(chosen.userId);
    proposals.push({
      shiftId: shift.id,
      area: shift.area,
      workerType: shift.workerType,
      userId: chosen.userId,
      userName: user.name,
      userRole: user.role,
      userStaffingType: shiftWorkerTypeForProfile(user),
      score: chosen.score,
      bucket: chosen.bucket,
      reasons: chosen.reasons,
      warnings: chosen.warnings,
      advisoryConflict: chosen.advisoryConflict,
      advisoryConflictNote: chosen.advisoryConflictNote,
    });
  }

  return {
    shiftGroupId,
    eventId,
    eventSummary,
    generatedAt: generatedAt.toISOString(),
    proposals,
    skipped,
    summary: {
      openSlots: openShifts.length,
      proposed: proposals.length,
      skipped: skipped.length,
      warnings: proposals.filter((proposal) => proposal.warnings.length > 0).length,
    },
  };
}

export async function getAutoFillPreview(shiftGroupId: string): Promise<AutoFillPreviewResponse> {
  const group = await db.shiftGroup.findUnique({
    where: { id: shiftGroupId },
    select: {
      id: true,
      eventId: true,
      event: { select: { summary: true, sportCode: true, isHome: true } },
      shifts: {
        select: {
          id: true,
          area: true,
          workerType: true,
          startsAt: true,
          assignments: {
            select: { status: true },
          },
        },
        orderBy: [{ startsAt: "asc" }, { area: "asc" }, { workerType: "asc" }, { id: "asc" }],
      },
    },
  });

  if (!group) throw new HttpError(404, "Shift group not found");

  const openShifts = group.shifts.filter(isOpenShift);
  const [users, scorePairs] = await Promise.all([
    db.user.findMany({
      where: visibleActiveUserWhere(),
      select: {
        id: true,
        name: true,
        role: true,
        staffingType: true,
        sportAssignments: { select: { sportCode: true, defaultTraveler: true } },
      },
      orderBy: { name: "asc" },
    }),
    Promise.all(openShifts.map(async (shift) => [shift.id, await getCandidateScoresForShift(shift.id)] as const)),
  ]);

  return buildAutoFillPreview({
    shiftGroupId: group.id,
    eventId: group.eventId,
    eventSummary: group.event.summary,
    eventSportCode: group.event.sportCode,
    policy: resolveSportAutoAssignPolicy(
      await loadSportAutoAssignPolicies(group.event.sportCode ? [group.event.sportCode] : []),
      group.event.sportCode,
    ),
    eventIsHome: group.event.isHome,
    eventHasTravelRoster: group.event.isHome === false && group.event.sportCode
      ? (await loadTravelRosterCounts([group.event.sportCode])).get(group.event.sportCode) !== undefined
      : false,
    generatedAt: new Date(),
    shifts: group.shifts,
    users,
    scoresByShiftId: Object.fromEntries(scorePairs),
  });
}
