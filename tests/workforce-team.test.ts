import { describe, expect, it } from "vitest";
import { buildTeamView, currentTeamTerm, selectTeamTerm, type TeamUser } from "@/lib/workforce/team";
const current = { term: "FALL" as const, year: 2026, academicYear: 2026 };
const user = (id: string, overrides: Partial<TeamUser> = {}): TeamUser => ({
  id, name: `Person ${id}`, avatarUrl: null, title: null, active: true, staffingType: "ST", primaryArea: "VIDEO",
  gradYear: 2028, graduationTerm: "SPRING", startTerm: "FALL", startTermYear: 2026,
  areaAssignments: [], sportAssignments: [{ sportCode: "FB" }], termPlacements: [], ...overrides,
});
describe("term-aware workforce", () => {
  it("uses recorded placements for history, including former interns, without inventing past staff", () => {
    const past = { term: "FALL" as const, year: 2025, academicYear: 2025 };
    const data = buildTeamView([
      user("active"), user("staff", { staffingType: "FT" }),
      user("former", { active: false, staffingType: "FT", directReportName: "Current Manager", termPlacements: [{ term: "FALL", year: 2025, area: "PHOTO", sportCodes: ["VB"] }] }),
    ], past, current);
    expect(data.people.map(p => ({ id: p.id, area: p.area, sports: p.sports, manager: p.manager }))).toEqual([{ id: "former", area: "PHOTO", sports: ["VB"], manager: null }]);
    expect(data).toMatchObject({ mode: "past", staffCount: 0, studentCount: 1, recordedCount: 1 });
  });
  it("uses a term's explicit empty area and sports without falling back to today's profile", () => {
    const data = buildTeamView([user("placed", { termPlacements: [{ term: "FALL", year: 2026, area: null, sportCodes: [] }] }), user("profile")], current, current);
    expect(data.people.find(p => p.id === "placed")).toMatchObject({ area: null, sports: [], basis: "recorded" });
    expect(data.people.find(p => p.id === "profile")).toMatchObject({ area: "VIDEO", sports: ["FB"], basis: "profile" });
    expect(data.studentCount).toBe(2);
  });
  it("respects starts and graduations in future terms, flags unknowns, and honors explicit placements", () => {
    const future = { term: "FALL" as const, year: 2028, academicYear: 2028 };
    const data = buildTeamView([
      user("graduated"), user("future-start", { startTermYear: 2029 }), user("inactive", { active: false }),
      user("unknown", { gradYear: null, graduationTerm: null }),
      user("known-year", { gradYear: 2027, graduationTerm: null }),
      user("recorded", { termPlacements: [{ term: "FALL", year: 2028, area: "COMMS", sportCodes: [] }] }),
      user("staff", { staffingType: "FT" }),
    ], future, current);
    expect(data.people.map(p => p.id)).toEqual(["recorded", "staff", "unknown"]);
    expect(data).toMatchObject({ staffCount: 1, studentCount: 2, uncertainCount: 1 });
    expect(data.people.find(p => p.id === "unknown")?.basis).toBe("projected");
  });
  it("does not call someone graduating this year when their graduation term already passed", () => {
    const data = buildTeamView([user("past", { gradYear: 2026 }), user("fall", { graduationTerm: "FALL", gradYear: 2026 })], current, current);
    expect(data.graduatingCount).toBe(1);
  });
  it("does not invent a graduation term for a year-only profile", () => {
    const data = buildTeamView([user("year-only", { graduationTerm: null })], current, current);
    expect(data.people[0]!.graduation).toBe("2028");
  });
  it("uses Chicago term boundaries and keeps spring in the previous Fall's academic year", () => {
    expect(currentTeamTerm(new Date("2026-08-01T03:00:00Z"))).toEqual({ term: "SUMMER", year: 2026, academicYear: 2025 });
    expect(currentTeamTerm(new Date("2026-08-01T06:00:00Z"))).toEqual(current);
    expect(selectTeamTerm({ year: "2025", term: "SPRING" }, current)).toEqual({ academicYear: 2025, term: "SPRING", year: 2026 });
    expect(selectTeamTerm({ year: "9999", term: "__proto__" }, current)).toEqual(current);
    expect(selectTeamTerm({ year: ["2025"] as unknown as string, term: ["FALL"] as unknown as string }, current)).toEqual(current);
  });
});
