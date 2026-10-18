import { BUDGET_CATEGORIES, BUDGET_CATEGORY_LABELS, parseDollarsToCents, type BudgetCategoryValue, type BudgetLineStatusValue } from "@/lib/budget/contract";

/**
 * Reads a budget sheet (rows of text) into candidate lines for a preview. Pure: no files, no database.
 * Headers are matched by name so the department's column order doesn't matter.
 */

export type ImportResult = "ready" | "check" | "skipped";

export type ImportCandidate = {
  /** 1-based sheet row, as the person sees it. */
  row: number;
  result: ImportResult;
  note: string;
  description: string;
  category: BudgetCategoryValue;
  status: BudgetLineStatusValue;
  supplier: string | null;
  quantity: number;
  unitCostCents: number;
  /** Planned total in cents (unit x quantity); null for an unplanned line. */
  budgetedCents: number | null;
  spentCents: number | null;
  purchasedOn: string | null;
  poNumber: string | null;
  orderNumber: string | null;
  unplanned: boolean;
};

export type ImportOptions = {
  /** Stored fiscal year like "2025-26"; month-only dates are placed inside it. */
  fiscalYear: string;
  /** What a line with a budget but nothing spent becomes: still planned, or dropped (the usual answer for past years). */
  unboughtAs: "PLANNED" | "CANCELLED";
};

const COLUMN_NAMES: Record<string, string[]> = {
  description: ["line", "item", "description", "name", "product", "expense"],
  category: ["category", "type", "account"],
  supplier: ["supplier", "vendor", "store", "source"],
  quantity: ["qty", "quantity", "count", "units"],
  each: ["each", "unit", "unit cost", "unit price", "price", "cost each", "per unit"],
  budgeted: ["budgeted", "budget", "planned", "plan", "amount budgeted", "estimated", "estimate"],
  spent: ["spent", "actual", "actual cost", "total spent", "paid", "cost", "amount spent"],
  date: ["ordered", "order date", "date", "purchased", "purchase date", "month", "date ordered"],
  po: ["po", "po number", "po #", "po no", "purchase order"],
  order: ["order", "order number", "order #", "order no", "confirmation"],
};

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9# ]+/g, " ").replace(/\s+/g, " ").trim();

const MONTH_INDEX: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

/** Which column index holds each field, from the header row; first match wins. */
export function mapHeaders(headers: string[]): Partial<Record<keyof typeof COLUMN_NAMES, number>> {
  const mapped: Partial<Record<keyof typeof COLUMN_NAMES, number>> = {};
  const used = new Set<number>();
  // Longer, more specific names first so "order date" isn't taken as "order".
  const entries = Object.entries(COLUMN_NAMES).flatMap(([field, names]) => names.map((name) => ({ field, name })));
  entries.sort((a, b) => b.name.length - a.name.length);
  const cleaned = headers.map(normalize);
  for (const { field, name } of entries) {
    if (mapped[field] !== undefined) continue;
    const index = cleaned.findIndex((header, i) => header === name && !used.has(i));
    if (index >= 0) {
      mapped[field] = index;
      used.add(index);
    }
  }
  return mapped;
}

/** The first row that names at least a line column and one money column. */
export function findHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 15); i += 1) {
    const mapped = mapHeaders(rows[i] ?? []);
    if (mapped.description !== undefined && (mapped.budgeted !== undefined || mapped.each !== undefined || mapped.spent !== undefined)) return i;
  }
  return -1;
}

/** "$1,299.50", "1299", "(50.00)" -> cents; null when empty or not money. */
export function parseMoney(value: string): number | null {
  const text = value.trim();
  if (!text || text === "-" || text === "—") return null;
  const negative = /^\(.*\)$/.test(text) || text.startsWith("-");
  const cents = parseDollarsToCents(text.replace(/^[(-]+|[)]+$/g, ""));
  if (cents === null) return null;
  return negative ? -cents : cents;
}

/**
 * A date from a cell: ISO, "5/28/2026", "May 28", "Jun 2025", or a bare month name. Month names with no
 * year land in the fiscal year (Jul to Dec are the first calendar year, Jan to Jun the second).
 */
export function parseSheetDate(value: string, fiscalYear: string): { date: string; guessed: boolean } | null {
  const text = value.trim();
  if (!text) return null;
  const startYear = Number(fiscalYear.slice(0, 4));
  const fiscalYearFor = (month: number) => (month >= 7 ? startYear : startYear + 1);
  const pad = (n: number) => String(n).padStart(2, "0");

  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, guessed: false };
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(text);
  if (m) {
    const year = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return { date: `${year}-${pad(Number(m[1]))}-${pad(Number(m[2]))}`, guessed: false };
  }
  m = /^([a-z]+)\.?\s+(\d{4})$/i.exec(text);
  if (m && MONTH_INDEX[m[1]!.slice(0, 3).toLowerCase()]) {
    const month = MONTH_INDEX[m[1]!.slice(0, 3).toLowerCase()]!;
    return { date: `${m[2]}-${pad(month)}-01`, guessed: true };
  }
  m = /^([a-z]+)\.?\s+(\d{1,2})$/i.exec(text);
  if (m && MONTH_INDEX[m[1]!.slice(0, 3).toLowerCase()]) {
    const month = MONTH_INDEX[m[1]!.slice(0, 3).toLowerCase()]!;
    return { date: `${fiscalYearFor(month)}-${pad(month)}-${pad(Number(m[2]))}`, guessed: true };
  }
  m = /^([a-z]+)\.?$/i.exec(text);
  if (m && MONTH_INDEX[m[1]!.slice(0, 3).toLowerCase()]) {
    const month = MONTH_INDEX[m[1]!.slice(0, 3).toLowerCase()]!;
    return { date: `${fiscalYearFor(month)}-${pad(month)}-01`, guessed: true };
  }
  return null;
}

function matchCategory(text: string, fallback: BudgetCategoryValue): BudgetCategoryValue {
  const wanted = normalize(text);
  if (!wanted) return fallback;
  for (const value of BUDGET_CATEGORIES) {
    if (normalize(BUDGET_CATEGORY_LABELS[value]) === wanted || normalize(value.replace(/_/g, " ")) === wanted) return value;
  }
  for (const value of BUDGET_CATEGORIES) {
    const label = normalize(BUDGET_CATEGORY_LABELS[value]);
    if (label.includes(wanted) || wanted.includes(label)) return value;
  }
  return fallback;
}

export function parseBudgetSheet(rows: string[][], options: ImportOptions): { candidates: ImportCandidate[]; headerRow: number; problem: string | null } {
  const headerRow = findHeaderRow(rows);
  if (headerRow < 0) {
    return { candidates: [], headerRow, problem: "Couldn't find a header row. The sheet needs a Line (or Item) column and a Budgeted, Each, or Spent column." };
  }
  const cols = mapHeaders(rows[headerRow]!);
  const cell = (row: string[], key: string) => (cols[key] === undefined ? "" : (row[cols[key]!] ?? "").trim());
  const candidates: ImportCandidate[] = [];

  for (let i = headerRow + 1; i < rows.length; i += 1) {
    const row = rows[i]!;
    if (row.every((value) => !value || !value.trim())) continue;
    const description = cell(row, "description");
    const base = {
      row: i + 1,
      description,
      category: matchCategory(cell(row, "category"), "EQUIPMENT"),
      supplier: cell(row, "supplier") || null,
      poNumber: cell(row, "po") || null,
      orderNumber: cell(row, "order") || null,
    };
    const skipped = (note: string): ImportCandidate => ({
      ...base,
      result: "skipped",
      note,
      status: "PLANNED",
      quantity: 1,
      unitCostCents: 0,
      budgetedCents: null,
      spentCents: null,
      purchasedOn: null,
      unplanned: false,
    });

    if (!description) {
      candidates.push(skipped("No line name"));
      continue;
    }
    if (/^(grand\s+)?(sub)?totals?\b/i.test(description)) {
      candidates.push(skipped("Totals row, not a purchase"));
      continue;
    }

    const quantityRaw = cell(row, "quantity");
    const quantity = /^\d+$/.test(quantityRaw) && Number(quantityRaw) >= 1 ? Number(quantityRaw) : 1;
    const each = parseMoney(cell(row, "each"));
    let budgeted = parseMoney(cell(row, "budgeted"));
    const spent = parseMoney(cell(row, "spent"));
    if (budgeted === null && each !== null) budgeted = each * quantity;
    const unitCostCents = budgeted !== null ? (each ?? Math.round(budgeted / quantity)) : 0;

    const when = parseSheetDate(cell(row, "date"), options.fiscalYear);
    const notes: string[] = [];
    if (when?.guessed) notes.push(`Date read as ${when.date.slice(0, 7)}`);

    if (budgeted === null && spent === null) {
      candidates.push(skipped("No amounts on this row"));
      continue;
    }

    let result: ImportResult = "ready";
    let status: BudgetLineStatusValue = "PURCHASED";
    let unplanned = false;
    if (budgeted === null) {
      unplanned = true;
      result = "check";
      notes.push("No budgeted amount. Imports as Unplanned.");
    } else if (spent === null) {
      status = options.unboughtAs;
      if (options.unboughtAs === "CANCELLED") {
        result = "check";
        notes.push("Never bought. Imports as Dropped.");
      }
    }

    candidates.push({
      ...base,
      result,
      note: notes.join(" ") || (spent !== null ? "Ready" : "Planned, not bought yet"),
      status,
      quantity,
      unitCostCents,
      budgetedCents: unplanned ? null : budgeted,
      spentCents: spent !== null && spent >= 0 ? spent : null,
      purchasedOn: when?.date ?? null,
      unplanned,
    });
  }
  return { candidates, headerRow, problem: null };
}
