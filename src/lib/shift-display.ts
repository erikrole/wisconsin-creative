import type { Role, ShiftWorkerType } from "@prisma/client";

export type ShiftWorkerKind = ShiftWorkerType;
type ShiftUserRoleKind = Role | string | null | undefined;
export type ShiftWorkerProfile = {
  role?: ShiftUserRoleKind;
  staffingType?: ShiftWorkerType | string | null | undefined;
} | null | undefined;
export type RoleSlotOutcomeLike = {
  originalWorkerType?: ShiftWorkerType | string | null;
  assignedWorkerType?: ShiftWorkerType | string | null;
  movedToMatchingSlot?: boolean;
  createdMatchingSlot?: boolean;
  reusedMatchingSlot?: boolean;
} | null | undefined;

export function shiftWorkerLabel(workerType: ShiftWorkerType | string | null | undefined): "Staff" | "Student" {
  return workerType === "FT" ? "Staff" : "Student";
}

export function shiftWorkerSlotLabel(workerType: ShiftWorkerType | string | null | undefined): string {
  return `${shiftWorkerLabel(workerType)} slot`;
}

function normalizeRole(role: ShiftUserRoleKind): Role | null {
  if (typeof role !== "string") return null;
  const normalized = role.trim().toUpperCase();
  return normalized === "ADMIN" || normalized === "STAFF" || normalized === "STUDENT" || normalized === "COLLABORATOR"
    ? normalized
    : null;
}

export function shiftWorkerTypeForRole(role: Role | string | null | undefined): ShiftWorkerType {
  const normalized = normalizeRole(role);
  return normalized === "STUDENT" || normalized === "COLLABORATOR" ? "ST" : "FT";
}

export function shiftWorkerTypeForStaffingType(staffingType: ShiftWorkerType | string | null | undefined): ShiftWorkerType | null {
  return staffingType === "FT" || staffingType === "ST" ? staffingType : null;
}

export function shiftWorkerTypeForProfile(profile: ShiftWorkerProfile): ShiftWorkerType | null {
  const staffingType = shiftWorkerTypeForStaffingType(profile?.staffingType);
  if (staffingType) return staffingType;
  const role = normalizeRole(profile?.role);
  if (role === "STUDENT") return "ST";
  if (role === "STAFF" || role === "ADMIN") return "FT";
  return null;
}

export function shiftWorkerLabelForRole(role: ShiftUserRoleKind): "Staff" | "Student" | null {
  const normalized = normalizeRole(role);
  if (normalized === "STUDENT") return "Student";
  if (normalized === "STAFF" || normalized === "ADMIN") return "Staff";
  return null;
}

export function shiftWorkerLabelForProfile(profile: ShiftWorkerProfile): "Staff" | "Student" | null {
  const workerType = shiftWorkerTypeForProfile(profile);
  return workerType ? shiftWorkerLabel(workerType) : null;
}

export function formatRoleSlotAssignmentOutcome(outcome: RoleSlotOutcomeLike, userName?: string | null): string {
  if (!outcome?.movedToMatchingSlot) return "Assigned shift";
  const assignee = userName?.trim() || "Worker";
  const assignedSlot = shiftWorkerSlotLabel(outcome.assignedWorkerType).toLowerCase();
  const originalSlot = shiftWorkerSlotLabel(outcome.originalWorkerType).toLowerCase();
  const verb = outcome.createdMatchingSlot ? "created" : "used";
  return `Assigned ${assignee} to ${assignedSlot}; ${verb} matching slot and left ${originalSlot} open.`;
}
