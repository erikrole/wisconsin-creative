import { describe, expect, it } from "vitest";
import {
  getNextSequentialAssetTag,
  getRepeatTagBase,
  summarizeRepeatTags,
} from "@/app/(app)/items/new-item-sheet/repeat-tags";
import { buildSerializedIntakeTemplate } from "@/app/(app)/items/new-item-sheet/serialized-template";

describe("Add item repeat tag helper", () => {
  it("uses the typed tag family as the repeat base", () => {
    expect(getRepeatTagBase(" FX3 2 ")).toBe("FX3");
    expect(getRepeatTagBase("FX3")).toBe("FX3");
    expect(getRepeatTagBase(" Sony FX3 12 ")).toBe("Sony FX3");
  });

  it("counts exact family tags and suggests the next numeric suffix", () => {
    const summary = summarizeRepeatTags("FX3 2", [
      { assetTag: "FX3" },
      { assetTag: "FX3 2" },
      { assetTag: "FX30" },
      { assetTag: "FX3 cage" },
    ]);

    expect(summary).toMatchObject({
      base: "FX3",
      existingCount: 2,
      nextTag: "FX3 3",
      matchedTags: ["FX3", "FX3 2"],
    });
  });

  it("suggests the strongest matching family while the operator is still typing", () => {
    const summary = summarizeRepeatTags("F", [
      { assetTag: "FX3" },
      { assetTag: "FX3 2" },
      { assetTag: "FX30" },
      { assetTag: "FX30 2" },
      { assetTag: "FS7" },
    ]);

    expect(summary).toMatchObject({
      base: "FX3",
      existingCount: 2,
      nextTag: "FX3 3",
    });
  });

  it("suggests the next tag when the operator types a base without a number", () => {
    const summary = summarizeRepeatTags("70-200", [
      { assetTag: "70-200 1" },
      { assetTag: "70-200 2" },
      { assetTag: "70-200 4" },
      { assetTag: "70 macro 1" },
    ]);

    expect(summary).toMatchObject({
      base: "70-200",
      existingCount: 3,
      nextTag: "70-200 5",
    });
  });

  it("uses the highest existing suffix when a number is skipped", () => {
    const summary = summarizeRepeatTags("FX3", [
      { assetTag: "FX3 4" },
      { assetTag: "FX3 2" },
    ]);

    expect(summary?.existingCount).toBe(2);
    expect(summary?.nextTag).toBe("FX3 5");
  });

  it("returns no suggestion when the typed prefix has no matching family", () => {
    expect(summarizeRepeatTags("ZZ", [{ assetTag: "FX3" }])).toBeNull();
  });

  it("advances the current tag when a family lookup is unavailable", () => {
    expect(getNextSequentialAssetTag("FX3 4")).toBe("FX3 5");
    expect(getNextSequentialAssetTag("FX3")).toBe("FX3 2");
    expect(getNextSequentialAssetTag(" 70-200 9 ")).toBe("70-200 10");
  });

  it("copies only reusable defaults into a new serialized intake", () => {
    const template = buildSerializedIntakeTemplate({
      id: "asset-fx3-4",
      assetTag: "FX3 4",
      name: "Sony FX3 Camera",
      brand: "Sony",
      model: "FX3",
      location: { id: "location-camp-randall" },
      category: { id: "category-camera" },
      department: { id: "department-creative" },
      linkUrl: "https://electronics.sony.com/fx3",
      imageUrl: "https://example.com/fx3.jpg",
      availableForReservation: true,
      availableForCheckout: false,
      availableForCustody: true,
    }, [
      { assetTag: "FX3" },
      { assetTag: "FX3 2" },
      { assetTag: "FX3 4" },
    ]);

    expect(template).toMatchObject({
      sourceAssetId: "asset-fx3-4",
      sourceLabel: "FX3 4",
      productLabel: "Sony FX3 Camera",
      assetTag: "FX3 5",
      name: "Sony FX3 Camera",
      brand: "Sony",
      model: "FX3",
      categoryId: "category-camera",
      locationId: "location-camp-randall",
      departmentId: "department-creative",
      linkUrl: "https://electronics.sony.com/fx3",
      availableForReservation: true,
      availableForCheckout: false,
      availableForCustody: true,
    });
    expect(template).not.toHaveProperty("serialNumber");
    expect(template).not.toHaveProperty("qrCodeValue");
    expect(template).not.toHaveProperty("purchaseDate");
    expect(template).not.toHaveProperty("purchasePrice");
    expect(template).not.toHaveProperty("warrantyDate");
    expect(template).not.toHaveProperty("uwAssetTag");
    expect(template).not.toHaveProperty("notes");
  });
});
