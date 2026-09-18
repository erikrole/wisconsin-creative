import { describe, expect, it } from "vitest";
import { generateEventTitle, sportColumnLabel, sportLabel, sportProgram, sportsGroupedByProgram } from "../src/lib/sports";

describe("generateEventTitle", () => {
  it("generates home title", () => {
    expect(generateEventTitle("MBB", "Michigan State", true)).toBe("MBB vs Michigan State");
  });

  it("generates away title", () => {
    expect(generateEventTitle("FB", "Ohio State", false)).toBe("FB at Ohio State");
  });

  it("generates neutral title", () => {
    expect(generateEventTitle("WBB", "Iowa", null)).toBe("WBB vs Iowa (Neutral)");
  });

  it("handles missing opponent", () => {
    expect(generateEventTitle("VB", null, true)).toBe("VB vs TBD");
  });
});

describe("sportLabel", () => {
  it("returns label for known code", () => {
    expect(sportLabel("FB")).toBe("Football");
    expect(sportLabel("MBB")).toBe("Men's Basketball");
  });

  it("returns code for unknown code", () => {
    expect(sportLabel("XYZ")).toBe("XYZ");
  });
});

describe("sport program grouping", () => {
  it("keeps 11 men's sports and 12 women's sports", () => {
    const { men, women } = sportsGroupedByProgram();
    expect(men).toHaveLength(11);
    expect(women).toHaveLength(12);
    expect(sportProgram("FB")).toBe("men");
    expect(sportProgram("VB")).toBe("women");
    expect(sportColumnLabel("MBB")).toBe("Basketball");
    expect(sportColumnLabel("FB")).toBe("Football");
  });
});
