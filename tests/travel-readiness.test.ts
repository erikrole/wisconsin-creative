import { describe, expect, it } from "vitest";
import { evaluateTravelReadiness } from "@/lib/travel-readiness";

const requirements = [
  { area: "PHOTO", staffRequired: 1, studentRequired: 1 },
  { area: "VIDEO", staffRequired: 0, studentRequired: 1 },
];

describe("travel readiness", () => {
  it("uses only marked travelers when an explicit travel roster exists", () => {
    const result = evaluateTravelReadiness(requirements, [
      { defaultTraveler: true, workerType: "FT", primaryArea: "PHOTO" },
      { defaultTraveler: true, workerType: "ST", primaryArea: "PHOTO" },
      { defaultTraveler: false, workerType: "ST", primaryArea: "VIDEO" },
    ]);

    expect(result.mode).toBe("EXPLICIT_TRAVEL");
    expect(result.effectivePoolSize).toBe(2);
    expect(result.gaps).toEqual([
      { area: "VIDEO", workerType: "ST", required: 1, eligible: 0, missing: 1 },
    ]);
  });

  it("uses the full roster fallback when nobody is marked for travel", () => {
    const result = evaluateTravelReadiness(requirements, [
      { defaultTraveler: false, workerType: "FT", primaryArea: "PHOTO" },
      { defaultTraveler: false, workerType: "ST", primaryArea: "PHOTO" },
      { defaultTraveler: false, workerType: "ST", primaryArea: "VIDEO" },
    ]);

    expect(result.mode).toBe("FULL_ROSTER_FALLBACK");
    expect(result.status).toBe("READY");
    expect(result.gaps).toEqual([]);
  });

  it("keeps Staff and Student requirements separate within each area", () => {
    const result = evaluateTravelReadiness(
      [{ area: "PHOTO", staffRequired: 1, studentRequired: 2 }],
      [
        { defaultTraveler: true, workerType: "FT", primaryArea: "PHOTO" },
        { defaultTraveler: true, workerType: "ST", primaryArea: "PHOTO" },
      ],
    );

    expect(result.gaps).toEqual([
      { area: "PHOTO", workerType: "ST", required: 2, eligible: 1, missing: 1 },
    ]);
  });

  it("reports missing-area people without counting them toward a requirement", () => {
    const result = evaluateTravelReadiness(
      [{ area: "PHOTO", staffRequired: 0, studentRequired: 1 }],
      [{ defaultTraveler: true, workerType: "ST", primaryArea: null }],
    );

    expect(result.membersWithoutArea).toBe(1);
    expect(result.status).toBe("GAPS");
    expect(result.gaps[0]).toMatchObject({ area: "PHOTO", eligible: 0, missing: 1 });
  });

  it("does not claim readiness when no away template is configured", () => {
    const result = evaluateTravelReadiness([], [
      { defaultTraveler: false, workerType: "ST", primaryArea: "PHOTO" },
    ]);

    expect(result.status).toBe("NO_TEMPLATE");
    expect(result.gaps).toEqual([]);
  });
});
