import type { Role, ShiftAssignmentStatus } from "@prisma/client";

/** Assignment statuses that represent an active (non-terminal) assignment */
export const ACTIVE_ASSIGNMENT_STATUSES: ShiftAssignmentStatus[] = [
  "DIRECT_ASSIGNED",
  "APPROVED",
];

/** Staff and administrators may cover overlapping events; other roles retain conflict checks. */
export function allowsOverlappingShifts(role: Role | undefined): boolean {
  return role === "STAFF" || role === "ADMIN";
}
