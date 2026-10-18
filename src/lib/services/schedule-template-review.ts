import { Role, ShiftArea, ShiftAssignmentStatus, ShiftWorkerType } from "@prisma/client";
import { createAuditEntry } from "@/lib/audit";
import { db } from "@/lib/db";
import { sportDefaultShiftWindow } from "@/lib/schedule-defaults";
import { HttpError } from "@/lib/http";
import type {
  CopyForwardApplyResult,
  CopyForwardPreview,
  CopyForwardProposal,
  CopyForwardSkippedSlot,
  CopyForwardSourceEvent,
  ScheduleTemplateDriftPreview,
  ScheduleTemplateReview,
} from "@/lib/schedule-template-review-types";
import { getCandidateScoresForShiftIds } from "@/lib/services/candidate-scoring";
import { directAssignShift } from "@/lib/services/shift-assignments";
import { ACTIVE_ASSIGNMENT_STATUSES } from "@/lib/shift-constants";
import { shiftWorkerTypeForProfile } from "@/lib/shift-display";

const ACTIVE_STATUSES = new Set<string>(ACTIVE_ASSIGNMENT_STATUSES);
const AREA_ORDER: ShiftArea[] = ["VIDEO", "PHOTO", "GRAPHICS", "SOCIAL", "COMMS", "LIVE_PRODUCTION"];
const AREA_RANK = new Map<string, number>(AREA_ORDER.map((area, index) => [area, index]));

type LoadedTargetGroup = NonNullable<Awaited<ReturnType<typeof loadTargetGroup>>>;
type TargetShift = LoadedTargetGroup["shifts"][number];
type SourceCandidate = Awaited<ReturnType<typeof loadSourceCandidates>>[number];
type SourceShift = NonNullable<SourceCandidate["shiftGroup"]>["shifts"][number];
type SourceAssignment = SourceShift["assignments"][number];

function templateCounts(config: {
  homeCount: number;
  awayCount: number;
  homeStaffCount?: number | null;
  homeStudentCount?: number | null;
  awayStaffCount?: number | null;
  awayStudentCount?: number | null;
}, isHome: boolean): Record<ShiftWorkerType, number> {
  if (isHome) {
    return {
      FT: config.homeStaffCount ?? 0,
      ST: config.homeStudentCount ?? config.homeCount,
    };
  }
  return {
    FT: config.awayStaffCount ?? 0,
    ST: config.awayStudentCount ?? config.awayCount,
  };
}

function slotKey(area: ShiftArea | string, workerType: ShiftWorkerType | string) {
  return `${area}:${workerType}`;
}

function sortSlots(a: { area: string; workerType: string; startsAt?: Date; id?: string }, b: { area: string; workerType: string; startsAt?: Date; id?: string }) {
  return (a.startsAt?.getTime() ?? 0) - (b.startsAt?.getTime() ?? 0)
    || (AREA_RANK.get(a.area) ?? AREA_ORDER.length) - (AREA_RANK.get(b.area) ?? AREA_ORDER.length)
    || a.workerType.localeCompare(b.workerType)
    || (a.id ?? "").localeCompare(b.id ?? "");
}

function activeAssignment(shift: { assignments: Array<{ status: ShiftAssignmentStatus | string }> }) {
  return shift.assignments.find((assignment) => ACTIVE_STATUSES.has(assignment.status));
}

function isOpenShift(shift: TargetShift) {
  return !activeAssignment(shift);
}

function sourceEventPayload(source: SourceCandidate | null): CopyForwardSourceEvent | null {
  if (!source) return null;
  return {
    id: source.id,
    summary: source.summary,
    startsAt: source.startsAt.toISOString(),
    isHome: source.isHome,
    locationId: source.locationId,
  };
}

async function loadTargetGroup(shiftGroupId: string) {
  return db.shiftGroup.findUnique({
    where: { id: shiftGroupId },
    select: {
      id: true,
      eventId: true,
      manuallyEdited: true,
      event: {
        select: {
          id: true,
          summary: true,
          sportCode: true,
          isHome: true,
          allDay: true,
          sourceId: true,
          locationId: true,
          startsAt: true,
          endsAt: true,
        },
      },
      shifts: {
        select: {
          id: true,
          area: true,
          workerType: true,
          startsAt: true,
          endsAt: true,
          callStartsAt: true,
          callEndsAt: true,
          assignments: {
            select: {
              id: true,
              status: true,
            },
          },
        },
        orderBy: [{ startsAt: "asc" }, { area: "asc" }, { workerType: "asc" }, { id: "asc" }],
      },
    },
  });
}

async function loadSportConfig(sportCode: string | null) {
  if (!sportCode) return null;
  return db.sportConfig.findUnique({
    where: { sportCode },
    select: {
      active: true,
      shiftStartOffset: true,
      shiftEndOffset: true,
      shiftConfigs: {
        select: {
          area: true,
          homeCount: true,
          awayCount: true,
          homeStaffCount: true,
          homeStudentCount: true,
          awayStaffCount: true,
          awayStudentCount: true,
        },
      },
    },
  });
}

async function loadSourceCandidates(group: LoadedTargetGroup) {
  if (!group.event.sportCode) return [];
  return db.calendarEvent.findMany({
    where: {
      id: { not: group.eventId },
      sportCode: group.event.sportCode,
      status: { not: "CANCELLED" },
      isHidden: false,
      archivedAt: null,
      startsAt: { lt: group.event.startsAt },
      shiftGroup: {
        is: {
          shifts: {
            some: {
              assignments: {
                some: { status: { in: ACTIVE_ASSIGNMENT_STATUSES as ShiftAssignmentStatus[] } },
              },
            },
          },
        },
      },
    },
    select: {
      id: true,
      summary: true,
      startsAt: true,
      isHome: true,
      sourceId: true,
      locationId: true,
      shiftGroup: {
        select: {
          shifts: {
            select: {
              id: true,
              area: true,
              workerType: true,
              startsAt: true,
              assignments: {
                where: { status: { in: ACTIVE_ASSIGNMENT_STATUSES as ShiftAssignmentStatus[] } },
                select: {
                  id: true,
                  userId: true,
                  status: true,
                  user: {
                    select: {
                      id: true,
                      name: true,
                      role: true,
                      staffingType: true,
                      active: true,
                    },
                  },
                },
                orderBy: { createdAt: "asc" },
              },
            },
            orderBy: [{ startsAt: "asc" }, { area: "asc" }, { workerType: "asc" }, { id: "asc" }],
          },
        },
      },
    },
    orderBy: { startsAt: "desc" },
    take: 10,
  });
}

function rankSourceCandidate(target: LoadedTargetGroup, source: SourceCandidate) {
  let score = 0;
  if (source.isHome === target.event.isHome) score += 8;
  if (source.locationId && source.locationId === target.event.locationId) score += 4;
  if (source.sourceId && source.sourceId === target.event.sourceId) score += 2;
  return score;
}

function pickSourceCandidate(target: LoadedTargetGroup, candidates: SourceCandidate[]) {
  return [...candidates].sort((a, b) =>
    rankSourceCandidate(target, b) - rankSourceCandidate(target, a)
    || b.startsAt.getTime() - a.startsAt.getTime()
    || a.id.localeCompare(b.id)
  )[0] ?? null;
}

function buildTemplateDrift(group: LoadedTargetGroup, sportConfig: Awaited<ReturnType<typeof loadSportConfig>>): ScheduleTemplateDriftPreview {
  if (!group.event.sportCode) {
    return {
      status: "no_event_sport",
      message: "This event has no sport, so no sport template can be compared.",
      manuallyEdited: group.manuallyEdited,
      expected: [],
      missing: [],
      extra: [],
    };
  }

  if (!sportConfig?.active || sportConfig.shiftConfigs.length === 0) {
    return {
      status: "no_active_template",
      message: "No active sport template exists for this event.",
      manuallyEdited: group.manuallyEdited,
      expected: [],
      missing: [],
      extra: [],
    };
  }

  const expectedCounts = new Map<string, { area: ShiftArea; workerType: ShiftWorkerType; expected: number }>();
  const currentCounts = new Map<string, number>();
  const isHome = group.event.isHome ?? true;
  const defaultWindow = sportDefaultShiftWindow(group.event, sportConfig);
  const startsAt = defaultWindow.startsAt;
  const endsAt = defaultWindow.endsAt;

  for (const config of sportConfig.shiftConfigs) {
    const counts = templateCounts(config, isHome);
    for (const workerType of ["FT", "ST"] as const) {
      expectedCounts.set(slotKey(config.area, workerType), {
        area: config.area,
        workerType,
        expected: counts[workerType],
      });
    }
  }

  for (const shift of group.shifts) {
    const key = slotKey(shift.area, shift.workerType);
    currentCounts.set(key, (currentCounts.get(key) ?? 0) + 1);
    if (!expectedCounts.has(key)) {
      expectedCounts.set(key, {
        area: shift.area,
        workerType: shift.workerType,
        expected: 0,
      });
    }
  }

  const expected = [...expectedCounts.values()]
    .map((row) => ({
      area: row.area,
      workerType: row.workerType,
      expected: row.expected,
      current: currentCounts.get(slotKey(row.area, row.workerType)) ?? 0,
    }))
    .sort(sortSlots);

  const missing = expected
    .filter((row) => row.expected > row.current)
    .map((row) => ({
      area: row.area,
      workerType: row.workerType,
      count: row.expected - row.current,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    }));

  const extra = expected
    .filter((row) => row.current > row.expected)
    .map((row) => ({
      area: row.area,
      workerType: row.workerType,
      count: row.current - row.expected,
    }));

  return {
    status: "ready",
    message: group.manuallyEdited
      ? "Manual slots are preserved. Missing template slots are additive only."
      : "Current slots are compared to the active sport template.",
    manuallyEdited: group.manuallyEdited,
    expected,
    missing,
    extra,
  };
}

function sourceAssignmentsBySlot(source: SourceCandidate | null) {
  const byKey = new Map<string, Array<{ shift: SourceShift; assignment: SourceAssignment }>>();
  if (!source?.shiftGroup) return byKey;

  for (const shift of source.shiftGroup.shifts) {
    for (const assignment of shift.assignments) {
      const key = slotKey(shift.area, shift.workerType);
      const list = byKey.get(key) ?? [];
      list.push({ shift, assignment });
      byKey.set(key, list);
    }
  }

  for (const entries of byKey.values()) {
    entries.sort((a, b) => sortSlots(a.shift, b.shift) || a.assignment.id.localeCompare(b.assignment.id));
  }

  return byKey;
}

function userMatchesWorkerType(workerType: ShiftWorkerType, user: { role: Role; staffingType?: ShiftWorkerType | string | null }) {
  return shiftWorkerTypeForProfile(user) === workerType;
}

async function buildCopyForwardPreview(group: LoadedTargetGroup): Promise<CopyForwardPreview> {
  const candidates = await loadSourceCandidates(group);
  const source = pickSourceCandidate(group, candidates);
  const openShifts = group.shifts.filter(isOpenShift).sort(sortSlots);
  const sourceAssignments = sourceAssignmentsBySlot(source);
  const scoresByShift = await getCandidateScoresForShiftIds(openShifts.map((shift) => shift.id));
  const usedUserIds = new Set<string>();
  const proposals: CopyForwardProposal[] = [];
  const skipped: CopyForwardSkippedSlot[] = [];

  if (!source) {
    return {
      sourceEvent: null,
      proposals: [],
      skipped: openShifts.map((shift) => ({
        shiftId: shift.id,
        area: shift.area,
        workerType: shift.workerType,
        reason: "No earlier staffed event matched this sport.",
      })),
      summary: { openSlots: openShifts.length, proposed: 0, skipped: openShifts.length, warnings: 0 },
    };
  }

  const consumedByKey = new Map<string, number>();
  for (const shift of openShifts) {
    const key = slotKey(shift.area, shift.workerType);
    const sourceList = sourceAssignments.get(key) ?? [];
    const index = consumedByKey.get(key) ?? 0;
    consumedByKey.set(key, index + 1);
    const sourceEntry = sourceList[index];

    if (!sourceEntry) {
      skipped.push({
        shiftId: shift.id,
        area: shift.area,
        workerType: shift.workerType,
        reason: "No matching staffed source slot.",
      });
      continue;
    }

    const { assignment, shift: sourceShift } = sourceEntry;
    const user = assignment.user;
    if (!user.active) {
      skipped.push({
        shiftId: shift.id,
        sourceShiftId: sourceShift.id,
        sourceAssignmentId: assignment.id,
        area: shift.area,
        workerType: shift.workerType,
        userId: user.id,
        userName: user.name,
        reason: "Source worker is inactive.",
      });
      continue;
    }
    if (usedUserIds.has(user.id)) {
      skipped.push({
        shiftId: shift.id,
        sourceShiftId: sourceShift.id,
        sourceAssignmentId: assignment.id,
        area: shift.area,
        workerType: shift.workerType,
        userId: user.id,
        userName: user.name,
        reason: "Source worker is already proposed for another copied slot.",
      });
      continue;
    }
    if (!userMatchesWorkerType(shift.workerType, user)) {
      skipped.push({
        shiftId: shift.id,
        sourceShiftId: sourceShift.id,
        sourceAssignmentId: assignment.id,
        area: shift.area,
        workerType: shift.workerType,
        userId: user.id,
        userName: user.name,
        reason: "Source worker scheduling class does not match this slot type.",
      });
      continue;
    }

    const score = scoresByShift.get(shift.id)?.find((candidate) => candidate.userId === user.id) ?? null;
    if (score?.blockingConflict) {
      skipped.push({
        shiftId: shift.id,
        sourceShiftId: sourceShift.id,
        sourceAssignmentId: assignment.id,
        area: shift.area,
        workerType: shift.workerType,
        userId: user.id,
        userName: user.name,
        reason: score.advisoryConflictNote ?? score.warnings[0]?.label ?? "Source worker has a blocking conflict.",
      });
      continue;
    }

    usedUserIds.add(user.id);
    proposals.push({
      shiftId: shift.id,
      sourceShiftId: sourceShift.id,
      sourceAssignmentId: assignment.id,
      area: shift.area,
      workerType: shift.workerType,
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      userStaffingType: shiftWorkerTypeForProfile(user),
      score: score?.score ?? null,
      bucket: score?.bucket ?? null,
      reasons: score?.reasons ?? [],
      warnings: score?.warnings ?? [],
      advisoryConflict: Boolean(score?.advisoryConflict),
      advisoryConflictNote: score?.advisoryConflictNote ?? null,
    });
  }

  return {
    sourceEvent: sourceEventPayload(source),
    proposals,
    skipped,
    summary: {
      openSlots: openShifts.length,
      proposed: proposals.length,
      skipped: skipped.length,
      warnings: proposals.filter((proposal) => proposal.warnings.length > 0 || proposal.advisoryConflict).length,
    },
  };
}

export async function getScheduleTemplateReview(shiftGroupId: string): Promise<ScheduleTemplateReview> {
  const group = await loadTargetGroup(shiftGroupId);
  if (!group) throw new HttpError(404, "Shift group not found");

  const [sportConfig, copyForward] = await Promise.all([
    loadSportConfig(group.event.sportCode),
    buildCopyForwardPreview(group),
  ]);

  return {
    shiftGroupId: group.id,
    eventId: group.eventId,
    eventSummary: group.event.summary,
    generatedAt: new Date().toISOString(),
    template: buildTemplateDrift(group, sportConfig),
    copyForward,
  };
}

export async function applyCopyForwardCrew(
  shiftGroupId: string,
  actor: { id: string; role: Role },
): Promise<CopyForwardApplyResult> {
  const review = await getScheduleTemplateReview(shiftGroupId);
  const results: CopyForwardApplyResult["results"] = [];
  let assigned = 0;
  let conflicts = 0;

  for (const proposal of review.copyForward.proposals) {
    try {
      await directAssignShift(proposal.shiftId, proposal.userId, actor.id);
      assigned += 1;
      if (proposal.advisoryConflict) conflicts += 1;
      results.push({
        shiftId: proposal.shiftId,
        userId: proposal.userId,
        userName: proposal.userName,
        status: "assigned",
      });
    } catch (err) {
      results.push({
        shiftId: proposal.shiftId,
        userId: proposal.userId,
        userName: proposal.userName,
        status: "skipped",
        reason: err instanceof HttpError ? err.message : "Assignment failed during final safety check.",
      });
    }
  }

  const skipped = review.copyForward.skipped.length + results.filter((result) => result.status === "skipped").length;

  await createAuditEntry({
    actorId: actor.id,
    actorRole: actor.role,
    entityType: "shift_group",
    entityId: shiftGroupId,
    action: "shift_group_copy_forward_applied",
    after: {
      sourceEventId: review.copyForward.sourceEvent?.id ?? null,
      assigned,
      skipped,
    },
  });

  return {
    shiftGroupId,
    sourceEvent: review.copyForward.sourceEvent,
    assigned,
    skipped,
    conflicts,
    results,
  };
}
