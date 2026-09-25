import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkingSchedulePayload } from "@/lib/schedule-working-copy";

/**
 * A working copy's version restarts at 1 whenever a draft is recreated after
 * publish or discard, so a stale client holding "v1 of draft X" could land a
 * mutation on "v1 of draft Y". The editor exposes `draftId` and every versioned
 * mutation accepts an optional `expectedDraftId` checked in the same
 * transaction as the version.
 */

const { tx, createAuditEntryTx } = vi.hoisted(() => ({
  tx: {
    shiftGroup: { findUnique: vi.fn() },
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    sportConfig: { findUnique: vi.fn() },
    shiftAssignment: { findMany: vi.fn() },
    shiftTrade: { findMany: vi.fn() },
    shiftGroupWorkingCopy: { updateMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  },
  createAuditEntryTx: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    ...tx,
    $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  },
}));

vi.mock("@/lib/audit", () => ({ createAuditEntryTx, createAuditEntry: vi.fn() }));
vi.mock("@/lib/services/shift-assignments", () => ({ checkTimeConflict: vi.fn() }));

import { workingScheduleDraftId, workingScheduleDraftMatches } from "@/lib/schedule-working-copy";
import {
  changeWorkingScheduleHistory,
  discardWorkingSchedule,
  getWorkingScheduleEditor,
  mutateWorkingSchedule,
} from "@/lib/services/schedule-working-copy";

const eventStartsAt = "2026-10-06T18:00:00.000Z";
const eventEndsAt = "2026-10-06T21:00:00.000Z";
const actor = { id: "staff-1", role: "STAFF" as const };
const draftCreatedAt = new Date("2026-09-01T12:01:00.000Z");
const currentDraftId = draftCreatedAt.toISOString();
const staleDraftId = "2026-08-30T09:00:00.000Z";
const addSlot = { type: "adjustSlots" as const, area: "VIDEO" as const, workerType: "FT" as const, delta: 1 as const };

function payload(): WorkingSchedulePayload {
  return {
    eventStartsAt,
    eventEndsAt,
    slots: [{
      key: "shift-1",
      sourceShiftId: "shift-1",
      area: "VIDEO",
      workerType: "FT",
      startsAt: eventStartsAt,
      endsAt: eventEndsAt,
      callStartsAt: null,
      callEndsAt: null,
      notes: null,
      assignmentHistoryCount: 0,
      assignment: null,
    }],
  };
}

function group(withDraft = true) {
  return {
    id: "group-1",
    publishedAt: new Date("2026-09-01T12:00:00.000Z"),
    publishedVersion: 1,
    event: {
      startsAt: new Date(eventStartsAt),
      endsAt: new Date(eventEndsAt),
      allDay: false,
      sportCode: "VB",
    },
    shifts: [],
    workingCopy: withDraft
      ? {
        version: 1,
        basePublishedVersion: 1,
        payloadVersion: 2,
        payload: payload(),
        undoStack: [{
          id: "history-1",
          actorId: actor.id,
          commandType: "adjustSlots",
          label: "Add Staff Video slot",
          before: payload(),
          after: payload(),
        }],
        redoStack: [],
        autoReleaseAt: null,
        autoReleaseRunId: null,
        autoReleaseError: null,
        createdAt: draftCreatedAt,
        updatedAt: new Date("2026-09-01T12:02:00.000Z"),
        updatedById: actor.id,
      }
      : null,
  };
}

beforeEach(() => {
  createAuditEntryTx.mockReset();
  for (const model of Object.values(tx)) {
    for (const fn of Object.values(model)) fn.mockReset();
  }
  tx.sportConfig.findUnique.mockResolvedValue(null);
  tx.user.findMany.mockResolvedValue([]);
  tx.shiftAssignment.findMany.mockResolvedValue([]);
  tx.shiftTrade.findMany.mockResolvedValue([]);
  tx.shiftGroupWorkingCopy.updateMany.mockResolvedValue({ count: 1 });
  tx.shiftGroupWorkingCopy.deleteMany.mockResolvedValue({ count: 1 });
  tx.shiftGroupWorkingCopy.create.mockResolvedValue({});
  tx.shiftGroup.findUnique.mockResolvedValue(group());
});

describe("working schedule draft identity", () => {
  it("derives a stable identity from the working copy's creation instant", () => {
    expect(workingScheduleDraftId(null)).toBeNull();
    expect(workingScheduleDraftId({ createdAt: draftCreatedAt })).toBe(currentDraftId);
    expect(workingScheduleDraftMatches({ createdAt: draftCreatedAt }, undefined)).toBe(true);
    expect(workingScheduleDraftMatches(null, undefined)).toBe(true);
    expect(workingScheduleDraftMatches({ createdAt: draftCreatedAt }, currentDraftId)).toBe(true);
    expect(workingScheduleDraftMatches({ createdAt: draftCreatedAt }, staleDraftId)).toBe(false);
    expect(workingScheduleDraftMatches({ createdAt: draftCreatedAt }, null)).toBe(false);
    expect(workingScheduleDraftMatches(null, null)).toBe(true);
    expect(workingScheduleDraftMatches(null, "")).toBe(true);
    expect(workingScheduleDraftMatches(null, currentDraftId)).toBe(false);
  });

  it("exposes draftId on the editor response, null when there is no draft", async () => {
    await expect(getWorkingScheduleEditor("group-1", actor.id))
      .resolves.toMatchObject({ draftId: currentDraftId, workingVersion: 1, hasWorkingCopy: true });
    tx.shiftGroup.findUnique.mockResolvedValue(group(false));
    await expect(getWorkingScheduleEditor("group-1", actor.id))
      .resolves.toMatchObject({ draftId: null, workingVersion: 0, hasWorkingCopy: false });
  });

  it("rejects a PATCH command aimed at a different draft with the same version", async () => {
    await expect(mutateWorkingSchedule("group-1", 1, addSlot, actor, undefined, staleDraftId))
      .rejects.toMatchObject({
        status: 409,
        message: "This schedule changed in another session. Refresh before editing again.",
      });
    await expect(mutateWorkingSchedule("group-1", 1, addSlot, actor, undefined, null))
      .rejects.toMatchObject({ status: 409 });
    expect(tx.shiftGroupWorkingCopy.updateMany).not.toHaveBeenCalled();
    expect(createAuditEntryTx).not.toHaveBeenCalled();
  });

  it("rejects a PATCH that expects a draft after it was published or discarded", async () => {
    tx.shiftGroup.findUnique.mockResolvedValue(group(false));
    await expect(mutateWorkingSchedule("group-1", 0, addSlot, actor, undefined, currentDraftId))
      .rejects.toMatchObject({ status: 409 });
    expect(tx.shiftGroupWorkingCopy.create).not.toHaveBeenCalled();
  });

  it("applies a PATCH when the draft id matches or when a legacy client omits it", async () => {
    await mutateWorkingSchedule("group-1", 1, addSlot, actor, undefined, currentDraftId);
    await mutateWorkingSchedule("group-1", 1, addSlot, actor);
    expect(tx.shiftGroupWorkingCopy.updateMany).toHaveBeenCalledTimes(2);

    tx.shiftGroup.findUnique.mockResolvedValue(group(false));
    await mutateWorkingSchedule("group-1", 0, addSlot, actor, undefined, "");
    await mutateWorkingSchedule("group-1", 0, addSlot, actor, undefined, null);
    expect(tx.shiftGroupWorkingCopy.create).toHaveBeenCalledTimes(2);
  });

  it("guards undo and redo with the same draft identity", async () => {
    await expect(changeWorkingScheduleHistory("group-1", 1, "undo", actor, undefined, staleDraftId))
      .rejects.toMatchObject({ status: 409 });
    expect(tx.shiftGroupWorkingCopy.updateMany).not.toHaveBeenCalled();

    await changeWorkingScheduleHistory("group-1", 1, "undo", actor, undefined, currentDraftId);
    expect(tx.shiftGroupWorkingCopy.updateMany).toHaveBeenCalledTimes(1);
  });

  it("never discards a newer draft that reused the stale client's version", async () => {
    await expect(discardWorkingSchedule("group-1", 1, actor, staleDraftId))
      .rejects.toMatchObject({
        status: 409,
        message: "This schedule changed in another session. Refresh before discarding it.",
      });
    expect(tx.shiftGroupWorkingCopy.deleteMany).not.toHaveBeenCalled();

    await discardWorkingSchedule("group-1", 1, actor, currentDraftId);
    expect(tx.shiftGroupWorkingCopy.deleteMany).toHaveBeenCalledTimes(1);
  });

  it("keeps legacy discard idempotent when the draft is already gone", async () => {
    tx.shiftGroup.findUnique.mockResolvedValue(group(false));
    await expect(discardWorkingSchedule("group-1", 1, actor)).resolves.toMatchObject({ draftId: null });
    await expect(discardWorkingSchedule("group-1", 1, actor, currentDraftId))
      .rejects.toMatchObject({ status: 409 });
  });

  it("accepts expectedDraftId on every versioned route body", () => {
    const workingCopyRoute = readFileSync("src/app/api/shift-groups/[id]/working-copy/route.ts", "utf8");
    const publishRoute = readFileSync("src/app/api/shift-groups/[id]/publish/route.ts", "utf8");

    // mutate, history, rebase (JSON bodies) and discard (query string)
    expect(workingCopyRoute.match(/expectedDraftId: expectedWorkingScheduleDraftIdSchema/g)).toHaveLength(3);
    expect(workingCopyRoute).toContain("expectedDraftId: z.string().max(64).optional()");
    expect(workingCopyRoute).toContain("body.expectedDraftId");
    expect(workingCopyRoute).toContain("query.expectedDraftId");
    expect(publishRoute).toContain("expectedDraftId: expectedWorkingScheduleDraftIdSchema");
    expect(publishRoute).toContain("expectedDraftId: body.expectedDraftId");
  });
});
