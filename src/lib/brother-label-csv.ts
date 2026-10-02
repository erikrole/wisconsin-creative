/**
 * CSVs for Brother P-touch Editor's database merge, one per label template on
 * the share (Media/RESOURCES/GUIDES/Labels/Brother Printer).
 *
 * The body, lens and SD card templates print ONE text box holding three lines
 * (dept, model, number); a blank first line keeps the layout when there is no
 * dept. So each row carries a pre-joined multi-line `Label` column alongside the
 * parts. Files match the share's working CSVs: UTF-8 BOM, CRLF between rows,
 * LF inside the quoted Label. Values are written verbatim (no spreadsheet
 * formula guard): P-touch would print a leading apostrophe literally.
 *
 * Batteries are not here: /api/bulk-skus/[id]/units/labels serves them.
 */
export type LabelKind = "body" | "lens" | "sd" | "text" | "numberTag";

export type LabelRow = {
  kind: LabelKind;
  dept: string;
  /** Model, focal length, camera, or free text. */
  model: string;
  /** Unit number, card slot ("1A"), or the generic number. */
  number: string;
  qrCodeValue: string;
  copies: number;
};

export const LABEL_KINDS: Record<
  LabelKind,
  { label: string; file: string; template: string; headers: string[]; needsQr: boolean }
> = {
  body: {
    label: "Camera bodies",
    file: "Camera Bodies.csv",
    template: "Camera Bodies.lbx",
    headers: ["Dept", "Model", "Number", "Label", "Codes"],
    needsQr: true,
  },
  lens: {
    label: "Lenses",
    file: "Lenses.csv",
    template: "Lenses.lbx",
    headers: ["Dept", "Model", "Number", "Label", "Codes"],
    needsQr: true,
  },
  sd: {
    label: "SD cards",
    file: "SD Cards.csv",
    template: "SD Cards.lbx",
    headers: ["Dept", "Camera", "Card", "Label"],
    needsQr: false,
  },
  text: {
    label: "Generic labels",
    file: "Generic Labels.csv",
    template: "Numbers.lbx",
    headers: ["Label"],
    needsQr: false,
  },
  numberTag: {
    label: "Number + QR",
    file: "Number Tags.csv",
    template: "Number-Tag.lbx",
    headers: ["Number", "Codes"],
    needsQr: true,
  },
};

/** Leading tokens on asset tags that name the owning program, e.g. "FB A7 IV 1". */
export const DEPT_PREFIXES = ["FB", "MBB", "WBB", "VB", "MHKY", "WHKY", "OOS"];

export function parseAssetTag(assetTag: string): { dept: string; model: string; number: string } {
  let rest = assetTag.trim().replace(/\s+/g, " ");
  let dept = "";
  const first = rest.split(" ")[0] ?? "";
  if (rest.includes(" ") && DEPT_PREFIXES.includes(first.toUpperCase())) {
    dept = first.toUpperCase();
    rest = rest.slice(first.length + 1);
  }
  const match = /^(.*\S)\s+(\d+)$/.exec(rest);
  return match
    ? { dept, model: match[1] ?? rest, number: match[2] ?? "" }
    : { dept, model: rest, number: "" };
}

/** SD card grid: cards 1..count × slots ("1A", "1B", "2A"…), matching the share CSV. */
export function sdCardRows(camera: string, dept: string, count: number, slots: string[]): LabelRow[] {
  const rows: LabelRow[] = [];
  for (let card = 1; card <= count; card += 1) {
    for (const slot of slots.length > 0 ? slots : [""]) {
      rows.push({ kind: "sd", dept, model: camera, number: `${card}${slot}`, qrCodeValue: "", copies: 1 });
    }
  }
  return rows;
}

export function numberRangeRows(from: number, to: number, prefix: string, kind: "text" | "numberTag"): LabelRow[] {
  const rows: LabelRow[] = [];
  const step = from <= to ? 1 : -1;
  for (let n = from; step > 0 ? n <= to : n >= to; n += step) {
    rows.push({ kind, dept: "", model: `${prefix}${n}`, number: String(n), qrCodeValue: "", copies: 1 });
  }
  return rows;
}

function quote(value: string): string {
  return /[,"\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function cells(row: LabelRow): string[] {
  const label = [row.dept, row.model, row.number].join("\n");
  switch (row.kind) {
    case "body":
    case "lens":
      return [row.dept, row.model, row.number, label, row.qrCodeValue];
    case "sd":
      return [row.dept, row.model, row.number, label];
    case "text":
      return [row.model];
    case "numberTag":
      return [row.number || row.model, row.qrCodeValue];
  }
}

export function buildBrotherCsv(kind: LabelKind, rows: LabelRow[]): string {
  const lines = rows
    .filter((row) => row.kind === kind)
    .filter((row) => !LABEL_KINDS[kind].needsQr || row.qrCodeValue)
    .flatMap((row) => {
      const line = cells(row).map(quote).join(",");
      return Array.from({ length: Math.max(1, Math.floor(row.copies)) }, () => line);
    });
  return "﻿" + [LABEL_KINDS[kind].headers.join(","), ...lines].join("\r\n") + "\r\n";
}
