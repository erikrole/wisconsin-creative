import { describe, expect, it } from "vitest";
import {
  applyWorkingScheduleCommand,
  reconcileWorkingAssignmentSources,
  summarizeWorkingScheduleChanges,
  workingSchedulePayloadSchema,
  type WorkingSchedulePayload,
} from "@/lib/schedule-working-copy";

function payload(overrides: Partial<WorkingSchedulePayload> = {}): WorkingSchedulePayload {
  return {
    eventStartsAt: "2026-10-06T18:00:00.000Z",
    eventEndsAt: "2026-10-06T21:00:00.000Z",
    slots: [
      {
        key: "shift-1",
        sourceShiftId: "shift-1",
        area: "VIDEO",
        workerType: "ST",
        startsAt: "2026-10-06T18:00:00.000Z",
        endsAt: "2026-10-06T21:00:00.000Z",
        callStartsAt: "2026-10-06T17:00:00.000Z",
        callEndsAt: "2026-10-06T22:00:00.000Z",
        notes: null,
        assignmentHistoryCount: 0,
        assignment: null,
      },
    ],
    ...overrides,
  };
}

describe("working schedule commands", () => {
  it("reconnects a same-person staged assignment to its live row", () => {
    const staged = payload({
      slots: [{
        ...payload().slots[0]!,
        workerType: "FT",
        assignment: {
          sourceAssignmentId: null,
          userId: "user-1",
          status: "DIRECT_ASSIGNED",
          callStartsAt: null,
          callEndsAt: null,
          callNote: null,
          activeTradeId: null,
          bookingCount: 0,
        },
      }],
    });

    const repaired = reconcileWorkingAssignmentSources(staged, [{
      id: "shift-1",
      workerType: "FT",
      assignments: [{ id: "assignment-1", userId: "user-1" }],
    }]);

    expect(repaired.slots[0]!.assignment?.sourceAssignmentId).toBe("assignment-1");
  });

  it("keeps a real worker-class replacement staged as new", () => {
    const staged = payload({
      slots: [{
        ...payload().slots[0]!,
        workerType: "ST",
        assignment: {
          sourceAssignmentId: null,
          userId: "user-1",
          status: "DIRECT_ASSIGNED",
          callStartsAt: null,
          callEndsAt: null,
          callNote: null,
          activeTradeId: null,
          bookingCount: 0,
        },
      }],
    });

    const repaired = reconcileWorkingAssignmentSources(staged, [{
      id: "shift-1",
      workerType: "FT",
      assignments: [{ id: "assignment-1", userId: "user-1" }],
    }]);

    expect(repaired.slots[0]!.assignment?.sourceAssignmentId).toBeNull();
  });

  it("adds a same-class slot with its peer's call window", () => {
    const result = applyWorkingScheduleCommand(
      payload(),
      { type: "adjustSlots", area: "VIDEO", workerType: "ST", delta: 1 },
      () => "draft:new",
    );

    expect(result.slots).toHaveLength(2);
    expect(result.slots[1]).toMatchObject({
      key: "draft:new",
      sourceShiftId: null,
      workerType: "ST",
      callStartsAt: "2026-10-06T17:00:00.000Z",
      assignmentHistoryCount: 0,
    });
  });

  it("allows a native quick-add to stage an explicit call window", () => {
    const defaultWindow = {
      startsAt: "2026-10-06T17:00:00.000Z",
      endsAt: "2026-10-06T22:00:00.000Z",
    };
    const result = applyWorkingScheduleCommand(
      payload({ slots: [] }),
      {
        type: "adjustSlots",
        area: "PHOTO",
        workerType: "ST",
        delta: 1,
        callStartsAt: "2026-10-06T16:30:00.000Z",
        callEndsAt: "2026-10-06T21:30:00.000Z",
      },
      () => "draft:custom",
      defaultWindow,
    );

    expect(result.slots[0]).toMatchObject({
      key: "draft:custom",
      startsAt: defaultWindow.startsAt,
      endsAt: defaultWindow.endsAt,
      callStartsAt: "2026-10-06T16:30:00.000Z",
      callEndsAt: "2026-10-06T21:30:00.000Z",
    });
  });

  it("uses the event window for the first Staff slot", () => {
    const result = applyWorkingScheduleCommand(
      payload({ slots: [] }),
      { type: "adjustSlots", area: "PHOTO", workerType: "FT", delta: 1 },
      () => "draft:first",
      {
        startsAt: "2026-10-06T16:30:00.000Z",
        endsAt: "2026-10-06T22:00:00.000Z",
      },
    );

    expect(result.slots[0]).toMatchObject({
      key: "draft:first",
      area: "PHOTO",
      workerType: "FT",
      startsAt: "2026-10-06T18:00:00.000Z",
      endsAt: "2026-10-06T21:00:00.000Z",
      callStartsAt: null,
      callEndsAt: null,
    });
  });

  it("subtracts only an open slot with no assignment history", () => {
    const historyBearing = payload().slots[0]!;
    expect(() => applyWorkingScheduleCommand(
      payload({ slots: [{ ...historyBearing, assignmentHistoryCount: 1 }] }),
      { type: "adjustSlots", area: "VIDEO", workerType: "ST", delta: -1 },
      () => "unused",
    )).toThrow("UNASSIGN_BEFORE_REDUCING");
  });

  it("removes the selected untouched slot instead of another matching opening", () => {
    const baseSlot = payload().slots[0]!;
    const result = applyWorkingScheduleCommand(
      payload({
        slots: [
          baseSlot,
          { ...baseSlot, key: "draft:second", sourceShiftId: null },
        ],
      }),
      { type: "removeSlot", slotKey: "shift-1" },
      () => "unused",
    );

    expect(result.slots.map((slot) => slot.key)).toEqual(["draft:second"]);
  });

  it("converts an empty slot but protects assigned slots", () => {
    const converted = applyWorkingScheduleCommand(
      payload(),
      { type: "convertSlot", slotKey: "shift-1", workerType: "FT" },
      () => "unused",
    );
    expect(converted.slots[0]!.workerType).toBe("FT");

    const baseSlot = payload().slots[0]!;
    const assigned = payload({
      slots: [{
        ...baseSlot,
        assignmentHistoryCount: 1,
        assignment: {
          sourceAssignmentId: "assignment-1",
          userId: "user-1",
          status: "DIRECT_ASSIGNED",
          callStartsAt: null,
          callEndsAt: null,
          callNote: null,
          activeTradeId: null,
          bookingCount: 0,
        },
      }],
    });
    expect(() => applyWorkingScheduleCommand(
      assigned,
      { type: "convertSlot", slotKey: "shift-1", workerType: "FT" },
      () => "unused",
    )).toThrow("UNASSIGN_BEFORE_CONVERTING");
  });

  it("converts an assigned slot only through an explicit replacement", () => {
    const baseSlot = payload().slots[0]!;
    const assigned = payload({
      slots: [{
        ...baseSlot,
        assignmentHistoryCount: 1,
        assignment: {
          sourceAssignmentId: "assignment-1",
          userId: "user-1",
          status: "DIRECT_ASSIGNED",
          callStartsAt: "2026-10-06T16:30:00.000Z",
          callEndsAt: "2026-10-06T21:30:00.000Z",
          callNote: "Old call window",
          activeTradeId: null,
          bookingCount: 0,
        },
      }],
    });

    const replaced = applyWorkingScheduleCommand(
      assigned,
      {
        type: "convertAndReplace",
        slotKey: "shift-1",
        workerType: "FT",
        userId: "user-2",
      },
      () => "unused",
    );

    expect(replaced.slots[0]).toMatchObject({
      workerType: "FT",
      assignmentHistoryCount: 1,
      assignment: {
        sourceAssignmentId: null,
        userId: "user-2",
        status: "DIRECT_ASSIGNED",
        callStartsAt: null,
        callEndsAt: null,
        callNote: null,
      },
    });
  });

  it("replaces an assigned worker without converting the slot", () => {
    const assigned = applyWorkingScheduleCommand(
      payload(),
      { type: "assign", slotKey: "shift-1", userId: "user-1" },
      () => "unused",
    );

    const replaced = applyWorkingScheduleCommand(
      assigned,
      {
        type: "convertAndReplace",
        slotKey: "shift-1",
        workerType: "ST",
        userId: "user-2",
      },
      () => "unused",
    );

    expect(replaced.slots[0]).toMatchObject({
      workerType: "ST",
      assignment: {
        sourceAssignmentId: null,
        userId: "user-2",
        status: "DIRECT_ASSIGNED",
      },
    });
  });

  it("protects active trades and linked bookings during replacement", () => {
    const baseSlot = payload().slots[0]!;
    for (const assignment of [
      { activeTradeId: "trade-1", bookingCount: 0 },
      { activeTradeId: null, bookingCount: 1 },
    ]) {
      expect(() => applyWorkingScheduleCommand(
        payload({
          slots: [{
            ...baseSlot,
            assignment: {
              sourceAssignmentId: "assignment-1",
              userId: "user-1",
              status: "DIRECT_ASSIGNED",
              callStartsAt: null,
              callEndsAt: null,
              callNote: null,
              ...assignment,
            },
          }],
        }),
        {
          type: "convertAndReplace",
          slotKey: "shift-1",
          workerType: "FT",
          userId: "user-2",
        },
        () => "unused",
      )).toThrow(assignment.activeTradeId ? "CANCEL_TRADE_BEFORE_REPLACING" : "UNLINK_BOOKING_BEFORE_REPLACING");
    }
  });

  it("stages assignment and removal without mutating a published row", () => {
    const assigned = applyWorkingScheduleCommand(
      payload(),
      { type: "assign", slotKey: "shift-1", userId: "user-1" },
      () => "unused",
    );
    expect(assigned.slots[0]!.assignment).toMatchObject({
      sourceAssignmentId: null,
      userId: "user-1",
      status: "DIRECT_ASSIGNED",
    });

    const unassigned = applyWorkingScheduleCommand(
      assigned,
      { type: "unassign", slotKey: "shift-1" },
      () => "unused",
    );
    expect(unassigned.slots[0]!.assignment).toBeNull();
  });

  it("stages a slot call window and includes it in publish review", () => {
    const published = payload();
    const working = applyWorkingScheduleCommand(
      published,
      {
        type: "setCallWindow",
        slotKey: "shift-1",
        callStartsAt: "2026-10-06T16:30:00.000Z",
        callEndsAt: "2026-10-06T21:30:00.000Z",
      },
      () => "unused",
    );

    expect(working.slots[0]).toMatchObject({
      callStartsAt: "2026-10-06T16:30:00.000Z",
      callEndsAt: "2026-10-06T21:30:00.000Z",
    });
    expect(summarizeWorkingScheduleChanges(published, working)).toMatchObject({
      callWindowChanges: 1,
      total: 1,
    });
  });

  it("stages an assigned worker's personal call window on the assignment", () => {
    const baseSlot = payload().slots[0]!;
    const published = payload({
      slots: [{
        ...baseSlot,
        assignment: {
          sourceAssignmentId: "assignment-1",
          userId: "user-1",
          status: "DIRECT_ASSIGNED",
          callStartsAt: null,
          callEndsAt: null,
          callNote: null,
          activeTradeId: null,
          bookingCount: 0,
        },
      }],
    });
    const working = applyWorkingScheduleCommand(
      published,
      {
        type: "setCallWindow",
        slotKey: "shift-1",
        callStartsAt: "2026-10-06T16:30:00.000Z",
        callEndsAt: "2026-10-06T21:30:00.000Z",
      },
      () => "unused",
    );

    expect(working.slots[0]).toMatchObject({
      callStartsAt: "2026-10-06T17:00:00.000Z",
      callEndsAt: "2026-10-06T22:00:00.000Z",
      assignment: {
        callStartsAt: "2026-10-06T16:30:00.000Z",
        callEndsAt: "2026-10-06T21:30:00.000Z",
      },
    });
    expect(summarizeWorkingScheduleChanges(published, working)).toMatchObject({
      assignmentChanges: 0,
      callWindowChanges: 1,
      total: 1,
    });
  });

  it("stages one shared call window for every slot and clears personal overrides", () => {
    const baseSlot = payload().slots[0]!;
    const published = payload({
      slots: [
        {
          ...baseSlot,
          assignment: {
            sourceAssignmentId: "assignment-1",
            userId: "user-1",
            status: "DIRECT_ASSIGNED",
            callStartsAt: "2026-10-06T16:30:00.000Z",
            callEndsAt: "2026-10-06T21:30:00.000Z",
            callNote: "Personal exception",
            activeTradeId: null,
            bookingCount: 0,
          },
        },
        { ...baseSlot, key: "shift-2", sourceShiftId: "shift-2", area: "PHOTO" },
      ],
    });

    const working = applyWorkingScheduleCommand(
      published,
      {
        type: "setCallWindowForAll",
        callStartsAt: "2026-10-06T17:15:00.000Z",
        callEndsAt: "2026-10-06T22:15:00.000Z",
      },
      () => "unused",
    );

    expect(working.slots).toEqual([
      expect.objectContaining({
        callStartsAt: "2026-10-06T17:15:00.000Z",
        callEndsAt: "2026-10-06T22:15:00.000Z",
        assignment: expect.objectContaining({
          callStartsAt: null,
          callEndsAt: null,
          callNote: "Personal exception",
        }),
      }),
      expect.objectContaining({
        callStartsAt: "2026-10-06T17:15:00.000Z",
        callEndsAt: "2026-10-06T22:15:00.000Z",
      }),
    ]);
  });

  it("summarizes additions, removals, and conversions for publish review", () => {
    const baseSlot = payload().slots[0]!;
    const published = payload({
      slots: [
        baseSlot,
        { ...baseSlot, key: "shift-2", sourceShiftId: "shift-2", area: "PHOTO" },
      ],
    });
    const working = payload({
      slots: [
        { ...baseSlot, workerType: "FT" },
        { ...baseSlot, key: "draft:new", sourceShiftId: null, area: "GRAPHICS" },
      ],
    });

    expect(summarizeWorkingScheduleChanges(published, working)).toEqual({
      addedSlots: 1,
      removedSlots: 1,
      convertedSlots: 1,
      assignmentChanges: 0,
      callWindowChanges: 0,
      total: 3,
    });
  });
});

describe("working schedule payload invariants", () => {
  function assigned(overrides: Record<string, unknown> = {}) {
    const base = payload();
    base.slots[0]!.assignment = {
      sourceAssignmentId: "assignment-1",
      userId: "student-1",
      status: "DIRECT_ASSIGNED",
      callStartsAt: "2026-10-06T19:00:00.000Z",
      callEndsAt: "2026-10-06T20:00:00.000Z",
      callNote: null,
      activeTradeId: null,
      bookingCount: 0,
      ...overrides,
    };
    return base;
  }

  it("accepts a complete personal call window", () => {
    expect(workingSchedulePayloadSchema.safeParse(assigned()).success).toBe(true);
  });

  // A half pair reads differently depending on the consumer: the shared
  // `effectiveCallWindow` helper ignores the override entirely, while the reads
  // that chain `??` per field splice a personal start onto a slot end. Publish
  // writes this payload straight onto ShiftAssignment, so the payload is the
  // last boundary that can hold the invariant the REST routes already enforce.
  it("rejects a personal call window missing its release time", () => {
    const result = workingSchedulePayloadSchema.safeParse(assigned({ callEndsAt: null }));
    expect(result.success).toBe(false);
  });

  it("rejects a personal call window missing its call time", () => {
    const result = workingSchedulePayloadSchema.safeParse(assigned({ callStartsAt: null }));
    expect(result.success).toBe(false);
  });

  it("rejects an inverted personal call window", () => {
    const result = workingSchedulePayloadSchema.safeParse(
      assigned({ callStartsAt: "2026-10-06T20:00:00.000Z", callEndsAt: "2026-10-06T19:00:00.000Z" }),
    );
    expect(result.success).toBe(false);
  });

  it("accepts an assignment with no personal override", () => {
    const result = workingSchedulePayloadSchema.safeParse(
      assigned({ callStartsAt: null, callEndsAt: null }),
    );
    expect(result.success).toBe(true);
  });
});
