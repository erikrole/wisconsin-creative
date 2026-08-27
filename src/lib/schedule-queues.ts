import type { CalendarEntry } from "@/app/(app)/schedule/_components/types";
import type { ScheduleHealthSnapshot } from "@/lib/schedule-health-types";

export const SCHEDULE_QUEUE_VALUES = [
  "needs-staffing",
  "conflicts",
  "pending-requests",
  "trade-approval",
  "gear-gaps",
  "data-quality",
  "my-calls-today",
  "stale-source",
  "unpublished-drafts",
] as const;

export type ScheduleQueue = (typeof SCHEDULE_QUEUE_VALUES)[number];

export type ScheduleQueueMeta = {
  label: string;
  shortLabel: string;
  emptyTitle: string;
  emptyDescription: string;
};

export const SCHEDULE_QUEUE_META: Record<ScheduleQueue, ScheduleQueueMeta> = {
  "needs-staffing": {
    label: "Needs staffing",
    shortLabel: "Needs staffing",
    emptyTitle: "No staffing gaps",
    emptyDescription: "Every visible event in this window is either covered or outside this queue.",
  },
  conflicts: {
    label: "Conflicts",
    shortLabel: "Conflicts",
    emptyTitle: "No assignment conflicts",
    emptyDescription: "No visible event has an active assignment conflict in this window.",
  },
  "pending-requests": {
    label: "Pending requests",
    shortLabel: "Requests",
    emptyTitle: "No pending requests",
    emptyDescription: "There are no student requests waiting for review in this window.",
  },
  "trade-approval": {
    label: "Trade approval",
    shortLabel: "Trade approval",
    emptyTitle: "No trade approvals",
    emptyDescription: "There are no claimed trades waiting for Admin review.",
  },
  "gear-gaps": {
    label: "Gear gaps",
    shortLabel: "Gear gaps",
    emptyTitle: "No gear gaps",
    emptyDescription: "Assigned workers in this window have linked active gear preparation.",
  },
  "data-quality": {
    label: "Data quality",
    shortLabel: "Data quality",
    emptyTitle: "No data-quality issues",
    emptyDescription: "Visible events have the sport, opponent, venue, and archive context needed for Schedule.",
  },
  "my-calls-today": {
    label: "My calls today",
    shortLabel: "My calls",
    emptyTitle: "No calls today",
    emptyDescription: "You do not have any active shift calls in the current app day.",
  },
  "stale-source": {
    label: "Stale source",
    shortLabel: "Stale source",
    emptyTitle: "No stale-source events",
    emptyDescription: "No visible event is tied to a source that currently needs attention.",
  },
  "unpublished-drafts": {
    label: "Unpublished drafts",
    shortLabel: "Drafts",
    emptyTitle: "No open drafts",
    emptyDescription: "No visible event is being held behind unpublished Schedule changes.",
  },
};

export function parseScheduleQueue(value: string | null | undefined): ScheduleQueue | null {
  if (!value) return null;
  return (SCHEDULE_QUEUE_VALUES as readonly string[]).includes(value) ? (value as ScheduleQueue) : null;
}

function eventIdSet(...ids: Array<string[] | undefined>) {
  const merged = ids.flatMap((value) => value ?? []);
  return merged.length > 0 ? new Set(merged) : null;
}

function hasOpenSlot(entry: CalendarEntry) {
  return !entry.coverage || entry.coverage.filled < entry.coverage.total;
}

function hasAssignmentStatus(entry: CalendarEntry, status: string) {
  return entry.shifts.some((shift) =>
    shift.assignments.some((assignment) => assignment.status === status),
  );
}

function hasConflictedAssignment(entry: CalendarEntry) {
  return entry.shifts.some((shift) =>
    shift.assignments.some((assignment) => (assignment as { hasConflict?: boolean }).hasConflict === true),
  );
}

function hasActiveUserShift(entry: CalendarEntry, userId: string) {
  if (!userId) return false;
  return entry.shifts.some((shift) =>
    shift.assignments.some(
      (assignment) =>
        assignment.user.id === userId &&
        (assignment.status === "DIRECT_ASSIGNED" || assignment.status === "APPROVED"),
    ),
  );
}

function shiftCallStartsAt(entry: CalendarEntry) {
  const callStarts = entry.shifts.flatMap((shift) => [
    shift.callStartsAt,
    ...shift.assignments.map((assignment) => assignment.callStartsAt),
  ]);
  return callStarts.find((value): value is string => Boolean(value)) ?? entry.startsAt;
}

function occursToday(iso: string, now = new Date()) {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return false;
  return value.toDateString() === now.toDateString();
}

export function filterEntriesForScheduleQueue({
  entries,
  queue,
  health,
  currentUserId,
  staleSourceIds = new Set<string>(),
  now = new Date(),
}: {
  entries: CalendarEntry[];
  queue: ScheduleQueue | null;
  health?: ScheduleHealthSnapshot | null;
  currentUserId?: string;
  staleSourceIds?: Set<string>;
  now?: Date;
}) {
  if (!queue) return entries;

  switch (queue) {
    case "needs-staffing": {
      const ids = eventIdSet(health?.queues.openSlots.eventIds, health?.queues.eventsWithoutCrew.eventIds);
      return ids ? entries.filter((entry) => ids.has(entry.id)) : entries.filter(hasOpenSlot);
    }
    case "conflicts": {
      const ids = eventIdSet(health?.queues.conflicts.eventIds);
      return ids ? entries.filter((entry) => ids.has(entry.id)) : entries.filter(hasConflictedAssignment);
    }
    case "pending-requests": {
      const ids = eventIdSet(health?.queues.pendingRequests.eventIds);
      return ids ? entries.filter((entry) => ids.has(entry.id)) : entries.filter((entry) => hasAssignmentStatus(entry, "REQUESTED"));
    }
    case "gear-gaps": {
      const ids = eventIdSet(health?.queues.gearGaps.eventIds);
      return ids ? entries.filter((entry) => ids.has(entry.id)) : [];
    }
    case "data-quality": {
      const ids = eventIdSet(health?.queues.dataQuality.eventIds);
      return ids ? entries.filter((entry) => ids.has(entry.id)) : [];
    }
    case "my-calls-today":
      return entries.filter(
        (entry) => hasActiveUserShift(entry, currentUserId ?? "") && occursToday(shiftCallStartsAt(entry), now),
      );
    case "stale-source":
      return entries.filter((entry) => entry.source?.id && staleSourceIds.has(entry.source.id));
    case "unpublished-drafts": {
      const ids = eventIdSet(health?.queues.unpublishedDrafts.eventIds);
      return ids ? entries.filter((entry) => ids.has(entry.id)) : entries;
    }
    case "trade-approval":
      return entries;
  }
}
