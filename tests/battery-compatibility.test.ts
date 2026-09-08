import { describe, expect, it } from "vitest";
import { getBatteryCompatibilitySummaries } from "@/lib/battery-compatibility";

describe("getBatteryCompatibilitySummaries", () => {
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
          minThreshold: 4,
        },
      ],
    });

    expect(alerts).toEqual([
      expect.objectContaining({
        ruleId: "sony-np-fz100",
        availableQuantity: 7,
        threshold: 10,
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
        },
        {
          id: "sony-bp-u70",
          name: "Sony BP-U70 Battery",
          category: "Batteries",
          availableQuantity: 3,
        },
      ],
    });

    expect(alerts[0]).toEqual(expect.objectContaining({
      ruleId: "sony-bp-u",
      batterySkuIds: ["sony-bp-u35", "sony-bp-u70"],
      availableQuantity: 7,
      threshold: 10,
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
        threshold: 10,
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
