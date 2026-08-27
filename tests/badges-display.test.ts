import { describe, expect, it } from "vitest";
import {
  badgeRarityMedallionClass,
  formatBadgeCategoryLabel,
  formatBadgeSourceLabel,
  getBadgeRarity,
  isHiddenUntilEarnedBadge,
  manualAwardGuidance,
} from "@/lib/badges/display";

describe("badge display metadata", () => {
  it("keeps surprise badges hidden until earned", () => {
    expect(isHiddenUntilEarnedBadge("above_and_beyond")).toBe(true);
    expect(isHiddenUntilEarnedBadge("event_hero")).toBe(true);
    expect(isHiddenUntilEarnedBadge("first_checkout")).toBe(false);
  });

  it("derives rarity without schema fields", () => {
    expect(getBadgeRarity({
      key: "above_and_beyond",
      category: "MILESTONE",
      kind: "RULE",
      trigger: "manual",
      threshold: null,
    })).toBe("Legendary");
    expect(getBadgeRarity({
      key: "checkout_25",
      category: "CHECKOUT",
      kind: "COUNT",
      trigger: "checkout:opened",
      threshold: 25,
    })).toBe("Uncommon");
    expect(getBadgeRarity({
      key: "first_checkout",
      category: "CHECKOUT",
      kind: "COUNT",
      trigger: "checkout:opened",
      threshold: 1,
    })).toBe("Common");
  });

  it("has admin guidance for manual fun badges", () => {
    expect(manualAwardGuidance.clutch_cover).toContain("late or urgent shift");
    expect(manualAwardGuidance.perfect_handoff).toContain("on time");
  });

  it("maps rarity to medallion classes", () => {
    // Earned is a rarity gradient carrying a white glyph; the tokens are the
    // disc palette, not the semantic text/background pair, because they are
    // picked for contrast against white. Locked is the muted wash.
    expect(badgeRarityMedallionClass("Legendary", true)).toContain("--badge-legendary");
    expect(badgeRarityMedallionClass("Rare", true)).toContain("--badge-rare");
    expect(badgeRarityMedallionClass("Uncommon", true)).toContain("--badge-uncommon");
    expect(badgeRarityMedallionClass("Common", true)).toContain("--badge-common");
    expect(badgeRarityMedallionClass("Common", false)).toContain("text-muted-foreground");
    expect(badgeRarityMedallionClass("Common", false)).not.toContain("--badge-common");
  });

  it("formats enum-style report labels for operators", () => {
    expect(formatBadgeCategoryLabel("ON_TIME")).toBe("On Time");
    expect(formatBadgeCategoryLabel("MILESTONE")).toBe("Milestone");
    expect(formatBadgeSourceLabel("MANUAL")).toBe("Manual");
  });
});
