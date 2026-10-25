import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { ALL_SECTION_KEYS, sectionWhere } from "@/lib/equipment-section-filters";
import { classifyAssetType } from "@/lib/equipment-sections";

type Row = { type: string; categoryId: string | null; category: { name: string } | null };

// Evaluates the subset of Prisma's filter language sectionWhere emits, with
// Postgres semantics: relation filters on a missing category never match.
function matches(row: Row, where: Prisma.AssetWhereInput): boolean {
  return Object.entries(where).every(([key, value]) => {
    switch (key) {
      case "OR": return (value as Prisma.AssetWhereInput[]).some((clause) => matches(row, clause));
      case "AND": return (value as Prisma.AssetWhereInput[]).every((clause) => matches(row, clause));
      case "NOT": return !matches(row, value as Prisma.AssetWhereInput);
      case "categoryId": return value === null ? row.categoryId === null : row.categoryId === value;
      case "type": {
        const { contains } = value as { contains: string };
        return row.type.toLowerCase().includes(contains.toLowerCase());
      }
      case "category": {
        if (!row.category) return false;
        const name = row.category.name.toLowerCase();
        const filter = (value as { name: { in?: string[]; notIn?: string[] } }).name;
        if (filter.in) return filter.in.map((n) => n.toLowerCase()).includes(name);
        return !filter.notIn!.map((n) => n.toLowerCase()).includes(name);
      }
      default: throw new Error(`unsupported filter ${key}`);
    }
  });
}

const categories = [null, "Cameras", "camera bodies", "Lenses", "Batteries", "Audio", "Wireless", "Support", "Lighting", "Monitors", "Media Cards", "Office", "Drones", "Grip"];
const types = ["Cinema Camera", "Camera Battery", "Lens", "Battery grip", "V-Mount battery", "Wireless receiver", "Shotgun mic", "Tripod", "LED Panel light", "Light stand", "Monitor", "SD card", "Drone", "Power strip", "Slider", "Headphones"];
const rows: Row[] = categories.flatMap((name) => types.map((type) => ({
  type,
  categoryId: name ? `cat-${name}` : null,
  category: name ? { name } : null,
})));

describe("equipment section database filters", () => {
  it("put every asset in exactly the section the picker counts it under", () => {
    const wheres = new Map(ALL_SECTION_KEYS.map((key) => [key, sectionWhere(key)]));

    for (const row of rows) {
      const matched = ALL_SECTION_KEYS.filter((key) => matches(row, wheres.get(key)!));
      expect({ row: `${row.category?.name ?? "none"} / ${row.type}`, matched })
        .toEqual({ row: `${row.category?.name ?? "none"} / ${row.type}`, matched: [classifyAssetType(row.type, row.category?.name)] });
    }
  });

  it("lets a known category win over the type", () => {
    const camera = { type: "Battery grip", categoryId: "c", category: { name: "Cameras" } };
    const monitor = { type: "LED light", categoryId: "m", category: { name: "Monitors" } };

    expect(matches(camera, sectionWhere("cameras"))).toBe(true);
    expect(matches(camera, sectionWhere("batteries"))).toBe(false);
    expect(matches(monitor, sectionWhere("lighting"))).toBe(false);
    expect(matches(monitor, sectionWhere("other"))).toBe(true);
  });
});
