import { describe, expect, it } from "vitest";
import { MAX_SPORT_CONFIG_GROUP_CODES_PER_REQUEST } from "@/lib/request-limits";
import {
  nullableSportCodeSchema,
  optionalSportCodeSchema,
  sportCodeSchema,
  upsertSportConfigSchema,
  updateSportConfigGroupSchema,
} from "@/lib/validation";

describe("sport code validation", () => {
  it("normalizes accepted sport codes to canonical uppercase values", () => {
    expect(sportCodeSchema.parse(" vb ")).toBe("VB");
    expect(optionalSportCodeSchema.parse("msoc")).toBe("MSOC");
    expect(nullableSportCodeSchema.parse("fb")).toBe("FB");
  });

  it("treats empty optional and nullable sport-code inputs as absent", () => {
    expect(optionalSportCodeSchema.parse("")).toBeUndefined();
    expect(nullableSportCodeSchema.parse("")).toBeNull();
    expect(nullableSportCodeSchema.parse(undefined)).toBeNull();
  });

  it("rejects unknown sport codes at API schema boundaries", () => {
    expect(() => sportCodeSchema.parse("football")).toThrow("Invalid sport code");
    expect(() => upsertSportConfigSchema.parse({ sportCode: "BAD" })).toThrow("Invalid sport code");
  });

  it("normalizes grouped sport config codes before service writes", () => {
    const parsed = updateSportConfigGroupSchema.parse({
      codes: ["mrow", "wrow", "lrow"],
      active: true,
    });

    expect(parsed.codes).toEqual(["MROW", "WROW", "LROW"]);
    expect(parsed.codes).toHaveLength(MAX_SPORT_CONFIG_GROUP_CODES_PER_REQUEST);
  });

  it("rejects grouped sport config writes above the Rowing boundary", () => {
    expect(() => updateSportConfigGroupSchema.parse({
      codes: ["mrow", "wrow", "lrow", "fb"],
      active: true,
    })).toThrow(`Too big: expected array to have <=${MAX_SPORT_CONFIG_GROUP_CODES_PER_REQUEST} items`);
  });

  it("rejects duplicate grouped sport codes after case normalization", () => {
    expect(() => updateSportConfigGroupSchema.parse({
      codes: ["mxc", "MXC"],
      active: true,
    })).toThrow("Sport codes must be unique");
  });
});
