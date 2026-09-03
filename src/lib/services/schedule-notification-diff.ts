import type {
  SchedulePublicationSnapshot,
  SchedulePublicationSnapshotItem,
} from "@/lib/schedule-publication-types";
import { studentCallTimeAppliesToEvent } from "@/lib/shift-call-windows";

/** Staff coverage keeps the event window internally and exposes no call time. */
const STAFF_WORKER_TYPE = "FT";

type SnapshotAssignment = SchedulePublicationSnapshotItem["assignments"][number];

/** Everything a worker-facing message needs about one person's slot at one event. */
export type WorkerShiftFacts = {
  shiftId: string;
  area: string;
  workerType: string;
  startsAt: string;
  endsAt: string;
  /** Null for Staff, who never see a call time; the effective window for Students. */
  callStartsAt: string | null;
  callEndsAt: string | null;
  callNote: string | null;
};

export type ScheduleWorkerChange =
  | { kind: "added"; after: WorkerShiftFacts }
  | { kind: "removed"; before: WorkerShiftFacts }
  | {
    kind: "reassigned";
    before: WorkerShiftFacts;
    after: WorkerShiftFacts;
    areaChanged: boolean;
    windowChanged: boolean;
  }
  | {
    kind: "updated";
    before: WorkerShiftFacts;
    after: WorkerShiftFacts;
    windowChanged: boolean;
    noteChanged: boolean;
  };

export type ScheduleNotificationDiff = {
  /** True when at least one worker has something worth being told. */
  changed: boolean;
  byUser: Map<string, ScheduleWorkerChange[]>;
};

/**
 * Remove Student call-window data from the worker-facing comparison for an
 * Away or Neutral event. The persisted publication snapshot stays raw so
 * conflict, readiness, and staff reconciliation can continue to use it.
 */
export function redactStudentCallTimesForEvent(
  snapshot: SchedulePublicationSnapshot | null,
  event: {
    startsAt: string | Date;
    endsAt: string | Date;
    allDay?: boolean | null;
    isHome?: boolean | null;
    site?: "HOME" | "AWAY" | "NEUTRAL" | null;
    opponent?: string | null;
    summary?: string | null;
  },
): SchedulePublicationSnapshot | null {
  if (!snapshot || (!event.allDay && studentCallTimeAppliesToEvent(event))) return snapshot;
  const startsAt = event.startsAt instanceof Date ? event.startsAt.toISOString() : event.startsAt;
  const endsAt = event.endsAt instanceof Date ? event.endsAt.toISOString() : event.endsAt;
  return {
    shifts: snapshot.shifts.map((shift) => shift.workerType !== "ST"
      ? shift
      : {
          ...shift,
          startsAt,
          endsAt,
          callStartsAt: null,
          callEndsAt: null,
          callTimeSuppressed: true,
          assignments: shift.assignments.map((assignment) => ({
            ...assignment,
            callStartsAt: null,
            callEndsAt: null,
            callNote: null,
          })),
        }),
  };
}

function factsFor(
  shift: SchedulePublicationSnapshotItem,
  assignment: SnapshotAssignment,
): WorkerShiftFacts {
  const staff = shift.workerType === STAFF_WORKER_TYPE;
  const callTimeSuppressed = shift.callTimeSuppressed === true;
  return {
    shiftId: shift.shiftId,
    area: shift.area,
    workerType: shift.workerType,
    startsAt: shift.startsAt,
    endsAt: shift.endsAt,
    callStartsAt: staff || callTimeSuppressed ? null : assignment.callStartsAt ?? shift.callStartsAt ?? shift.startsAt,
    callEndsAt: staff || callTimeSuppressed ? null : assignment.callEndsAt ?? shift.callEndsAt ?? shift.endsAt,
    callNote: staff || callTimeSuppressed ? null : assignment.callNote ?? null,
  };
}

/** The window this worker actually reads: the call window, or the shift for Staff. */
export function reportableWindow(facts: WorkerShiftFacts) {
  return facts.workerType === STAFF_WORKER_TYPE
    ? { startsAt: facts.startsAt, endsAt: facts.endsAt }
    : {
      startsAt: facts.callStartsAt ?? facts.startsAt,
      endsAt: facts.callEndsAt ?? facts.endsAt,
    };
}

function windowMoved(before: WorkerShiftFacts, after: WorkerShiftFacts) {
  const a = reportableWindow(before);
  const b = reportableWindow(after);
  return a.startsAt !== b.startsAt || a.endsAt !== b.endsAt;
}

function slotKey(shiftId: string, userId: string) {
  return `${shiftId}::${userId}`;
}

/**
 * Index by slot and person, never by assignment id. Removing someone and putting
 * them straight back mints a new assignment row, and keying on that id would
 * report the churn as a removal plus an addition instead of as nothing at all.
 */
function indexSnapshot(snapshot: SchedulePublicationSnapshot | null) {
  const byKey = new Map<string, { userId: string; facts: WorkerShiftFacts }>();
  for (const shift of snapshot?.shifts ?? []) {
    for (const assignment of shift.assignments) {
      byKey.set(slotKey(shift.shiftId, assignment.userId), {
        userId: assignment.userId,
        facts: factsFor(shift, assignment),
      });
    }
  }
  return byKey;
}

/**
 * Nobody works two shifts at one event, so a lone removal paired with a lone
 * addition is one person moving slots, not two separate things happening to them.
 */
function collapseReassignments(byUser: Map<string, ScheduleWorkerChange[]>) {
  for (const [userId, changes] of byUser) {
    const removed = changes.filter((change) => change.kind === "removed");
    const added = changes.filter((change) => change.kind === "added");
    if (removed.length !== 1 || added.length !== 1) continue;

    const before = (removed[0] as Extract<ScheduleWorkerChange, { kind: "removed" }>).before;
    const after = (added[0] as Extract<ScheduleWorkerChange, { kind: "added" }>).after;
    const rest = changes.filter((change) => change.kind !== "removed" && change.kind !== "added");

    byUser.set(userId, [
      {
        kind: "reassigned",
        before,
        after,
        areaChanged: before.area !== after.area,
        windowChanged: windowMoved(before, after),
      },
      ...rest,
    ]);
  }
}

/**
 * Compare what workers were last told against what is true now.
 *
 * `previous` is the high-water mark of delivered notifications, not of edits, so
 * a quiet period's worth of churn collapses to its net effect: assigning someone
 * and removing them again before the flush produces no change at all.
 */
export function diffScheduleForNotification(
  previous: SchedulePublicationSnapshot | null,
  current: SchedulePublicationSnapshot,
): ScheduleNotificationDiff {
  const before = indexSnapshot(previous);
  const after = indexSnapshot(current);
  const byUser = new Map<string, ScheduleWorkerChange[]>();

  const push = (userId: string, change: ScheduleWorkerChange) => {
    const existing = byUser.get(userId);
    if (existing) existing.push(change);
    else byUser.set(userId, [change]);
  };

  for (const [key, entry] of after) {
    const prior = before.get(key);
    if (!prior) {
      push(entry.userId, { kind: "added", after: entry.facts });
      continue;
    }
    const windowChanged = windowMoved(prior.facts, entry.facts);
    const noteChanged = prior.facts.callNote !== entry.facts.callNote;
    if (windowChanged || noteChanged) {
      push(entry.userId, {
        kind: "updated",
        before: prior.facts,
        after: entry.facts,
        windowChanged,
        noteChanged,
      });
    }
  }

  for (const [key, entry] of before) {
    if (!after.has(key)) push(entry.userId, { kind: "removed", before: entry.facts });
  }

  collapseReassignments(byUser);
  return { changed: byUser.size > 0, byUser };
}

/** Recipients in a stable order, so delivery and its evidence are deterministic. */
export function affectedUserIds(diff: ScheduleNotificationDiff): string[] {
  return [...diff.byUser.keys()].sort();
}

const CHANGE_PRIORITY: Record<ScheduleWorkerChange["kind"], number> = {
  removed: 0,
  reassigned: 1,
  added: 2,
  updated: 3,
};

/** The change a one-line message should lead with when a worker has several. */
export function primaryChange(changes: ScheduleWorkerChange[]): ScheduleWorkerChange | null {
  if (changes.length === 0) return null;
  return [...changes].sort(
    (a, b) => CHANGE_PRIORITY[a.kind] - CHANGE_PRIORITY[b.kind],
  )[0]!;
}
