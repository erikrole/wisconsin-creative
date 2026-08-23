import { beforeEach, describe, expect, it, vi } from "vitest";

const { tx, createAuditEntryTx, updateShiftAssignmentConflictsTx, buildSnapshot } = vi.hoisted(() => ({
  tx: {
    $executeRaw: vi.fn(),
    shiftGroup: { findUnique: vi.fn(), update: vi.fn() },
    shiftGroupWorkingCopy: { updateMany: vi.fn() },
  },
  createAuditEntryTx: vi.fn(),
  updateShiftAssignmentConflictsTx: vi.fn(),
  buildSnapshot: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({ createAuditEntryTx }));
vi.mock("@/lib/services/shift-assignment-conflicts", () => ({ updateShiftAssignmentConflictsTx }));
vi.mock("@/lib/services/schedule-publication", () => ({
  buildSchedulePublicationSnapshot: buildSnapshot,
}));

import { Role } from "@prisma/client";
import { shiftManualEventScheduleTx } from "@/lib/services/manual-event-time";

const saturdayStart = new Date("2026-08-29T18:00:00.000Z");
const saturdayEnd = new Date("2026-08-29T20:00:00.000Z");
const fridayStart = new Date("2026-08-28T18:00:00.000Z");
const fridayEnd = new Date("2026-08-28T20:00:00.000Z");

function workingPayload() {
  return {
    eventStartsAt: saturdayStart.toISOString(),
    eventEndsAt: saturdayEnd.toISOString(),
    baseShiftIds: ["shift-1"],
    slots: [{
      key: "shift-1",
      sourceShiftId: "shift-1",
      area: "VIDEO",
      workerType: "ST",
      startsAt: saturdayStart.toISOString(),
      endsAt: saturdayEnd.toISOString(),
      callStartsAt: "2026-08-29T17:00:00.000Z",
      callEndsAt: "2026-08-29T21:00:00.000Z",
      notes: null,
      assignmentHistoryCount: 1,
      assignment: {
        sourceAssignmentId: "assignment-1",
        source: "MANUAL",
        userId: "student-1",
        status: "APPROVED",
        callStartsAt: "2026-08-29T17:30:00.000Z",
        callEndsAt: "2026-08-29T20:30:00.000Z",
        callNote: null,
        activeTradeId: null,
        bookingCount: 0,
      },
    }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  tx.$executeRaw.mockResolvedValue(1);
  tx.shiftGroup.update.mockResolvedValue({});
  tx.shiftGroupWorkingCopy.updateMany.mockResolvedValue({ count: 1 });
  createAuditEntryTx.mockResolvedValue(undefined);
  updateShiftAssignmentConflictsTx.mockResolvedValue(undefined);
  buildSnapshot.mockReturnValue({ shifts: [] });
  tx.shiftGroup.findUnique.mockResolvedValue({
    id: "group-1",
    publishedAt: new Date("2026-08-01T12:00:00.000Z"),
    publishedVersion: 3,
    shifts: [{
      id: "shift-1",
      area: "VIDEO",
      workerType: "ST",
      startsAt: saturdayStart,
      endsAt: saturdayEnd,
      callStartsAt: new Date("2026-08-29T17:00:00.000Z"),
      callEndsAt: new Date("2026-08-29T21:00:00.000Z"),
      assignments: [{
        id: "assignment-1",
        userId: "student-1",
        status: "APPROVED",
        callStartsAt: new Date("2026-08-29T17:30:00.000Z"),
        callEndsAt: new Date("2026-08-29T20:30:00.000Z"),
        callNote: null,
        user: { role: "STUDENT", staffingType: "ST", availabilityBlocks: [] },
      }],
    }],
    workingCopy: { version: 2, payload: workingPayload() },
  });
});

describe("shiftManualEventScheduleTx", () => {
  it("moves published crew, personal calls, and the private working copy with the event", async () => {
    const result = await shiftManualEventScheduleTx(tx as never, {
      eventId: "event-1",
      previousStartsAt: saturdayStart,
      previousEndsAt: saturdayEnd,
      nextStartsAt: fridayStart,
      nextEndsAt: fridayEnd,
      actor: { id: "staff-1", role: Role.STAFF },
    });

    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(buildSnapshot).toHaveBeenCalledWith({
      shifts: [expect.objectContaining({
        startsAt: fridayStart,
        endsAt: fridayEnd,
        callStartsAt: new Date("2026-08-28T17:00:00.000Z"),
        callEndsAt: new Date("2026-08-28T21:00:00.000Z"),
        assignments: [expect.objectContaining({
          callStartsAt: new Date("2026-08-28T17:30:00.000Z"),
          callEndsAt: new Date("2026-08-28T20:30:00.000Z"),
        })],
      })],
    });

    const workingUpdate = tx.shiftGroupWorkingCopy.updateMany.mock.calls[0]?.[0];
    expect(workingUpdate).toMatchObject({
      where: { shiftGroupId: "group-1", version: 2 },
      data: {
        version: { increment: 1 },
        basePublishedVersion: 4,
        updatedById: "staff-1",
        payload: expect.objectContaining({
          eventStartsAt: fridayStart.toISOString(),
          eventEndsAt: fridayEnd.toISOString(),
          slots: [expect.objectContaining({
            startsAt: fridayStart.toISOString(),
            endsAt: fridayEnd.toISOString(),
            callStartsAt: "2026-08-28T17:00:00.000Z",
            callEndsAt: "2026-08-28T21:00:00.000Z",
            assignment: expect.objectContaining({
              callStartsAt: "2026-08-28T17:30:00.000Z",
              callEndsAt: "2026-08-28T20:30:00.000Z",
            }),
          })],
        }),
      },
    });
    expect(tx.shiftGroup.update).toHaveBeenCalledWith({
      where: { id: "group-1" },
      data: {
        publishedVersion: { increment: 1 },
        lastPublishedSnapshot: { shifts: [] },
      },
    });
    expect(updateShiftAssignmentConflictsTx).toHaveBeenCalledWith(
      tx,
      [{ id: "assignment-1", hasConflict: false, conflictNote: null }],
      true,
    );
    expect(result).toEqual({
      shiftGroupId: "group-1",
      affectedUserIds: ["student-1"],
      published: true,
    });
  });
});
