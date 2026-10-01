/**
 * Minimal RFC 4180 CSV parser for spreadsheet exports (Google Sheets, PageUp).
 * Handles quoted fields, escaped quotes, embedded newlines, CRLF, and a BOM.
 */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/** Header cell to a comparable key: lowercase, punctuation collapsed. */
export function headerKey(value: string): string {
  return value
    .replace(/[‎‏‪-‮⁦-⁩]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function parseBoolean(value: string | undefined): boolean | null {
  const v = (value ?? "").trim().toLowerCase();
  if (["true", "yes", "y", "1"].includes(v)) return true;
  if (["false", "no", "n", "0"].includes(v)) return false;
  return null;
}

/** Split multi-value cells on commas, semicolons, and slashes ("Video / Photography"). */
export function splitList(value: string | undefined): string[] {
  return [...new Set((value ?? "").split(/[,;/]/).map((s) => s.trim()).filter((s) => s && s.toLowerCase() !== "none listed"))];
}
