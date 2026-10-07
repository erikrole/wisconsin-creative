import { describe, expect, it } from "vitest";
import {
  CANONICAL_SUPPORT_GEAR_FAMILIES,
  findCanonicalSupportFamily,
  isCanonicalSupportFamilyName,
  isSerializedSupportPoolCandidate,
  shouldAssignUnitProduct,
} from "@/lib/support-gear-families";

describe("canonical support gear families", () => {
  it("keeps Creative and Football pools for tripods and light kits", () => {
    expect(CANONICAL_SUPPORT_GEAR_FAMILIES.map((family) => family.name)).toEqual([
      "Tripod",
      "Football Tripod",
      "Light Kit",
      "Football Light Kit",
    ]);
    expect(findCanonicalSupportFamily("Football Tripod")?.pool).toBe("football");
    expect(isCanonicalSupportFamilyName("light kit")).toBe(true);
  });

  it("marks 2-point vs 3-point as a pending light-kit split only", () => {
    const lightKits = CANONICAL_SUPPORT_GEAR_FAMILIES.filter((family) => family.section === "lighting");
    expect(lightKits.every((family) => family.pendingSplit?.includes("2-point"))).toBe(true);
    expect(CANONICAL_SUPPORT_GEAR_FAMILIES.filter((family) => family.section === "tripods")
      .every((family) => !family.pendingSplit)).toBe(true);
  });
});

describe("isSerializedSupportPoolCandidate", () => {
  it("flags active tripod and light-kit serialized rows", () => {
    expect(isSerializedSupportPoolCandidate({
      status: "AVAILABLE",
      categoryName: "Tripods",
      assetTag: "Manfrotto 535",
      brand: "Manfrotto",
      model: "535 MPro",
    })).toBe(true);

    expect(isSerializedSupportPoolCandidate({
      status: "AVAILABLE",
      type: "Lighting",
      name: "Interview Light Kit",
      brand: "Aputure",
      model: "300d",
    })).toBe(true);
  });

  it("skips accessories and retired gear", () => {
    expect(isSerializedSupportPoolCandidate({
      status: "AVAILABLE",
      parentAssetId: "parent-1",
      categoryName: "Tripods",
    })).toBe(false);

    expect(isSerializedSupportPoolCandidate({
      status: "RETIRED",
      categoryName: "Lighting",
      name: "Old Light Kit",
    })).toBe(false);
  });
});

describe("shouldAssignUnitProduct", () => {
  it("requires product assignment only when the family already defines products", () => {
    expect(shouldAssignUnitProduct({
      trackByNumber: true,
      activeProductCount: 2,
      productId: null,
      unitStatus: "AVAILABLE",
    })).toBe(true);

    expect(shouldAssignUnitProduct({
      trackByNumber: true,
      activeProductCount: 0,
      productId: null,
      unitStatus: "AVAILABLE",
    })).toBe(false);

    expect(shouldAssignUnitProduct({
      trackByNumber: true,
      activeProductCount: 2,
      productId: "product-1",
      unitStatus: "AVAILABLE",
    })).toBe(false);
  });
});
