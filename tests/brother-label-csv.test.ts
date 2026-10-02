import { describe, expect, it } from "vitest";
import { buildBrotherLabelCsv, splitAssetTag } from "@/lib/brother-label-csv";

describe("splitAssetTag", () => {
  it("splits a trailing unit number", () => {
    expect(splitAssetTag("Z200 2")).toEqual({ tag: "Z200", number: "2" });
    expect(splitAssetTag("FX3 Cage 12")).toEqual({ tag: "FX3 Cage", number: "12" });
  });
  it("keeps tags without a unit number whole", () => {
    expect(splitAssetTag("A7SIII")).toEqual({ tag: "A7SIII", number: "" });
  });
});

describe("buildBrotherLabelCsv", () => {
  it("writes the P-touch columns and quotes commas", () => {
    expect(
      buildBrotherLabelCsv([{ assetTag: "Z200 2", qrCodeValue: "DEF9FAC9", name: "Sony, PXW-Z200" }]),
    ).toBe('Tag,Number,QR,Asset Tag,Name\nZ200,2,DEF9FAC9,Z200 2,"Sony, PXW-Z200"\n');
  });
});

describe("buildBrotherLabelCsv review overrides", () => {
  it("uses edited tag/number and repeats copies", () => {
    const csv = buildBrotherLabelCsv([
      { assetTag: "FB A7 V 2", qrCodeValue: "D8870B6D", tag: "FB a7 V", number: "02", copies: 2 },
    ]);
    expect(csv.trim().split("\n").slice(1)).toEqual([
      "FB a7 V,02,D8870B6D,FB A7 V 2,",
      "FB a7 V,02,D8870B6D,FB A7 V 2,",
    ]);
  });
});
