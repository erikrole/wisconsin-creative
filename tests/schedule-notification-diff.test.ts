import { describe, expect, it } from "vitest";

import {
  affectedUserIds,
  diffScheduleForNotification,
  primaryChange,
  redactStudentCallTimesForEvent,
  reportableWindow,
  type ScheduleWorkerChange,
} from "@/lib/services/schedule-notification-diff";
import type { SchedulePublicationSnapshot } from "@/lib/schedule-publication-types";

type SlotSpec = {
  shiftId: string;
  area?: string;
  workerType?: string;
  startsAt?: string;
  endsAt?: string;
  callStartsAt?: string | null;
  callEndsAt?: string | null;
  assignments?: Array<{
    id?: string;
    userId: string;
    status?: string;
    callStartsAt?: string | null;
    callEndsAt?: string | null;
    callNote?: string | null;
  }>;
};

function snapshot(slots: SlotSpec[]): SchedulePublicationSnapshot {
  return {
    shifts: slots.map((slot) => ({
      shiftId: slot.shiftId,
      area: slot.area ?? "VIDEO",
      workerType: slot.workerType ?? "ST",
      startsAt: slot.startsAt ?? "2026-10-12T21:00:00.000Z",
      endsAt: slot.endsAt ?? "2026-10-13T02:00:00.000Z",
      callStartsAt: slot.callStartsAt ?? null,
      callEndsAt: slot.callEndsAt ?? null,
      assignments: (slot.assignments ?? []).map((assignment, index) => ({
        id: assignment.id ?? `assignment-${slot.shiftId}-${index}`,
        userId: assignment.userId,
        status: assignment.status ?? "DIRECT_ASSIGNED",
        callStartsAt: assignment.callStartsAt ?? null,
        callEndsAt: assignment.callEndsAt ?? null,
        callNote: assignment.callNote ?? null,
      })),
    })),
  };
}

const staffed = snapshot([{ shiftId: "shift-1", assignments: [{ userId: "user-1" }] }]);
const empty = snapshot([{ shiftId: "shift-1", assignments: [] }]);

describe("diffScheduleForNotification", () => {
  it("reports nothing when someone is assigned and removed before the flush", () => {
    const diff = diffScheduleForNotification(empty, empty);
    expect(diff.changed).toBe(false);
    expect(diff.byUser.size).toBe(0);
  });

  it("reports nothing when the same person is re-added under a new assignment id", () => {
    const before = snapshot([
      { shiftId: "shift-1", assignments: [{ id: "assignment-old", userId: "user-1" }] },
    ]);
    const after = snapshot([
      { shiftId: "shift-1", assignments: [{ id: "assignment-new", userId: "user-1" }] },
    ]);

    expect(diffScheduleForNotification(before, after).changed).toBe(false);
  });

  it("treats a first release as an addition for everyone on the crew", () => {
    const diff = diffScheduleForNotification(null, staffed);
    expect(diff.byUser.get("user-1")).toEqual([
      { kind: "added", after: expect.objectContaining({ shiftId: "shift-1", area: "VIDEO" }) },
    ]);
  });

  it("reports a removal when the slot is emptied", () => {
    const diff = diffScheduleForNotification(staffed, empty);
    const change = diff.byUser.get("user-1")?.[0];
    expect(change?.kind).toBe("removed");
  });

  it("collapses a removal plus an addition into one reassignment", () => {
    const after = snapshot([
      { shiftId: "shift-1", assignments: [] },
      { shiftId: "shift-2", area: "PHOTO", assignments: [{ userId: "user-1" }] },
    ]);

    const changes = diffScheduleForNotification(staffed, after).byUser.get("user-1");
    expect(changes).toHaveLength(1);
    const change = changes![0] as Extract<ScheduleWorkerChange, { kind: "reassigned" }>;
    expect(change.kind).toBe("reassigned");
    expect(change.areaChanged).toBe(true);
    expect(change.before.area).toBe("VIDEO");
    expect(change.after.area).toBe("PHOTO");
  });

  it("reports a moved call window as an update carrying the old value", () => {
    const before = snapshot([
      {
        shiftId: "shift-1",
        assignments: [{ userId: "user-1", callStartsAt: "2026-10-12T20:00:00.000Z" }],
      },
    ]);
    const after = snapshot([
      {
        shiftId: "shift-1",
        assignments: [{ userId: "user-1", callStartsAt: "2026-10-12T21:30:00.000Z" }],
      },
    ]);

    const change = diffScheduleForNotification(before, after).byUser.get("user-1")?.[0];
    expect(change).toMatchObject({ kind: "updated", windowChanged: true, noteChanged: false });
    expect((change as Extract<ScheduleWorkerChange, { kind: "updated" }>).before.callStartsAt)
      .toBe("2026-10-12T20:00:00.000Z");
  });

  it("reports a call-note edit without claiming the time moved", () => {
    const before = snapshot([{ shiftId: "shift-1", assignments: [{ userId: "user-1" }] }]);
    const after = snapshot([
      { shiftId: "shift-1", assignments: [{ userId: "user-1", callNote: "Enter through Gate C." }] },
    ]);

    expect(diffScheduleForNotification(before, after).byUser.get("user-1")?.[0])
      .toMatchObject({ kind: "updated", windowChanged: false, noteChanged: true });
  });

  it("ignores a call-time edit on a Staff slot, which exposes no call time", () => {
    const before = snapshot([
      {
        shiftId: "shift-1",
        workerType: "FT",
        assignments: [{ userId: "user-1", callStartsAt: "2026-10-12T20:00:00.000Z" }],
      },
    ]);
    const after = snapshot([
      {
        shiftId: "shift-1",
        workerType: "FT",
        assignments: [{ userId: "user-1", callStartsAt: "2026-10-12T18:00:00.000Z" }],
      },
    ]);

    expect(diffScheduleForNotification(before, after).changed).toBe(false);
  });

  it("still reports a Staff shift whose own window moved", () => {
    const before = snapshot([
      { shiftId: "shift-1", workerType: "FT", assignments: [{ userId: "user-1" }] },
    ]);
    const after = snapshot([
      {
        shiftId: "shift-1",
        workerType: "FT",
        startsAt: "2026-10-12T23:00:00.000Z",
        assignments: [{ userId: "user-1" }],
      },
    ]);

    expect(diffScheduleForNotification(before, after).byUser.get("user-1")?.[0])
      .toMatchObject({ kind: "updated", windowChanged: true });
  });

  it("ignores a status change between two active states", () => {
    const before = snapshot([
      { shiftId: "shift-1", assignments: [{ userId: "user-1", status: "DIRECT_ASSIGNED" }] },
    ]);
    const after = snapshot([
      { shiftId: "shift-1", assignments: [{ userId: "user-1", status: "APPROVED" }] },
    ]);

    expect(diffScheduleForNotification(before, after).changed).toBe(false);
  });

  it("keeps two people's changes apart", () => {
    const after = snapshot([
      { shiftId: "shift-1", assignments: [{ userId: "user-2" }] },
    ]);

    const diff = diffScheduleForNotification(staffed, after);
    expect(diff.byUser.get("user-1")?.[0]?.kind).toBe("removed");
    expect(diff.byUser.get("user-2")?.[0]?.kind).toBe("added");
    expect(affectedUserIds(diff)).toEqual(["user-1", "user-2"]);
  });

  it("ignores Student call-window edits for an Away event", () => {
    const event = {
      startsAt: "2026-10-12T21:00:00.000Z",
      endsAt: "2026-10-13T02:00:00.000Z",
      allDay: false,
      opponent: "Iowa",
      site: "AWAY" as const,
    };
    const before = redactStudentCallTimesForEvent(snapshot([
      {
        shiftId: "shift-1",
        callStartsAt: "2026-10-12T20:00:00.000Z",
        assignments: [{ userId: "user-1", callStartsAt: "2026-10-12T20:15:00.000Z" }],
      },
    ]), event);
    const after = redactStudentCallTimesForEvent(snapshot([
      {
        shiftId: "shift-1",
        callStartsAt: "2026-10-12T19:00:00.000Z",
        assignments: [{ userId: "user-1", callStartsAt: "2026-10-12T19:15:00.000Z" }],
      },
    ]), event);

    expect(after?.shifts[0]?.callStartsAt).toBeNull();
    expect(after?.shifts[0]?.assignments[0]?.callStartsAt).toBeNull();
    expect(diffScheduleForNotification(before, after!).changed).toBe(false);
  });

  it("does not turn a suppressed Away window into an event-time call", () => {
    const event = {
      startsAt: "2026-10-12T21:00:00.000Z",
      endsAt: "2026-10-13T02:00:00.000Z",
      allDay: false,
      opponent: "Iowa",
      site: "AWAY" as const,
    };
    const redacted = redactStudentCallTimesForEvent(snapshot([
      {
        shiftId: "shift-1",
        callStartsAt: "2026-10-12T20:00:00.000Z",
        assignments: [{ userId: "user-1", callStartsAt: "2026-10-12T20:15:00.000Z" }],
      },
    ]), event)!;

    const change = diffScheduleForNotification(null, redacted).byUser.get("user-1")?.[0];
    expect(change).toMatchObject({
      kind: "added",
      after: { callStartsAt: null, callEndsAt: null },
    });
  });
});

describe("reportableWindow", () => {
  it("gives Students their call window and Staff the shift window", () => {
    const student = diffScheduleForNotification(null, snapshot([
      {
        shiftId: "shift-1",
        callStartsAt: "2026-10-12T20:00:00.000Z",
        assignments: [{ userId: "user-1" }],
      },
    ])).byUser.get("user-1")![0] as Extract<ScheduleWorkerChange, { kind: "added" }>;

    expect(reportableWindow(student.after).startsAt).toBe("2026-10-12T20:00:00.000Z");

    const staff = diffScheduleForNotification(null, snapshot([
      {
        shiftId: "shift-1",
        workerType: "FT",
        callStartsAt: "2026-10-12T20:00:00.000Z",
        assignments: [{ userId: "user-1" }],
      },
    ])).byUser.get("user-1")![0] as Extract<ScheduleWorkerChange, { kind: "added" }>;

    expect(reportableWindow(staff.after).startsAt).toBe("2026-10-12T21:00:00.000Z");
  });
});

describe("primaryChange", () => {
  it("leads with the removal when a worker has several changes", () => {
    const changes: ScheduleWorkerChange[] = [
      { kind: "added", after: {} as never },
      { kind: "removed", before: {} as never },
    ];
    expect(primaryChange(changes)?.kind).toBe("removed");
  });

  it("returns null for an empty list", () => {
    expect(primaryChange([])).toBeNull();
  });
});
