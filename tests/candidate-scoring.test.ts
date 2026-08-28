import { describe, expect, it } from "vitest";
import { scoreCandidatesForShift, type CandidateScoringUser } from "@/lib/services/candidate-scoring";

const shift = {
  id: "target-shift",
  area: "VIDEO" as const,
  workerType: "ST" as const,
  startsAt: new Date("2026-10-06T18:00:00.000Z"),
  endsAt: new Date("2026-10-06T21:00:00.000Z"),
  callStartsAt: new Date("2026-10-06T16:00:00.000Z"),
  callEndsAt: new Date("2026-10-06T21:30:00.000Z"),
  sportCode: "VB",
};

function assignment(id: string, startsAt: string, endsAt: string, sportCode = "VB") {
  return {
    id,
    status: "DIRECT_ASSIGNED" as const,
    callStartsAt: null,
    callEndsAt: null,
    shift: {
      id: `shift-${id}`,
      area: "VIDEO" as const,
      startsAt: new Date(startsAt),
      endsAt: new Date(endsAt),
      callStartsAt: null,
      callEndsAt: null,
      shiftGroup: { event: { sportCode } },
    },
  };
}

function candidate(overrides: Partial<CandidateScoringUser> & { id: string }): CandidateScoringUser {
  return {
    role: "STUDENT",
    staffingType: "ST",
    primaryArea: "VIDEO",
    areaAssignments: [{ area: "VIDEO", isPrimary: true }],
    sportAssignments: [{ sportCode: "VB", defaultTraveler: false }],
    availabilityBlocks: [],
    assignments: [],
    ...overrides,
  };
}

describe("scoreCandidatesForShift", () => {
  it("ranks role, area, sport, and prior sport fit ahead of weak matches", () => {
    const scores = scoreCandidatesForShift({
      shift,
      candidates: [
        candidate({ id: "weak", primaryArea: "PHOTO", areaAssignments: [], sportAssignments: [] }),
        candidate({
          id: "strong",
          assignments: [assignment("prior", "2026-09-20T18:00:00.000Z", "2026-09-20T21:00:00.000Z")],
        }),
      ],
      now: new Date("2026-10-01T12:00:00.000Z"),
    });

    expect(scores[0]?.userId).toBe("strong");
    expect(scores[0]?.bucket).toBe("recommended");
    expect(scores[0]?.reasons.map((reason) => reason.code)).toEqual(
      expect.arrayContaining(["role_fit", "primary_area", "sport_roster", "prior_sport_assignment"]),
    );
    expect(scores[1]?.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(["area_gap", "sport_gap"]),
    );
  });

  it("labels advisory availability conflicts without blocking manual assignment", () => {
    const [score] = scoreCandidatesForShift({
      shift,
      candidates: [
        candidate({
          id: "conflicted",
          availabilityBlocks: [{
            kind: "WEEKLY",
            dayOfWeek: 2,
            startsAt: "11:30",
            endsAt: "13:00",
            label: "JOURN 410",
          }],
        }),
      ],
      now: new Date("2026-10-01T12:00:00.000Z"),
    });

    expect(score?.bucket).toBe("warning");
    expect(score?.blockingConflict).toBe(false);
    expect(score?.advisoryConflict).toBe(true);
    expect(score?.advisoryConflictNote).toBe("Conflicts with JOURN 410 (11:30-13:00)");
    expect(score?.warnings.map((warning) => warning.code)).toContain("availability_conflict");
  });

  it("does not treat staff-class users with roster metadata as student slot fits", () => {
    const [score] = scoreCandidatesForShift({
      shift,
      candidates: [
        candidate({
          id: "staff-with-roster",
          role: "STAFF",
          staffingType: "FT",
          areaAssignments: [{ area: "VIDEO", isPrimary: true }],
        }),
      ],
      now: new Date("2026-10-01T12:00:00.000Z"),
    });

    expect(score?.reasons.map((reason) => reason.code)).not.toContain("role_fit");
    expect(score?.warnings.map((warning) => warning.code)).toContain("role_mismatch");
  });

  it("treats staff-access users with student scheduling class as student slot fits", () => {
    const [score] = scoreCandidatesForShift({
      shift,
      candidates: [
        candidate({
          id: "staff-access-student-worker",
          role: "STAFF",
          staffingType: "ST",
        }),
      ],
      now: new Date("2026-10-01T12:00:00.000Z"),
    });

    expect(score?.reasons.map((reason) => reason.code)).toContain("role_fit");
    expect(score?.warnings.map((warning) => warning.code)).not.toContain("role_mismatch");
  });

  it("adds a positive reason for preferred work windows", () => {
    const [score] = scoreCandidatesForShift({
      shift,
      candidates: [
        candidate({
          id: "preferred",
          availabilityBlocks: [{
            kind: "WEEKLY",
            intent: "PREFER",
            status: "APPROVED",
            dayOfWeek: 2,
            startsAt: "11:00",
            endsAt: "17:00",
            label: "Afternoon coverage",
          }],
        }),
      ],
      now: new Date("2026-10-01T12:00:00.000Z"),
    });

    expect(score?.blockingConflict).toBe(false);
    expect(score?.reasons.map((reason) => reason.code)).toContain("preferred_window");
    expect(score?.reasons.map((reason) => reason.label)).toContain("Prefers Afternoon coverage (11:00-17:00)");
  });

  it("treats approved time off as a blocking recommendation conflict", () => {
    const [score] = scoreCandidatesForShift({
      shift,
      candidates: [
        candidate({
          id: "time-off",
          availabilityBlocks: [{
            kind: "AD_HOC",
            intent: "TIME_OFF",
            status: "APPROVED",
            date: "2026-10-06",
            startsAt: "11:00",
            endsAt: "17:00",
            label: "Family trip",
          }],
        }),
      ],
      now: new Date("2026-10-01T12:00:00.000Z"),
    });

    expect(score?.blockingConflict).toBe(true);
    expect(score?.advisoryConflictNote).toBe("Approved time off: Family trip (11:00-17:00)");
    expect(score?.warnings.map((warning) => warning.code)).toContain("approved_time_off");
  });

  it("flags overlapping assignments as blocking recommendation conflicts", () => {
    const [score] = scoreCandidatesForShift({
      shift,
      candidates: [
        candidate({
          id: "double-booked",
          assignments: [assignment("overlap", "2026-10-06T17:00:00.000Z", "2026-10-06T19:00:00.000Z")],
        }),
      ],
      now: new Date("2026-10-01T12:00:00.000Z"),
    });

    expect(score?.bucket).toBe("warning");
    expect(score?.blockingConflict).toBe(true);
    expect(score?.warnings[0]?.code).toBe("overlapping_assignment");
  });

  it("groups heavy workload candidates as overloaded", () => {
    const [score] = scoreCandidatesForShift({
      shift,
      candidates: [
        candidate({
          id: "overloaded",
          assignments: [
            assignment("one", "2026-10-05T18:00:00.000Z", "2026-10-05T22:00:00.000Z"),
            assignment("two", "2026-10-07T18:00:00.000Z", "2026-10-07T22:00:00.000Z"),
            assignment("three", "2026-10-08T18:00:00.000Z", "2026-10-08T22:00:00.000Z"),
          ],
        }),
      ],
      now: new Date("2026-10-01T12:00:00.000Z"),
    });

    expect(score?.bucket).toBe("overloaded");
    expect(score?.workload.weekHours).toBe(12);
    expect(score?.warnings.map((warning) => warning.code)).toContain("workload_overloaded");
  });
});
