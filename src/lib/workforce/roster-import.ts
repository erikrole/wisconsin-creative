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

export type RosterUser = {
  id: string;
  name: string;
  email: string;
  athleticsEmail: string | null;
  startTerm: GraduationTerm | null;
  staffingType: "FT" | "ST";
};

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

  // Writes already planned in this file, so a student repeated in a combined export cannot
  // plan two start terms or the same placement twice (which would hit the unique key).
  const plannedStart = new Set<string>();
  const plannedPlacements = new Set<string>();
  const seenUsers = new Set<string>();

  return records.map((record) => {
    const matched = [...new Map(record.emails.map((e) => byEmail.get(e)).filter((u): u is RosterUser => Boolean(u)).map((u) => [u.id, u])).values()];
    // The campus and athletics columns are unique separately, so two addresses on one row can
    // belong to two different people. Never guess which one the row means.
    if (matched.length > 1) {
      return { record, action: "unmatched", setStartTerm: false, newPlacements: [], reason: "The campus and athletics addresses match different accounts" };
    }
    const user = matched[0];
    if (!user) {
      return { record, action: "unmatched", setStartTerm: false, newPlacements: [], reason: "No account with this email" };
    }
    if (user.staffingType !== "ST") {
      return { record, action: "unmatched", userId: user.id, setStartTerm: false, newPlacements: [], reason: "Not a student account (full-time staff are skipped)" };
    }
    const repeated = seenUsers.has(user.id);
    seenUsers.add(user.id);
    const setStartTerm = Boolean(record.startTerm) && user.startTerm === null && !plannedStart.has(user.id);
    const newPlacements = record.placements.filter((p) => {
      const key = `${user.id}:${p.term}:${p.year}`;
      return !existingPlacementKeys.has(key) && !plannedPlacements.has(key);
    });
    if (setStartTerm) plannedStart.add(user.id);
    for (const p of newPlacements) plannedPlacements.add(`${user.id}:${p.term}:${p.year}`);
    const action: RosterAction = setStartTerm || newPlacements.length > 0 ? "update" : "no_change";
    return {
      record,
      action,
      userId: user.id,
      setStartTerm,
      newPlacements,
      ...(repeated ? { reason: "This person appears earlier in the file. Only values not already planned are used." } : {}),
    };
  });
}
