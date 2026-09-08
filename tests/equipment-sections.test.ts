import { describe, it, expect } from "vitest";
import {
  classifyAssetType,
  groupBulkBySection,
  EQUIPMENT_SECTIONS,
} from "@/lib/equipment-sections";

/* ───── classifyAssetType ───── */

describe("classifyAssetType", () => {
  it("classifies camera bodies", () => {
    expect(classifyAssetType("Camera")).toBe("cameras");
    expect(classifyAssetType("DSLR")).toBe("cameras");
    expect(classifyAssetType("Mirrorless")).toBe("cameras");
    expect(classifyAssetType("Video Camera")).toBe("cameras");
    expect(classifyAssetType("Cinema Camera")).toBe("cameras");
    expect(classifyAssetType("Camcorder")).toBe("cameras");
    expect(classifyAssetType("camera body")).toBe("cameras");
  });

  it("classifies lenses", () => {
    expect(classifyAssetType("Lens")).toBe("lenses");
    expect(classifyAssetType("Lenses")).toBe("lenses");
  });

  it("classifies batteries and chargers", () => {
    expect(classifyAssetType("Battery")).toBe("batteries");
    expect(classifyAssetType("Batteries")).toBe("batteries");
    expect(classifyAssetType("Charger")).toBe("batteries");
    expect(classifyAssetType("Power Supply")).toBe("batteries");
    expect(classifyAssetType("V-Mount")).toBe("batteries");
    expect(classifyAssetType("Gold Mount")).toBe("batteries");
  });

  it("classifies audio gear", () => {
    expect(classifyAssetType("Microphone")).toBe("audio");
    expect(classifyAssetType("Audio Mixer")).toBe("audio");
    expect(classifyAssetType("Recorder")).toBe("audio");
    expect(classifyAssetType("Wireless Transmitter")).toBe("audio");
    expect(classifyAssetType("Lavalier")).toBe("audio");
    expect(classifyAssetType("Shotgun Mic")).toBe("audio");
  });

  it("classifies tripods and support", () => {
    expect(classifyAssetType("Tripod")).toBe("tripods");
    expect(classifyAssetType("Monopod")).toBe("tripods");
    expect(classifyAssetType("Slider")).toBe("tripods");
  });

  it("classifies lighting", () => {
    expect(classifyAssetType("Light")).toBe("lighting");
    expect(classifyAssetType("LED Panel")).toBe("lighting");
    expect(classifyAssetType("Fresnel")).toBe("lighting");
  });

  it("classifies by category name when provided", () => {
    expect(classifyAssetType("equipment", "Cameras")).toBe("cameras");
    expect(classifyAssetType("equipment", "Lenses")).toBe("lenses");
    expect(classifyAssetType("equipment", "Batteries")).toBe("batteries");
    expect(classifyAssetType("equipment", "Audio")).toBe("audio");
    expect(classifyAssetType("equipment", "Microphones")).toBe("audio");
    expect(classifyAssetType("equipment", "Tripods")).toBe("tripods");
    expect(classifyAssetType("equipment", "Lighting")).toBe("lighting");
    expect(classifyAssetType("equipment", "Monitors")).toBe("other");
    expect(classifyAssetType("equipment", "Media Storage")).toBe("other");
    expect(classifyAssetType("equipment", "Office")).toBe("other");
  });

  it("puts unrecognized types in 'other'", () => {
    expect(classifyAssetType("Cable")).toBe("other");
    expect(classifyAssetType("equipment")).toBe("other");
    expect(classifyAssetType("Unknown")).toBe("other");
    expect(classifyAssetType("Monitor")).toBe("other");
    expect(classifyAssetType("Gimbal")).toBe("other");
  });

  it("is case insensitive", () => {
    expect(classifyAssetType("CAMERA")).toBe("cameras");
    expect(classifyAssetType("lens")).toBe("lenses");
    expect(classifyAssetType("BATTERY")).toBe("batteries");
    expect(classifyAssetType("MICROPHONE")).toBe("audio");
    expect(classifyAssetType("TRIPOD")).toBe("tripods");
  });

  it("handles empty and whitespace", () => {
    expect(classifyAssetType("")).toBe("other");
    expect(classifyAssetType("   ")).toBe("other");
  });

  it("prioritizes cameras over lenses for 'Camera Lens'", () => {
    expect(classifyAssetType("Camera Lens")).toBe("cameras");
  });
});

/* ───── groupBulkBySection ───── */

describe("groupBulkBySection", () => {
  it("groups bulk SKUs into correct sections", () => {
    const skus = [
      { id: "b1", category: "Battery" },
      { id: "b2", category: "Cable" },
      { id: "b3", category: "Charger" },
      { id: "b4", category: "Microphone" },
    ];
    const groups = groupBulkBySection(skus);
    expect(groups.batteries.map((s) => s.id)).toEqual(["b1", "b3"]);
    expect(groups.other.map((s) => s.id)).toEqual(["b2"]);
    expect(groups.audio.map((s) => s.id)).toEqual(["b4"]);
  });
});

/* ───── EQUIPMENT_SECTIONS constant ───── */

describe("EQUIPMENT_SECTIONS", () => {
  it("has 7 sections in the correct order: Cameras → Lenses → Batteries → Audio → Tripods → Lighting → Other", () => {
    expect(EQUIPMENT_SECTIONS).toHaveLength(7);
    expect(EQUIPMENT_SECTIONS.map((s) => s.key)).toEqual([
      "cameras", "lenses", "batteries", "audio", "tripods", "lighting", "other",
    ]);
  });

  it("every section has label and description", () => {
    for (const sec of EQUIPMENT_SECTIONS) {
      expect(sec.label).toBeTruthy();
      expect(sec.description).toBeTruthy();
    }
  });
});

/* ───── "Everything Else" catch-all ───── */

describe("catch-all behavior", () => {
  it("items with no recognized category or type end up in 'other'", () => {
    const miscTypes = ["Cable", "Tape", "Bag", "Case", "equipment", "foo bar"];
    for (const t of miscTypes) {
      expect(classifyAssetType(t)).toBe("other");
    }
  });
});
