import { describe, expect, it } from "vitest";
import { GEAR_CATALOG } from "@/lib/gear-picks/catalog";
import { SIZE_NEEDED, buildOrderPlan } from "@/lib/gear-picks/order";
import type { GearPicksAdminResponse } from "@/lib/gear-picks/types";

type Person = GearPicksAdminResponse["participants"][number];

function person(id: string, fit: "MEN" | "WOMEN", topSize: string | null, shoeSize: string | null, lines: Person["submission"] = null): Person {
  return {
    id,
    fit,
    allowanceCents: 0,
    user: { id, name: `Person ${id}`, email: `${id}@example.com`, active: true, topSize, shoeSize },
    status: "NOT_STARTED",
    submission: lines,
  };
}

const MEN_TEE = "6021649-834"; // core kit, men only
const SHOE = "6024285-102"; // standard issue for everyone

describe("buildOrderPlan", () => {
  it("sums kit pieces by item and size, and shoes use the shoe size", () => {
    const plan = buildOrderPlan([person("a", "MEN", "M", "10"), person("b", "MEN", "M", "11"), person("c", "MEN", "2XL", "10")], GEAR_CATALOG.kits);

    const tee = plan.lines.find((line) => line.sku === MEN_TEE && line.source === "CORE_KIT")!;
    expect(tee.quantity).toBe(3);
    expect(tee.sizes).toEqual([
      { size: "M", quantity: 2 },
      { size: "XXL", quantity: 1 },
    ]);
    const shoe = plan.lines.find((line) => line.sku === SHOE)!;
    expect(shoe.sizes).toEqual([
      { size: "10", quantity: 2 },
      { size: "11", quantity: 1 },
    ]);
    expect(plan.missingSizePeople).toEqual([]);
  });

  it("gives women no core kit and counts people with no size", () => {
    const plan = buildOrderPlan([person("w", "WOMEN", null, null)], GEAR_CATALOG.kits);

    expect(plan.lines.some((line) => line.source === "CORE_KIT")).toBe(false);
    expect(plan.lines.every((line) => line.sizes.every((entry) => entry.size === SIZE_NEEDED))).toBe(true);
    expect(plan.missingSizePeople).toEqual(["Person w"]);
  });

  it("adds saved picks as their own lines and totals the pick dollars", () => {
    const submission = {
      version: 1,
      totalCents: 1500,
      submittedAt: null,
      updatedAt: "2026-10-18T00:00:00Z",
      lines: [
        { sku: MEN_TEE, style: "6021649", colorCode: "834", size: "L", quantity: 1, unitPriceCents: 1500, lineTotalCents: 1500, itemName: "Athletics SS Tee", colorLabel: "Red", category: null },
      ],
    };
    const plan = buildOrderPlan([person("a", "MEN", "M", "10", submission)], GEAR_CATALOG.kits);

    const pick = plan.lines.find((line) => line.source === "PICK")!;
    expect(pick.sizes).toEqual([{ size: "L", quantity: 1 }]);
    expect(plan.pickCents).toBe(1500);
    expect(plan.pieces).toBe(plan.lines.reduce((sum, line) => sum + line.quantity, 0));
  });
});
