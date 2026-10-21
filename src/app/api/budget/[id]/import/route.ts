import ExcelJS from "exceljs";
import { withAuth } from "@/lib/api";
import { findHeaderRow, parseBudgetSheet, suggestSheet } from "@/lib/budget/import";
import { importLinesSchema } from "@/lib/budget/schemas";
import { HttpError, ok } from "@/lib/http";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";
import { getBudgetDetail, importLines } from "@/lib/services/budget";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 2000;

/** A cell as the person sees it: dates as ISO, formulas as their result, rich text flattened. */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
    if ("richText" in value) return value.richText.map((part) => part.text).join("");
    if ("text" in value) return String(value.text);
    return "";
  }
  return String(value);
}

type Sheet = { name: string; rows: string[][] };

async function readWorkbook(file: File): Promise<Sheet[]> {
  const name = file.name.toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = new ExcelJS.Workbook();
  if (name.endsWith(".csv")) {
    const { Readable } = await import("node:stream");
    await workbook.csv.read(Readable.from(buffer));
  } else if (name.endsWith(".xlsx")) {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } else {
    throw new HttpError(400, "Upload an .xlsx or .csv file.");
  }
  if (workbook.worksheets.length === 0) throw new HttpError(400, "That file has no sheets.");
  return workbook.worksheets
    .filter((sheet) => sheet.state === "visible")
    .map((sheet) => {
      const rows: string[][] = [];
      if (sheet.rowCount <= MAX_ROWS) {
        sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
          const cells: string[] = [];
          row.eachCell({ includeEmpty: true }, (cell, col) => {
            cells[col - 1] = cellText(cell.value);
          });
          rows[rowNumber - 1] = Array.from(cells, (value) => value ?? "");
        });
      }
      return { name: sheet.name, rows: Array.from(rows, (row) => row ?? []) };
    });
}

/**
 * Preview: upload a sheet (multipart `file`, optional `sheet` tab name and `unboughtAs`) and get candidate lines back.
 * A workbook with several tabs answers with the tab list and a suggested tab. Saves nothing.
 */
export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "budget", "manage");
  await enforceRateLimit(`budget:mutate:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Choose a file to import.");
  if (file.size > MAX_BYTES) throw new HttpError(400, "That file is over 2 MB.");
  const unboughtRaw = form.get("unboughtAs");
  const unboughtAs = unboughtRaw === "PLANNED" || unboughtRaw === "PURCHASED" ? unboughtRaw : "CANCELLED";
  const { budget } = await getBudgetDetail(params.id);
  const sheets = await readWorkbook(file);
  const summaries = sheets.map((sheet) => ({ name: sheet.name, usable: findHeaderRow(sheet.rows) >= 0 }));
  const requested = form.get("sheet");
  const chosen =
    typeof requested === "string" && summaries.some((sheet) => sheet.name === requested)
      ? requested
      : suggestSheet(summaries, budget.name, budget.fiscalYear);
  const sheet = sheets.find((candidate) => candidate.name === chosen);
  if (!sheet) throw new HttpError(400, "Couldn't find a tab with a header row. The sheet needs a Line (or Item) column and a Budgeted, Each, or Spent column.");
  const { candidates, problem } = parseBudgetSheet(sheet.rows, { fiscalYear: budget.fiscalYear, unboughtAs });
  if (problem) throw new HttpError(400, problem);
  return ok({ data: { fileName: file.name, sheet: sheet.name, sheets: summaries, candidates } });
});

/** Commit: save the lines the person reviewed. */
export const PUT = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "budget", "manage");
  await enforceRateLimit(`budget:mutate:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const input = importLinesSchema.parse(await req.json());
  return ok({ data: await importLines(user, params.id, input) });
});
