import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectSerializableIsolation } from "./_helpers/assert-transaction";

const { tx, transactionCalls } = vi.hoisted(() => ({
  tx: {
    shiftGroup: { findUnique: vi.fn() },
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    sportConfig: { findUnique: vi.fn() },
    shiftAssignment: { findMany: vi.fn() },
    shiftTrade: { findMany: vi.fn() },
    shiftGroupWorkingCopy: { updateMany: vi.fn(), create: vi.fn() },
  },
  transactionCalls: [] as Array<{ options: unknown }>,
}));

vi.mock("@/lib/db", () => ({
  db: {
    ...tx,
    $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>, options?: unknown) => {
      transactionCalls.push({ options });
      return fn(tx);
    }),
  },
}));

vi.mock("@/lib/audit", () => ({ createAuditEntryTx: vi.fn(), createAuditEntry: vi.fn() }));
vi.mock("@/lib/services/shift-assignments", () => ({ checkTimeConflict: vi.fn() }));

import { rebaseWorkingSchedule } from "@/lib/services/schedule-working-copy";

const eventStartsAt = new Date("2026-08-05T17:00:00.000Z");
const eventEndsAt = new Date("2026-08-05T21:00:00.000Z");
const draftStartedAt = new Date("2026-08-05T02:17:21.000Z");
const beforeDraft = new Date("2026-08-04T10:00:00.000Z");
const afterDraft = new Date("2026-08-05T02:35:43.000Z");
const actor = { id: "staff-1", role: "STAFF" as const };

/** A live relational shift as the editor select returns it. */
function liveShift(
  id: string,
  createdAt: Date,
  assignment: { id: string; userId: string } | null,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    createdAt,
    area: "VIDEO",
    workerType: "FT",
    startsAt: eventStartsAt,
    endsAt: eventEndsAt,
    callStartsAt: null,
    callEndsAt: null,
    notes: null,
    _count: { assignments: assignment ? 1 : 0 },
    assignments: assignment
      ? [{
        id: assignment.id,
        userId: assignment.userId,
        status: "DIRECT_ASSIGNED",
        callStartsAt: null,
        callEndsAt: null,
        callNote: null,
        trades: [],
        _count: { bookings: 0 },
      }]
      : [],
    ...overrides,
  };
}

/** A slot inside the stored draft payload. */
function draftSlot(
  key: string,
  sourceShiftId: string | null,
  assignment: { sourceAssignmentId: string | null; userId: string } | null,
  overrides: Record<string, unknown> = {},
) {
  return {
    key,
    sourceShiftId,
    area: "VIDEO",
    workerType: "FT",
    startsAt: eventStartsAt.toISOString(),
    endsAt: eventEndsAt.toISOString(),
    callStartsAt: null,
    callEndsAt: null,
    notes: null,
    assignmentHistoryCount: 0,
    assignment: assignment
      ? {
        sourceAssignmentId: assignment.sourceAssignmentId,
        userId: assignment.userId,
        status: "DIRECT_ASSIGNED",
        callStartsAt: null,
        callEndsAt: null,
        callNote: null,
        activeTradeId: null,
        bookingCount: 0,
      }
      : null,
    ...overrides,
  };
}

function group(shifts: unknown[], draftSlots: unknown[], publishedVersion = 0) {
  return {
    id: "group-1",
    publishedAt: null,
    publishedVersion,
    event: { startsAt: eventStartsAt, endsAt: eventEndsAt, allDay: false, sportCode: "VB" },
    shifts,
    workingCopy: {
      version: 7,
      basePublishedVersion: 0,
      payloadVersion: 1,
      createdAt: draftStartedAt,
      updatedAt: new Date("2026-08-05T11:52:00.000Z"),
      updatedById: "staff-1",
      payload: {
        eventStartsAt: eventStartsAt.toISOString(),
        eventEndsAt: eventEndsAt.toISOString(),
        slots: draftSlots,
      },
    },
  };
}

/** The payload handed to the working-copy row on write. */
function writtenPayload() {
  const call = tx.shiftGroupWorkingCopy.updateMany.mock.calls[0]![0] as {
    data: { payload: { slots: Array<Record<string, unknown>>; baseShiftIds?: string[] } };
  };
  return call.data.payload;
}

describe("rebaseWorkingSchedule", () => {
  beforeEach(() => {
    transactionCalls.length = 0;
    for (const model of Object.values(tx)) {
      for (const fn of Object.values(model)) fn.mockReset();
    }
    tx.sportConfig.findUnique.mockResolvedValue(null);
    tx.user.findMany.mockResolvedValue([]);
    tx.shiftAssignment.findMany.mockResolvedValue([]);
    tx.shiftTrade.findMany.mockResolvedValue([]);
    tx.shiftGroupWorkingCopy.updateMany.mockResolvedValue({ count: 1 });
  });

  it("repairs a same-person staged assignment before writing the rebased copy", async () => {
    tx.shiftGroup.findUnique.mockResolvedValue(group(
      [liveShift("shift-video", beforeDraft, { id: "assignment-live", userId: "maddy" })],
      [draftSlot("shift-video", "shift-video", { sourceAssignmentId: null, userId: "maddy" })],
    ));

    await rebaseWorkingSchedule("group-1", 7, actor);

    expect(writtenPayload().slots[0]!.assignment).toMatchObject({
      sourceAssignmentId: "assignment-live",
      userId: "maddy",
    });
  });

  // The production failure: two shifts were added live 18 minutes after the
  // draft started, so the draft never saw them and publish refused to proceed.
  it("adopts live shifts created after the draft started", async () => {
    tx.shiftGroup.findUnique.mockResolvedValue(group(
      [
        liveShift("shift-photo", beforeDraft, { id: "assignment-photo", userId: "kromke" }),
        liveShift("shift-late", afterDraft, { id: "assignment-late", userId: "zimmerman" }),
      ],
      [draftSlot("shift-photo", "shift-photo", { sourceAssignmentId: "assignment-photo", userId: "kromke" })],
    ));

    const result = await rebaseWorkingSchedule("group-1", 7, actor);

    expect(result.rebase.adoptedSlots).toBe(1);
    expect(writtenPayload().slots.map((s) => s.sourceShiftId)).toEqual(["shift-photo", "shift-late"]);
  });

  // The mirror case. A slot that predates the draft and is absent from it was
  // deliberately removed, so a refresh must not resurrect it.
  it("does not resurrect a slot the user removed before the draft snapshot", async () => {
    tx.shiftGroup.findUnique.mockResolvedValue(group(
      [
        liveShift("shift-kept", beforeDraft, null),
        liveShift("shift-removed", beforeDraft, null),
      ],
      [draftSlot("shift-kept", "shift-kept", null)],
    ));

    const result = await rebaseWorkingSchedule("group-1", 7, actor);

    expect(result.rebase.adoptedSlots).toBe(0);
    expect(writtenPayload().slots.map((s) => s.sourceShiftId)).toEqual(["shift-kept"]);
  });

  it("keeps draft-only additions", async () => {
    tx.shiftGroup.findUnique.mockResolvedValue(group(
      [liveShift("shift-a", beforeDraft, null)],
      [
        draftSlot("shift-a", "shift-a", null),
        draftSlot("draft:new", null, { sourceAssignmentId: null, userId: "saddler" }),
      ],
    ));

    await rebaseWorkingSchedule("group-1", 7, actor);

    const slots = writtenPayload().slots;
    expect(slots).toHaveLength(2);
    expect(slots[1]).toMatchObject({ key: "draft:new", sourceShiftId: null });
    expect((slots[1]!.assignment as Record<string, unknown>).userId).toBe("saddler");
  });

  it("drops a draft slot whose live shift was deleted", async () => {
    tx.shiftGroup.findUnique.mockResolvedValue(group(
      [liveShift("shift-a", beforeDraft, null)],
      [draftSlot("shift-a", "shift-a", null), draftSlot("shift-gone", "shift-gone", null)],
    ));

    const result = await rebaseWorkingSchedule("group-1", 7, actor);

    expect(result.rebase.droppedSlots).toBe(1);
    expect(writtenPayload().slots.map((s) => s.sourceShiftId)).toEqual(["shift-a"]);
  });

  // This is what "an assignment changed after this draft started" was blocking
  // on: the draft still pointed at an assignment row that no longer exists.
  it("re-points a mirrored assignment at the live row", async () => {
    tx.shiftGroup.findUnique.mockResolvedValue(group(
      [liveShift("shift-a", beforeDraft, { id: "assignment-new", userId: "new-person" })],
      [draftSlot("shift-a", "shift-a", { sourceAssignmentId: "assignment-old", userId: "old-person" })],
    ));

    const result = await rebaseWorkingSchedule("group-1", 7, actor);

    expect(result.rebase.refreshedAssignments).toBe(1);
    const assignment = writtenPayload().slots[0]!.assignment as Record<string, unknown>;
    expect(assignment).toMatchObject({ sourceAssignmentId: "assignment-new", userId: "new-person" });
  });

  // A draft-only assignment is a staged replacement, which publish already knows
  // how to apply. Refreshing must not silently undo that decision.
  it("preserves a staged replacement over the live assignment", async () => {
    tx.shiftGroup.findUnique.mockResolvedValue(group(
      [liveShift("shift-a", beforeDraft, { id: "assignment-live", userId: "live-person" })],
      [draftSlot("shift-a", "shift-a", { sourceAssignmentId: null, userId: "staged-person" })],
    ));

    const result = await rebaseWorkingSchedule("group-1", 7, actor);

    expect(result.rebase.refreshedAssignments).toBe(0);
    const assignment = writtenPayload().slots[0]!.assignment as Record<string, unknown>;
    expect(assignment).toMatchObject({ sourceAssignmentId: null, userId: "staged-person" });
  });

  // The editor guarded removals with a count frozen at snapshot time while
  // publish read live rows, so the two could disagree about the same slot.
  it("re-reads assignment history counts from live rows", async () => {
    tx.shiftGroup.findUnique.mockResolvedValue(group(
      [liveShift("shift-a", beforeDraft, { id: "assignment-a", userId: "person" })],
      [draftSlot("shift-a", "shift-a", { sourceAssignmentId: "assignment-a", userId: "person" },
        { assignmentHistoryCount: 0 })],
    ));

    const result = await rebaseWorkingSchedule("group-1", 7, actor);

    expect(result.rebase.refreshedHistoryCounts).toBe(1);
    expect(writtenPayload().slots[0]!.assignmentHistoryCount).toBe(1);
  });

  it("re-seats the draft on the current published version", async () => {
    tx.shiftGroup.findUnique.mockResolvedValue(group([liveShift("shift-a", beforeDraft, null)],
      [draftSlot("shift-a", "shift-a", null)], 4));

    const result = await rebaseWorkingSchedule("group-1", 7, actor);

    expect(result.rebase.rebasedToPublishedVersion).toBe(4);
    const data = tx.shiftGroupWorkingCopy.updateMany.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(data.data.basePublishedVersion).toBe(4);
    expect(data.data.version).toBe(8);
  });

  it("runs serializably and rejects a stale expected version", async () => {
    tx.shiftGroup.findUnique.mockResolvedValue(group([liveShift("shift-a", beforeDraft, null)],
      [draftSlot("shift-a", "shift-a", null)]));

    await rebaseWorkingSchedule("group-1", 7, actor);
    expectSerializableIsolation(transactionCalls, 0);

    await expect(rebaseWorkingSchedule("group-1", 3, actor)).rejects.toMatchObject({ status: 409 });
  });

  it("refuses to rebase an event with no draft", async () => {
    tx.shiftGroup.findUnique.mockResolvedValue({
      ...group([liveShift("shift-a", beforeDraft, null)], []),
      workingCopy: null,
    });

    await expect(rebaseWorkingSchedule("group-1", 7, actor)).rejects.toMatchObject({ status: 409 });
    expect(tx.shiftGroupWorkingCopy.updateMany).not.toHaveBeenCalled();
  });

  // With payloadVersion 2 the base set is exact, so adoption no longer depends
  // on comparing timestamps.
  it("adopts using the recorded base shift set when present", async () => {
    const g = group(
      [liveShift("shift-known", beforeDraft, null), liveShift("shift-new", beforeDraft, null)],
      [draftSlot("shift-known", "shift-known", null)],
    );
    (g.workingCopy.payload as Record<string, unknown>).baseShiftIds = ["shift-known"];
    tx.shiftGroup.findUnique.mockResolvedValue(g);

    const result = await rebaseWorkingSchedule("group-1", 7, actor);

    // shift-new predates the draft by timestamp, so the proxy would skip it;
    // the recorded base set correctly reports the draft never saw it.
    expect(result.rebase.adoptedSlots).toBe(1);
    expect(writtenPayload().slots.map((s) => s.sourceShiftId)).toEqual(["shift-known", "shift-new"]);
  });

  it("re-seats the base shift set on the current live shifts", async () => {
    tx.shiftGroup.findUnique.mockResolvedValue(group(
      [liveShift("shift-a", beforeDraft, null), liveShift("shift-b", afterDraft, null)],
      [draftSlot("shift-a", "shift-a", null)],
    ));

    await rebaseWorkingSchedule("group-1", 7, actor);

    expect(writtenPayload().baseShiftIds).toEqual(["shift-a", "shift-b"]);
    const data = tx.shiftGroupWorkingCopy.updateMany.mock.calls[0]![0] as { data: Record<string, unknown> };
    // A legacy draft becomes payloadVersion 2 the moment it is refreshed.
    expect(data.data.payloadVersion).toBe(2);
  });

  // Staff routinely stage a person in the draft and separately assign that same
  // person live. Adopting the live slot while keeping the staged one puts the
  // worker in the event twice, and publish then reports them as conflicting
  // with themselves -- an error with no sensible reading.
  it("merges a staged slot when the adopted live slot already holds that person", async () => {
    tx.shiftGroup.findUnique.mockResolvedValue(group(
      [liveShift("shift-live", afterDraft, { id: "assignment-live", userId: "zimmerman" })],
      [draftSlot("draft:staged", null, { sourceAssignmentId: null, userId: "zimmerman" })],
    ));

    const result = await rebaseWorkingSchedule("group-1", 7, actor);

    expect(result.rebase.adoptedSlots).toBe(1);
    expect(result.rebase.deduplicatedSlots).toBe(1);
    const slots = writtenPayload().slots;
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ sourceShiftId: "shift-live" });
  });

  it("keeps a staged slot for a different person", async () => {
    tx.shiftGroup.findUnique.mockResolvedValue(group(
      [liveShift("shift-live", afterDraft, { id: "assignment-live", userId: "zimmerman" })],
      [draftSlot("draft:staged", null, { sourceAssignmentId: null, userId: "saddler" })],
    ));

    const result = await rebaseWorkingSchedule("group-1", 7, actor);

    expect(result.rebase.deduplicatedSlots).toBe(0);
    expect(writtenPayload().slots).toHaveLength(2);
  });

  it("keeps a staged slot in a different area", async () => {
    tx.shiftGroup.findUnique.mockResolvedValue(group(
      [liveShift("shift-live", afterDraft, { id: "assignment-live", userId: "zimmerman" })],
      [draftSlot("draft:staged", null, { sourceAssignmentId: null, userId: "zimmerman" }, { area: "PHOTO" })],
    ));

    const result = await rebaseWorkingSchedule("group-1", 7, actor);

    expect(result.rebase.deduplicatedSlots).toBe(0);
    expect(writtenPayload().slots).toHaveLength(2);
  });
});
