import { describe, expect, it } from "vitest";
import { describeLineChanges } from "@/lib/budget/history";

describe("line history", () => {
  it("lists only the fields that changed, in plain words", () => {
    expect(
      describeLineChanges(
        { status: "PLANNED", unitCostCents: 219_900, supplier: "B&H", unplanned: false },
        { status: "CANCELLED", unitCostCents: 219_900, supplier: "B&H", unplanned: false },
      ),
    ).toEqual([{ field: "status", label: "Status", from: "Planned", to: "Dropped" }]);
  });

  it("treats a missing value and null as the same, and formats money and flags", () => {
    expect(describeLineChanges({ refundCents: null }, {})).toEqual([]);
    expect(describeLineChanges({ unplanned: false, spentCents: 100 }, { unplanned: true, spentCents: 64_000 })).toEqual([
      { field: "spentCents", label: "Spent", from: "$1", to: "$640" },
      { field: "unplanned", label: "Unplanned", from: "no", to: "yes" },
    ]);
  });
});
