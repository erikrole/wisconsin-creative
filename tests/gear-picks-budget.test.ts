import { describe, expect, it } from "vitest";
import { parseDollarsToCents } from "@/lib/gear-picks/catalog";
import { gearPickBudget } from "@/lib/services/gear-picks";

describe("parseDollarsToCents", () => {
  it("reads plain dollar amounts typed by an admin", () => {
    expect(parseDollarsToCents("5500")).toBe(550000);
    expect(parseDollarsToCents("$5,500.00")).toBe(550000);
    expect(parseDollarsToCents(" 59.5 ")).toBe(5950);
  });

  it("rejects anything that is not a plain amount", () => {
    for (const bad of ["", "abc", "-5", "5.555", "1e3", "5,50,0x"]) {
      expect(parseDollarsToCents(bad)).toBeNull();
    }
  });
});

describe("gearPickBudget", () => {
  it("adds student kits to the picks, and goes negative when over the budget", () => {
    const base = { budgetCents: 550000, confirmed: false, picksCents: 100000, studentKitCents: 14250, studentCount: 16 };
    expect(gearPickBudget(base)).toEqual({
      budgetCents: 550000,
      confirmed: false,
      topUps: [],
      topUpCents: 0,
      availableCents: 550000,
      picksCents: 100000,
      studentKitsCents: 228000,
      studentKitCents: 14250,
      committedCents: 328000,
      remainingCents: 222000,
    });
    expect(gearPickBudget({ ...base, budgetCents: 1000, studentCount: 0, picksCents: 1500 }).remainingCents).toBe(-500);
  });

  it("adds Creative top-ups to what the year can spend without changing the allotment", () => {
    const topUp = { lineId: "l1", budgetId: "b1", budgetLabel: "Creative 2026-27", description: "Student UA top-up", amountCents: 50000 };
    const result = gearPickBudget({ budgetCents: 550000, confirmed: true, picksCents: 580000, studentKitCents: 0, studentCount: 0, topUps: [topUp] });
    expect(result.budgetCents).toBe(550000);
    expect(result.topUpCents).toBe(50000);
    expect(result.availableCents).toBe(600000);
    expect(result.remainingCents).toBe(20000);
  });
});

describe("kitCountsForFit", () => {
  it("gives men a core kit and women standard issue only", async () => {
    const { kitCountsForFit } = await import("@/lib/gear-picks/catalog");
    expect(kitCountsForFit("MEN")).toEqual({ standardIssue: 4, coreKit: 5 });
    expect(kitCountsForFit("WOMEN")).toEqual({ standardIssue: 4, coreKit: 0 });
  });
});
