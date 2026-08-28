import { createHash, randomUUID } from "node:crypto";
import {
  Prisma,
  Role,
  ShiftAssignmentStatus,
} from "@prisma/client";
import { createAuditEntriesTx } from "@/lib/audit";
import { ACTIVE_BOOKING_STATUSES } from "@/lib/booking-statuses";
import type { CandidateRecommendation } from "@/lib/candidate-scoring-types";
import {
  loadCandidateScoringUsersForRange,
  scoreCandidatesForShift,
  type CandidateScoringShift,
  type CandidateScoringUser,
} from "@/lib/services/candidate-scoring";
import {
  bulkAssignmentApplySchema,
  bulkAssignmentScopeSchema,
  summarizeAssignmentPeople,
  type BulkAssignmentApplyInput,
  type BulkAssignmentPreviewEvent,
  type BulkAssignmentPreviewProposal,
  type BulkAssignmentPreviewResponse,
  type BulkAssignmentPreviewSkipped,
  type BulkAssignmentScope,
} from "@/lib/bulk-schedule-assignment-types";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { scheduleAssigneeWorkerType } from "@/lib/schedule-assignee";
import {
  isOnSportRoster,
  isSportRosterEligible,
  isTravelEligible,
  sportHasTravelRoster,
} from "@/lib/schedule-assignment-eligibility";
import {
  policyAllowsWorkerType,
  resolveSportAutoAssignPolicy,
  SportAutoAssignPolicy,
  SPORT_AUTO_ASSIGN_POLICY_DESCRIPTIONS,
} from "@/lib/sport-auto-assign-policy";
import { loadSportAutoAssignPolicies, loadTravelRosterCounts } from "@/lib/services/sport-auto-assign-policies";
import {
  applyWorkingScheduleCommand,
  reconcileWorkingAssignmentSources,
  type WorkingSchedulePayload,
  workingSchedulePayloadSchema,
} from "@/lib/schedule-working-copy";
import { ACTIVE_ASSIGNMENT_STATUSES } from "@/lib/shift-constants";
import { checkTimeConflict } from "@/lib/services/shift-assignments";
import { evaluateAvailabilityPreferences } from "@/lib/student-availability";
import { shiftWorkerTypeForProfile } from "@/lib/shift-display";
import { buildWorkingSchedulePayload } from "@/lib/services/schedule-working-copy";
import { createBulkScheduleAssignmentNotifications } from "@/lib/services/notifications";

const MAX_BULK_EVENTS = 200;

const bulkShiftGroupSelect = {
  id: true,
  eventId: true,
  publishedAt: true,
  publishedVersion: true,
  archivedAt: true,
  event: {
    select: {
      id: true,
      summary: true,
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
      payload: true,
    },
  },
} satisfies Prisma.ShiftGroupSelect;

type BulkShiftGroup = Prisma.ShiftGroupGetPayload<{ select: typeof bulkShiftGroupSelect }>;

type BulkCalendarEvent = {
  id: string;
  summary: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  status: string;
  sportCode: string | null;
  opponent: string | null;
  isHome: boolean | null;
  shiftGroup: BulkShiftGroup | null;
};

type ReadyEvent = {
  event: BulkCalendarEvent;
  group: BulkShiftGroup;
  payload: WorkingSchedulePayload;
  openSlots: WorkingSchedulePayload["slots"];
};

type ReleaseResult = { at: Date; runId: string };

export type EnqueueBulkRelease = (args: {
  shiftGroupId: string;
  version: number;
  now: Date;
  batchId: string;
}) => Promise<ReleaseResult>;

function iso(value: Date) {
  return value.toISOString();
}

function effectiveSlotWindow(slot: WorkingSchedulePayload["slots"][number]) {
  return {
    startsAt: slot.workerType === "ST"
      ? new Date(slot.assignment?.callStartsAt ?? slot.callStartsAt ?? slot.startsAt)
      : new Date(slot.startsAt),
    endsAt: slot.workerType === "ST"
      ? new Date(slot.assignment?.callEndsAt ?? slot.callEndsAt ?? slot.endsAt)
      : new Date(slot.endsAt),
  };
}

function overlaps(a: { startsAt: Date; endsAt: Date }, b: { startsAt: Date; endsAt: Date }) {
  return a.startsAt < b.endsAt && a.endsAt > b.startsAt;
}

function hasAreaFit(score: CandidateRecommendation) {
  return score.reasons.some((reason) => reason.code === "primary_area" || reason.code === "area_assignment");
}

/**
 * Which open slots this scope is allowed to fill. The worker scope narrows the
 * slots considered -- it never relaxes the rule that an `ST` slot takes a
 * student and an `FT` slot takes staff.
 */
function slotInScope(
  slot: WorkingSchedulePayload["slots"][number],
  scope: BulkAssignmentScope,
  policy: SportAutoAssignPolicy,
) {
  if (scope.area && slot.area !== scope.area) return false;
  if (scope.workerScope !== "ALL" && slot.workerType !== scope.workerScope) return false;
  // A student slot on a STAFF_ONLY sport is deliberately left open for students
  // to request, so it is out of scope rather than a gap this run failed to fill.
  if (!policyAllowsWorkerType(policy, slot.workerType)) return false;
  return true;
}

function openSlotsScopeReason(scope: BulkAssignmentScope, policy: SportAutoAssignPolicy) {
  if (policy === SportAutoAssignPolicy.STAFF_ONLY) {
    return "No open staff slots on this event. Student slots stay open for students to request.";
  }
  const qualifiers = [
    scope.workerScope === "ST" ? "student" : scope.workerScope === "FT" ? "staff" : null,
    scope.area ? scope.area.toLowerCase().replace("_", " ") : null,
  ].filter((value): value is string => Boolean(value));
  return qualifiers.length > 0
    ? `No open ${qualifiers.join(" ")} slots on this event.`
    : "This event has no open crew slots.";
}

function hasWarning(score: CandidateRecommendation, code: string) {
  return score.warnings.some((warning) => warning.code === code);
}

function eventSnapshot(event: BulkCalendarEvent, group: BulkShiftGroup | null) {
  return {
    eventId: event.id,
    shiftGroupId: group?.id ?? null,
    startsAt: iso(event.startsAt),
    endsAt: iso(event.endsAt),
    status: event.status,
    sportCode: event.sportCode,
    workingVersion: group?.workingCopy?.version ?? null,
    publishedVersion: group?.publishedVersion ?? null,
  };
}

function buildFingerprint(scope: BulkAssignmentScope, events: BulkAssignmentPreviewEvent[], snapshots: ReturnType<typeof eventSnapshot>[]) {
  const normalized = {
    scope,
    snapshots,
    events: events.map((event) => ({
      eventId: event.eventId,
      shiftGroupId: event.shiftGroupId,
      status: event.status,
      openSlots: event.openSlots,
      proposals: event.proposals.map((proposal) => [proposal.proposalId, proposal.shiftId, proposal.userId]),
      skipped: event.skipped.map((skipped) => [skipped.shiftId, skipped.reasonCode]),
    })),
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function parseWorkingPayload(group: BulkShiftGroup): WorkingSchedulePayload {
  const published = buildWorkingSchedulePayload(group as Parameters<typeof buildWorkingSchedulePayload>[0]);
  if (!group.workingCopy) return published;
  const parsed = workingSchedulePayloadSchema.safeParse(group.workingCopy.payload);
  if (!parsed.success) throw new HttpError(409, "This event has an invalid pending schedule. Resolve it before bulk assignment.");
  return reconcileWorkingAssignmentSources(parsed.data, group.shifts);
}

function candidateTarget(slot: WorkingSchedulePayload["slots"][number], sportCode: string | null): CandidateScoringShift {
  return {
    id: slot.sourceShiftId ?? slot.key,
    area: slot.area,
    workerType: slot.workerType,
    startsAt: new Date(slot.startsAt),
    endsAt: new Date(slot.endsAt),
    callStartsAt: slot.workerType === "ST" && slot.callStartsAt ? new Date(slot.callStartsAt) : null,
    callEndsAt: slot.workerType === "ST" && slot.callEndsAt ? new Date(slot.callEndsAt) : null,
    sportCode,
  };
}

function appendTentativeAssignment(candidate: CandidateScoringUser, shift: CandidateScoringShift) {
  candidate.assignments.push({
    id: `bulk-preview:${shift.id}:${candidate.id}`,
    status: "DIRECT_ASSIGNED",
    callStartsAt: shift.callStartsAt ?? null,
    callEndsAt: shift.callEndsAt ?? null,
    shift: {
      id: shift.id,
      area: shift.area,
      startsAt: shift.startsAt,
      endsAt: shift.endsAt,
      callStartsAt: shift.callStartsAt ?? null,
      callEndsAt: shift.callEndsAt ?? null,
      shiftGroup: { event: { sportCode: shift.sportCode } },
    },
  });
}

function buildSkippedSlot(
  slot: WorkingSchedulePayload["slots"][number],
  scores: CandidateRecommendation[],
  candidatesById: Map<string, CandidateScoringUser>,
  usedUserIds: Set<string>,
  eventSportCode: string | null,
  travel: { isHome: boolean | null; hasTravelRoster: boolean },
): BulkAssignmentPreviewSkipped {
  const visibleScores = scores.filter((score) => candidatesById.has(score.userId));
  const rosterScores = visibleScores.filter((score) => isSportRosterEligible(score, eventSportCode));
  const travelScores = rosterScores.filter((score) => {
    const candidate = candidatesById.get(score.userId);
    return candidate
      ? isTravelEligible(candidate.sportAssignments, eventSportCode, travel.isHome, travel.hasTravelRoster)
      : false;
  });
  const classScores = travelScores.filter((score) => {
    const candidate = candidatesById.get(score.userId);
    return candidate ? shiftWorkerTypeForProfile(candidate) === slot.workerType : false;
  });
  const areaScores = classScores.filter(hasAreaFit);
  const safeAreaScores = areaScores.filter((score) => !score.blockingConflict);
  const unusedSafeScores = safeAreaScores.filter((score) => !usedUserIds.has(score.userId));
  const approvedTimeOffCount = areaScores.filter((score) => hasWarning(score, "approved_time_off")).length;
  const overlappingCount = areaScores.filter((score) => hasWarning(score, "overlapping_assignment")).length;
  const alreadyProposedCount = safeAreaScores.filter((score) => usedUserIds.has(score.userId)).length;

  let reasonCode: BulkAssignmentPreviewSkipped["reasonCode"] = "no_safe_candidate";
  let reason = "No eligible candidate met the auto-fill safety rules.";
  if (visibleScores.length === 0) {
    reasonCode = "no_visible_candidates";
    reason = "No active candidates were available for this slot.";
  } else if (rosterScores.length === 0) {
    reasonCode = "no_sport_roster";
    reason = "Nobody is assigned to this sport.";
  } else if (travelScores.length === 0) {
    reasonCode = "no_travel_roster";
    reason = "Nobody on this sport's travel roster is available for this away game.";
  } else if (classScores.length === 0) {
    reasonCode = "no_scheduling_class_match";
    reason = `No ${slot.workerType === "ST" ? "Student" : "Staff"} candidates were available.`;
  } else if (areaScores.length === 0) {
    reasonCode = "no_area_fit";
    reason = "No eligible candidate had an area fit for this slot.";
  } else if (safeAreaScores.length === 0 && approvedTimeOffCount >= overlappingCount && approvedTimeOffCount > 0) {
    reasonCode = "approved_time_off_blocked";
    reason = "Approved time off blocked the available candidate pool.";
  } else if (safeAreaScores.length === 0 && overlappingCount > 0) {
    reasonCode = "overlapping_assignment_blocked";
    reason = "Existing or proposed assignments blocked the available candidate pool.";
  } else if (unusedSafeScores.length === 0 && alreadyProposedCount > 0) {
    reasonCode = "already_proposed";
    reason = "Eligible candidates were already proposed for another slot in this event.";
  }

  return {
    shiftId: slot.sourceShiftId ?? slot.key,
    area: slot.area,
    workerType: slot.workerType,
    reasonCode,
    reason,
    reasonDetails: [
      `${visibleScores.length} active candidate${visibleScores.length === 1 ? "" : "s"} considered.`,
      eventSportCode && visibleScores.length > rosterScores.length
        ? `${visibleScores.length - rosterScores.length} are not on the ${eventSportCode} roster.`
        : null,
      travel.isHome === false && travel.hasTravelRoster && rosterScores.length > travelScores.length
        ? `${rosterScores.length - travelScores.length} are not on the travel roster for this away game.`
        : null,
      travelScores.length > classScores.length
        ? `${travelScores.length - classScores.length} did not match the scheduling class.`
        : null,
      classScores.length > areaScores.length
        ? `${classScores.length - areaScores.length} lacked area fit.`
        : null,
      approvedTimeOffCount > 0 ? `${approvedTimeOffCount} blocked by approved time off.` : null,
      overlappingCount > 0 ? `${overlappingCount} blocked by an overlapping assignment.` : null,
      alreadyProposedCount > 0 ? `${alreadyProposedCount} already proposed for this event.` : null,
    ].filter((detail): detail is string => Boolean(detail)),
  };
}

function buildEventResult(state: ReadyEvent, proposals: BulkAssignmentPreviewProposal[], skipped: BulkAssignmentPreviewSkipped[]): BulkAssignmentPreviewEvent {
  const unfilledSlots = state.openSlots.length - proposals.length;
  return {
    shiftGroupId: state.group.id,
    eventId: state.event.id,
    summary: state.event.summary,
    startsAt: iso(state.event.startsAt),
    sportCode: state.event.sportCode,
    workingVersion: state.group.workingCopy?.version ?? null,
    publishedVersion: state.group.publishedVersion,
    status: "ready",
    proposals,
    skipped,
    openSlots: state.openSlots.length,
    unfilledSlots,
    fullyCrewed: unfilledSlots === 0,
  };
}

/**
 * Held sports can never produce a proposal, so loading their events -- each one
 * pulling a whole shift group, working copy, and assignment tree -- and letting
 * them consume the event cap is pure waste. A single sport on hold across a
 * season is enough to push a legitimate scope over the limit. They are counted
 * separately instead, cheaply, so the preview can still say how many were held.
 */
function heldSportFilter(scope: BulkAssignmentScope, heldCodes: string[]): Prisma.CalendarEventWhereInput {
  if (heldCodes.length === 0) {
    return scope.sportCodes.length > 0 ? { sportCode: { in: scope.sportCodes } } : {};
  }
  const held = new Set(heldCodes);
  if (scope.sportCodes.length > 0) {
    return { sportCode: { in: scope.sportCodes.filter((code) => !held.has(code)) } };
  }
  // No sport filter: keep non-sport events, which a bare `notIn` would drop
  // because SQL `NOT IN` is null for a null column.
  return { OR: [{ sportCode: null }, { sportCode: { notIn: heldCodes } }] };
}

function scopeWindowFilter(scope: BulkAssignmentScope): Prisma.CalendarEventWhereInput {
  const startsAt = new Date(scope.rangeStartsAt);
  const endsAt = new Date(scope.rangeEndsAt);
  return {
    isHidden: false,
    archivedAt: null,
    status: { not: "CANCELLED" },
    AND: [
      { startsAt: { lt: endsAt } },
      { endsAt: { gt: startsAt } },
      { endsAt: { gt: new Date() } },
    ],
  };
}

async function loadScopeEvents(
  scope: BulkAssignmentScope,
  heldCodes: string[],
): Promise<{ events: BulkCalendarEvent[]; heldEventCount: number }> {
  const window = scopeWindowFilter(scope);
  const inScopeHeldCodes = scope.sportCodes.length > 0
    ? heldCodes.filter((code) => scope.sportCodes.includes(code))
    : heldCodes;

  const [events, heldEventCount] = await Promise.all([
    db.calendarEvent.findMany({
      where: { ...window, ...heldSportFilter(scope, heldCodes) },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      take: MAX_BULK_EVENTS + 1,
      select: {
        id: true,
        summary: true,
        startsAt: true,
        endsAt: true,
        allDay: true,
        status: true,
        sportCode: true,
        opponent: true,
        isHome: true,
        shiftGroup: { select: bulkShiftGroupSelect },
      },
    }),
    inScopeHeldCodes.length === 0
      ? Promise.resolve(0)
      : db.calendarEvent.count({ where: { ...window, sportCode: { in: inScopeHeldCodes } } }),
  ]);

  if (events.length > MAX_BULK_EVENTS) {
    throw new HttpError(400, `This scope contains more than ${MAX_BULK_EVENTS} events. Choose a shorter period, fewer sports, or a single area before previewing.`);
  }
  return { events, heldEventCount };
}

export async function getBulkAssignmentPreview(rawScope: BulkAssignmentScope): Promise<BulkAssignmentPreviewResponse> {
  const scope = bulkAssignmentScopeSchema.parse(rawScope);
  // Policies decide which sports are even worth loading, so they come first.
  const policies = await loadSportAutoAssignPolicies(scope.sportCodes.length > 0 ? scope.sportCodes : undefined);
  const heldCodes = [...policies.entries()]
    .filter(([, policy]) => policy === SportAutoAssignPolicy.HOLD)
    .map(([sportCode]) => sportCode);
  const { events: rawEvents, heldEventCount } = await loadScopeEvents(scope, heldCodes);
  const travelRosterCounts = await loadTravelRosterCounts(
    [...new Set(rawEvents.filter((event) => event.isHome === false)
      .map((event) => event.sportCode)
      .filter((code): code is string => Boolean(code)))],
  );
  const readyStates: ReadyEvent[] = [];
  const events: BulkAssignmentPreviewEvent[] = [];
  const snapshots = rawEvents.map((event) => eventSnapshot(event, event.shiftGroup));

  for (const event of rawEvents) {
    const group = event.shiftGroup;
    if (!group || group.archivedAt) {
      events.push({
        shiftGroupId: group?.id ?? null,
        eventId: event.id,
        summary: event.summary,
        startsAt: iso(event.startsAt),
        sportCode: event.sportCode,
        workingVersion: group?.workingCopy?.version ?? null,
        publishedVersion: group?.publishedVersion ?? null,
        status: "skipped",
        proposals: [],
        skipped: [{
          shiftId: null,
          area: null,
          workerType: null,
          reasonCode: "no_shift_group",
          reason: "This event has no active crew schedule to assign.",
          reasonDetails: [],
        }],
        openSlots: 0,
        unfilledSlots: 0,
        fullyCrewed: false,
      });
      continue;
    }
    const policy = resolveSportAutoAssignPolicy(policies, event.sportCode);
    // Backstop. The scope query already excludes held sports, so this should
    // not fire; it exists so a future change to that filter degrades into a
    // correctly-reported skip rather than assigning a sport that is on hold.
    if (policy === SportAutoAssignPolicy.HOLD) {
      events.push({
        shiftGroupId: group.id,
        eventId: event.id,
        summary: event.summary,
        startsAt: iso(event.startsAt),
        sportCode: event.sportCode,
        workingVersion: group.workingCopy?.version ?? null,
        publishedVersion: group.publishedVersion,
        status: "skipped",
        proposals: [],
        skipped: [{
          shiftId: null,
          area: null,
          workerType: null,
          reasonCode: "sport_policy_hold",
          reason: `${event.sportCode} is on hold for auto assignment.`,
          reasonDetails: [SPORT_AUTO_ASSIGN_POLICY_DESCRIPTIONS.HOLD, "Change the policy in the sport setup wizard to include it."],
        }],
        openSlots: 0,
        unfilledSlots: 0,
        fullyCrewed: false,
      });
      continue;
    }
    if (group.workingCopy) {
      events.push({
        shiftGroupId: group.id,
        eventId: event.id,
        summary: event.summary,
        startsAt: iso(event.startsAt),
        sportCode: event.sportCode,
        workingVersion: group.workingCopy?.version ?? null,
        publishedVersion: group.publishedVersion,
        status: "skipped",
        proposals: [],
        skipped: [{
          shiftId: null,
          area: null,
          workerType: null,
          reasonCode: "pending_working_copy",
          reason: "This event already has pending schedule changes.",
          reasonDetails: ["Review or release the pending event changes before adding it to a bulk assignment."],
        }],
        openSlots: 0,
        unfilledSlots: 0,
        fullyCrewed: false,
      });
      continue;
    }

    const payload = parseWorkingPayload(group);
    const openSlots = payload.slots.filter((slot) => !slot.assignment && slotInScope(slot, scope, policy));
    if (openSlots.length === 0) {
      events.push(buildEventResult({ event, group, payload, openSlots }, [], [{
        shiftId: null,
        area: scope.area,
        workerType: scope.workerScope === "ALL" ? null : scope.workerScope,
        reasonCode: "no_open_slots",
        reason: openSlotsScopeReason(scope, policy),
        reasonDetails: [],
      }]));
      continue;
    }
    readyStates.push({ event, group, payload, openSlots });
  }

  const targetSlots = readyStates.flatMap((state) => state.openSlots.map((slot) => candidateTarget(slot, state.event.sportCode)));
  if (targetSlots.length > 0) {
    const startsAt = new Date(Math.min(...targetSlots.map((target) => target.startsAt.getTime())));
    const endsAt = new Date(Math.max(...targetSlots.map((target) => target.endsAt.getTime())));
    const loadedCandidates = await loadCandidateScoringUsersForRange({ startsAt, endsAt });
    const candidates = loadedCandidates.filter((candidate) => candidate.role !== Role.COLLABORATOR);
    const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));

    for (const state of readyStates) {
      const usedUserIds = new Set<string>();
      const proposals: BulkAssignmentPreviewProposal[] = [];
      const skipped: BulkAssignmentPreviewSkipped[] = [];
      for (const slot of state.openSlots) {
        const target = candidateTarget(slot, state.event.sportCode);
        const scores = scoreCandidatesForShift({ shift: target, candidates, now: new Date() });
        const eventHasTravelRoster = sportHasTravelRoster(travelRosterCounts, state.event.sportCode);
        const chosen = scores.find((score) => {
          const candidate = candidatesById.get(score.userId);
          if (!candidate || usedUserIds.has(score.userId)) return false;
          // The sport roster is the pool, not a tiebreaker.
          if (!isSportRosterEligible(score, state.event.sportCode)) return false;
          // Away games narrow that pool to whoever travels.
          if (!isTravelEligible(candidate.sportAssignments, state.event.sportCode, state.event.isHome, eventHasTravelRoster)) {
            return false;
          }
          if (shiftWorkerTypeForProfile(candidate) !== slot.workerType) return false;
          if (!hasAreaFit(score) || score.blockingConflict) return false;
          return true;
        });
        if (!chosen) {
          skipped.push(buildSkippedSlot(slot, scores, candidatesById, usedUserIds, state.event.sportCode, {
            isHome: state.event.isHome,
            hasTravelRoster: eventHasTravelRoster,
          }));
          continue;
        }

        const candidate = candidatesById.get(chosen.userId)!;
        usedUserIds.add(candidate.id);
        proposals.push({
          proposalId: `${state.group.id}:${slot.sourceShiftId ?? slot.key}:${candidate.id}`,
          shiftGroupId: state.group.id,
          shiftId: slot.sourceShiftId ?? slot.key,
          eventId: state.event.id,
          userId: candidate.id,
          eventSummary: state.event.summary,
          eventStartsAt: iso(state.event.startsAt),
          eventSportCode: state.event.sportCode,
          area: slot.area,
          workerType: slot.workerType,
          userName: candidate.name ?? candidate.id,
          userRole: candidate.role,
          score: chosen.score,
          bucket: chosen.bucket,
          reasons: chosen.reasons,
          warnings: chosen.warnings,
          advisoryConflict: chosen.advisoryConflict,
          advisoryConflictNote: chosen.advisoryConflictNote,
        });
        appendTentativeAssignment(candidate, target);
      }

      // Refusing to half-crew an event is all-or-nothing: drop the partial set
      // rather than staging a schedule that releases a position short.
      if (scope.requireFullCrew && proposals.length < state.openSlots.length) {
        events.push({
          ...buildEventResult(state, [], skipped),
          skipped: [
            {
              shiftId: null,
              area: null,
              workerType: null,
              reasonCode: "partial_crew_blocked",
              reason: `Only ${proposals.length} of ${state.openSlots.length} open slots could be filled.`,
              reasonDetails: ["Full-crew-only is on, so no assignment was proposed for this event."],
            },
            ...skipped,
          ],
        });
        continue;
      }
      events.push(buildEventResult(state, proposals, skipped));
    }
  }

  events.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime() || a.eventId.localeCompare(b.eventId));
  const fingerprint = buildFingerprint(scope, events, snapshots);
  const readyEvents = events.filter((event) => event.status === "ready");
  const people = summarizeAssignmentPeople(events.flatMap((event) => event.proposals));
  const proposingEvents = events.filter((event) => event.proposals.length > 0);
  return {
    generatedAt: new Date().toISOString(),
    scope,
    fingerprint,
    events,
    people,
    summary: {
      eventsMatched: events.length,
      eventsReady: readyEvents.length,
      openSlots: readyEvents.reduce((sum, event) => sum + event.openSlots, 0),
      proposed: events.reduce((sum, event) => sum + event.proposals.length, 0),
      skipped: events.reduce((sum, event) => sum + event.skipped.length, 0),
      warnings: events.reduce((sum, event) => sum + event.proposals.filter((proposal) => proposal.warnings.length > 0).length, 0),
      peopleAffected: people.length,
      eventsFullyCrewed: proposingEvents.filter((event) => event.fullyCrewed).length,
      eventsPartiallyCrewed: proposingEvents.filter((event) => !event.fullyCrewed).length,
      eventsPendingChanges: events.filter((event) => event.skipped.some((entry) => entry.reasonCode === "pending_working_copy")).length,
      // Held events are excluded from the scope query, so this comes from the
      // separate count rather than the loaded rows.
      eventsOnHold: heldEventCount + events.filter((event) => event.skipped.some((entry) => entry.reasonCode === "sport_policy_hold")).length,
    },
  };
}

function proposalsByGroup(input: BulkAssignmentApplyInput, preview: BulkAssignmentPreviewResponse) {
  const available = new Map(
    preview.events.flatMap((event) => event.proposals.map((proposal) => [proposal.proposalId, proposal] as const)),
  );
  const seen = new Set<string>();
  const selected = input.proposals.map((proposal) => {
    if (seen.has(proposal.proposalId)) throw new HttpError(400, "Each bulk assignment proposal may be selected only once.");
    seen.add(proposal.proposalId);
    const current = available.get(proposal.proposalId);
    if (!current
      || current.shiftGroupId !== proposal.shiftGroupId
      || current.shiftId !== proposal.shiftId
      || current.eventId !== proposal.eventId
      || current.userId !== proposal.userId) {
      throw new HttpError(409, "The bulk assignment preview is stale. Review it again before applying.");
    }
    return current;
  });
  const grouped = new Map<string, BulkAssignmentPreviewProposal[]>();
  for (const proposal of selected) {
    const list = grouped.get(proposal.shiftGroupId) ?? [];
    list.push(proposal);
    grouped.set(proposal.shiftGroupId, list);
  }
  return grouped;
}

function addTentativeWindow(windowsByUser: Map<string, Array<{ startsAt: Date; endsAt: Date }>>, userId: string, window: { startsAt: Date; endsAt: Date }) {
  const windows = windowsByUser.get(userId) ?? [];
  if (windows.some((existing) => overlaps(existing, window))) {
    throw new HttpError(409, "The selected assignments contain an overlapping worker schedule. Review the preview again.");
  }
  windows.push(window);
  windowsByUser.set(userId, windows);
}

export async function applyBulkScheduleAssignment(
  rawInput: BulkAssignmentApplyInput,
  actor: { id: string; role: Role },
  enqueueRelease: EnqueueBulkRelease,
) {
  const input = bulkAssignmentApplySchema.parse(rawInput);
  const preview = await getBulkAssignmentPreview(input.scope);
  if (preview.fingerprint !== input.fingerprint) {
    throw new HttpError(409, "The bulk assignment preview is stale. Review it again before applying.");
  }
  const grouped = proposalsByGroup(input, preview);
  if (grouped.size === 0) throw new HttpError(400, "Select at least one proposed assignment.");

  const batchId = randomUUID();
  const now = new Date();
  const releasePlans = await Promise.all(
    [...grouped.keys()].map(async (shiftGroupId) => ({
      shiftGroupId,
      release: await enqueueRelease({ shiftGroupId, version: 1, now, batchId }),
    })),
  );
  const releaseByGroup = new Map(releasePlans.map((plan) => [plan.shiftGroupId, plan.release]));
  const releaseAt = releasePlans[0]?.release.at;
  if (!releaseAt) throw new HttpError(503, "The automatic release timer could not start. Try again.");

  const created = await db.$transaction(async (tx) => {
    const groupIds = [...grouped.keys()];
    const groups = await tx.shiftGroup.findMany({ where: { id: { in: groupIds } }, select: bulkShiftGroupSelect });
    if (groups.length !== groupIds.length) throw new HttpError(409, "One or more selected events changed. Review the preview again.");
    const groupById = new Map(groups.map((group) => [group.id, group]));
    const liveSportCodes = [...new Set(groups.map((group) => group.event.sportCode).filter((code): code is string => Boolean(code)))];
    const livePolicies = await loadSportAutoAssignPolicies(liveSportCodes);
    const liveTravelCounts = await loadTravelRosterCounts(
      [...new Set(groups.filter((group) => group.event.isHome === false)
        .map((group) => group.event.sportCode)
        .filter((code): code is string => Boolean(code)))],
    );
    const userIds = [...new Set([...grouped.values()].flat().map((proposal) => proposal.userId))];
    const users = await tx.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        active: true,
        role: true,
        staffingType: true,
        collaboratorPolicy: { select: { status: true, grants: { select: { capabilityKey: true } } } },
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
    const userById = new Map(users.map((user) => [user.id, user]));
    const tentativeWindows = new Map<string, Array<{ startsAt: Date; endsAt: Date }>>();
    const workingByGroup = new Map<string, WorkingSchedulePayload>();
    const auditEntries: Parameters<typeof createAuditEntriesTx>[1] = [];

    for (const [shiftGroupId, proposals] of grouped) {
      const group = groupById.get(shiftGroupId)!;
      if (group.workingCopy) throw new HttpError(409, "One or more selected events now has pending changes. Review the preview again.");
      const matchingPreview = preview.events.find((event) => event.shiftGroupId === group.id);
      if (!matchingPreview || matchingPreview.publishedVersion !== group.publishedVersion || matchingPreview.status !== "ready") {
        throw new HttpError(409, "One or more selected events changed. Review the preview again.");
      }

      const groupPolicy = resolveSportAutoAssignPolicy(livePolicies, group.event.sportCode);
      if (groupPolicy === SportAutoAssignPolicy.HOLD) {
        throw new HttpError(409, "One of these sports was put on hold for auto assignment. Review the preview again.");
      }

      let working = parseWorkingPayload(group);
      const assignedWithinEvent = new Set(
        working.slots.flatMap((slot) => slot.assignment ? [slot.assignment.userId] : []),
      );
      for (const proposal of proposals) {
        const slot = working.slots.find((candidate) => candidate.sourceShiftId === proposal.shiftId || candidate.key === proposal.shiftId);
        if (!slot || slot.assignment) throw new HttpError(409, "One or more selected slots is no longer open. Review the preview again.");
        const user = userById.get(proposal.userId);
        if (!user?.active) throw new HttpError(409, "One of the proposed workers is no longer active.");
        if (user.role === Role.COLLABORATOR || scheduleAssigneeWorkerType(user) !== slot.workerType) {
          throw new HttpError(409, "One of the proposed workers no longer matches the slot rules.");
        }
        if (!isOnSportRoster(user.sportAssignments, group.event.sportCode)) {
          throw new HttpError(409, "One of the proposed workers is no longer on this event's sport roster.");
        }
        if (!policyAllowsWorkerType(groupPolicy, slot.workerType)) {
          throw new HttpError(409, "One of these sports no longer auto-assigns this kind of slot. Review the preview again.");
        }
        if (!isTravelEligible(
          user.sportAssignments,
          group.event.sportCode,
          group.event.isHome,
          sportHasTravelRoster(liveTravelCounts, group.event.sportCode),
        )) {
          throw new HttpError(409, "One of the proposed workers is no longer on the travel roster for an away game.");
        }
        if (assignedWithinEvent.has(user.id)) {
          throw new HttpError(409, "A worker cannot receive two assignments in the same event.");
        }
        const window = effectiveSlotWindow(slot);
        await checkTimeConflict(tx, user.id, window.startsAt, window.endsAt);
        addTentativeWindow(tentativeWindows, user.id, window);
        const availability = evaluateAvailabilityPreferences(user.availabilityBlocks, window);
        if (availability.blocking) throw new HttpError(409, availability.blocking.note);
        working = applyWorkingScheduleCommand(working, {
          type: "assign",
          slotKey: slot.key,
          userId: user.id,
        }, () => `bulk:${randomUUID()}`);
        working = {
          ...working,
          slots: working.slots.map((candidate) => candidate.key === slot.key && candidate.assignment
            ? { ...candidate, assignment: { ...candidate.assignment, source: "AUTO_FILL" } }
            : candidate),
        };
        assignedWithinEvent.add(user.id);
      }
      workingByGroup.set(group.id, workingSchedulePayloadSchema.parse(working));
    }

    await tx.scheduleBulkAssignment.create({
      data: {
        id: batchId,
        createdById: actor.id,
        // The column holds a single code; a multi-sport scope is recorded in
        // full on the audit entries below.
        sportCode: input.scope.sportCodes.length === 1 ? input.scope.sportCodes[0]! : null,
        rangeStartsAt: new Date(input.scope.rangeStartsAt),
        rangeEndsAt: new Date(input.scope.rangeEndsAt),
        area: input.scope.area,
        previewFingerprint: input.fingerprint,
        releaseAt,
      },
    });
    await tx.scheduleBulkAssignmentItem.createMany({
      data: [...grouped.entries()].map(([shiftGroupId, proposals]) => ({
        bulkAssignmentId: batchId,
        shiftGroupId,
        expectedVersion: 1,
        proposalPayload: proposals.map((proposal) => ({ shiftId: proposal.shiftId, userId: proposal.userId })) as unknown as Prisma.InputJsonValue,
      })),
    });

    for (const [shiftGroupId, working] of workingByGroup) {
      const group = groupById.get(shiftGroupId)!;
      const release = releaseByGroup.get(shiftGroupId)!;
      await tx.shiftGroupWorkingCopy.create({
        data: {
          shiftGroupId,
          version: 1,
          basePublishedVersion: group.publishedVersion,
          payloadVersion: 2,
          payload: working as unknown as Prisma.InputJsonValue,
          autoReleaseAt: release.at,
          autoReleaseRunId: release.runId,
          createdById: actor.id,
          updatedById: actor.id,
        },
      });
      auditEntries.push({
        actorId: actor.id,
        actorRole: actor.role,
        entityType: "schedule_bulk_assignment",
        entityId: batchId,
        action: "schedule_bulk_assignment_staged",
        before: { shiftGroupId, workingVersion: 0 },
        after: {
          shiftGroupId,
          workingVersion: 1,
          proposalCount: grouped.get(shiftGroupId)?.length ?? 0,
          releaseAt: release.at.toISOString(),
          batchId,
          scope: {
            sportCodes: input.scope.sportCodes,
            workerScope: input.scope.workerScope,
            period: input.scope.period,
            area: input.scope.area,
            rangeStartsAt: input.scope.rangeStartsAt,
            rangeEndsAt: input.scope.rangeEndsAt,
          },
        },
      });
    }
    await createAuditEntriesTx(tx, auditEntries);
    return {
      batchId,
      releaseAt: releaseAt.toISOString(),
      eventCount: grouped.size,
      assignmentCount: input.proposals.length,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  return created;
}

export async function recordBulkScheduleReleaseOutcome(args: {
  batchId: string;
  shiftGroupId: string;
  expectedVersion: number;
  status: "RELEASED" | "BLOCKED" | "SUPERSEDED";
  releasedVersion?: number;
  error?: string;
}) {
  await db.scheduleBulkAssignmentItem.updateMany({
    where: {
      bulkAssignmentId: args.batchId,
      shiftGroupId: args.shiftGroupId,
      expectedVersion: args.expectedVersion,
      status: "PENDING",
    },
    data: {
      status: args.status,
      releasedVersion: args.releasedVersion,
      error: args.error ?? null,
    },
  });
  await finalizeBulkScheduleAssignment(args.batchId);
}

export async function finalizeBulkScheduleAssignment(batchId: string) {
  const batch = await db.scheduleBulkAssignment.findUnique({
    where: { id: batchId },
    include: { items: true },
  });
  if (!batch || batch.notificationSentAt || batch.items.length === 0 || batch.items.some((item) => item.status === "PENDING")) return;

  const releasedCount = batch.items.filter((item) => item.status === "RELEASED").length;
  const status = releasedCount === batch.items.length
    ? "RELEASED"
    : releasedCount > 0
      ? "PARTIAL"
      : "BLOCKED";
  await db.scheduleBulkAssignment.update({ where: { id: batchId }, data: { status } });
  await createBulkScheduleAssignmentNotifications(batchId);
  await db.scheduleBulkAssignment.update({ where: { id: batchId }, data: { notificationSentAt: new Date() } });
}
