import { describe, expect, it } from "vitest";
import {
  clampCopies,
  entryKind,
  familyEntry,
  printableCount,
  selectedUnitNumbers,
  serializedEntry,
  sheetRows,
  templateFiles,
  type CartEntry,
  type SheetUnit,
} from "@/app/(app)/labels/label-sheet";

const lines = (csv: string) => csv.replace(/^﻿/, "").split("\r\n").filter(Boolean);

const numbered = familyEntry({ id: "batt", name: "NP-FZ100", binQrCodeValue: "BATT", trackByNumber: true, onHandQuantity: 4 });
const counted = familyEntry({ id: "xlr", name: "XLR 25 ft", binQrCodeValue: "XLR25", trackByNumber: false, onHandQuantity: 36 });
const camera = serializedEntry({ id: "a1", title: "FB A7 IV 1", name: "Sony A7 IV", qrCodeValue: "6d6623d4", category: "Camera Bodies" });

const units: SheetUnit[] = [
  { unitNumber: 3, status: "AVAILABLE", labelPrintedAt: null },
  { unitNumber: 1, status: "AVAILABLE", labelPrintedAt: "2026-09-01T00:00:00Z" },
  { unitNumber: 2, status: "CHECKED_OUT", labelPrintedAt: null },
  { unitNumber: 4, status: "RETIRED", labelPrintedAt: null },
];

const asUnits = (entry: CartEntry, unitScope: "unprinted" | "all"): CartEntry => ({
  ...entry,
  family: { ...entry.family!, mode: "units", unitScope },
});

describe("print sheet rows", () => {
  it("prints a serialized item once per copy on its category template", () => {
    const files = templateFiles(sheetRows([{ ...camera, copies: 2 }], {}));
    expect(files.map((file) => [file.file, file.labels])).toEqual([["Camera Bodies.csv", 2]]);
    expect(lines(files[0]!.csv).slice(1)).toEqual([
      'FB,A7 IV,1,"FB\nA7 IV\n1",6d6623d4',
      'FB,A7 IV,1,"FB\nA7 IV\n1",6d6623d4',
    ]);
  });

  it("prints one family label with the family QR and name", () => {
    const [file] = templateFiles(sheetRows([numbered], {}));
    expect(lines(file!.csv)[1]).toBe(',NP-FZ100,,"\nNP-FZ100\n",BATT');
  });

  it("prints a counted family as N copies of its label", () => {
    const rows = sheetRows([{ ...counted, copies: 36 }], {});
    expect(printableCount(rows)).toBe(36);
    expect(lines(templateFiles(rows)[0]!.csv)).toHaveLength(37);
  });

  it("prints unit labels as Number Tags with derived QR, skipping printed and retired units", () => {
    const entry = asUnits(numbered, "unprinted");
    expect(entryKind(entry)).toBe("numberTag");
    expect(selectedUnitNumbers(entry, units)).toEqual([2, 3]);
    const [file] = templateFiles(sheetRows([entry], { batt: units }));
    expect(file!.file).toBe("Number Tags.csv");
    expect(lines(file!.csv)).toEqual(["Number,Codes", "2,BATT-2", "3,BATT-3"]);
  });

  it("reprints every active unit when asked for all", () => {
    expect(selectedUnitNumbers(asUnits(numbered, "all"), units)).toEqual([1, 2, 3]);
  });

  it("waits for units before counting unit labels", () => {
    expect(printableCount(sheetRows([asUnits(numbered, "unprinted")], {}))).toBe(0);
  });

  it("splits a mixed sheet into one CSV per template", () => {
    const files = templateFiles(sheetRows([camera, asUnits(numbered, "unprinted"), counted], { batt: units }));
    expect(files.map((file) => file.file)).toEqual(["Camera Bodies.csv", "Number Tags.csv"]);
  });

  it("keeps copies between 1 and 500", () => {
    expect(clampCopies(0)).toBe(1);
    expect(clampCopies(Number.NaN)).toBe(1);
    expect(clampCopies(9999)).toBe(500);
  });
});
