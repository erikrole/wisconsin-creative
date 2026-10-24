import { describe, expect, it } from "vitest";
import { BATTERY_CAMERA_SEARCH_TERMS, getBatteryCompatibilitySummaries } from "@/lib/battery-compatibility";

const ACCEPTED_CAMERA_WORDS = ["camera", "cameras", "camcorder", "cinema", "mirrorless", "dslr", "body", "bodies"] as const;

describe("getBatteryCompatibilitySummaries", () => {
  it("keeps the camera prefilter a superset of every accepted camera word", () => {
    for (const word of ACCEPTED_CAMERA_WORDS) {
      expect(
        BATTERY_CAMERA_SEARCH_TERMS.some((term) => word.includes(term)),
        word,
      ).toBe(true);
      const summaries = getBatteryCompatibilitySummaries({
        cameraAssets: [{ brand: "Sony", model: "FX3", type: word === "bodies" ? "Bodies" : word }],
        bulkSkus: [{ id: "sony-battery", name: "Sony Battery", availableQuantity: 1 }],
      });
      expect(summaries.some((summary) => summary.ruleId === "sony-np-fz100"), word).toBe(true);
    }
  });

  it("warns when selected camera model has fewer compatible batteries than threshold", () => {
    const alerts = getBatteryCompatibilitySummaries({
      cameraAssets: [
        { brand: "Sony", model: "FX3", type: "Camera Body", categoryName: "Cameras" },
      ],
      bulkSkus: [
        {
          id: "sony-battery",
          name: "Sony Battery",
          category: "Batteries",
          availableQuantity: 7,
          ownedQuantity: 40,
          minThreshold: 4,
        },
      ],
    });

    expect(alerts).toEqual([
      expect.objectContaining({
        ruleId: "sony-np-fz100",
        availableQuantity: 7,
        threshold: 8,
        isLow: true,
        batterySkuIds: ["sony-battery"],
      }),
    ]);
  });

  it("does not warn when compatible available quantity meets threshold", () => {
    const alerts = getBatteryCompatibilitySummaries({
      cameraAssets: [
        { brand: "Sony", model: "FX3", type: "Camera Body", categoryName: "Cameras" },
      ],
      bulkSkus: [
        {
          id: "sony-battery",
          name: "Sony Battery",
          category: "Batteries",
          availableQuantity: 12,
        },
      ],
    });

    expect(alerts).toEqual([expect.objectContaining({ availableQuantity: 12, isLow: false })]);
  });

  it("uses a higher SKU threshold when configured", () => {
    const alerts = getBatteryCompatibilitySummaries({
      cameraAssets: [
        { brand: "Canon", model: "C70", type: "Cinema Camera", categoryName: "Cameras" },
      ],
      bulkSkus: [
        {
          id: "canon-battery",
          name: "Canon LP-E6",
          category: "Batteries",
          availableQuantity: 12,
          minThreshold: 15,
        },
      ],
    });

    expect(alerts[0]).toEqual(expect.objectContaining({
      ruleId: "canon-lp-e6",
      threshold: 15,
      isLow: true,
      availableQuantity: 12,
    }));
  });

  it("maps imported Sony FX6 camera models to BP-U batteries", () => {
    const alerts = getBatteryCompatibilitySummaries({
      cameraAssets: [
        { brand: "Sony", model: "ILME-FX6V", type: "Cameras/Bodies", categoryName: "Cameras" },
      ],
      bulkSkus: [
        {
          id: "sony-bp-u35",
          name: "Sony BP-U35 Battery",
          category: "Batteries",
          availableQuantity: 4,
          ownedQuantity: 20,
        },
        {
          id: "sony-bp-u70",
          name: "Sony BP-U70 Battery",
          category: "Batteries",
          availableQuantity: 3,
          ownedQuantity: 20,
        },
      ],
    });

    expect(alerts[0]).toEqual(expect.objectContaining({
      ruleId: "sony-bp-u",
      batterySkuIds: ["sony-bp-u35", "sony-bp-u70"],
      availableQuantity: 7,
      threshold: 8,
      isLow: true,
    }));
  });

  it("summarizes low compatible battery families across camera inventory", () => {
    const summaries = getBatteryCompatibilitySummaries({
      cameraAssets: [
        { brand: "Sony", model: "FX3", type: "Camera Body", categoryName: "Cameras" },
        { brand: "Sony", model: "A7 IV", type: "Camera Body", categoryName: "Cameras" },
        { brand: "Sony", model: "FX6", type: "Camera Body", categoryName: "Cameras" },
      ],
      bulkSkus: [
        {
          id: "np-fz100",
          name: "Sony NP-FZ100 Battery",
          category: "Batteries",
          availableQuantity: 6,
          ownedQuantity: 40,
        },
        {
          id: "bp-u",
          name: "Sony BP-U Battery",
          category: "Batteries",
          availableQuantity: 14,
        },
      ],
    });

    expect(summaries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ruleId: "sony-np-fz100",
        cameraCount: 2,
        batterySkuNames: ["Sony NP-FZ100 Battery"],
        availableQuantity: 6,
        threshold: 8,
        isLow: true,
      }),
      expect.objectContaining({
        ruleId: "sony-bp-u",
        cameraCount: 1,
        availableQuantity: 14,
        isLow: false,
      }),
    ]));
  });
});

describe("camera model matching", () => {
  const sonyBattery = [{ id: "sony-battery", name: "Sony Battery", availableQuantity: 1 }];
  const ruleIds = (model: string, brand: string) =>
    getBatteryCompatibilitySummaries({
      cameraAssets: [{ brand, model, type: "Camera" }],
      bulkSkus: [
        ...sonyBattery,
        { id: "canon-battery", name: "Canon Battery LP-E6", availableQuantity: 1 },
      ],
    }).map((summary) => summary.ruleId);

  it("does not attribute a Canon R50 to the R5 battery family", () => {
    expect(ruleIds("EOS R50", "Canon")).not.toContain("canon-lp-e6");
  });

  it("does not attribute a Sony A10 to the A1 battery family", () => {
    expect(ruleIds("A10", "Sony")).not.toContain("sony-np-fz100");
  });

  it("still matches real model strings with a suffix or separator", () => {
    expect(ruleIds("EOS R5 C", "Canon")).toContain("canon-lp-e6");
    expect(ruleIds("A7IV", "Sony")).toContain("sony-np-fz100");
    expect(ruleIds("ILME-FX3", "Sony")).toContain("sony-np-fz100");
  });
});

describe("relative low-stock line", () => {
  it("does not flag a small family that is merely running down", () => {
    const [summary] = getBatteryCompatibilitySummaries({
      cameraAssets: [{ brand: "Sony", model: "FX3", type: "Camera" }],
      bulkSkus: [{ id: "s", name: "Sony Battery", availableQuantity: 3, ownedQuantity: 12 }],
    });
    expect(summary).toEqual(expect.objectContaining({ threshold: 3, isLow: false }));
  });
});
