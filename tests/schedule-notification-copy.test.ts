import { describe, expect, it } from "vitest";

import { areaLabel, scheduleChangeCopy } from "@/lib/services/schedule-notification-copy";
import type { WorkerShiftFacts } from "@/lib/services/schedule-notification-diff";

const EVENT = "Wisconsin vs Ohio State";

function facts(overrides: Partial<WorkerShiftFacts> = {}): WorkerShiftFacts {
  return {
    shiftId: "shift-1",
    area: "VIDEO",
    workerType: "ST",
    startsAt: "2026-10-17T22:00:00.000Z",
    endsAt: "2026-10-18T03:00:00.000Z",
    callStartsAt: "2026-10-17T21:30:00.000Z",
    callEndsAt: "2026-10-18T02:00:00.000Z",
    callNote: null,
    ...overrides,
  };
}

describe("areaLabel", () => {
  it("turns the enum into the words the rest of the app uses", () => {
    expect(areaLabel("VIDEO")).toBe("Video");
    expect(areaLabel("LIVE_PRODUCTION")).toBe("Live Production");
  });

  it("passes an unknown area through rather than dropping it", () => {
    expect(areaLabel("PODCAST")).toBe("PODCAST");
  });
});

describe("scheduleChangeCopy", () => {
  it("titles every message with the event", () => {
    const copy = scheduleChangeCopy({ eventTitle: EVENT, change: { kind: "added", after: facts() } });
    expect(copy.title).toBe(EVENT);
  });

  it("names the area and call time on an addition", () => {
    const copy = scheduleChangeCopy({ eventTitle: EVENT, change: { kind: "added", after: facts() } });
    expect(copy.body).toBe("You're on Video. Call Sat, Oct 17, 4:30 PM - 9:00 PM.");
    expect(copy.type).toBe("shift_assigned");
  });

  it("never leaks the raw enum", () => {
    const copy = scheduleChangeCopy({
      eventTitle: EVENT,
      change: { kind: "added", after: facts({ area: "LIVE_PRODUCTION" }) },
    });
    expect(copy.body).toContain("Live Production");
    expect(copy.body).not.toContain("LIVE_PRODUCTION");
  });

  it("says when the lost shift was on a removal", () => {
    const copy = scheduleChangeCopy({ eventTitle: EVENT, change: { kind: "removed", before: facts() } });
    expect(copy.body).toBe("You're off Video, Sat, Oct 17, 4:30 PM. Nothing else changed for you.");
    expect(copy.type).toBe("shift_assignment_removed");
  });

  it("states both ends of a reassignment", () => {
    const copy = scheduleChangeCopy({
      eventTitle: EVENT,
      change: {
        kind: "reassigned",
        before: facts(),
        after: facts({ shiftId: "shift-2", area: "PHOTO" }),
        areaChanged: true,
        windowChanged: false,
      },
    });
    expect(copy.body).toContain("Moved from Video to Photo.");
  });

  it("carries the previous call time on a move", () => {
    const copy = scheduleChangeCopy({
      eventTitle: EVENT,
      change: {
        kind: "updated",
        before: facts(),
        after: facts({ callStartsAt: "2026-10-17T23:00:00.000Z" }),
        windowChanged: true,
        noteChanged: false,
      },
    });
    expect(copy.body).toContain("was Sat, Oct 17, 4:30 PM");
    expect(copy.body).toContain("moved to Sat, Oct 17, 6:00 PM");
  });

  it("reports a note-only edit without claiming the time moved", () => {
    const copy = scheduleChangeCopy({
      eventTitle: EVENT,
      change: {
        kind: "updated",
        before: facts(),
        after: facts({ callNote: "Enter through Gate C." }),
        windowChanged: false,
        noteChanged: true,
      },
    });
    expect(copy.body).toBe("Video note: Enter through Gate C.");
    expect(copy.body).not.toContain("moved");
  });

  it("appends a call note to an assignment", () => {
    const copy = scheduleChangeCopy({
      eventTitle: EVENT,
      change: { kind: "added", after: facts({ callNote: "Enter through Gate C." }) },
    });
    expect(copy.body).toContain("Enter through Gate C.");
  });

  it("gives Staff the shift window, since they carry no call time", () => {
    const copy = scheduleChangeCopy({
      eventTitle: EVENT,
      change: { kind: "added", after: facts({ workerType: "FT", callStartsAt: null, callEndsAt: null }) },
    });
    expect(copy.body).toContain("Sat, Oct 17, 5:00 PM");
  });

  it("does not add a call time or call note when Student timing is suppressed", () => {
    const copy = scheduleChangeCopy({
      eventTitle: EVENT,
      change: {
        kind: "added",
        after: facts({ callStartsAt: null, callEndsAt: null, callNote: "Use the visitor entrance." }),
      },
    });
    expect(copy.body).toBe("You're on Video.");
    expect(copy.body).not.toContain("Call");
    expect(copy.body).not.toContain("visitor entrance");
  });

  it("folds extra changes into a count rather than a second message", () => {
    const copy = scheduleChangeCopy({
      eventTitle: EVENT,
      change: { kind: "added", after: facts() },
      alsoCount: 2,
    });
    expect(copy.body).toContain("+2 more changes.");
  });
});
