import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectSerializableIsolation } from "./_helpers/assert-transaction";
import type { WorkingSchedulePayload } from "@/lib/schedule-working-copy";

const { tx, transactionCalls, createAuditEntryTx } = vi.hoisted(() => ({
  tx: {
    shiftGroup: { findUnique: vi.fn() },
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    sportConfig: { findUnique: vi.fn() },
    shiftGroupWorkingCopy: { updateMany: vi.fn(), create: vi.fn() },
  },
  transactionCalls: [] as Array<{ options: unknown }>,
  createAuditEntryTx: vi.fn(),
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

vi.mock("@/lib/audit", () => ({ createAuditEntryTx, createAuditEntry: vi.fn() }));
vi.mock("@/lib/services/shift-assignments", () => ({ checkTimeConflict: vi.fn() }));

import {
  changeWorkingScheduleHistory,
  mutateWorkingSchedule,
} from "@/lib/services/schedule-working-copy";

const eventStartsAt = "2026-10-06T18:00:00.000Z";
const eventEndsAt = "2026-10-06T21:00:00.000Z";
const actor = { id: "staff-1", role: "STAFF" as const };

function slot(key: string) {
  return {
    key,
    sourceShiftId: key.startsWith("draft:") ? null : key,
    area: "VIDEO" as const,
    workerType: "FT" as const,
    startsAt: eventStartsAt,
    endsAt: eventEndsAt,
    callStartsAt: null,
    callEndsAt: null,
    notes: null,
    assignmentHistoryCount: 0,
    assignment: null,
  };
}

function payload(slots: WorkingSchedulePayload["slots"] = [slot("shift-1")]): WorkingSchedulePayload {
  return { eventStartsAt, eventEndsAt, slots };
}

function historyEntry(
  before: WorkingSchedulePayload,
  after: WorkingSchedulePayload,
  actorId = actor.id,
) {
  return {
    id: "history-1",
    actorId,
    commandType: "adjustSlots",
    label: "Add Staff Video slot",
    before,
    after,
  };
}

function group(copy: {
  version: number;
  payload: WorkingSchedulePayload;
  undoStack: unknown[];
  redoStack: unknown[];
}) {
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
    workingCopy: {
      ...copy,
      basePublishedVersion: 1,
      payloadVersion: 2,
      undoStack: copy.undoStack,
      redoStack: copy.redoStack,
      autoReleaseAt: null,
      autoReleaseRunId: null,
      autoReleaseError: null,
      createdAt: new Date("2026-09-01T12:01:00.000Z"),
      updatedAt: new Date("2026-09-01T12:02:00.000Z"),
      updatedById: actor.id,
    },
  };
}

describe("schedule working-copy history", () => {
  beforeEach(() => {
    transactionCalls.length = 0;
    createAuditEntryTx.mockReset();
    for (const model of Object.values(tx)) {
      for (const fn of Object.values(model)) fn.mockReset();
    }
    tx.sportConfig.findUnique.mockResolvedValue(null);
    tx.user.findMany.mockResolvedValue([]);
    tx.shiftGroupWorkingCopy.updateMany.mockResolvedValue({ count: 1 });
  });

  it("undoes the latest named command and moves it to redo", async () => {
    const before = payload([]);
    const after = payload();
    const entry = historyEntry(before, after);
    tx.shiftGroup.findUnique
      .mockResolvedValueOnce(group({ version: 4, payload: after, undoStack: [entry], redoStack: [] }))
      .mockResolvedValueOnce(group({ version: 5, payload: before, undoStack: [], redoStack: [entry] }));

    const result = await changeWorkingScheduleHistory("group-1", 4, "undo", actor);

    expectSerializableIsolation(transactionCalls);
    expect(result.historyAction).toMatchObject({ type: "undo", label: entry.label, version: 5 });
    expect(result.workingVersion).toBe(5);
    expect(result.canUndo).toBe(false);
    expect(result.canRedo).toBe(true);
    expect(tx.shiftGroupWorkingCopy.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { shiftGroupId: "group-1", version: 4 },
      data: expect.objectContaining({
        version: 5,
        payload: before,
        undoStack: [],
        redoStack: [entry],
        updatedById: actor.id,
      }),
    }));
    expect(createAuditEntryTx).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: "working_schedule_undo",
      before: expect.objectContaining({ version: 4, label: entry.label }),
      after: expect.objectContaining({ version: 5, label: entry.label }),
    }));
  });

  it("redoes an undone command and moves it back to undo", async () => {
    const before = payload([]);
    const after = payload();
    const entry = historyEntry(before, after);
    tx.shiftGroup.findUnique
      .mockResolvedValueOnce(group({ version: 5, payload: before, undoStack: [], redoStack: [entry] }))
      .mockResolvedValueOnce(group({ version: 6, payload: after, undoStack: [entry], redoStack: [] }));

    const result = await changeWorkingScheduleHistory("group-1", 5, "redo", actor);

    expect(result.historyAction).toMatchObject({ type: "redo", label: entry.label, version: 6 });
    expect(result.canUndo).toBe(true);
    expect(result.canRedo).toBe(false);
    expect(tx.shiftGroupWorkingCopy.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        version: 6,
        payload: after,
        undoStack: [entry],
        redoStack: [],
      }),
    }));
    expect(createAuditEntryTx).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: "working_schedule_redo",
    }));
  });

  it("rejects stale versions and another operator's top command", async () => {
    const before = payload([]);
    const after = payload();
    const entry = historyEntry(before, after, "staff-2");
    tx.shiftGroup.findUnique.mockResolvedValue(group({ version: 4, payload: after, undoStack: [entry], redoStack: [] }));

    await expect(changeWorkingScheduleHistory("group-1", 3, "undo", actor))
      .rejects.toMatchObject({ status: 409 });
    await expect(changeWorkingScheduleHistory("group-1", 4, "undo", actor))
      .rejects.toMatchObject({ status: 409 });
    expect(tx.shiftGroupWorkingCopy.updateMany).not.toHaveBeenCalled();
  });

  it("records a new command, caps the stack, and clears redo", async () => {
    const before = payload([]);
    const after = payload();
    const previous = historyEntry(before, after, actor.id);
    const redo = historyEntry(before, after, actor.id);
    const initial = group({ version: 7, payload: after, undoStack: [previous], redoStack: [redo] });
    let writeData: Record<string, unknown> | null = null;
    tx.shiftGroup.findUnique
      .mockResolvedValueOnce(initial)
      .mockImplementation(async () => group({
        version: Number(writeData?.version ?? 8),
        payload: (writeData?.payload ?? after) as WorkingSchedulePayload,
        undoStack: (writeData?.undoStack ?? [previous]) as unknown[],
        redoStack: (writeData?.redoStack ?? []) as unknown[],
      }));
    tx.shiftGroupWorkingCopy.updateMany.mockImplementation(async (input: { data: Record<string, unknown> }) => {
      writeData = input.data;
      return { count: 1 };
    });

    const result = await mutateWorkingSchedule(
      "group-1",
      7,
      { type: "adjustSlots", area: "VIDEO", workerType: "FT", delta: 1 },
      actor,
    );

    expect(result.historyAction).toMatchObject({ type: "command", version: 8 });
    expect(result.canUndo).toBe(true);
    expect(result.canRedo).toBe(false);
    expect(writeData).toEqual(expect.objectContaining({ version: 8, redoStack: [] }));
    const persistedWriteData = writeData as Record<string, unknown> | null;
    const stack = persistedWriteData?.undoStack as Array<Record<string, unknown>>;
    const latest = stack.at(-1);
    expect(latest).toMatchObject({
      actorId: actor.id,
      commandType: "adjustSlots",
      label: "Add Staff Video slot",
    });
    expect(latest?.before).toEqual(after);
    expect((latest?.after as WorkingSchedulePayload).slots).toHaveLength(2);
    expect(createAuditEntryTx).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: "working_schedule_adjustSlots",
    }));
  });
});
