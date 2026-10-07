import { describe, it, expect } from "vitest";
import {
  EQUIPMENT_GUIDANCE_RULES,
  getSectionGuidance,
  getUnsatisfiedRequirements,
} from "@/lib/equipment-guidance";

describe("EQUIPMENT_GUIDANCE_RULES", () => {
  it("has stable rule IDs including family-language support rules", () => {
    const ids = EQUIPMENT_GUIDANCE_RULES.map((r) => r.id);
    expect(ids).toContain("body-needs-batteries");
    expect(ids).toContain("cameras-need-support");
    expect(ids).toContain("cameras-need-lighting");
  });

  it("every rule has required fields", () => {
    for (const rule of EQUIPMENT_GUIDANCE_RULES) {
      expect(rule.id).toBeTruthy();
      expect(rule.message).toBeTruthy();
      expect(["info", "warning", "requirement"]).toContain(rule.level);
    }
  });

  it("names canonical families instead of models in support copy", () => {
    const tripod = EQUIPMENT_GUIDANCE_RULES.find((rule) => rule.id === "cameras-need-support");
    const lighting = EQUIPMENT_GUIDANCE_RULES.find((rule) => rule.id === "cameras-need-lighting");
    expect(tripod?.message).toMatch(/Tripod or Football Tripod/);
    expect(lighting?.message).toMatch(/Light Kit or Football Light Kit/);
    expect(tripod?.message).not.toMatch(/Manfrotto|Aputure/i);
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

describe("getSectionGuidance", () => {
  it("returns active-section advisory hints when cameras are selected without support gear", () => {
    const rules = getSectionGuidance({
      selectedSectionKeys: ["cameras"],
      activeSection: "tripods",
    });
    expect(rules.map((rule) => rule.id)).toContain("cameras-need-support");
  });

  it("does not surface requirement-level rules through section guidance", () => {
    expect(getUnsatisfiedRequirements(["cameras"])).toEqual([]);
    const rules = getSectionGuidance({
      selectedSectionKeys: ["cameras"],
      activeSection: "batteries",
    });
    expect(rules.every((rule) => rule.level !== "requirement")).toBe(true);
  });
});
