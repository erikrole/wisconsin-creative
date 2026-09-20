import { describe, expect, it } from "vitest";
import {
  buildItemAssetTagSortKey,
  compareItemAssetTags,
  getAssetTagSearchAliases,
} from "@/lib/item-asset-tag-sort";

describe("item asset tag sorting", () => {
  it("sorts prefixed department/team rows with their asset-tag family", () => {
    const tags = [
      "FX6 1",
      "FB 70-200 2",
      "FX3 2",
      "MBB 28-75 1",
      "70-200 1",
      "FB 16-35 1",
      "MBB 70-180 1",
      "FB FX3 1",
    ];

    expect(tags.sort(compareItemAssetTags)).toEqual([
      "FB 16-35 1",
      "MBB 28-75 1",
      "MBB 70-180 1",
      "70-200 1",
      "FB 70-200 2",
      "FX3 2",
      "FB FX3 1",
      "FX6 1",
    ]);
  });

  it("groups operational prefixes inside the same equipment family", () => {
    const tags = [
      "FB 70-200 3",
      "70-200 3",
      "FB 70-200 1",
      "70-200 1",
      "100-400 1",
      "FB 70-200 2",
      "70200 4",
      "70-200 2",
    ];

    expect(tags.sort(compareItemAssetTags)).toEqual([
      "70-200 1",
      "70-200 2",
      "70-200 3",
      "70200 4",
      "FB 70-200 1",
      "FB 70-200 2",
      "FB 70-200 3",
      "100-400 1",
    ]);
  });

  it("keeps broad-word false positives in their own natural position", () => {
    const tags = ["FX6 1", "Video Assist 1", "Video FX6 2", "FB FX6 3"];

    expect(tags.sort(compareItemAssetTags)).toEqual([
      "FX6 1",
      "Video FX6 2",
      "FB FX6 3",
      "Video Assist 1",
    ]);
  });

  it("keeps numeric suffixes in natural order", () => {
    const tags = ["FX3 10", "FX3 2", "FX3 1", "FX6 1", "FX3"];

    expect(tags.sort(compareItemAssetTags)).toEqual([
      "FX3",
      "FX3 1",
      "FX3 2",
      "FX3 10",
      "FX6 1",
    ]);
  });

  it("handles hyphenated repeated family names", () => {
    const tags = [
      "Dell Single Monitor Arm-5",
      "Dell Single Monitor Arm",
      "Dell Single Monitor Arm-2",
    ];

    expect(tags.sort(compareItemAssetTags)).toEqual([
      "Dell Single Monitor Arm",
      "Dell Single Monitor Arm-2",
      "Dell Single Monitor Arm-5",
    ]);
  });

  it("expands compact and hyphenated numeric family search aliases", () => {
    expect(getAssetTagSearchAliases("70200")).toEqual(["70200", "70-200"]);
    expect(getAssetTagSearchAliases("70-200")).toEqual(["70-200", "70200"]);
    expect(getAssetTagSearchAliases("FB 100400")).toEqual(["FB 100400", "FB 100-400"]);
  });
});

/**
 * `assets.asset_tag_sort_key` (migration 0151) lets the Items list default sort
 * paginate in Postgres. Ordering by that persisted key has to reproduce
 * `compareItemAssetTags` or the list silently changes order, so this corpus
 * covers every branch of the normalization: team prefixes, department
 * prefixes, equipment starters, compact vs hyphenated families, trailing
 * hyphen units, mixed case, multi-digit units, and unit-less tags.
 */
describe("persisted asset tag sort key", () => {
  const CORPUS = [
    "FB 70-200 1", "MBB 28-75 1", "FB A7 V 1", "FB Wireless Flash", "FX6 2",
    "70200 4", "100400 2", "Video Assist 1", "Photo Printer 1", "Video FX6 1",
    "Creative 70-200 1", "70-200 10", "70-200 2", "SONY FX3", "Monitor Battery",
    "DEMO-CAM-001", "FB 16-35 1", "MBB 70-180 1", "FB FX3 1", "FX3 2",
    "70-200 1", "70-200 3", "FB 70-200 2", "FB 70-200 3", "100-400 1",
    "XC Sandisk 128", "WSOC A7 3", "Tripod", "Tripod 2", "Tripod 10",
    "Aputure 120d 1", "aputure 120D 2", "DJI RS3 1", "GOLF Canon R5 1",
    "SB 24-70 1", "VB Godox 1", "Anton/Bauer 1", "anton/bauer 2", "FS7 1",
    "FX30 4", "A9 III 1", "Dell Monitor 1", "Photo A7 1", "Creative Insta360 1",
    "Video 5D 2", "Impact Stand 12", "Impact Stand 2", "item-9", "item-10",
    "item-2", "Cage", "70-200-2", "70-200-10",
  ];

  it("orders exactly like compareItemAssetTags", () => {
    const byComparator = [...CORPUS].sort(compareItemAssetTags);
    // Byte comparison, matching the COLLATE "C" column the migration creates.
    const bySortKey = [...CORPUS].sort((a, b) => {
      const keyA = buildItemAssetTagSortKey(a);
      const keyB = buildItemAssetTagSortKey(b);
      if (keyA !== keyB) return keyA < keyB ? -1 : 1;
      return a < b ? -1 : a > b ? 1 : 0;
    });

    expect(bySortKey).toEqual(byComparator);
  });

  it("is deterministic and never empty", () => {
    for (const tag of CORPUS) {
      expect(buildItemAssetTagSortKey(tag)).toBe(buildItemAssetTagSortKey(tag));
      expect(buildItemAssetTagSortKey(tag).length).toBeGreaterThan(0);
    }
    expect(buildItemAssetTagSortKey("")).toBe(["", "0", "0".repeat(12), "", "", ""].join("\u0001"));
  });

  it("collapses whitespace the same way the tag normalizer does", () => {
    expect(buildItemAssetTagSortKey("  FB   70-200   1 ")).toBe(buildItemAssetTagSortKey("FB 70-200 1"));
  });
});
