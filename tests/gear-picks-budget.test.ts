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
  it("reports what is left, and goes negative when picks exceed the budget", () => {
    expect(gearPickBudget(550000, false, 100000)).toEqual({ budgetCents: 550000, confirmed: false, committedCents: 100000, remainingCents: 450000 });
    expect(gearPickBudget(1000, true, 1500).remainingCents).toBe(-500);
  });
});
