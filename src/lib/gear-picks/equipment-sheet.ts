import { readFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { HttpError } from "@/lib/http";
import { findGearSku, GEAR_CATALOG, type GearCatalogItem } from "@/lib/gear-picks/catalog";
import type { GearPickAdminParticipant } from "@/lib/gear-picks/types";

/**
 * Fills the equipment department's budget workbook ("Z-Brand Creative") from
 * submitted picks. The template is the department's own sheet, converted once
 * from .xls to .xlsx so styles and formulas survive. Each tab is one cycle
 * ("27-28"); a section row is one item and color, with size counts across the
 * size columns, the same way the department filled earlier tabs by hand.
 */

export const EQUIPMENT_SHEET_TEMPLATE_PATH = path.join(
  process.cwd(),
  "src/lib/gear-picks/templates/equipment-sheet-brand-creative.xlsx",
);

export type EquipmentSheetSectionKey = "SHOES" | "SIDELINE" | "TEAM_CATALOG" | "GOLF";

/** Data rows (1-based) under each section header on a cycle tab. Coaches/Staff issue is left for the department. */
const SECTION_ROWS: Record<EquipmentSheetSectionKey, { first: number; last: number; label: string }> = {
  SHOES: { first: 6, last: 15, label: "Shoe selection" },
  SIDELINE: { first: 17, last: 37, label: "Sideline apparel" },
  TEAM_CATALOG: { first: 39, last: 56, label: "Team catalog" },
  GOLF: { first: 58, last: 70, label: "Golf apparel" },
};

/** Where a section's rows go when it is full. Shoes never spill into apparel size columns. */
const OVERFLOW: Record<EquipmentSheetSectionKey, EquipmentSheetSectionKey[]> = {
  SHOES: [],
  SIDELINE: ["TEAM_CATALOG", "GOLF"],
  TEAM_CATALOG: ["GOLF"],
  GOLF: [],
};

/** Column A..O. Shoes: 6, 6½, 7 … 13. Apparel: XS … 5XL. */
const SHOE_COLUMNS = Array.from({ length: 15 }, (_, index) => String(6 + index / 2));
const APPAREL_COLUMNS = ["XS", "S", "M", "MT", "L", "LT", "XL", "XLT", "2XL", "2XLT", "3XL", "3XLT", "4XL", "4XLT", "5XL"];
const APPAREL_ALIASES: Record<string, string> = { XXL: "2XL", XXXL: "3XL", XXXXL: "4XL" };

export type EquipmentSheetRow = {
  section: EquipmentSheetSectionKey;
  /** Section the row belongs in when it had to move because that section was full. */
  movedFrom: EquipmentSheetSectionKey | null;
  style: string;
  colorCode: string;
  sku: string;
  itemName: string;
  colorLabel: string;
  unitPriceCents: number;
  /** Counts per size column, A..O. */
  sizeCounts: number[];
  /** Sizes with no column on the sheet (waist, fitted caps, women's or catalog shoe sizes, OSFA). */
  otherSizes: { size: string; quantity: number }[];
  quantity: number;
};

export type EquipmentSheetPlan = {
  rows: EquipmentSheetRow[];
  submittedCount: number;
  totalCents: number;
};

function sectionForItem(item: GearCatalogItem | null, category: string | null): EquipmentSheetSectionKey {
  const resolvedCategory = item?.category ?? category;
  if (resolvedCategory === "Footwear") return "SHOES";
  if (item?.collection === "sideline" || resolvedCategory === "Headwear") return "SIDELINE";
  return "TEAM_CATALOG";
}

/** The department writes the fit before the name ("W UA Transit Wrap"); unisex items stay bare. */
function sheetItemName(item: GearCatalogItem | null, fallback: string) {
  const name = item?.name ?? fallback;
  if (!item || item.fit === "UNISEX") return name;
  const prefix = item.fit === "WOMEN" ? "W" : "M";
  const bare = name.replace(/^(?:W|M|Women's|Men's)\s+/, "");
  return `${prefix} ${bare}`;
}

/** Index of the size column, or -1 when the sheet has no column for it. */
function sizeColumn(section: EquipmentSheetSectionKey, item: GearCatalogItem | null, size: string) {
  if (section === "SHOES") {
    // Columns are men's sizes. Women's and catalog sizes are never converted.
    if (item?.shoeSizeSystem !== "US_MENS") return -1;
    const numeric = Number(size);
    return Number.isFinite(numeric) ? SHOE_COLUMNS.indexOf(String(numeric)) : -1;
  }
  const normalized = size.trim().toUpperCase();
  return APPAREL_COLUMNS.indexOf(APPAREL_ALIASES[normalized] ?? normalized);
}

function otherSizeLabel(item: GearCatalogItem | null, size: string) {
  if (item?.shoeSizeSystem === "US_WOMENS") return `W ${size}`;
  return size;
}

const SECTION_ORDER: EquipmentSheetSectionKey[] = ["SHOES", "SIDELINE", "TEAM_CATALOG", "GOLF"];

/** Groups submitted lines by item, color, and price, then places each group on a section row. */
export function planEquipmentSheet(participants: GearPickAdminParticipant[]): EquipmentSheetPlan {
  const categoryOrder = new Map(GEAR_CATALOG.categories.map((category, index) => [category, index]));
  const groups = new Map<string, EquipmentSheetRow & { category: string | null }>();
  let submittedCount = 0;
  let totalCents = 0;

  for (const participant of participants) {
    // Only submitted picks go to the order sheet; drafts stay out, as in the CSV.
    if (!participant.submission?.submittedAt) continue;
    submittedCount += 1;
    for (const line of participant.submission.lines) {
      const item = findGearSku(line.sku)?.item ?? null;
      const section = sectionForItem(item, line.category);
      const key = `${line.sku}|${line.unitPriceCents}`;
      let row = groups.get(key);
      if (!row) {
        row = {
          section,
          movedFrom: null,
          style: line.style,
          colorCode: line.colorCode,
          sku: line.sku,
          itemName: sheetItemName(item, line.itemName),
          colorLabel: line.colorLabel,
          unitPriceCents: line.unitPriceCents,
          sizeCounts: Array(15).fill(0),
          otherSizes: [],
          quantity: 0,
          category: item?.category ?? line.category,
        };
        groups.set(key, row);
      }
      const size = line.size?.trim() || "OSFA";
      const column = sizeColumn(section, item, size);
      if (column >= 0) {
        row.sizeCounts[column] = (row.sizeCounts[column] ?? 0) + line.quantity;
      } else {
        const label = otherSizeLabel(item, size);
        const existing = row.otherSizes.find((entry) => entry.size === label);
        if (existing) existing.quantity += line.quantity;
        else row.otherSizes.push({ size: label, quantity: line.quantity });
      }
      row.quantity += line.quantity;
      totalCents += line.lineTotalCents;
    }
  }

  const sorted = [...groups.values()].sort(
    (a, b) =>
      SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section)
      || (categoryOrder.get(a.category ?? "") ?? 99) - (categoryOrder.get(b.category ?? "") ?? 99)
      || a.itemName.localeCompare(b.itemName)
      || a.colorLabel.localeCompare(b.colorLabel),
  );
  const rows: EquipmentSheetRow[] = sorted.map((group) => {
    const { category, ...row } = group;
    void category;
    row.otherSizes.sort((a, b) => a.size.localeCompare(b.size, undefined, { numeric: true }));
    return row;
  });
  return { rows, submittedCount, totalCents };
}

/** "2027-28" → "27-28", the department's tab name. */
export function equipmentSheetTabName(cycleId: string) {
  const match = /^20(\d{2})-(\d{2})$/.exec(cycleId);
  if (!match) throw new Error(`Unexpected gear pick cycle id: ${cycleId}`);
  return `${match[1]}-${match[2]}`;
}

function equipmentSheetTitle(cycleId: string) {
  const [start, end] = equipmentSheetTabName(cycleId).split("-");
  return `20${start}-20${end} Equipment Budget`;
}

/** ExcelJS takes an ArrayBuffer; Node file reads return a Buffer view. */
export function toArrayBuffer(buffer: Uint8Array) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

const SIZE_COLUMN_LETTERS = "ABCDEFGHIJKLMNO".split("");
const DATA_COLUMN_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWX".split("");

/** A row is free when columns A..X hold no typed value (formulas don't count). Template notes like "Talls may or may not be available" sit on some rows. */
function isFreeRow(sheet: ExcelJS.Worksheet, rowNumber: number) {
  return DATA_COLUMN_LETTERS.every((letter) => {
    const cell = sheet.getCell(`${letter}${rowNumber}`);
    if (cell.isMerged && cell.master.address !== cell.address) return false;
    const value = cell.value;
    if (value === null || value === undefined || value === "") return true;
    // Row 7's Total cell holds a typed 0 where its neighbors have the formula.
    if (value === 0 && (letter === "P" || letter === "W")) return true;
    return typeof value === "object" && ("formula" in value || "sharedFormula" in value);
  });
}

function freeRows(sheet: ExcelJS.Worksheet) {
  const free = {} as Record<EquipmentSheetSectionKey, number[]>;
  for (const key of SECTION_ORDER) {
    const { first, last } = SECTION_ROWS[key];
    free[key] = [];
    for (let row = first; row <= last; row += 1) {
      if (isFreeRow(sheet, row)) free[key].push(row);
    }
  }
  return free;
}

function writeRow(sheet: ExcelJS.Worksheet, rowNumber: number, row: EquipmentSheetRow) {
  const isShoe = row.section === "SHOES";
  row.sizeCounts.forEach((count, index) => {
    sheet.getCell(`${SIZE_COLUMN_LETTERS[index]}${rowNumber}`).value = count > 0 ? count : null;
  });
  sheet.getCell(`P${rowNumber}`).value = { formula: `SUM(A${rowNumber}:O${rowNumber})` };
  // Shoe rows: Q is notes and S is the stock #. Apparel rows: Q is Styles # and S is Color #.
  sheet.getCell(`Q${rowNumber}`).value = isShoe ? null : row.style;
  sheet.getCell(`R${rowNumber}`).value = row.itemName;
  sheet.getCell(`S${rowNumber}`).value = isShoe ? row.sku : row.colorCode;
  sheet.getCell(`T${rowNumber}`).value = row.colorLabel;
  sheet.getCell(`U${rowNumber}`).value = row.unitPriceCents / 100;
  sheet.getCell(`V${rowNumber}`).value = row.quantity;
  sheet.getCell(`W${rowNumber}`).value = { formula: `SUM(U${rowNumber}*V${rowNumber})` };
  const notes = [
    row.otherSizes.map((entry) => `${entry.size} ×${entry.quantity}`).join(", "),
    row.movedFrom ? `${SECTION_ROWS[row.movedFrom].label} (section full)` : "",
  ].filter(Boolean);
  sheet.getCell(`X${rowNumber}`).value = notes.length ? notes.join("; ") : null;
}

/** Places each planned row in its section, spilling into the overflow sections when a section is full. */
export function assignEquipmentSheetRows(plan: EquipmentSheetPlan, free: Record<EquipmentSheetSectionKey, number[]>) {
  const remaining = Object.fromEntries(
    SECTION_ORDER.map((key) => [key, [...free[key]]]),
  ) as Record<EquipmentSheetSectionKey, number[]>;
  return plan.rows.map((row) => {
    for (const section of [row.section, ...OVERFLOW[row.section]]) {
      const rowNumber = remaining[section].shift();
      if (rowNumber !== undefined) {
        return {
          rowNumber,
          row: section === row.section ? row : { ...row, section, movedFrom: row.section },
        };
      }
    }
    throw new HttpError(
      422,
      `The equipment sheet has no room left for ${SECTION_ROWS[row.section].label.toLowerCase()}. Use Export CSV instead.`,
    );
  });
}

export type EquipmentSheetResult = {
  buffer: Buffer;
  rowCount: number;
  movedCount: number;
};

/** Fills a copy of the template's cycle tab and returns the workbook. The template file itself is never changed. */
export async function buildEquipmentSheet(
  plan: EquipmentSheetPlan,
  cycleId: string,
): Promise<EquipmentSheetResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(toArrayBuffer(await readFile(EQUIPMENT_SHEET_TEMPLATE_PATH)));
  const tabName = equipmentSheetTabName(cycleId);
  const sheet = workbook.getWorksheet(tabName);
  if (!sheet) throw new HttpError(500, `The equipment sheet template has no "${tabName}" tab.`);

  const placements = assignEquipmentSheetRows(plan, freeRows(sheet));
  for (const { rowNumber, row } of placements) writeRow(sheet, rowNumber, row);

  // The department's tab title had a typo ("2027-2078").
  sheet.getCell("R1").value = equipmentSheetTitle(cycleId);

  const tabIndex = workbook.worksheets.indexOf(sheet);
  workbook.views = [{ x: 0, y: 0, width: 20000, height: 12000, firstSheet: 0, activeTab: tabIndex, visibility: "visible" }];
  workbook.calcProperties = { fullCalcOnLoad: true };

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return {
    buffer,
    rowCount: placements.length,
    movedCount: placements.filter(({ row }) => row.movedFrom).length,
  };
}
