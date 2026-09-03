export type SchedulePublicationStatus = "draft" | "published" | "changed";

export type SchedulePublicationSnapshotItem = {
  shiftId: string;
  area: string;
  workerType: string;
  startsAt: string;
  endsAt: string;
  callStartsAt: string | null;
  callEndsAt: string | null;
  /** Internal comparison marker; never persisted in publication snapshots. */
  callTimeSuppressed?: boolean;
  assignments: Array<{
    id: string;
    userId: string;
    status: string;
    callStartsAt: string | null;
    callEndsAt: string | null;
    callNote: string | null;
  }>;
};

export type SchedulePublicationSnapshot = {
  shifts: SchedulePublicationSnapshotItem[];
};

export type SchedulePublicationState = {
  status: SchedulePublicationStatus;
  publishedAt: string | null;
  publishedById: string | null;
  changedAfterPublish: boolean;
  activeAssignmentCount: number;
  acknowledgedCount: number;
  unacknowledgedCount: number;
};

/**
 * Publication reconciliation clears acknowledgement only when that worker's
 * visible assignment changes. A later group publish must not invalidate an
 * unchanged coworker's acknowledgement just because `publishedAt` advanced.
 */
export function isShiftAssignmentAcknowledged(
  publishedAt: Date | string | null | undefined,
  acknowledgedAt: Date | string | null | undefined,
) {
  return Boolean(publishedAt && acknowledgedAt);
}

/**
 * Parse a stored snapshot back out of JSON.
 *
 * A row written before the current shape, or hand-edited into nonsense, reads as
 * null rather than throwing: callers treat that as "workers have been told
 * nothing yet", which over-notifies once instead of losing the schedule.
 */
export function normalizeStoredSnapshot(value: unknown): SchedulePublicationSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as { shifts?: unknown };
  if (!Array.isArray(candidate.shifts)) return null;
  return value as SchedulePublicationSnapshot;
}
