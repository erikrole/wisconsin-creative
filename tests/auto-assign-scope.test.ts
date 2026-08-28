import { describe, expect, it } from "vitest";
import {
  bulkAssignmentScopeSchema,
  summarizeAssignmentPeople,
  type BulkAssignmentPreviewProposal,
} from "@/lib/bulk-schedule-assignment-types";
import {
  isOnSportRoster,
  isSportRosterEligible,
  isTravelEligible,
  sportHasTravelRoster,
} from "@/lib/schedule-assignment-eligibility";

function proposal(overrides: Partial<BulkAssignmentPreviewProposal>): BulkAssignmentPreviewProposal {
  return {
    proposalId: `p-${Math.random()}`,
    shiftGroupId: "sg-1",
    shiftId: "shift-1",
    eventId: "event-1",
    userId: "user-1",
    eventSummary: "Football vs Iowa",
    eventStartsAt: "2026-09-12T18:00:00.000Z",
    eventSportCode: "FB",
    area: "VIDEO",
    workerType: "ST",
    userName: "Avery",
    userRole: "STUDENT",
    score: 80,
    bucket: "recommended",
    reasons: [],
    warnings: [],
    advisoryConflict: false,
    advisoryConflictNote: null,
    ...overrides,
  };
}

describe("auto assign scope", () => {
  it("normalizes, dedupes, and sorts sport codes", () => {
    const scope = bulkAssignmentScopeSchema.parse({
      sportCodes: [" mbb ", "FB", "fb"],
      rangeStartsAt: "2026-08-28T05:00:00.000Z",
      rangeEndsAt: "2026-12-21T06:00:00.000Z",
    });
    expect(scope.sportCodes).toEqual(["FB", "MBB"]);
  });

  it("defaults to every sport, both scheduling classes, and a custom window label", () => {
    const scope = bulkAssignmentScopeSchema.parse({
      rangeStartsAt: "2026-08-28T05:00:00.000Z",
      rangeEndsAt: "2026-09-01T05:00:00.000Z",
    });
    expect(scope.sportCodes).toEqual([]);
    expect(scope.workerScope).toBe("ALL");
    expect(scope.area).toBeNull();
    expect(scope.period).toBe("custom");
    expect(scope.requireFullCrew).toBe(false);
  });

  it("rejects an inverted range", () => {
    expect(() => bulkAssignmentScopeSchema.parse({
      rangeStartsAt: "2026-09-01T05:00:00.000Z",
      rangeEndsAt: "2026-08-28T05:00:00.000Z",
    })).toThrow();
  });

  it("rolls proposals up per worker, counting shifts and distinct events", () => {
    const people = summarizeAssignmentPeople([
      proposal({ userId: "u1", userName: "Avery", eventId: "e1", area: "VIDEO" }),
      proposal({ userId: "u1", userName: "Avery", eventId: "e2", area: "PHOTO", eventSportCode: "MBB" }),
      proposal({ userId: "u1", userName: "Avery", eventId: "e2", area: "VIDEO", eventSportCode: "MBB" }),
      proposal({
        userId: "u2",
        userName: "Blake",
        workerType: "FT",
        userRole: "STAFF",
        eventId: "e1",
        warnings: [{ code: "overlapping_assignment", label: "Already busy" }],
        advisoryConflict: true,
      }),
    ]);

    expect(people).toHaveLength(2);
    const [avery, blake] = people;
    expect(avery!.userName).toBe("Avery");
    expect(avery!.shiftCount).toBe(3);
    expect(avery!.eventCount).toBe(2);
    expect(avery!.areas).toEqual(["PHOTO", "VIDEO"]);
    expect(avery!.sportCodes).toEqual(["FB", "MBB"]);
    expect(avery!.warningCount).toBe(0);

    expect(blake!.workerType).toBe("FT");
    expect(blake!.shiftCount).toBe(1);
    expect(blake!.warningCount).toBe(1);
    expect(blake!.advisoryConflictCount).toBe(1);
  });

  it("sorts the busiest worker first, then by name", () => {
    const people = summarizeAssignmentPeople([
      proposal({ userId: "u2", userName: "Zoe", eventId: "e1" }),
      proposal({ userId: "u1", userName: "Avery", eventId: "e1" }),
      proposal({ userId: "u3", userName: "Milo", eventId: "e1" }),
      proposal({ userId: "u3", userName: "Milo", eventId: "e2" }),
    ]);
    expect(people.map((person) => person.userName)).toEqual(["Milo", "Avery", "Zoe"]);
  });

  it("returns nothing for an empty batch", () => {
    expect(summarizeAssignmentPeople([])).toEqual([]);
  });
});

describe("sport roster eligibility", () => {
  const onRoster = { reasons: [{ code: "sport_roster", label: "On this sport roster" }] };
  const offRoster = { reasons: [{ code: "primary_area", label: "Primary area match" }] };

  it("only proposes people on the event's sport roster", () => {
    expect(isSportRosterEligible(onRoster, "FB")).toBe(true);
    expect(isSportRosterEligible(offRoster, "FB")).toBe(false);
  });

  it("leaves the pool open for events with no sport", () => {
    expect(isSportRosterEligible(offRoster, null)).toBe(true);
    expect(isSportRosterEligible(offRoster, undefined)).toBe(true);
    expect(isSportRosterEligible(offRoster, "")).toBe(true);
  });

  it("agrees with the roster-row view used by the apply transaction", () => {
    const assignments = [{ sportCode: "FB" }, { sportCode: "VB" }];
    expect(isOnSportRoster(assignments, "FB")).toBe(true);
    expect(isOnSportRoster(assignments, "MBB")).toBe(false);
    expect(isOnSportRoster([], "FB")).toBe(false);
    // No sport on the event means no roster to be on.
    expect(isOnSportRoster([], null)).toBe(true);
  });
});

describe("away-game travel eligibility", () => {
  const traveler = [{ sportCode: "FB", defaultTraveler: true }];
  const nonTraveler = [{ sportCode: "FB", defaultTraveler: false }];

  it("narrows an away game to the travel roster when the sport has one", () => {
    expect(isTravelEligible(traveler, "FB", false, true)).toBe(true);
    expect(isTravelEligible(nonTraveler, "FB", false, true)).toBe(false);
  });

  it("falls back to the full roster when the sport has marked nobody", () => {
    expect(isTravelEligible(nonTraveler, "FB", false, false)).toBe(true);
  });

  it("leaves home games and unknown venues alone", () => {
    expect(isTravelEligible(nonTraveler, "FB", true, true)).toBe(true);
    expect(isTravelEligible(nonTraveler, "FB", null, true)).toBe(true);
    expect(isTravelEligible(nonTraveler, "FB", undefined, true)).toBe(true);
  });

  it("does not gate non-sport events", () => {
    expect(isTravelEligible(nonTraveler, null, false, true)).toBe(true);
  });

  it("only counts travel on the event's own sport", () => {
    const travelsElsewhere = [{ sportCode: "MBB", defaultTraveler: true }, { sportCode: "FB", defaultTraveler: false }];
    expect(isTravelEligible(travelsElsewhere, "FB", false, true)).toBe(false);
  });

  it("reports whether a sport has a travel roster at all", () => {
    const counts = new Map([["FB", 3], ["VB", 0]]);
    expect(sportHasTravelRoster(counts, "FB")).toBe(true);
    expect(sportHasTravelRoster(counts, "VB")).toBe(false);
    expect(sportHasTravelRoster(counts, "MBB")).toBe(false);
    expect(sportHasTravelRoster(counts, null)).toBe(false);
  });
});
