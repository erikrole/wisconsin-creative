import { describe, expect, it } from "vitest";
import {
  applyWorkingScheduleCommand,
  summarizeWorkingScheduleChanges,
  workingSchedulePayloadSchema,
  type WorkingSchedulePayload,
} from "@/lib/schedule-working-copy";
import { crewTagText, crewTagsClash, crewTagsOf, normalizeCrewLabel } from "@/lib/crew-label";

function assignedPayload(): WorkingSchedulePayload {
  return {
    eventStartsAt: "2026-10-06T18:00:00.000Z",
    eventEndsAt: "2026-10-06T21:00:00.000Z",
    slots: [
      {
        key: "shift-1",
        sourceShiftId: "shift-1",
        area: "PHOTO",
        workerType: "FT",
        startsAt: "2026-10-06T18:00:00.000Z",
        endsAt: "2026-10-06T21:00:00.000Z",
        callStartsAt: null,
        callEndsAt: null,
        notes: null,
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
      },
      {
        key: "shift-2",
        sourceShiftId: "shift-2",
        area: "PHOTO",
        workerType: "FT",
        startsAt: "2026-10-06T18:00:00.000Z",
        endsAt: "2026-10-06T21:00:00.000Z",
        callStartsAt: null,
        callEndsAt: null,
        notes: null,
        assignmentHistoryCount: 0,
        assignment: null,
      },
    ],
  };
}

describe("crew label", () => {
  it("normalizes and formats the tag", () => {
    expect(normalizeCrewLabel("  SLOW1  ")).toBe("SLOW1");
    expect(normalizeCrewLabel("   ")).toBeNull();
    expect(normalizeCrewLabel(null)).toBeNull();
    expect(normalizeCrewLabel("x".repeat(40))).toHaveLength(24);
    expect(crewTagText("SLOW1", "FIRST")).toBe("SLOW1 · 1st half");
    expect(crewTagText(null, "SECOND")).toBe("2nd half");
    expect(crewTagText("ROAM2", null)).toBe("ROAM2");
    expect(crewTagText(null, null)).toBeNull();
  });

  it("stages a label and half on an assignment and counts it as a change", () => {
    const published = assignedPayload();
    const next = applyWorkingScheduleCommand(
      published,
      { type: "setCrewTags", slotKey: "shift-1", tags: [{ label: "  SLOW1 ", half: "FIRST" }] },
      () => "unused",
    );
    expect(next.slots[0]!.assignment?.crewLabel).toBe("SLOW1");
    expect(next.slots[0]!.assignment?.crewHalf).toBe("FIRST");
    expect(summarizeWorkingScheduleChanges(published, next).assignmentChanges).toBe(1);
    // Untouched draft with no tag is not a change.
    expect(summarizeWorkingScheduleChanges(published, published).total).toBe(0);
  });

  it("keeps a different label for each half and mirrors the first to the legacy fields", () => {
    const next = applyWorkingScheduleCommand(
      assignedPayload(),
      {
        type: "setCrewTags",
        slotKey: "shift-1",
        tags: [{ label: "SLOW1", half: "FIRST" }, { label: " CAM3 ", half: "SECOND" }, { label: " ", half: null }],
      },
      () => "unused",
    );
    const assignment = next.slots[0]!.assignment!;
    expect(assignment.crewTags).toEqual([{ label: "SLOW1", half: "FIRST" }, { label: "CAM3", half: "SECOND" }]);
    expect(assignment.crewLabel).toBe("SLOW1");
    expect(assignment.crewHalf).toBe("FIRST");
    expect(crewTagsOf({ crewLabel: "ROAM2", crewHalf: null })).toEqual([{ label: "ROAM2", half: null }]);
  });

  it("clears the tag when both parts are empty", () => {
    const tagged = applyWorkingScheduleCommand(
      assignedPayload(),
      { type: "setCrewTags", slotKey: "shift-1", tags: [{ label: "SLOW2", half: "SECOND" }] },
      () => "unused",
    );
    const cleared = applyWorkingScheduleCommand(
      tagged,
      { type: "setCrewTags", slotKey: "shift-1", tags: [{ label: " ", half: null }] },
      () => "unused",
    );
    expect(cleared.slots[0]!.assignment?.crewLabel).toBeNull();
    expect(cleared.slots[0]!.assignment?.crewHalf).toBeNull();
  });

  it("rejects a label on an open slot", () => {
    expect(() => applyWorkingScheduleCommand(
      assignedPayload(),
      { type: "setCrewTags", slotKey: "shift-2", tags: [{ label: "SLOW1", half: null }] },
      () => "unused",
    )).toThrow("WORKING_SLOT_NOT_ASSIGNED");
  });

  it("keeps the position labels when a different person takes the slot", () => {
    const tagged = applyWorkingScheduleCommand(
      assignedPayload(),
      { type: "setCrewTags", slotKey: "shift-1", tags: [{ label: "SLOW1", half: "FIRST" }] },
      () => "unused",
    );
    const replaced = applyWorkingScheduleCommand(
      tagged,
      { type: "convertAndReplace", slotKey: "shift-1", workerType: "FT", userId: "user-2" },
      () => "unused",
    );
    expect(replaced.slots[0]!.assignment?.userId).toBe("user-2");
    expect(replaced.slots[0]!.assignment?.crewTags).toEqual([{ label: "SLOW1", half: "FIRST" }]);
  });

  it("flags the same label on overlapping parts of the event only", () => {
    expect(crewTagsClash({ label: "SLOW1", half: "FIRST" }, { label: "slow1", half: null })).toBe(true);
    expect(crewTagsClash({ label: "SLOW1", half: "FIRST" }, { label: "SLOW1", half: "SECOND" })).toBe(false);
    expect(crewTagsClash({ label: "SLOW1", half: null }, { label: "CAM3", half: null })).toBe(false);
  });

  it("still parses drafts saved before labels existed", () => {
    expect(workingSchedulePayloadSchema.safeParse(assignedPayload()).success).toBe(true);
  });
});
