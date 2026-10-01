import { describe, expect, it } from "vitest";
import { academicYearLabel, buildPlanning, presentInYear, type PlanningApplicant, type PlanningStudent } from "@/lib/workforce/planning";

// Fictional people. Academic year 2026 means Fall 2026 through Summer 2027.
const student = (id: string, area: PlanningStudent["area"], gradTerm: PlanningStudent["gradTerm"], gradYear: number | null): PlanningStudent => ({
  id,
  name: `Student ${id}`,
  area,
  gradTerm,
  gradYear,
});

const applicant = (id: string, area: PlanningApplicant["area"], stage: PlanningApplicant["stage"], gradTerm: PlanningApplicant["gradTerm"], gradYear: number | null): PlanningApplicant => ({
  id,
  name: `Applicant ${id}`,
  area,
  gradTerm,
  gradYear,
  stage,
});

describe("presentInYear", () => {
  it("keeps someone who graduates in the Fall of that year, drops one who graduated the Spring before", () => {
    expect(presentInYear({ gradTerm: "FALL", gradYear: 2026 }, 2026)).toBe(true);
    expect(presentInYear({ gradTerm: "SPRING", gradYear: 2026 }, 2026)).toBe(false);
    expect(presentInYear({ gradTerm: "SUMMER", gradYear: 2026 }, 2026)).toBe(false);
    expect(presentInYear({ gradTerm: "SPRING", gradYear: 2027 }, 2026)).toBe(true);
    expect(presentInYear({ gradTerm: "SPRING", gradYear: 2027 }, 2027)).toBe(false);
  });

  it("treats an unknown graduation as staying", () => {
    expect(presentInYear({ gradTerm: null, gradYear: null }, 2030)).toBe(true);
    expect(presentInYear({ gradTerm: "SPRING", gradYear: null }, 2030)).toBe(true);
  });
});

describe("buildPlanning", () => {
  const years = [2026, 2027, 2028];

  it("projects continuing students, who is leaving, and the hiring gap", () => {
    const students = [
      student("a", "VIDEO", "SPRING", 2027),
      student("b", "VIDEO", "SPRING", 2027),
      student("c", "VIDEO", "SPRING", 2028),
      student("d", "VIDEO", "SPRING", 2029),
    ];
    const [video] = buildPlanning(students, [], years);
    expect(video!.baseline).toBe(4);
    expect(video!.cells.map((c) => c.projected)).toEqual([4, 2, 1]);
    expect(video!.cells[1]!.leaving.sort()).toEqual(["Student a", "Student b"]);
    expect(video!.cells.map((c) => c.need)).toEqual([0, 2, 3]);
  });

  it("counts unregistered hires toward the projection and shows pipeline separately", () => {
    const students = [student("a", "PHOTO", "SPRING", 2027), student("b", "PHOTO", "SPRING", 2027)];
    const applicants = [
      applicant("h1", "PHOTO", "HIRE", "SPRING", 2030),
      applicant("p1", "PHOTO", "ROUND_1", "SPRING", 2029),
      applicant("p2", "PHOTO", "APPLIED", "SPRING", 2027),
    ];
    const [photo] = buildPlanning(students, applicants, years);
    const second = photo!.cells[1]!;
    expect(second.continuing).toBe(0);
    expect(second.hired).toBe(1);
    expect(second.projected).toBe(1);
    expect(second.pipeline).toBe(1); // p2 graduates before this year, so only p1
    expect(second.need).toBe(1);
    expect(second.hiredNames).toEqual(["Applicant h1"]);
  });

  it("flags students with no graduation date but still counts them", () => {
    const [row] = buildPlanning([student("a", "SOCIAL", null, null), student("b", "SOCIAL", "SPRING", 2027)], [], years);
    expect(row!.cells[2]!.continuing).toBe(1);
    expect(row!.cells[2]!.unknownGrad).toBe(1);
  });

  it("puts unassigned people in a No-area row, last, and omits empty areas", () => {
    const rows = buildPlanning([student("a", null, "SPRING", 2028), student("b", "COMMS", "SPRING", 2028)], [], years);
    expect(rows.map((r) => r.area)).toEqual(["COMMS", "NONE"]);
  });

  it("never reports a negative need", () => {
    const [row] = buildPlanning(
      [student("a", "VIDEO", "SPRING", 2027)],
      [applicant("h1", "VIDEO", "HIRE", "SPRING", 2030), applicant("h2", "VIDEO", "HIRE", "SPRING", 2030)],
      years,
    );
    expect(row!.cells.every((c) => c.need >= 0)).toBe(true);
    expect(row!.cells[1]!.need).toBe(0);
  });

  it("returns no rows when there is nothing to project", () => {
    expect(buildPlanning([], [], years)).toEqual([]);
  });
});

describe("academicYearLabel", () => {
  it("formats the span", () => {
    expect(academicYearLabel(2026)).toBe("2026-27");
    expect(academicYearLabel(2099)).toBe("2099-00");
  });
});
