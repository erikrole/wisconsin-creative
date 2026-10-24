import {
  LABEL_KINDS,
  buildBrotherCsv,
  fitsBrotherQr,
  parseAssetTag,
  unitTagRows,
  type LabelKind,
  type LabelRow,
} from "@/lib/brother-label-csv";
import type { PrintLabel } from "@/lib/label-print-job";
import { MAX_BULK_UNIT_NUMBER } from "@/lib/request-limits";

/** Most labels one sheet entry can ask for; a typo should not queue 10,000 prints. */
export const MAX_COPIES = 500;

/** Most copies one USB batch sends; matches the print job schema cap. */
const MAX_USB_LABELS = 500;

/** How an item family prints. Serialized items never carry this. */
type FamilySource = {
  skuId: string;
  binQrCodeValue: string;
  trackByNumber: boolean;
  onHand: number;
  /** Numbered families print either the one family label or a label for each unit. */
  mode: "family" | "units";
  /** Units only: labels not printed yet, every active unit for a reprint, or picked numbers. */
  unitScope: UnitScope;
  /** Units only, with the "pick" scope: numbers and ranges such as "3, 7-12". */
  unitPick?: string;
  /** Units only: which template the unit labels print on. */
  unitKind?: UnitKind;
};

export type UnitScope = "unprinted" | "all" | "pick";
export type UnitKind = "battery" | "numberTag";
export const UNIT_KINDS: UnitKind[] = ["battery", "numberTag"];

/** Text the label had when it was added, so edits can be undone. */
type LabelText = { dept: string; model: string; number: string };

/** One line on the print sheet, editable before export. */
export type CartEntry = LabelRow & {
  id: string;
  title: string;
  name: string;
  primaryScanCode?: string;
  family?: FamilySource;
  original?: LabelText;
};

export type SheetUnit = {
  unitNumber: number;
  status: string;
  labelPrintedAt: string | null;
};

export const KIND_ORDER = Object.keys(LABEL_KINDS) as LabelKind[];

/** Lenses and SD cards get their own templates; everything else prints as a body label. */
function kindForCategory(category: string | null | undefined): LabelKind {
  const name = (category ?? "").toLowerCase();
  if (name.includes("lens")) return "lens";
  if (name.includes("sd card")) return "sd";
  return "body";
}

export function clampCopies(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_COPIES, Math.max(1, Math.floor(value)));
}

export function serializedEntry(item: {
  id: string;
  title: string;
  name: string;
  qrCodeValue: string;
  primaryScanCode?: string;
  category?: string | null;
}): CartEntry {
  const text = parseAssetTag(item.title);
  return {
    id: item.id,
    title: item.title,
    name: item.name,
    primaryScanCode: item.primaryScanCode,
    kind: kindForCategory(item.category),
    ...text,
    original: text,
    qrCodeValue: item.qrCodeValue,
    copies: 1,
  };
}

export function textEdited(entry: CartEntry): boolean {
  if (!entry.original) return false;
  return (
    entry.dept !== entry.original.dept ||
    entry.model !== entry.original.model ||
    entry.number !== entry.original.number
  );
}

/**
 * A family starts as one family label: the bin QR plus the family name. Numbered
 * families can switch to unit labels on the sheet; counted families raise copies.
 */
export function familyEntry(family: {
  id: string;
  name: string;
  binQrCodeValue: string;
  trackByNumber: boolean;
  onHandQuantity: number;
}): CartEntry {
  return {
    id: `bulk-${family.id}`,
    title: family.name,
    name: family.name,
    primaryScanCode: family.binQrCodeValue,
    kind: "body",
    dept: "",
    model: family.name,
    number: "",
    original: { dept: "", model: family.name, number: "" },
    qrCodeValue: family.binQrCodeValue,
    copies: 1,
    family: {
      skuId: family.id,
      binQrCodeValue: family.binQrCodeValue,
      trackByNumber: family.trackByNumber,
      onHand: family.onHandQuantity,
      mode: "family",
      unitScope: "unprinted",
      unitKind: "battery",
    },
  };
}

export function printsUnits(entry: CartEntry): boolean {
  return Boolean(entry.family?.trackByNumber && entry.family.mode === "units");
}

/** Most unit numbers one pick can name. */
const MAX_PICK = 2000;

/**
 * Parses "7", "3, 9" or "12-18" (any mix, commas or spaces) into unit numbers.
 * Anything that is not a positive number or range lands in `invalid`.
 */
export function parseUnitPick(text: string): { numbers: number[]; invalid: string[] } {
  const numbers = new Set<number>();
  const invalid: string[] = [];
  const parts = text.replace(/\s*[-–]\s*/g, "-").split(/[\s,]+/).filter(Boolean);
  for (const part of parts) {
    const range = /^(\d+)-(\d+)$/.exec(part) ?? /^(\d+)$/.exec(part);
    if (!range) {
      invalid.push(part);
      continue;
    }
    const from = Number(range[1]);
    const to = Number(range[2] ?? range[1]);
    const [low, high] = from <= to ? [from, to] : [to, from];
    if (!Number.isSafeInteger(low) || !Number.isSafeInteger(high) || low < 1 || high > MAX_BULK_UNIT_NUMBER || high - low >= MAX_PICK) {
      invalid.push(part);
      continue;
    }
    const added = [];
    for (let n = low; n <= high; n += 1) if (!numbers.has(n)) added.push(n);
    if (numbers.size + added.length > MAX_PICK) {
      invalid.push(part);
      continue;
    }
    for (const n of added) numbers.add(n);
  }
  return { numbers: [...numbers].sort((a, b) => a - b), invalid };
}

/** Unit numbers an entry prints in units mode. Retired units never get new labels. */
export function selectedUnitNumbers(entry: CartEntry, units: SheetUnit[] | undefined): number[] {
  if (!units || !printsUnits(entry)) return [];
  const active = units.filter((unit) => unit.status !== "RETIRED");
  const scope = entry.family?.unitScope;
  if (scope === "pick") {
    const picked = new Set(parseUnitPick(entry.family?.unitPick ?? "").numbers);
    return active.filter((unit) => picked.has(unit.unitNumber)).map((unit) => unit.unitNumber).sort((a, b) => a - b);
  }
  return active
    .filter((unit) => scope === "all" || !unit.labelPrintedAt)
    .map((unit) => unit.unitNumber)
    .sort((a, b) => a - b);
}

/** Picked numbers that are not active units of the family, to call out on the sheet. */
export function unknownPickedNumbers(entry: CartEntry, units: SheetUnit[] | undefined): number[] {
  if (!units || entry.family?.unitScope !== "pick") return [];
  const active = new Set(units.filter((unit) => unit.status !== "RETIRED").map((unit) => unit.unitNumber));
  return parseUnitPick(entry.family.unitPick ?? "").numbers.filter((n) => !active.has(n));
}

export function unitKindOf(entry: CartEntry): UnitKind {
  return entry.family?.unitKind ?? "battery";
}

/** A sheet must be corrected before export rather than silently dropping labels. */
export function entryPrintIssue(entry: CartEntry, units: SheetUnit[] | undefined): string | null {
  const qr = printsUnits(entry) ? entry.family?.binQrCodeValue : entry.qrCodeValue;
  if (LABEL_KINDS[entryKind(entry)].needsQr && !qr?.trim()) return "This label needs an item QR code.";
  const qrIssue = "This QR code needs wider tape and a matching P-touch layout.";
  if (!printsUnits(entry)) return LABEL_KINDS[entry.kind].needsQr && !fitsBrotherQr(entry.qrCodeValue) ? qrIssue : null;
  if (!units) return "Loading unit numbers…";
  if (selectedUnitNumbers(entry, units).some((n) => !fitsBrotherQr(`${entry.family!.binQrCodeValue}-${n}`))) return qrIssue;
  if (entry.family?.unitScope !== "pick") return null;
  const picked = parseUnitPick(entry.family.unitPick ?? "");
  if (picked.invalid.length > 0) return "Use whole unit numbers and ranges, up to 2,000 units at a time.";
  if (picked.numbers.length === 0) return "Choose at least one unit number.";
  if (unknownPickedNumbers(entry, units).length > 0) return "Remove numbers that are not active units of this family.";
  return null;
}

/** The CSV rows one sheet entry turns into. */
export function entryRows(entry: CartEntry, units: SheetUnit[] | undefined): LabelRow[] {
  if (entryPrintIssue(entry, units)) return [];
  if (printsUnits(entry) && entry.family) {
    return unitTagRows(
      entry.family.binQrCodeValue,
      selectedUnitNumbers(entry, units),
      // One label per unit; the copies stepper belongs to the family label.
      1,
      unitKindOf(entry),
    );
  }
  return [{ ...entry, copies: clampCopies(entry.copies) }];
}

export type UnitsBySku = Record<string, SheetUnit[] | undefined>;

export function sheetRows(cart: CartEntry[], unitsBySku: UnitsBySku): LabelRow[] {
  return KIND_ORDER.flatMap((kind) => cart.filter((entry) => entryKind(entry) === kind).flatMap((entry) => entryRows(entry, entry.family ? unitsBySku[entry.family.skuId] : undefined)));
}

/** Labels a set of rows prints, counting copies and dropping rows the CSV would skip. */
export function printableCount(rows: LabelRow[]): number {
  return rows
    .filter((row) => !LABEL_KINDS[row.kind].needsQr || row.qrCodeValue)
    .reduce((sum, row) => sum + clampCopies(row.copies), 0);
}

/** The P-touch template file, served from public/label-templates. */
export function templateHref(kind: LabelKind): string {
  return `/label-templates/${encodeURIComponent(LABEL_KINDS[kind].template)}`;
}

export type TemplateFile = {
  kind: LabelKind;
  file: string;
  template: string;
  templateHref: string;
  labels: number;
  csv: string;
};

/** One CSV per P-touch template that has at least one printable label, in template order. */
export function templateFiles(rows: LabelRow[]): TemplateFile[] {
  return KIND_ORDER.flatMap((kind) => {
    const kindRows = rows.filter((row) => row.kind === kind);
    const labels = printableCount(kindRows);
    if (labels === 0) return [];
    const { file, template } = LABEL_KINDS[kind];
    return [{ kind, file, template, templateHref: templateHref(kind), labels, csv: buildBrotherCsv(kind, kindRows) }];
  });
}

/** Template an entry lands in, for grouping the sheet. */
export function entryKind(entry: CartEntry): LabelKind {
  return printsUnits(entry) ? unitKindOf(entry) : entry.kind;
}

/** Canonical template order drives display, CSV and the frozen per-copy USB queue. */
export function preparedSheet(cart: CartEntry[], unitsBySku: UnitsBySku) {
  const groups = KIND_ORDER.map((kind) => ({ kind, entries: cart.filter((entry) => entryKind(entry) === kind) })).filter((group) => group.entries.length > 0);
  const rows = sheetRows(cart, unitsBySku);
  const labels: PrintLabel[] = [];
  for (const group of groups) for (const entry of group.entries) {
    for (const [rowIndex, row] of entryRows(entry, entry.family ? unitsBySku[entry.family.skuId] : undefined).entries()) {
      for (let copy = 0; copy < clampCopies(row.copies) && labels.length < MAX_USB_LABELS; copy++) {
        labels.push({ copyId: `${entry.id}:${rowIndex}:${copy}`, entryId: entry.id,
          row: { kind: row.kind, dept: row.dept, model: row.model, number: row.number, qrCodeValue: row.qrCodeValue, copies: 1 },
          ...(printsUnits(entry) ? { unit: { skuId: entry.family!.skuId, number: Number(row.number) } } : {}) });
      }
    }
  }
  return { groups, rows, labels, total: printableCount(rows) };
}
