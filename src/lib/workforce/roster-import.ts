import { GraduationTerm, ShiftArea } from "@prisma/client";
import { normalizeEmail, parseTermLabel } from "@/lib/hiring/contract";
import { headerKey, parseCsv } from "@/lib/hiring/csv";
import { mapArea } from "@/lib/hiring/import";
import { isSportCode, normalizeSportCode } from "@/lib/sports";

const ALIASES: Record<string, string[]> = {
  name: ["name"],
  email: ["campus email", "email", "wisc email"],
  athleticsEmail: ["athletics email"],
  startTerm: ["start date", "start term", "started"],
  area: ["area"],
  fall: ["fall"],
  winter: ["winter"],
  spring: ["spring"],
};

export type RosterPlacement = { term: GraduationTerm; year: number; sportCodes: string[] };

export type RosterRecord = {
  line: number;
  name: string;
  emails: string[];
  startTerm: { term: GraduationTerm; year: number } | null;
  area: ShiftArea | null;
  placements: RosterPlacement[];
  warnings: string[];
};

/**
 * Parse a student roster export (the "Creative Student Interns" and staff-sheet
 * student blocks). Columns Fall, Winter, and Spring hold sport codes for the
 * academic year that starts in `academicYearStart` (Winter and Spring fall in the
 * following calendar year). Repeated header rows and blank separators are skipped.
 */
export function parseRosterCsv(csv: string, academicYearStart: number): { records: RosterRecord[]; skipped: number } {
  const table = parseCsv(csv);
  if (table.length < 2) return { records: [], skipped: 0 };
  const headers = table[0]!.map(headerKey);
  const column: Record<string, number> = {};
  for (const [field, names] of Object.entries(ALIASES)) {
    const index = headers.findIndex((h) => names.includes(h));
    if (index >= 0) column[field] = index;
  }

  const records: RosterRecord[] = [];
  let skipped = 0;
  table.slice(1).forEach((cells, offset) => {
    const cell = (field: string) => (column[field] === undefined ? "" : (cells[column[field]!] ?? "").trim());
    const name = cell("name");
    if (!name || headerKey(name) === "name") {
      skipped++;
      return;
    }

    const warnings: string[] = [];
    const emails = [cell("email"), cell("athleticsEmail")].map(normalizeEmail).filter((e) => e.includes("@"));
    const startRaw = cell("startTerm");
    const startTerm = parseTermLabel(startRaw);
    if (startRaw && !startTerm) warnings.push(`Start "${startRaw}" is not a term (for example Fall 2025) and was skipped`);

    const areaRaw = cell("area");
    const area = areaRaw ? mapArea(areaRaw) : null;
    if (areaRaw && !area) warnings.push(`Area "${areaRaw}" kept off the placement`);

    const placements: RosterPlacement[] = [];
    for (const [field, term, year] of [
      ["fall", "FALL", academicYearStart],
      ["winter", "WINTER", academicYearStart + 1],
      ["spring", "SPRING", academicYearStart + 1],
    ] as const) {
      const raw = cell(field);
      if (!raw) continue;
      const tokens = raw.split(/[\s,;/&]+/).map(normalizeSportCode).filter(Boolean);
      const valid = [...new Set(tokens.filter(isSportCode))];
      const invalid = tokens.filter((t) => !isSportCode(t));
      if (invalid.length) warnings.push(`${term.charAt(0)}${term.slice(1).toLowerCase()}: unknown sport "${invalid.join(", ")}" skipped`);
      if (valid.length) placements.push({ term, year, sportCodes: valid });
    }

    records.push({ line: offset + 2, name, emails, startTerm, area, placements, warnings });
  });
  return { records, skipped };
}

export type RosterUser = { id: string; name: string; email: string; athleticsEmail: string | null; startTerm: GraduationTerm | null };

export type RosterAction = "update" | "no_change" | "unmatched";

export type RosterPlanItem = {
  record: RosterRecord;
  action: RosterAction;
  userId?: string;
  setStartTerm: boolean;
  newPlacements: RosterPlacement[];
  reason?: string;
};

/**
 * Match rows to existing users by campus or athletics email (never by name), and
 * add only what is missing: a start term when none is set, and placements for
 * terms that have none yet. Existing values are never overwritten.
 */
export function planRosterImport(
  records: RosterRecord[],
  users: RosterUser[],
  existingPlacementKeys: Set<string>,
): RosterPlanItem[] {
  const byEmail = new Map<string, RosterUser>();
  for (const u of users) {
    byEmail.set(normalizeEmail(u.email), u);
    if (u.athleticsEmail) byEmail.set(normalizeEmail(u.athleticsEmail), u);
  }

  return records.map((record) => {
    const user = record.emails.map((e) => byEmail.get(e)).find(Boolean);
    if (!user) {
      return { record, action: "unmatched", setStartTerm: false, newPlacements: [], reason: "No account with this email" };
    }
    const setStartTerm = Boolean(record.startTerm) && user.startTerm === null;
    const newPlacements = record.placements.filter((p) => !existingPlacementKeys.has(`${user.id}:${p.term}:${p.year}`));
    const action: RosterAction = setStartTerm || newPlacements.length > 0 ? "update" : "no_change";
    return { record, action, userId: user.id, setStartTerm, newPlacements };
  });
}
