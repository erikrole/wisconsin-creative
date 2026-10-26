import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  policies: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: { studentSportAssignment: { findMany: mocks.findMany } } }));
vi.mock("@/lib/services/sport-auto-assign-policies", () => ({ loadSportAutoAssignPolicies: mocks.policies }));

import { getSportRosterPreview } from "@/lib/services/sport-roster-preview";

const person = (id: string, extra: Record<string, unknown>) => ({ id, name: id, role: "STUDENT", staffingType: null, primaryArea: null, ...extra });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.policies.mockResolvedValue(new Map([["MBB", "HOLD"]]));
  mocks.findMany.mockResolvedValue([
    { sportCode: "FB", defaultTraveler: true, user: person("erik", { role: "STAFF", primaryArea: "VIDEO" }) },
    { sportCode: "FB", defaultTraveler: false, user: person("ada", {}) },
    { sportCode: "FB", defaultTraveler: false, user: person("pat", { role: "STAFF", staffingType: "ST" }) },
    { sportCode: "FB", defaultTraveler: false, user: person("btn", { role: "COLLABORATOR" }) },
    { sportCode: "WVB", defaultTraveler: false, user: person("stray", {}) },
  ]);
});

describe("getSportRosterPreview", () => {
  it("returns nothing without asking when no sport is chosen", async () => {
    expect(await getSportRosterPreview([" ", ""])).toEqual({ sports: [], emptySportCodes: [], heldSportCodes: [] });
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("groups each sport's roster into staff and students", async () => {
    const preview = await getSportRosterPreview(["fb ", "MBB", "FB"]);

    expect(mocks.policies).toHaveBeenCalledWith(["FB", "MBB"]);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ sportCode: { in: ["FB", "MBB"] } }) }));
    const [football, basketball] = preview.sports;
    expect(football).toEqual(expect.objectContaining({ sportCode: "FB", policy: "FULL_CREW", total: 3 }));
    expect(football!.staff).toEqual([{ id: "erik", name: "erik", role: "STAFF", workerType: "FT", primaryArea: "VIDEO", defaultTraveler: true }]);
    expect(football!.students.map((member) => [member.id, member.workerType])).toEqual([["ada", "ST"], ["pat", "ST"]]);
    expect(basketball).toEqual(expect.objectContaining({ sportCode: "MBB", policy: "HOLD", total: 0, staff: [], students: [] }));
  });

  it("reports empty and held sports separately", async () => {
    const preview = await getSportRosterPreview(["FB", "MBB", "MHKY"]);

    expect(preview.emptySportCodes).toEqual(["MBB", "MHKY"]);
    expect(preview.heldSportCodes).toEqual(["MBB"]);
  });
});
