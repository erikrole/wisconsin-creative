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
  /**
   * What a line with a budget, nothing spent and no Status of its own becomes: still planned, dropped, or bought at
   * the planned amount (older years only list what was bought, with the price). */
  unboughtAs: "PLANNED" | "CANCELLED" | "PURCHASED";
  /** Today as YYYY-MM-DD (for tests). A month written without a year never lands in the future. Defaults to the real date. */
  today?: string;
};

const COLUMN_NAMES: Record<string, string[]> = {
  description: ["line", "item", "description", "name", "product", "expense"],
  category: ["category", "expense category", "type", "account"],
  supplier: ["supplier", "supplier name id", "vendor", "store", "source"],
  quantity: ["qty", "quantity", "count", "units"],
  boughtQuantity: ["quantity bought", "qty bought", "bought qty"],
  each: ["each", "unit", "unit cost", "unit price", "price", "price per unit", "cost each", "per unit"],
  budgeted: ["budgeted", "total budgeted", "budget", "planned", "plan", "amount budgeted", "estimated", "estimate", "total"],
  spent: ["spent", "actual", "actual cost", "total spent", "paid", "cost", "amount spent"],
  date: ["ordered", "order date", "date", "purchased", "purchase date", "month", "month purchased", "date ordered"],
  status: ["status", "state"],
  // Older years tick a checkbox column instead of keeping a status.
  boughtFlag: ["p", "bought"],
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

function readStatus(text: string): BudgetLineStatusValue | null {
  const value = text.trim().toLowerCase();
  if (!value) return null;
  if (value.startsWith("cancel") || value === "dropped") return "CANCELLED";
  if (value.startsWith("order")) return "ORDERED";
  if (value.startsWith("purchas") || value === "bought" || value === "paid") return "PURCHASED";
  if (value.startsWith("plan")) return "PLANNED";
  return null;
}

/** A checkbox column: true when ticked, false when present but empty-ticked, null when the cell is blank. */
function readFlag(text: string): boolean | null {
  const value = text.trim().toLowerCase();
  if (!value) return null;
  return ["true", "yes", "y", "x", "1", "✓"].includes(value);
}

/** A repeated header further down means a second table (the category summary) starts here. */
function looksLikeHeader(row: string[]): boolean {
  const first = normalize(row.find((value) => value && value.trim()) ?? "");
  return first === "category" || first === "expense category";
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
export function parseSheetDate(value: string, fiscalYear: string, today = new Date().toISOString().slice(0, 10)): { date: string; guessed: boolean } | null {
  // A month dropdown that allows several picks reads "MAY, JUNE"; the first one is when it started.
  const text = value.split(",")[0]!.trim();
  if (!text) return null;
  const startYear = Number(fiscalYear.slice(0, 4));
  // A tab for the coming year often lists purchases made before it starts ("MAY" on the 26-27 tab is May 2026).
  const fiscalYearFor = (month: number, day = 1) => {
    const year = month >= 7 ? startYear : startYear + 1;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` > today ? year - 1 : year;
  };
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
    return { date: `${fiscalYearFor(month, Number(m[2]))}-${pad(month)}-${pad(Number(m[2]))}`, guessed: true };
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

  let blankRun = 0;
  for (let i = headerRow + 1; i < rows.length; i += 1) {
    const row = rows[i]!;
    if (row.every((value) => !value || !value.trim())) {
      blankRun += 1;
      // Two empty rows end the list: what follows is a summary table (Category, Budgeted, Purchased, Remaining), not purchases.
      if (blankRun >= 2) break;
      continue;
    }
    blankRun = 0;
    if (looksLikeHeader(row)) break;
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
    let quantity = /^\d+$/.test(quantityRaw) && Number(quantityRaw) >= 1 ? Number(quantityRaw) : 1;
    const each = parseMoney(cell(row, "each"));
    const budgetedRaw = cell(row, "budgeted");
    let budgeted = parseMoney(budgetedRaw);
    const spent = parseMoney(cell(row, "spent"));
    const notes: string[] = [];
    let planGuessed = false;
    // A sheet with a budget column that is empty or $0 on a row that was still bought is a late addition, not a plan
    // of price x quantity. Text like "X" in that column is treated as "no figure", so the row falls back to the price.
    const blankPlan = cols.budgeted !== undefined && (budgetedRaw === "" || budgeted === 0);
    const lateAddition = blankPlan && spent !== null && spent > 0;
    if (lateAddition) {
      budgeted = null;
      const boughtRaw = cell(row, "boughtQuantity");
      if (/^\d+$/.test(boughtRaw) && Number(boughtRaw) >= 1) quantity = Number(boughtRaw);
    } else if ((budgeted === null || budgeted === 0) && each !== null) {
      budgeted = each * quantity;
      if (blankPlan) {
        planGuessed = true;
        notes.push("Budget was blank or $0. Using price x quantity.");
      }
    }
    const unitCostCents = budgeted !== null ? (each ?? Math.round(budgeted / quantity)) : each ?? Math.round((spent ?? 0) / quantity);

    const when = parseSheetDate(cell(row, "date"), options.fiscalYear, options.today);
    if (when?.guessed) notes.push(`Date read as ${when.date.slice(0, 7)}`);

    if (budgeted === null && spent === null) {
      candidates.push(skipped("No amounts on this row"));
      continue;
    }

    const sheetStatus = readStatus(cell(row, "status"));
    const flag = readFlag(cell(row, "boughtFlag"));

    let result: ImportResult = planGuessed ? "check" : "ready";
    let status: BudgetLineStatusValue;
    let spentCents: number | null = spent !== null && spent >= 0 ? spent : null;
    let unplanned = false;
    if (budgeted === null) {
      unplanned = true;
      result = "check";
      status = sheetStatus === "ORDERED" ? "ORDERED" : "PURCHASED";
      notes.push("No budgeted amount. Imports as Unplanned.");
    } else if (sheetStatus === "CANCELLED") {
      status = "CANCELLED";
      spentCents = null;
    } else if (spentCents !== null) {
      status = sheetStatus === "ORDERED" ? "ORDERED" : "PURCHASED";
      if (spentCents === 0 && budgeted > 0 && status === "PURCHASED") {
        result = "check";
        notes.push("Marked bought with $0 spent.");
      }
    } else if (sheetStatus === "ORDERED") {
      status = "ORDERED";
    } else if (sheetStatus === "PLANNED") {
      status = "PLANNED";
    } else if (sheetStatus === "PURCHASED" || flag === true) {
      status = "PURCHASED";
      spentCents = budgeted;
      result = "check";
      notes.push("Marked bought with no amount spent. Using the planned amount.");
    } else if (options.unboughtAs === "PURCHASED" && flag === null) {
      status = "PURCHASED";
      spentCents = budgeted;
      notes.push("Taken as bought at the planned amount.");
    } else {
      status = options.unboughtAs === "PURCHASED" ? "PLANNED" : options.unboughtAs;
      if (status === "CANCELLED") {
        result = "check";
        notes.push("Never bought. Imports as Dropped.");
      }
    }

    candidates.push({
      ...base,
      result,
      note: notes.join(" ") || (status === "CANCELLED" ? "Dropped in the sheet" : spentCents !== null ? "Ready" : "Planned, not bought yet"),
      status,
      quantity,
      unitCostCents,
      budgetedCents: unplanned ? null : budgeted,
      spentCents,
      purchasedOn: when?.date ?? null,
      unplanned,
    });
  }
  return { candidates, headerRow, problem: null };
}

/**
 * Which tab of a workbook to suggest. The department keeps one tab per year ("26-27") and a football twin ("FB 26-27",
 * "FB:25-26"), so a tab matches when it carries the fiscal year's short form and agrees on football. Only tabs with a
 * readable header are candidates; null when none is usable.
 */
export function suggestSheet(sheets: { name: string; usable: boolean }[], budgetName: string, fiscalYear: string): string | null {
  const usable = sheets.filter((sheet) => sheet.usable);
  if (usable.length === 0) return null;
  const start = Number(fiscalYear.slice(2, 4));
  const short = `${String(start).padStart(2, "0")}-${String(start + 1).padStart(2, "0")}`;
  const wantsFootball = /football|\bfb\b/i.test(budgetName);
  const score = (name: string) => {
    const compact = name.toLowerCase().replace(/[\s:_]+/g, "");
    const isFootball = compact.startsWith("fb") || compact.includes("football");
    return (compact.includes(short) ? 2 : 0) + (isFootball === wantsFootball ? 1 : 0);
  };
  return [...usable].sort((a, b) => score(b.name) - score(a.name))[0]!.name;
}
