import { describe, expect, it } from "vitest";
import { gearAttentionItems } from "@/lib/gear-picks/attention";

const base = {
  cycle: { id: "2027-28", title: "2027-28", deadline: null, isOpen: true, launchedAt: "2026-10-10T00:00:00.000Z" },
  summary: { participantCount: 9, submittedCount: 9, draftCount: 0, notStartedCount: 0, totalCents: 0 },
  budget: { budgetCents: 550000, confirmed: true, topUps: [], topUpCents: 0, availableCents: 550000, picksCents: 0, studentKitsCents: 0, studentKitCents: 14250, committedCents: 0, remainingCents: 550000 },
  students: [{ id: "1", user: { id: "u1", name: "A", active: true }, topSize: "M", topSizeFit: null, shoeSize: "9", needsSize: false }],
};

describe("gearAttentionItems", () => {
  it("is empty when nothing needs a look", () => {
    expect(gearAttentionItems(base)).toEqual([]);
  });

  it("lists problems most urgent first with product-language text", () => {
    const items = gearAttentionItems({
      ...base,
      cycle: { ...base.cycle, launchedAt: null },
      budget: { ...base.budget, confirmed: false, remainingCents: -100 },
      students: [
        { ...base.students[0]!, needsSize: true },
        { ...base.students[0]!, id: "2", needsSize: true },
      ],
    });
    expect(items.map((item) => item.key)).toEqual(["over", "sizes", "budget", "launch"]);
    expect(items[1]!.text).toBe("2 students have no size on file");
  });

  it("counts staff who have not submitted once picks are open, and handles singulars", () => {
    const items = gearAttentionItems({ ...base, summary: { ...base.summary, draftCount: 1, notStartedCount: 0 } });
    expect(items.map((item) => item.text)).toEqual(["1 staff member hasn’t submitted picks"]);
  });

  it("asks for students when the list is empty", () => {
    expect(gearAttentionItems({ ...base, students: [] }).map((item) => item.key)).toEqual(["students"]);
  });
});
