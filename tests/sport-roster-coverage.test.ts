import { describe, expect, it } from "vitest";
import { summarizeSportRosterCoverage } from "@/lib/sport-roster-coverage";

describe("sport roster coverage", () => {
  it("counts Staff and Students independently by primary area", () => {
    expect(summarizeSportRosterCoverage([
      { workerType: "FT", primaryArea: "PHOTO" },
      { workerType: "ST", primaryArea: "PHOTO" },
      { workerType: "ST", primaryArea: "PHOTO" },
      { workerType: "ST", primaryArea: "VIDEO" },
    ])).toEqual([
      { area: "PHOTO", staffCount: 1, studentCount: 2, total: 3 },
      { area: "VIDEO", staffCount: 0, studentCount: 1, total: 1 },
    ]);
  });

  it("keeps missing profile areas explicit instead of inferring one", () => {
    expect(summarizeSportRosterCoverage([
      { workerType: "FT", primaryArea: null },
      { workerType: "ST", primaryArea: null },
    ])).toEqual([
      { area: null, staffCount: 1, studentCount: 1, total: 2 },
    ]);
  });

  it("returns no coverage rows for an empty roster", () => {
    expect(summarizeSportRosterCoverage([])).toEqual([]);
  });
});
