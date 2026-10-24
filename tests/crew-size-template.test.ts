import { describe, expect, it } from "vitest";
import {
  crewCountKey,
  sameCrewCounts,
  templateCountsFor,
  templateSaveRows,
  type CountKey,
} from "@/lib/crew-size-template";
import type { WorkingScheduleSportTemplate } from "@/lib/schedule-working-copy";

const template: WorkingScheduleSportTemplate = {
  sportCode: "FB",
  venue: "home",
  rows: [
    { area: "VIDEO", home: { FT: 1, ST: 4 }, away: { FT: 1, ST: 1 } },
    { area: "PHOTO", home: { FT: 0, ST: 2 }, away: { FT: 0, ST: 1 } },
  ],
};

describe("crew size sport template", () => {
  it("reads the counts for the event's venue", () => {
    const home = templateCountsFor(template);
    expect([...home.entries()]).toEqual([["VIDEO:FT", 1], ["VIDEO:ST", 4], ["PHOTO:ST", 2]]);
    const away = templateCountsFor({ ...template, venue: "away" });
    expect(away.get(crewCountKey("VIDEO", "ST"))).toBe(1);
  });

  it("saves this venue's counts for every area and keeps the other venue", () => {
    const draft = new Map<CountKey, number>([["VIDEO:ST", 3], ["SOCIAL:ST", 1]]);
    const rows = templateSaveRows(template, draft);
    expect(rows).toHaveLength(6);
    expect(rows.find((row) => row.area === "VIDEO")).toEqual({
      area: "VIDEO", homeStaffCount: 0, homeStudentCount: 3, awayStaffCount: 1, awayStudentCount: 1,
    });
    expect(rows.find((row) => row.area === "SOCIAL")).toEqual({
      area: "SOCIAL", homeStaffCount: 0, homeStudentCount: 1, awayStaffCount: 0, awayStudentCount: 0,
    });
    expect(rows.find((row) => row.area === "PHOTO")).toMatchObject({ homeStudentCount: 0, awayStudentCount: 1 });
  });

  it("treats missing and zero counts the same when comparing", () => {
    expect(sameCrewCounts(new Map([["VIDEO:ST", 0]]), new Map())).toBe(true);
    expect(sameCrewCounts(new Map([["VIDEO:ST", 1]]), new Map())).toBe(false);
  });
});
