import { z } from "zod";
import {
  FOOTBALL_GAME_DAY_ROLES,
  type FootballGameDayRole,
} from "@/lib/football-roles";
import { normalizeOpponentName } from "@/lib/schedule-event-identity";

export const FOOTBALL_STAFFING_SHEET_SOURCE = {
  sheetId: "1BrASYKR3XZyE4_Hm6DiHTWIPZwP7NUv8iEuDmncZsZQ",
  tabName: "Sheet1",
  range: "A1:M14",
  rowCount: 14,
  columnCount: 13,
  sportCode: "FB",
} as const;

export const footballStaffingSheetSourceSchema = z.object({
  sheetId: z.literal(FOOTBALL_STAFFING_SHEET_SOURCE.sheetId),
  tabName: z.literal(FOOTBALL_STAFFING_SHEET_SOURCE.tabName),
  range: z.literal(FOOTBALL_STAFFING_SHEET_SOURCE.range),
});

export const footballStaffingSheetPreviewRequestSchema = z.object({
  sportCode: z.literal("FB"),
  source: footballStaffingSheetSourceSchema,
  tsv: z.string().min(1, "Paste Sheet1!A1:M14 before previewing").max(100_000),
});

export type FootballStaffingSheetPreviewRequest = z.infer<typeof footballStaffingSheetPreviewRequestSchema>;

const sha256Fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const footballStaffingSheetApplySelectionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ASSIGN_ROLE"),
    sourceA1: z.string().regex(/^[A-M](?:[2-9]|1[0-4])$/),
    eventId: z.string().min(1),
    userId: z.string().min(1),
    slotKey: z.string().min(1),
    expectedVersion: z.number().int().min(0),
  }),
  z.object({
    kind: z.literal("CLEAR_ROLE"),
    sourceA1: z.string().regex(/^[A-M](?:[2-9]|1[0-4])$/),
    eventId: z.string().min(1),
    expectedVersion: z.number().int().min(0),
  }),
]);

export const footballStaffingSheetApplyRequestSchema = footballStaffingSheetPreviewRequestSchema.extend({
  sourceFingerprint: sha256Fingerprint,
  reviewFingerprint: sha256Fingerprint,
  selection: footballStaffingSheetApplySelectionSchema,
});

export type FootballStaffingSheetApplyRequest = z.infer<typeof footballStaffingSheetApplyRequestSchema>;

export type FootballStaffingSheetApplyRow = {
  kind: "DIRECT_ASSIGNMENT" | "INTENTIONALLY_UNSTAFFED";
  sourceA1: string;
  sourceRaw: string;
  role: FootballGameDayRole;
  eventId: string;
  eventSummary: string;
  eventStartsAt: string;
  eventOpponent: string | null;
  eventIsHome: boolean | null;
  shiftGroupId: string | null;
  workingVersion: number | null;
  userId: string | null;
  userName: string | null;
  assignedSlotKey: string | null;
  openSlots: Array<{ key: string; area: string; workerType: string }>;
  currentRoleHolders: Array<{ slotKey: string; userId: string; userName: string }>;
  canApply: boolean;
  reason: string;
};

export const footballStaffingSheetCommandProofSchema = z.object({
  source: footballStaffingSheetSourceSchema,
  sourceA1: z.string().regex(/^[A-M](?:[2-9]|1[0-4])$/),
  sourceRaw: z.string().max(500),
  sourceFingerprint: sha256Fingerprint,
  reviewFingerprint: sha256Fingerprint,
  event: z.object({
    id: z.string().min(1),
    startsAt: z.string().datetime({ offset: true }),
    opponent: z.string().nullable(),
    isHome: z.boolean().nullable(),
  }),
});

export type SheetCellProvenance = {
  sheetId: typeof FOOTBALL_STAFFING_SHEET_SOURCE.sheetId;
  tabName: typeof FOOTBALL_STAFFING_SHEET_SOURCE.tabName;
  range: typeof FOOTBALL_STAFFING_SHEET_SOURCE.range;
  row: number;
  column: number;
  a1: string;
};

export type ParsedFootballEventHeader = {
  column: number;
  raw: string;
  source: SheetCellProvenance;
  date: { month: number; day: number; year: number | null } | null;
  opponent: string | null;
  isAway: boolean;
  issue: "MISSING_DATE" | "INVALID_DATE" | "MISSING_OPPONENT" | null;
};

export type ParsedFootballStaffingCell = {
  role: FootballGameDayRole;
  raw: string;
  source: SheetCellProvenance;
  eventColumn: number;
  sourceKind:
    | "DIRECT_ASSIGNMENT_CANDIDATE"
    | "STUDENT_OPPORTUNITY"
    | "INTENTIONALLY_UNSTAFFED"
    | "BLANK"
    | "AMBIGUOUS_ALTERNATIVES"
    | "UNRESOLVED_ROLE"
    | "NOTE_OR_INSTRUCTION";
  alternatives: string[];
};

export type FootballStaffingSheetRowIssue = {
  kind: "UNRESOLVED_ROLE_ROW" | "UNKNOWN_ROLE_ROW" | "MISSING_ROLE_ROW";
  raw: string;
  source: SheetCellProvenance;
};

export type ParsedFootballStaffingSheet = {
  source: typeof FOOTBALL_STAFFING_SHEET_SOURCE;
  headers: ParsedFootballEventHeader[];
  cells: ParsedFootballStaffingCell[];
  rowIssues: FootballStaffingSheetRowIssue[];
};

const ROLE_LABEL_ALIASES = new Map<string, FootballGameDayRole>([
  ...FOOTBALL_GAME_DAY_ROLES.map((role) => [role, role] as const),
  ["ROAM1 (ACTION)", "ROAM1"],
  ["ROAM2 (COLOR)", "ROAM2"],
]);

function normalizeRoleLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

export function normalizeFootballStaffingRoleLabel(value: string): FootballGameDayRole | null {
  return ROLE_LABEL_ALIASES.get(normalizeRoleLabel(value)) ?? null;
}

export function normalizeFootballSheetPersonName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function columnLetters(column: number): string {
  let current = column;
  let result = "";
  while (current > 0) {
    current -= 1;
    result = String.fromCharCode(65 + (current % 26)) + result;
    current = Math.floor(current / 26);
  }
  return result;
}

export function footballSheetCellProvenance(row: number, column: number): SheetCellProvenance {
  return {
    sheetId: FOOTBALL_STAFFING_SHEET_SOURCE.sheetId,
    tabName: FOOTBALL_STAFFING_SHEET_SOURCE.tabName,
    range: FOOTBALL_STAFFING_SHEET_SOURCE.range,
    row,
    column,
    a1: `${columnLetters(column)}${row}`,
  };
}

function parseSnapshotTsv(tsv: string): string[][] {
  const normalized = tsv.replace(/\r\n?/g, "\n").replace(/\n$/, "");
  const rows = normalized.split("\n").map((row) => row.split("\t"));
  if (rows.length !== FOOTBALL_STAFFING_SHEET_SOURCE.rowCount) {
    throw new Error(
      `Expected ${FOOTBALL_STAFFING_SHEET_SOURCE.rowCount} rows from ${FOOTBALL_STAFFING_SHEET_SOURCE.range}; received ${rows.length}.`,
    );
  }
  const wrongWidth = rows.findIndex((row) => row.length !== FOOTBALL_STAFFING_SHEET_SOURCE.columnCount);
  if (wrongWidth >= 0) {
    throw new Error(
      `Expected ${FOOTBALL_STAFFING_SHEET_SOURCE.columnCount} columns on row ${wrongWidth + 1}; received ${rows[wrongWidth]!.length}.`,
    );
  }
  return rows;
}

function parseHeader(raw: string, column: number): ParsedFootballEventHeader {
  const source = footballSheetCellProvenance(1, column);
  const trimmed = raw.trim().replace(/\s+/g, " ");
  const dateMatch = trimmed.match(/(?:^|\b)(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?/);
  if (!dateMatch) {
    return { column, raw, source, date: null, opponent: null, isAway: /\bat\s+/i.test(trimmed), issue: "MISSING_DATE" };
  }

  const month = Number(dateMatch[1]);
  const day = Number(dateMatch[2]);
  const rawYear = dateMatch[3];
  const year = rawYear ? (rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear)) : null;
  const validationYear = year ?? 2000;
  const candidate = new Date(Date.UTC(validationYear, month - 1, day));
  const validDate = month >= 1
    && month <= 12
    && day >= 1
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day;
  if (!validDate) {
    return { column, raw, source, date: null, opponent: null, isAway: /\bat\s+/i.test(trimmed), issue: "INVALID_DATE" };
  }

  const remainder = trimmed
    .replace(dateMatch[0], " ")
    .replace(/^\s*[-–—|:]\s*/, "")
    .trim();
  const awayMatch = remainder.match(/\bat\s+(.+)$/i);
  const homeMatch = remainder.match(/\bvs\.?\s+(.+)$/i);
  const opponentRaw = (awayMatch?.[1] ?? homeMatch?.[1] ?? remainder).trim();
  const opponent = normalizeOpponentName(opponentRaw);
  return {
    column,
    raw,
    source,
    date: { month, day, year },
    opponent,
    isAway: Boolean(awayMatch),
    issue: opponent ? null : "MISSING_OPPONENT",
  };
}

function classifyStaffingCell(raw: string): Pick<ParsedFootballStaffingCell, "sourceKind" | "alternatives"> {
  const trimmed = raw.trim();
  if (!trimmed) return { sourceKind: "BLANK", alternatives: [] };
  if (trimmed === "-") return { sourceKind: "INTENTIONALLY_UNSTAFFED", alternatives: [] };
  if (/^student$/i.test(trimmed)) return { sourceKind: "STUDENT_OPPORTUNITY", alternatives: [] };
  if (/^role$/i.test(trimmed)) return { sourceKind: "UNRESOLVED_ROLE", alternatives: [] };
  if (trimmed.includes("/")) {
    return {
      sourceKind: "AMBIGUOUS_ALTERNATIVES",
      alternatives: trimmed.split("/").map((value) => value.trim()).filter(Boolean),
    };
  }
  if (/\bbackup\b|\bstandby\b|^note\s*:/i.test(trimmed)) {
    return { sourceKind: "NOTE_OR_INSTRUCTION", alternatives: [] };
  }
  return { sourceKind: "DIRECT_ASSIGNMENT_CANDIDATE", alternatives: [] };
}

export function parseFootballStaffingSheet(input: FootballStaffingSheetPreviewRequest): ParsedFootballStaffingSheet {
  const validated = footballStaffingSheetPreviewRequestSchema.parse(input);
  const matrix = parseSnapshotTsv(validated.tsv);
  const headers = matrix[0]!.slice(1).map((raw, index) => parseHeader(raw, index + 2));
  const cells: ParsedFootballStaffingCell[] = [];
  const rowIssues: FootballStaffingSheetRowIssue[] = [];

  for (let rowIndex = 1; rowIndex < matrix.length; rowIndex += 1) {
    const rowNumber = rowIndex + 1;
    const row = matrix[rowIndex]!;
    const rawRole = row[0] ?? "";
    const normalizedRole = normalizeRoleLabel(rawRole);
    const role = normalizeFootballStaffingRoleLabel(rawRole);
    if (!role) {
      rowIssues.push({
        kind: normalizedRole === "ROLE"
          ? "UNRESOLVED_ROLE_ROW"
          : normalizedRole
            ? "UNKNOWN_ROLE_ROW"
            : "MISSING_ROLE_ROW",
        raw: rawRole,
        source: footballSheetCellProvenance(rowNumber, 1),
      });
      continue;
    }

    for (let columnIndex = 1; columnIndex < row.length; columnIndex += 1) {
      const raw = row[columnIndex] ?? "";
      cells.push({
        role,
        raw,
        source: footballSheetCellProvenance(rowNumber, columnIndex + 1),
        eventColumn: columnIndex + 1,
        ...classifyStaffingCell(raw),
      });
    }
  }

  return { source: FOOTBALL_STAFFING_SHEET_SOURCE, headers, cells, rowIssues };
}

export type FootballSheetUserCandidate = {
  id: string;
  name: string;
  email: string;
  role: string;
  staffingType: string;
  workerType?: "FT" | "ST" | null;
};

export type FootballSheetEventCandidate = {
  id: string;
  summary: string;
  startsAt: Date;
  sportCode: string | null;
  opponent: string | null;
  isHome: boolean | null;
};

export type FootballSheetEventResolution = {
  status: "MATCHED" | "AMBIGUOUS" | "NOT_FOUND" | "INVALID_HEADER";
  header: ParsedFootballEventHeader;
  candidates: Array<{
    id: string;
    summary: string;
    startsAt: string;
    opponent: string | null;
    isHome: boolean | null;
  }>;
};

function appDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

export function resolveFootballSheetEvents(
  headers: ParsedFootballEventHeader[],
  events: FootballSheetEventCandidate[],
  timeZone = "America/Chicago",
): FootballSheetEventResolution[] {
  return headers.map((header) => {
    if (header.issue || !header.date || !header.opponent) {
      return { status: "INVALID_HEADER" as const, header, candidates: [] };
    }
    const normalizedOpponent = normalizeOpponentName(header.opponent)?.toLocaleLowerCase("en-US");
    const matches = events.filter((event) => {
      if (event.sportCode?.trim().toUpperCase() !== "FB") return false;
      const date = appDateParts(event.startsAt, timeZone);
      if (date.month !== header.date!.month || date.day !== header.date!.day) return false;
      if (header.date!.year !== null && date.year !== header.date!.year) return false;
      if (header.isAway ? event.isHome !== false : event.isHome !== true) return false;
      return normalizeOpponentName(event.opponent)?.toLocaleLowerCase("en-US") === normalizedOpponent;
    }).map((event) => ({
      id: event.id,
      summary: event.summary,
      startsAt: event.startsAt.toISOString(),
      opponent: event.opponent,
      isHome: event.isHome,
    }));

    return {
      status: matches.length === 1 ? "MATCHED" : matches.length > 1 ? "AMBIGUOUS" : "NOT_FOUND",
      header,
      candidates: matches,
    };
  });
}

export type FootballSheetCellReview = ParsedFootballStaffingCell & {
  resolution:
    | "DIRECT_ASSIGNMENT_MATCHED"
    | "DIRECT_ASSIGNMENT_AMBIGUOUS"
    | "DIRECT_ASSIGNMENT_UNKNOWN"
    | ParsedFootballStaffingCell["sourceKind"];
  personCandidates: FootballSheetUserCandidate[];
  blocking: boolean;
};

export function resolveFootballSheetPeople(
  cells: ParsedFootballStaffingCell[],
  users: FootballSheetUserCandidate[],
): FootballSheetCellReview[] {
  const usersByName = new Map<string, FootballSheetUserCandidate[]>();
  for (const user of users) {
    const key = normalizeFootballSheetPersonName(user.name);
    usersByName.set(key, [...(usersByName.get(key) ?? []), user]);
  }

  return cells.map((cell) => {
    if (cell.sourceKind !== "DIRECT_ASSIGNMENT_CANDIDATE") {
      return {
        ...cell,
        resolution: cell.sourceKind,
        personCandidates: [],
        blocking: !["STUDENT_OPPORTUNITY", "INTENTIONALLY_UNSTAFFED"].includes(cell.sourceKind),
      };
    }
    const candidates = usersByName.get(normalizeFootballSheetPersonName(cell.raw)) ?? [];
    return {
      ...cell,
      resolution: candidates.length === 1
        ? "DIRECT_ASSIGNMENT_MATCHED"
        : candidates.length > 1
          ? "DIRECT_ASSIGNMENT_AMBIGUOUS"
          : "DIRECT_ASSIGNMENT_UNKNOWN",
      personCandidates: candidates,
      blocking: candidates.length !== 1,
    };
  });
}
