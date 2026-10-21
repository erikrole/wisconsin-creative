import { describe, expect, it } from "vitest";
import { gearAttentionItems } from "@/lib/gear-picks/attention";

const base = {
  cycle: { id: "2027-28", title: "2027-28", deadline: null, isOpen: true, launchedAt: "2026-10-10T00:00:00.000Z" },
  summary: { participantCount: 9, submittedCount: 9, draftCount: 0, notStartedCount: 0, totalCents: 0 },
  budget: { budgetCents: 550000, confirmed: true, picksCents: 0, studentKitsCents: 0, studentKitCents: 14250, committedCents: 0, remainingCents: 550000 },
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

describe("gearAttentionItems order follow-ups", () => {
  const NOW = new Date("2027-07-10T12:00:00Z");
  const closed = { ...base.cycle, isOpen: false };
  const person = {
    id: "p1",
    fit: "MEN" as const,
    allowanceCents: 18500,
    user: { id: "u9", name: "Pat", email: "p@x.com", active: true, topSize: "L", shoeSize: "10" },
    status: "SUBMITTED" as const,
    submission: null,
    ...{},
  };
  const full = { ...base, cycle: closed, participants: [person], students: [], order: { placedAt: null, poNumber: null, orderNumber: null, expectedAt: null }, receipts: [], handouts: [] };

  it("asks for the order to be recorded once picks are closed", () => {
    expect(gearAttentionItems(full, NOW).map((item) => item.key)).toContain("order-not-placed");
  });

  it("flags pieces past the expected date, red", () => {
    const items = gearAttentionItems({ ...full, order: { placedAt: "2026-10-14T00:00:00Z", poNumber: null, orderNumber: null, expectedAt: "2027-07-02T00:00:00Z" } }, NOW);
    const late = items.find((item) => item.key === "order-late");
    expect(late?.tone).toBe("red");
    expect(late?.href).toBe("#receiving");
  });

  it("flags people waiting on handout once gear has arrived", () => {
    const order = { placedAt: "2026-10-14T00:00:00Z", poNumber: null, orderNumber: null, expectedAt: "2027-07-02T00:00:00Z" };
    const planned = gearAttentionItems({ ...full, order }, NOW);
    expect(planned.map((item) => item.key)).not.toContain("handout");
    const received = gearAttentionItems(
      { ...full, order, receipts: [{ id: "r1", sku: "6021649-005", size: "L", quantity: 1, receivedAt: "2027-07-03T00:00:00Z", note: null } as never] },
      NOW,
    );
    expect(received.map((item) => item.key)).toContain("handout");
  });

  it("stays quiet about the order before launch data exists", () => {
    expect(gearAttentionItems(base, NOW)).toEqual([]);
  });
});
