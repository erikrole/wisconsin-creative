import { describe, expect, it } from "vitest";
import { WRAPPED_SCENARIOS, wrappedScenario } from "@/lib/wrapped/stress-fixtures";

const BAD = /undefined|null|NaN|Infinity|\[object/;

describe.each(WRAPPED_SCENARIOS)("Wrapped stress: %s", (name) => {
  const recap = wrappedScenario(name);
  const cards = [...recap.cards, ...recap.team];

  it("has no broken text or bad numbers", () => {
    for (const card of cards) {
      const text = [card.eyebrow, card.value, card.sentence, ...(card.items ?? []).flatMap((i) => [i.label, i.value])].join(" | ");
      expect(text, card.id).not.toMatch(BAD);
      expect(text.trim(), card.id).not.toBe("");
      if (card.countTo !== undefined) expect(Number.isFinite(card.countTo) && card.countTo >= 0, card.id).toBe(true);
      for (const item of card.items ?? []) {
        if (item.share !== undefined) expect(item.share >= 0 && item.share <= 1, card.id).toBe(true);
      }
    }
  });

  it("has unique card ids, a summary last, and at most four summary stats", () => {
    expect(new Set(cards.map((c) => c.id)).size).toBe(cards.length);
    if (recap.cards.length > 1) {
      expect(recap.cards.at(-1)!.layout).toBe("summary");
      expect(recap.cards.at(-1)!.items!.length).toBeLessThanOrEqual(4);
    }
  });
});

describe("Wrapped stress outcomes", () => {
  it("shows nothing personal for nobody and for collaborators", () => {
    expect(wrappedScenario("nothing").cards).toEqual([]);
    expect(wrappedScenario("nothing").team).toEqual([]);
    expect(wrappedScenario("collaborator").cards).toEqual([]);
  });

  it("opens a new student on their own cover before the team's cards", () => {
    const recap = wrappedScenario("new-student");
    expect(recap.cards.map((card) => card.id)).toEqual(["welcome"]);
    expect(recap.cards[0]!.layout).toBe("cover");
    expect(recap.team.length).toBeGreaterThan(0);
  });

  it("rounds a half hour of call time without calling it zero", () => {
    const hours = wrappedScenario("one-shift").cards.find((c) => c.id === "hours");
    expect(hours?.value).toBe("1");
  });

  it("calls a tied top sport a tie and never prints an address as a venue", () => {
    const huge = wrappedScenario("huge").cards.find((c) => c.id === "sport")!;
    expect(huge.sentence).toContain("tied with");
    const long = wrappedScenario("long-text").cards.find((c) => c.id === "road")!;
    expect(long.items!.find((i) => i.label === "Top venue")!.value).toBe("Kohl Center");
  });

  it("keeps big numbers whole", () => {
    const huge = wrappedScenario("huge");
    expect(huge.cards.find((c) => c.id === "hours")!.value).toBe("1,000");
    expect(huge.cards.find((c) => c.id === "events")!.value).toBe("220");
  });
});
