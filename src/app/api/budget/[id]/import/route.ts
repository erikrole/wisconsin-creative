import ExcelJS from "exceljs";
import { withAuth } from "@/lib/api";
import { parseBudgetSheet } from "@/lib/budget/import";
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

async function readRows(file: File): Promise<string[][]> {
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
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new HttpError(400, "That file has no sheets.");
  if (sheet.rowCount > MAX_ROWS) throw new HttpError(400, `That sheet has more than ${MAX_ROWS} rows. Import one year at a time.`);
  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cells[col - 1] = cellText(cell.value);
    });
    rows[rowNumber - 1] = Array.from(cells, (value) => value ?? "");
  });
  return Array.from(rows, (row) => row ?? []);
}

/** Preview: upload a sheet (multipart `file`, optional `unboughtAs`) and get candidate lines back. Saves nothing. */
export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "budget", "manage");
  await enforceRateLimit(`budget:mutate:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Choose a file to import.");
  if (file.size > MAX_BYTES) throw new HttpError(400, "That file is over 2 MB.");
  const unboughtAs = form.get("unboughtAs") === "PLANNED" ? "PLANNED" : "CANCELLED";
  const { budget } = await getBudgetDetail(params.id);
  const rows = await readRows(file);
  const { candidates, problem } = parseBudgetSheet(rows, { fiscalYear: budget.fiscalYear, unboughtAs });
  if (problem) throw new HttpError(400, problem);
  return ok({ data: { fileName: file.name, candidates } });
});

/** Commit: save the lines the person reviewed. */
export const PUT = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "budget", "manage");
  await enforceRateLimit(`budget:mutate:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const input = importLinesSchema.parse(await req.json());
  return ok({ data: await importLines(user, params.id, input) });
});
