import {
  LABEL_KINDS,
  buildBrotherCsv,
  parseAssetTag,
  unitTagRows,
  type LabelKind,
  type LabelRow,
} from "@/lib/brother-label-csv";

/** Most labels one sheet entry can ask for; a typo should not queue 10,000 prints. */
export const MAX_COPIES = 500;

/** How an item family prints. Serialized items never carry this. */
export type FamilySource = {
  skuId: string;
  binQrCodeValue: string;
  trackByNumber: boolean;
  onHand: number;
  /** Numbered families print either the one family label or a label for each unit. */
  mode: "family" | "units";
  /** Units only: labels not printed yet, or every active unit for a reprint. */
  unitScope: "unprinted" | "all";
};

/** One line on the print sheet, editable before export. */
export type CartEntry = LabelRow & {
  id: string;
  title: string;
  name: string;
  primaryScanCode?: string;
  family?: FamilySource;
};

export type SheetUnit = {
  unitNumber: number;
  status: string;
  labelPrintedAt: string | null;
};

export const KIND_ORDER = Object.keys(LABEL_KINDS) as LabelKind[];

/** Lenses and SD cards get their own templates; everything else prints as a body label. */
export function kindForCategory(category: string | null | undefined): LabelKind {
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
  return {
    id: item.id,
    title: item.title,
    name: item.name,
    primaryScanCode: item.primaryScanCode,
    kind: kindForCategory(item.category),
    ...parseAssetTag(item.title),
    qrCodeValue: item.qrCodeValue,
    copies: 1,
  };
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
    qrCodeValue: family.binQrCodeValue,
    copies: 1,
    family: {
      skuId: family.id,
      binQrCodeValue: family.binQrCodeValue,
      trackByNumber: family.trackByNumber,
      onHand: family.onHandQuantity,
      mode: "family",
      unitScope: "unprinted",
    },
  };
}

export function printsUnits(entry: CartEntry): boolean {
  return Boolean(entry.family?.trackByNumber && entry.family.mode === "units");
}

/** Unit numbers an entry prints in units mode. Retired units never get new labels. */
export function selectedUnitNumbers(entry: CartEntry, units: SheetUnit[] | undefined): number[] {
  if (!units || !printsUnits(entry)) return [];
  return units
    .filter((unit) => unit.status !== "RETIRED")
    .filter((unit) => entry.family?.unitScope === "all" || !unit.labelPrintedAt)
    .map((unit) => unit.unitNumber)
    .sort((a, b) => a - b);
}

/** The CSV rows one sheet entry turns into. */
export function entryRows(entry: CartEntry, units: SheetUnit[] | undefined): LabelRow[] {
  if (printsUnits(entry) && entry.family) {
    return unitTagRows(entry.family.binQrCodeValue, selectedUnitNumbers(entry, units), clampCopies(entry.copies));
  }
  return [{ ...entry, copies: clampCopies(entry.copies) }];
}

export type UnitsBySku = Record<string, SheetUnit[] | undefined>;

export function sheetRows(cart: CartEntry[], unitsBySku: UnitsBySku): LabelRow[] {
  return cart.flatMap((entry) => entryRows(entry, entry.family ? unitsBySku[entry.family.skuId] : undefined));
}

/** Labels a set of rows prints, counting copies and dropping rows the CSV would skip. */
export function printableCount(rows: LabelRow[]): number {
  return rows
    .filter((row) => !LABEL_KINDS[row.kind].needsQr || row.qrCodeValue)
    .reduce((sum, row) => sum + clampCopies(row.copies), 0);
}

export type TemplateFile = {
  kind: LabelKind;
  file: string;
  template: string;
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
    return [{ kind, file, template, labels, csv: buildBrotherCsv(kind, kindRows) }];
  });
}

/** Template an entry lands in, for grouping the sheet. Unit labels always print as Number Tags. */
export function entryKind(entry: CartEntry): LabelKind {
  return printsUnits(entry) ? "numberTag" : entry.kind;
}
