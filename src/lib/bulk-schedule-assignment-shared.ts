import type {
  BulkAssignmentPreviewPerson,
  BulkAssignmentPreviewProposal,
} from "@/lib/bulk-schedule-assignment-types";

/** Guardrail on the sport multi-select; the full varsity list is 23 codes. */
export const MAX_BULK_ASSIGNMENT_SPORTS = 30;

/**
 * Which scheduling classes auto assignment is allowed to fill.
 *
 * Slots are already typed `ST` (student) or `FT` (staff) and only a matching
 * worker may take one, so this narrows *which slots are touched* rather than
 * loosening who may fill them: `ST` fills student slots only and leaves staff
 * slots open, and vice versa.
 */
export const BULK_ASSIGNMENT_WORKER_SCOPES = ["ALL", "ST", "FT"] as const;
export type BulkAssignmentWorkerScope = (typeof BULK_ASSIGNMENT_WORKER_SCOPES)[number];

export const BULK_ASSIGNMENT_WORKER_SCOPE_LABELS: Record<BulkAssignmentWorkerScope, string> = {
  ALL: "Everyone",
  ST: "Students only",
  FT: "Staff only",
};

/**
 * Roll proposals up by worker. Shared by the server response and the dialog, so
 * the count next to a name always matches the current event selection.
 */
export function summarizeAssignmentPeople(
  proposals: BulkAssignmentPreviewProposal[],
): BulkAssignmentPreviewPerson[] {
  const byUser = new Map<string, BulkAssignmentPreviewPerson & { eventIds: Set<string> }>();

  for (const proposal of proposals) {
    const current = byUser.get(proposal.userId) ?? {
      userId: proposal.userId,
      userName: proposal.userName,
      userRole: proposal.userRole,
      workerType: proposal.workerType,
      shiftCount: 0,
      eventCount: 0,
      areas: [],
      sportCodes: [],
      warningCount: 0,
      advisoryConflictCount: 0,
      eventIds: new Set<string>(),
    };
    current.shiftCount += 1;
    current.eventIds.add(proposal.eventId);
    if (!current.areas.includes(proposal.area)) current.areas.push(proposal.area);
    if (proposal.eventSportCode && !current.sportCodes.includes(proposal.eventSportCode)) {
      current.sportCodes.push(proposal.eventSportCode);
    }
    if (proposal.warnings.length > 0) current.warningCount += 1;
    if (proposal.advisoryConflict) current.advisoryConflictCount += 1;
    byUser.set(proposal.userId, current);
  }

  return [...byUser.values()]
    .map(({ eventIds, ...person }) => ({
      ...person,
      eventCount: eventIds.size,
      areas: [...person.areas].sort(),
      sportCodes: [...person.sportCodes].sort(),
    }))
    .sort((a, b) => b.shiftCount - a.shiftCount || a.userName.localeCompare(b.userName));
}
