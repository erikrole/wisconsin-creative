import type { Role } from "@prisma/client";
import { badges } from "@/lib/badges";
import { HttpError } from "@/lib/http";
import { enqueuePendingScheduleRelease } from "@/lib/schedule-auto-release";
import {
  footballStaffingSheetApplyRequestSchema,
  type FootballStaffingSheetApplyRequest,
} from "@/lib/football-staffing-sheet";
import type { WorkingScheduleCommand } from "@/lib/schedule-working-copy";
import { previewFootballStaffingSheet } from "@/lib/services/football-staffing-sheet-preview";
import { publishShiftGroup } from "@/lib/services/schedule-publication";
import {
  getWorkingScheduleEditor,
  getWorkingScheduleEventEndsAt,
  mutateWorkingSchedule,
} from "@/lib/services/schedule-working-copy";

export async function applyReviewedFootballStaffingSheet(
  rawInput: FootballStaffingSheetApplyRequest,
  actor: { id: string; role: Role },
) {
  const input = footballStaffingSheetApplyRequestSchema.parse(rawInput);
  const preview = await previewFootballStaffingSheet({
    sportCode: input.sportCode,
    source: input.source,
    tsv: input.tsv,
  });
  if (
    preview.sourceFingerprint !== input.sourceFingerprint
    || preview.reviewFingerprint !== input.reviewFingerprint
  ) {
    throw new HttpError(409, "The Football staffing-sheet review is stale. Preview the pasted snapshot again.");
  }

  const row = preview.applyRows.find((candidate) =>
    candidate.sourceA1 === input.selection.sourceA1
    && candidate.eventId === input.selection.eventId,
  );
  if (!row || !row.canApply || !row.shiftGroupId || row.workingVersion === null) {
    throw new HttpError(409, "This source cell is no longer an applicable reviewed change. Preview it again.");
  }
  if (row.workingVersion !== input.selection.expectedVersion) {
    throw new HttpError(409, "This event's working schedule changed. Preview the sheet again before applying.");
  }

  const proof = {
    source: input.source,
    sourceA1: row.sourceA1,
    sourceRaw: row.sourceRaw,
    sourceFingerprint: input.sourceFingerprint,
    reviewFingerprint: input.reviewFingerprint,
    event: {
      id: row.eventId,
      startsAt: row.eventStartsAt,
      opponent: row.eventOpponent,
      isHome: row.eventIsHome,
    },
  };
  let command: WorkingScheduleCommand;
  if (input.selection.kind === "ASSIGN_ROLE") {
    const selection = input.selection;
    if (row.kind !== "DIRECT_ASSIGNMENT" || row.userId !== selection.userId) {
      throw new HttpError(409, "The reviewed person no longer matches this source cell.");
    }
    const slotIsReviewed = row.assignedSlotKey
      ? row.assignedSlotKey === selection.slotKey
      : row.openSlots.some((slot) => slot.key === selection.slotKey);
    if (!slotIsReviewed) {
      throw new HttpError(409, "The selected working slot is not part of the current review.");
    }
    command = {
      type: "applyFootballSheetAssignment",
      slotKey: selection.slotKey,
      userId: selection.userId,
      role: row.role,
      proof,
    };
  } else {
    if (row.kind !== "INTENTIONALLY_UNSTAFFED" || row.currentRoleHolders.length === 0) {
      throw new HttpError(409, "This source cell is no longer an intentional vacancy change.");
    }
    command = {
      type: "clearFootballSheetRole",
      role: row.role,
      proof,
    };
  }

  const eventHasEnded = (await getWorkingScheduleEventEndsAt(row.shiftGroupId)).getTime() <= Date.now();
  const autoRelease = eventHasEnded
    ? null
    : await enqueuePendingScheduleRelease({
      shiftGroupId: row.shiftGroupId,
      version: input.selection.expectedVersion + 1,
    });
  const editor = await mutateWorkingSchedule(
    row.shiftGroupId,
    input.selection.expectedVersion,
    command,
    actor,
    autoRelease,
  );
  if (!eventHasEnded) return editor;

  const publication = await publishShiftGroup(
    row.shiftGroupId,
    actor.id,
    editor.workingVersion,
    actor.role,
    { clearNotificationPending: true },
  );
  await Promise.allSettled(
    publication.affectedUserIds.map((userId) => badges.onShiftsWorked({ userId }, { notify: false })),
  );
  return getWorkingScheduleEditor(row.shiftGroupId);
}
