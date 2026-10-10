import type { Role, ShiftArea, ShiftWorkerType } from "@prisma/client";
import { shiftWorkerTypeForProfile } from "@/lib/shift-display";

export type ShiftClaimProfile = {
  active: boolean;
  role: Role;
  staffingType: ShiftWorkerType;
  primaryArea: ShiftArea | null;
};

/**
 * Student claim visibility follows the worker's primary area. Photo and
 * Graphics operate as one shared claim pool; no other secondary assignment
 * widens the board.
 */
export function claimableShiftAreas(primaryArea: ShiftArea | null | undefined): ShiftArea[] {
  if (primaryArea === "PHOTO" || primaryArea === "GRAPHICS") {
    return ["PHOTO", "GRAPHICS"];
  }
  return primaryArea ? [primaryArea] : [];
}

export function canClaimShiftArea(
  primaryArea: ShiftArea | null | undefined,
  shiftArea: ShiftArea,
): boolean {
  return claimableShiftAreas(primaryArea).includes(shiftArea);
}

export function shiftClaimAreaEligibilityReason(
  primaryArea: ShiftArea | null | undefined,
  shiftArea: ShiftArea,
): string | null {
  if (canClaimShiftArea(primaryArea, shiftArea)) return null;
  return `You cannot claim shifts in this area (${shiftArea})`;
}

export function shiftClaimEligibilityReason(
  profile: ShiftClaimProfile,
  shift: { area: ShiftArea; workerType: ShiftWorkerType },
): string | null {
  if (!profile.active) return "Inactive users cannot claim shifts";
  if (shiftWorkerTypeForProfile(profile) !== shift.workerType) {
    return "Your scheduling class does not match this shift slot";
  }
  return shiftClaimAreaEligibilityReason(profile.primaryArea, shift.area);
}

/**
 * Why a crew cannot be claimed from at all, or null when it is open. The pickup
 * endpoint enforces this and shift-group reads send the result to clients as
 * `claimsOpen`, so web and native never decide it themselves.
 */
export function crewClaimClosedReason(group: {
  publishedAt: Date | null;
  archivedAt: Date | null;
  event: { archivedAt: Date | null; isHidden: boolean; status: string };
}): string | null {
  if (!group.publishedAt) return "Draft shifts are not open for pickup";
  if (group.archivedAt || group.event.archivedAt || group.event.isHidden || group.event.status === "CANCELLED") {
    return "This shift is not open for pickup";
  }
  return null;
}
