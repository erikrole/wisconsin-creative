import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { scheduleAssigneeWorkerType } from "@/lib/schedule-assignee";
import {
  parseFootballStaffingSheet,
  resolveFootballSheetEvents,
  resolveFootballSheetPeople,
  type FootballStaffingSheetApplyRow,
  type FootballStaffingSheetPreviewRequest,
} from "@/lib/football-staffing-sheet";
import { getFootballStaffingWorkingContexts } from "@/lib/services/schedule-working-copy";

function fingerprint(value: unknown) {
  const hash = createHash("sha256");
  hash.write(JSON.stringify(value));
  return hash.digest("hex");
}

function canonicalSnapshot(tsv: string) {
  return tsv.replace(/\r\n?/g, "\n").replace(/\n$/, "");
}

export async function previewFootballStaffingSheet(input: FootballStaffingSheetPreviewRequest) {
  const parsed = parseFootballStaffingSheet(input);
  const [rawUsers, events] = await Promise.all([
    db.user.findMany({
      where: { active: true, hiddenFromRoster: false },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        staffingType: true,
        collaboratorPolicy: {
          select: { status: true, grants: { select: { capabilityKey: true } } },
        },
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
    db.calendarEvent.findMany({
      where: {
        sportCode: "FB",
        archivedAt: null,
        isHidden: false,
        status: { not: "CANCELLED" },
      },
      select: {
        id: true,
        summary: true,
        startsAt: true,
        sportCode: true,
        opponent: true,
        isHome: true,
        shiftGroup: { select: { id: true } },
      },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      take: 500,
    }),
  ]);
  const users = rawUsers.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    staffingType: user.staffingType,
    workerType: scheduleAssigneeWorkerType(user),
  }));

  const eventReviews = resolveFootballSheetEvents(parsed.headers, events, env.appTimezone);
  const cellReviews = resolveFootballSheetPeople(parsed.cells, users);
  const eventById = new Map(events.map((event) => [event.id, event] as const));
  const matchedEventIds = eventReviews.flatMap((review) =>
    review.status === "MATCHED" && review.candidates[0] ? [review.candidates[0].id] : [],
  );
  const groupIds = matchedEventIds.flatMap((eventId) => {
    const groupId = eventById.get(eventId)?.shiftGroup?.id;
    return groupId ? [groupId] : [];
  });
  const contexts = await getFootballStaffingWorkingContexts(groupIds);
  const contextByGroupId = new Map(contexts.map((context) => [context.shiftGroupId, context] as const));
  const eventReviewByColumn = new Map(eventReviews.map((review) => [review.header.column, review] as const));

  const applyRows: FootballStaffingSheetApplyRow[] = [];
  for (const cell of cellReviews) {
    if (cell.resolution !== "DIRECT_ASSIGNMENT_MATCHED" && cell.resolution !== "INTENTIONALLY_UNSTAFFED") continue;
    const eventReview = eventReviewByColumn.get(cell.eventColumn);
    if (eventReview?.status !== "MATCHED" || !eventReview.candidates[0]) continue;
    const event = eventById.get(eventReview.candidates[0].id);
    const shiftGroupId = event?.shiftGroup?.id ?? null;
    const context = shiftGroupId ? contextByGroupId.get(shiftGroupId) ?? null : null;
    const currentRoleHolders = context?.slots.flatMap((slot) =>
      slot.assignment?.footballRoles.includes(cell.role)
        ? [{ slotKey: slot.key, userId: slot.assignment.userId, userName: slot.assignment.userName }]
        : [],
    ) ?? [];

    if (cell.resolution === "INTENTIONALLY_UNSTAFFED") {
      applyRows.push({
        kind: "INTENTIONALLY_UNSTAFFED",
        sourceA1: cell.source.a1,
        sourceRaw: cell.raw,
        role: cell.role,
        eventId: eventReview.candidates[0].id,
        eventSummary: eventReview.candidates[0].summary,
        eventStartsAt: eventReview.candidates[0].startsAt,
        eventOpponent: eventReview.candidates[0].opponent,
        eventIsHome: eventReview.candidates[0].isHome,
        shiftGroupId,
        workingVersion: context?.workingVersion ?? null,
        userId: null,
        userName: null,
        assignedSlotKey: null,
        openSlots: [],
        currentRoleHolders,
        canApply: Boolean(context && currentRoleHolders.length > 0),
        reason: !context
          ? "This event has no active working schedule."
          : currentRoleHolders.length > 0
            ? `Clear ${cell.role} from ${currentRoleHolders.length} current holder${currentRoleHolders.length === 1 ? "" : "s"}.`
            : `${cell.role} is already vacant.`,
      });
      continue;
    }

    const person = cell.personCandidates[0]!;
    const assignedSlot = context?.slots.find((slot) => slot.assignment?.userId === person.id) ?? null;
    const openSlots = context?.slots
      .filter((slot) => !slot.assignment && slot.workerType === person.workerType)
      .map((slot) => ({ key: slot.key, area: slot.area, workerType: slot.workerType })) ?? [];
    const alreadyHasRole = assignedSlot?.assignment?.footballRoles.includes(cell.role) ?? false;
    applyRows.push({
      kind: "DIRECT_ASSIGNMENT",
      sourceA1: cell.source.a1,
      sourceRaw: cell.raw,
      role: cell.role,
      eventId: eventReview.candidates[0].id,
      eventSummary: eventReview.candidates[0].summary,
      eventStartsAt: eventReview.candidates[0].startsAt,
      eventOpponent: eventReview.candidates[0].opponent,
      eventIsHome: eventReview.candidates[0].isHome,
      shiftGroupId,
      workingVersion: context?.workingVersion ?? null,
      userId: person.id,
      userName: person.name,
      assignedSlotKey: assignedSlot?.key ?? null,
      openSlots,
      currentRoleHolders,
      canApply: Boolean(context && !alreadyHasRole && (assignedSlot || openSlots.length > 0)),
      reason: !context
        ? "This event has no active working schedule."
        : alreadyHasRole
          ? `${person.name} already holds ${cell.role}.`
          : assignedSlot
            ? `Add ${cell.role} to ${person.name}'s current assignment.`
            : openSlots.length > 0
              ? `Choose the exact ${person.workerType === "ST" ? "Student" : "Staff"} slot for ${person.name}.`
              : `No compatible open slot is available for ${person.name}.`,
    });
  }

  const sourceFingerprint = fingerprint({ source: parsed.source, snapshot: canonicalSnapshot(input.tsv) });
  const reviewFingerprint = fingerprint({
    sourceFingerprint,
    events: eventReviews.map((review) => ({
      sourceA1: review.header.source.a1,
      status: review.status,
      candidates: review.candidates.map((candidate) => candidate.id),
    })),
    cells: cellReviews.map((review) => ({
      sourceA1: review.source.a1,
      resolution: review.resolution,
      candidates: review.personCandidates.map((candidate) => candidate.id),
    })),
    contexts: [...contexts].sort((a, b) => a.shiftGroupId.localeCompare(b.shiftGroupId)),
    applyRows,
  });
  const eventBlockers = eventReviews.filter((review) => review.status !== "MATCHED").length;
  const cellBlockers = cellReviews.filter((review) => review.blocking).length;

  return {
    source: parsed.source,
    dimensions: { rows: parsed.source.rowCount, columns: parsed.source.columnCount },
    sourceFingerprint,
    reviewFingerprint,
    eventReviews,
    rowIssues: parsed.rowIssues,
    cellReviews,
    applyRows,
    summary: {
      matchedEvents: eventReviews.length - eventBlockers,
      eventBlockers,
      resolvedDirectAssignments: cellReviews.filter((review) => review.resolution === "DIRECT_ASSIGNMENT_MATCHED").length,
      studentOpportunities: cellReviews.filter((review) => review.resolution === "STUDENT_OPPORTUNITY").length,
      intentionallyUnstaffed: cellReviews.filter((review) => review.resolution === "INTENTIONALLY_UNSTAFFED").length,
      blankCells: cellReviews.filter((review) => review.resolution === "BLANK").length,
      applicableChanges: applyRows.filter((row) => row.canApply).length,
      cellBlockers,
      rowBlockers: parsed.rowIssues.length,
      blockingReviewItems: eventBlockers + cellBlockers + parsed.rowIssues.length,
    },
    previewOnly: true as const,
  };
}
