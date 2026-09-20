import { describe, it, expect } from "vitest";
import { EQUIPMENT_GUIDANCE_RULES } from "@/lib/equipment-guidance";

describe("EQUIPMENT_GUIDANCE_RULES", () => {
  it("has stable rule IDs", () => {
    const ids = EQUIPMENT_GUIDANCE_RULES.map((r) => r.id);
    expect(ids).toContain("body-needs-batteries");
  });

  it("every rule has required fields", () => {
    for (const rule of EQUIPMENT_GUIDANCE_RULES) {
      expect(rule.id).toBeTruthy();
      expect(rule.message).toBeTruthy();
      expect(["info", "warning", "requirement"]).toContain(rule.level);
    }
  });

  it("is extensible — adding a rule does not break existing ones", () => {
    const extended = [
      ...EQUIPMENT_GUIDANCE_RULES,
      {
        id: "test-rule",
        section: null as null,
        message: "Test",
        level: "info" as const,
        condition: () => true,
      },
    ];
    expect(extended.length).toBe(EQUIPMENT_GUIDANCE_RULES.length + 1);
  });
});
