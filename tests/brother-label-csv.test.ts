import { describe, expect, it } from "vitest";
import {
  buildBrotherCsv,
  fitsBrotherQr,
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
  it("refuses an oversized QR instead of growing it beyond the 12 mm layout", () => {
    expect(() => buildBrotherCsv("body", [row({ qrCodeValue: "legacy-camera-code-123456" })])).toThrow("wider-tape");
  });
});

describe("fixed-size Brother QR capacity", () => {
  it.each([
    ["c62a82d7", true], ["94e068d1-12345", true],
    ["1234567890123456789012345678901234", true], ["12345678901234567890123456789012345", false],
    ["ABCDEFGHIJKLMNOPQRST", true], ["ABCDEFGHIJKLMNOPQRSTU", false],
    ["abcdefghijklmn", true], ["abcdefghijklmno", false], ["équipement", false],
  ])("keeps %j within version 1 / M: %s", (value, fits) => {
    expect(fitsBrotherQr(value)).toBe(fits);
  });
});

describe("generators", () => {
  it("builds the SD card grid", () => {
    const csv = buildBrotherCsv("sd", sdCardRows("FX3", "", 2, ["A", "B"]));
    expect(body(csv)).toEqual([
      "Dept,Camera,Card,Size,",
      ',FX3,1A,,"\nFX3\n1A"',
      ',FX3,1B,,"\nFX3\n1B"',
      ',FX3,2A,,"\nFX3\n2A"',
      ',FX3,2B,,"\nFX3\n2B"',
    ]);
  });
  it("builds number ranges with a prefix", () => {
    expect(numberRangeRows(1, 3, "#", "text").map((r) => r.model)).toEqual(["#1", "#2", "#3"]);
  });
  it.each([[1.5, 3], [1, 501]])("rejects invalid or oversized number runs %s to %s", (from, to) => {
    expect(numberRangeRows(from, to, "", "text")).toEqual([]);
  });
});

describe("battery labels", () => {
  it("match the fields Batteries.lbx is bound to", () => {
    const csv = buildBrotherCsv("battery", [
      { kind: "battery", dept: "", model: "", number: "12", qrCodeValue: "BATT-12", copies: 1 },
    ]);
    expect(csv.replace(/^﻿/, "").split("\r\n").filter(Boolean)).toEqual(["item_number,qr_code", "12,BATT-12"]);
  });
});
