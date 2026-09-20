export type ReviewFilter = "all" | "conflicts" | "open" | "clean";
export type CandidateConflictFilter = "all" | "conflicts" | "clean";

type AssignmentConflictLike = {
  hasConflict?: boolean | null;
};

type ShiftConflictLike = {
  assignments: AssignmentConflictLike[];
};

type EventConflictLike = {
  shifts: ShiftConflictLike[];
};

type AssignmentReviewSummary = {
  events: number;
  totalSlots: number;
  assigned: number;
  open: number;
  conflicts: number;
  cleanAssignments: number;
};

export function summarizeAssignmentReview(events: EventConflictLike[]): AssignmentReviewSummary {
  const summary: AssignmentReviewSummary = {
    events: events.length,
    totalSlots: 0,
    assigned: 0,
    open: 0,
    conflicts: 0,
    cleanAssignments: 0,
  };

  for (const event of events) {
    for (const shift of event.shifts) {
      summary.totalSlots += 1;
      if (shift.assignments.length === 0) {
        summary.open += 1;
        continue;
      }
      for (const assignment of shift.assignments) {
        summary.assigned += 1;
        if (assignment.hasConflict) summary.conflicts += 1;
        else summary.cleanAssignments += 1;
      }
    }
  }

  return summary;
}

function eventMatchesAssignmentReviewFilter(
  event: EventConflictLike,
  filter: ReviewFilter,
): boolean {
  if (filter === "all") return true;

  let hasOpen = false;
  let hasConflict = false;
  let hasClean = false;

  for (const shift of event.shifts) {
    if (shift.assignments.length === 0) {
      hasOpen = true;
      continue;
    }
    for (const assignment of shift.assignments) {
      if (assignment.hasConflict) hasConflict = true;
      else hasClean = true;
    }
  }

  if (filter === "conflicts") return hasConflict;
  if (filter === "open") return hasOpen;
  return hasClean;
}

export function filterEventsByAssignmentReview<T extends EventConflictLike>(
  events: T[],
  filter: ReviewFilter,
): T[] {
  return events.filter((event) => eventMatchesAssignmentReviewFilter(event, filter));
}

export function filterCandidatesByConflict<T extends { id: string }>(
  users: T[],
  conflictMap: Record<string, string> | undefined,
  filter: CandidateConflictFilter,
): T[] {
  if (filter === "all") return users;
  return users.filter((user) => {
    const hasConflict = Boolean(conflictMap?.[user.id]);
    return filter === "conflicts" ? hasConflict : !hasConflict;
  });
}
