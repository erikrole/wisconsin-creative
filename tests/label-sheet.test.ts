import { describe, expect, it } from "vitest";
import {
  preparedSheet,
  clampCopies,
  entryRows,
  entryKind,
  familyEntry,
  parseUnitPick,
  printableCount,
  selectedUnitNumbers,
  serializedEntry,
  sheetRows,
  templateFiles,
  textEdited,
  unknownPickedNumbers,
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

describe("parseUnitPick", () => {
  it("reads single numbers, ranges and mixes", () => {
    expect(parseUnitPick("7").numbers).toEqual([7]);
    expect(parseUnitPick("12-15").numbers).toEqual([12, 13, 14, 15]);
    expect(parseUnitPick("3, 9 20 – 22").numbers).toEqual([3, 9, 20, 21, 22]);
    expect(parseUnitPick("5-3").numbers).toEqual([3, 4, 5]);
  });
  it("reports what it can't read", () => {
    expect(parseUnitPick("4, abc, 0").invalid).toEqual(["abc", "0"]);
  });
  it("rejects numbers outside the unit API's integer range", () => {
    expect(parseUnitPick("3, 2147483648")).toEqual({ numbers: [3], invalid: ["2147483648"] });
  });
  it("reports a selection past the cap instead of silently truncating it", () => {
    const picked = parseUnitPick("1-2000, 2001");
    expect(picked.numbers).toHaveLength(2000);
    expect(picked.invalid).toEqual(["2001"]);
  });
});

describe("edited text", () => {
  it("remembers the item's text so edits can be reset", () => {
    const edited = { ...camera, model: "A7 IV Spare" };
    expect(textEdited(camera)).toBe(false);
    expect(textEdited(edited)).toBe(true);
    expect({ ...edited, ...edited.original }.model).toBe("A7 IV");
  });
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

  it("prints unit labels on Batteries.lbx with derived QR, skipping printed and retired units", () => {
    const entry = asUnits(numbered, "unprinted");
    expect(entryKind(entry)).toBe("battery");
    expect(selectedUnitNumbers(entry, units)).toEqual([2, 3]);
    const [file] = templateFiles(sheetRows([entry], { batt: units }));
    expect(file!.file).toBe("Batteries.csv");
    expect(file!.templateHref).toBe("/label-templates/Batteries.lbx");
    expect(lines(file!.csv)).toEqual(["item_number,qr_code", "2,BATT-2", "3,BATT-3"]);
  });

  it("prints one label per unit even if the family label had copies", () => {
    const entry: CartEntry = { ...asUnits(numbered, "all"), copies: 3 };
    expect(printableCount(sheetRows([entry], { batt: units }))).toBe(3);
  });

  it("can print unit labels on Number-Tag.lbx instead", () => {
    const entry: CartEntry = { ...numbered, family: { ...numbered.family!, mode: "units", unitScope: "all", unitKind: "numberTag" } };
    const [file] = templateFiles(sheetRows([entry], { batt: units }));
    expect(file!.template).toBe("Number-Tag.lbx");
    expect(lines(file!.csv)[0]).toBe("Number,Codes");
  });

  it("prints just the picked unit numbers, including already printed ones", () => {
    const entry: CartEntry = { ...numbered, family: { ...numbered.family!, mode: "units", unitScope: "pick", unitPick: "1, 3-4, 9" } };
    expect(selectedUnitNumbers(entry, units)).toEqual([1, 3]);
    expect(unknownPickedNumbers(entry, units)).toEqual([4, 9]);
  });

  it("reprints every active unit when asked for all", () => {
    expect(selectedUnitNumbers(asUnits(numbered, "all"), units)).toEqual([1, 2, 3]);
  });

  it("waits for units before counting unit labels", () => {
    expect(printableCount(sheetRows([asUnits(numbered, "unprinted")], {}))).toBe(0);
  });

  it("checks the complete derived QR before exporting any units", () => {
    const entry = asUnits(familyEntry({ id: "batt", name: "NP-FZ100", binQrCodeValue: "abcdefghijklmn", trackByNumber: true, onHandQuantity: 4 }), "all");
    expect(entryRows(entry, units)).toEqual([]);
  });

  it.each(["2, abc", "2, 9", "2, 4", ""])("does not export a partial picked batch for %j", (unitPick) => {
    const entry: CartEntry = { ...asUnits(numbered, "all"), family: { ...numbered.family!, mode: "units", unitScope: "pick", unitPick } };
    expect(entryRows(entry, units)).toEqual([]);
  });

  it("splits a mixed sheet into one CSV per template", () => {
    const files = templateFiles(sheetRows([camera, asUnits(numbered, "unprinted"), counted], { batt: units }));
    expect(files.map((file) => file.file)).toEqual(["Camera Bodies.csv", "Batteries.csv"]);
  });

  it("prints in displayed template order even when a battery was added before a camera", () => {
    const sheet = preparedSheet([asUnits(numbered, "unprinted"), { ...camera, copies: 2 }], { batt: units });
    expect(sheet.groups.map((group) => group.kind)).toEqual(["body", "battery"]);
    expect(sheet.labels.map((label) => label.row.kind)).toEqual(["body", "body", "battery", "battery"]);
    expect(sheet.labels.map((label) => label.unit?.number ?? null)).toEqual([null, null, 2, 3]);
    expect(new Set(sheet.labels.map((label) => label.copyId)).size).toBe(4);
    expect(sheet.labels.every((label) => label.row.copies === 1)).toBe(true);
  });
  it("queues at most 500 USB copies, matching the print job cap", () => {
    const sheet = preparedSheet([{ ...camera, copies: 500 }, { ...camera, id: "a2", copies: 1 }], {});
    expect(sheet.total).toBe(501);
    expect(sheet.labels).toHaveLength(500);
  });
  it("keeps copies between 1 and 500", () => {
    expect(clampCopies(0)).toBe(1);
    expect(clampCopies(Number.NaN)).toBe(1);
    expect(clampCopies(9999)).toBe(500);
  });
});
