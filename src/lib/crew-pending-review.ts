import type { WorkingScheduleSlot } from "@/lib/schedule-working-copy";

export type PendingCrewReviewUser = {
  id: string;
  name: string;
  avatarUrl: string | null;
};

export type PendingCrewClaim = {
  id: string;
  shiftId: string;
  hasConflict: boolean;
  conflictNote: string | null;
  user: PendingCrewReviewUser;
};

export type PendingCrewTrade = {
  id: string;
  assignmentId: string;
  status: "CLAIMED";
  notes: string | null;
  claimedBy: PendingCrewReviewUser | null;
  postedBy: PendingCrewReviewUser;
};

/** Open-slot claims belong on empty live slots, not a draft assignment that replaced them. */
export function claimsForWorkingSlot(
  slot: Pick<WorkingScheduleSlot, "sourceShiftId" | "assignment">,
  pendingClaims: PendingCrewClaim[],
): PendingCrewClaim[] {
  if (slot.assignment || !slot.sourceShiftId) return [];
  return pendingClaims.filter((claim) => claim.shiftId === slot.sourceShiftId);
}

/** A claimed trade is a request to take the live assignment still on this slot. */
export function tradeForWorkingSlot(
  slot: Pick<WorkingScheduleSlot, "assignment">,
  pendingTrades: PendingCrewTrade[],
): PendingCrewTrade | null {
  const assignmentId = slot.assignment?.sourceAssignmentId;
  if (!assignmentId) return null;
  return pendingTrades.find((trade) => trade.assignmentId === assignmentId) ?? null;
}
