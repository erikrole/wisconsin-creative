import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
  shift: { findMany: vi.fn() },
  user: { findMany: vi.fn() },
  shiftAssignment: { findMany: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ db: dbMock }));

import { getCandidateScoresForShiftIds } from "@/lib/services/candidate-scoring";

function shift(id: string, startsAt: string) {
  return {
    id,
    area: "VIDEO",
    workerType: "ST",
    startsAt: new Date(startsAt),
    endsAt: new Date("2026-10-06T21:00:00.000Z"),
    callStartsAt: null,
    callEndsAt: null,
    shiftGroup: { event: { sportCode: "VB" } },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.shift.findMany.mockResolvedValue([
    shift("shift-1", "2026-10-06T18:00:00.000Z"),
    shift("shift-2", "2026-10-10T18:00:00.000Z"),
  ]);
  dbMock.user.findMany.mockResolvedValue([{
    id: "student-1",
    name: "A Student",
    email: "a@example.com",
    role: "STUDENT",
    staffingType: "ST",
    primaryArea: "VIDEO",
    areaAssignments: [{ area: "VIDEO", isPrimary: true }],
    sportAssignments: [{ sportCode: "VB", defaultTraveler: false }],
    availabilityBlocks: [],
  }]);
  dbMock.shiftAssignment.findMany.mockResolvedValue([]);
});

describe("getCandidateScoresForShiftIds", () => {
  it("loads people and assignments once for every open slot", async () => {
    const scores = await getCandidateScoresForShiftIds(["shift-1", "shift-2", "shift-1"]);

    expect(dbMock.shift.findMany).toHaveBeenCalledTimes(1);
    expect(dbMock.user.findMany).toHaveBeenCalledTimes(1);
    expect(dbMock.shiftAssignment.findMany).toHaveBeenCalledTimes(1);
    expect(scores.get("shift-1")?.[0]?.userId).toBe("student-1");
    expect(scores.get("shift-2")?.[0]?.userId).toBe("student-1");
    expect(dbMock.shift.findMany.mock.calls[0]![0].where.id.in).toEqual(["shift-1", "shift-2"]);
  });
});
