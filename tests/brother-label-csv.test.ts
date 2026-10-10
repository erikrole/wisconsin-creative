import { describe, expect, it } from "vitest";
import {
  buildBrotherCsv,
  numberRangeRows,
  parseAssetTag,
  sdCardRows,
  type LabelRow,
} from "@/lib/brother-label-csv";

const row = (patch: Partial<LabelRow>): LabelRow => ({
  kind: "body",
  dept: "",
  model: "",
  number: "",
  qrCodeValue: "",
  copies: 1,
  ...patch,
});

const body = (csv: string) => csv.replace(/^﻿/, "").split("\r\n").filter(Boolean);

describe("parseAssetTag", () => {
  it("splits dept prefix, model and unit number", () => {
    expect(parseAssetTag("FB A7 IV 1")).toEqual({ dept: "FB", model: "A7 IV", number: "1" });
    expect(parseAssetTag("Z200 2")).toEqual({ dept: "", model: "Z200", number: "2" });
    expect(parseAssetTag("100-400 2")).toEqual({ dept: "", model: "100-400", number: "2" });
  });
  it("leaves tags without a unit number whole", () => {
    expect(parseAssetTag("a7 V 2 Grip")).toEqual({ dept: "", model: "a7 V 2 Grip", number: "" });
    expect(parseAssetTag("FB")).toEqual({ dept: "", model: "FB", number: "" });
  });
});

describe("buildBrotherCsv", () => {
  it("matches the share format: BOM, CRLF rows, 3-line quoted Label", () => {
    const csv = buildBrotherCsv("body", [row({ dept: "FB", model: "A7 IV", number: "1", qrCodeValue: "6d6623d4" })]);
    expect(csv.startsWith("﻿Dept,Model,Number,Label,Codes\r\n")).toBe(true);
    expect(body(csv)[1]).toBe('FB,A7 IV,1,"FB\nA7 IV\n1",6d6623d4');
  });
  it("keeps a blank first label line without a dept and skips rows missing a QR", () => {
    const csv = buildBrotherCsv("lens", [
      row({ kind: "lens", model: "100-400", number: "1", qrCodeValue: "1bc3ee46" }),
      row({ kind: "lens", model: "50-500", number: "1" }),
      row({ kind: "body", model: "FX3", number: "1", qrCodeValue: "x" }),
    ]);
    expect(body(csv).slice(1)).toEqual([',100-400,1,"\n100-400\n1",1bc3ee46']);
  });
  it("repeats copies", () => {
    const csv = buildBrotherCsv("text", [row({ kind: "text", model: "FB", copies: 3 })]);
    expect(body(csv)).toEqual(["Label", "FB", "FB", "FB"]);
  });
});

describe("generators", () => {
  it("builds the SD card grid", () => {
    const csv = buildBrotherCsv("sd", sdCardRows("FX3", "", 2, ["A", "B"]));
    expect(body(csv)).toEqual([
      "Dept,Camera,Card,Label",
      ',FX3,1A,"\nFX3\n1A"',
      ',FX3,1B,"\nFX3\n1B"',
      ',FX3,2A,"\nFX3\n2A"',
      ',FX3,2B,"\nFX3\n2B"',
    ]);
  });
  it("builds number ranges with a prefix", () => {
    expect(numberRangeRows(1, 3, "#", "text").map((r) => r.model)).toEqual(["#1", "#2", "#3"]);
  });
});
