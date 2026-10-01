import { ApplicantStanding, ApplicationStage, GraduationTerm, ShiftArea } from "@prisma/client";
import {
  findPossibleMatches,
  isHttpsUrl,
  normalizeEmail,
  normalizePhone,
  parseTermLabel,
  type MatchableApplicant,
} from "@/lib/hiring/contract";
import { headerKey, parseBoolean, parseCsv, splitList } from "@/lib/hiring/csv";

export const MAX_IMPORT_ROWS = 500;
export const MAX_IMPORT_CHARS = 1_000_000;

/** Header aliases seen in the PageUp export and the Google Form / prospect sheets. */
const ALIASES: Record<string, string[]> = {
  name: ["applicant", "name", "full name"],
  email: ["email", "email wisc edu", "campus email"],
  phone: ["phone", "phone number"],
  standing: ["year", "class standing"],
  graduation: ["graduation", "graduation year", "grad term"],
  primaryArea: ["primary area", "area", "focus"],
  verifiedAreas: ["verified areas"],
  fieldsExperience: ["fields you have experience in", "relevant experience areas"],
  fieldsInterested: ["fields you are interested in"],
  software: ["do you have experience with the adobe creative cloud suite"],
  stage: ["decision stage", "decision", "stage"],
  reviewed: ["reviewed"],
  interviewed: ["interview", "interviewed"],
  summer: ["summer", "are you available to work this summer"],
  interviewUrl: ["round 1 interview", "interview link"],
  portfolio: ["portfolio link", "link to your portfolio and or website if applicable", "portfolio"],
  externalId: ["application id"],
  location: ["location"],
  notes: ["notes"],
};

const STANDINGS: Record<string, ApplicantStanding> = {
  incoming: "INCOMING",
  freshman: "FRESHMAN",
  sophomore: "SOPHOMORE",
  junior: "JUNIOR",
  senior: "SENIOR",
  grad: "GRADUATE",
  graduate: "GRADUATE",
};

const AREA_MAP: Record<string, ShiftArea> = {
  video: "VIDEO",
  videography: "VIDEO",
  photo: "PHOTO",
  photography: "PHOTO",
  design: "GRAPHICS",
  "graphic design": "GRAPHICS",
  graphics: "GRAPHICS",
  social: "SOCIAL",
  "social strategy": "SOCIAL",
  comms: "COMMS",
  communications: "COMMS",
  "live production": "LIVE_PRODUCTION",
};

/** Map a free-form area label to a `ShiftArea`; unmapped labels (Marketing) stay raw only. */
export function mapArea(label: string): ShiftArea | null {
  return AREA_MAP[label.trim().toLowerCase()] ?? null;
}

/**
 * Map a decision cell to a stage. Returns null for non-empty text that is not
 * recognized (a typo, or a value such as "Interview 2"), so the importer can reject the
 * row instead of silently moving a decided applicant back into the active pipeline.
 */
export function mapStage(value: string, blankMeansPassed: boolean, interviewed: boolean): ApplicationStage | null {
  const v = value.trim().toLowerCase();
  if (v === "hire" || v === "hired") return "HIRE";
  if (v === "round 1" || v === "round1" || v === "interview") return "ROUND_1";
  if (v === "pass" || v === "passed" || v === "no" || v === "declined" || v === "rejected" || v === "not hired") return "PASSED";
  if (v === "withdrawn" || v === "withdrew") return "WITHDRAWN";
  if (v === "applied" || v === "new") return "APPLIED";
  if (v) return null;
  // Blank decision: in a finished cycle that means passed over, even if they interviewed.
  if (blankMeansPassed) return "PASSED";
  return interviewed ? "ROUND_1" : "APPLIED";
}

export type ImportRecord = {
  line: number;
  name: string;
  email: string;
  phone: string | null;
  standing: ApplicantStanding | null;
  gradTerm: GraduationTerm | null;
  gradYear: number | null;
  rawAreas: string[];
  primaryArea: ShiftArea | null;
  fieldsExperience: string[];
  fieldsInterested: string[];
  softwareExperience: string[];
  stage: ApplicationStage;
  reviewed: boolean;
  interviewed: boolean;
  summerAvailable: boolean | null;
  interviewUrl: string | null;
  portfolioUrl: string | null;
  externalApplicationId: string | null;
  location: string | null;
  note: string | null;
  source: Record<string, string>;
  warnings: string[];
};

export type ParsedImport = { records: ImportRecord[]; invalid: { line: number; name: string; reason: string }[]; unmappedHeaders: string[] };

export function parseApplicantCsv(csv: string, options: { blankDecisionMeansPassed?: boolean } = {}): ParsedImport {
  const table = parseCsv(csv);
  if (table.length < 2) return { records: [], invalid: [], unmappedHeaders: [] };

  const headers = table[0]!.map(headerKey);
  const column: Record<string, number> = {};
  for (const [field, names] of Object.entries(ALIASES)) {
    const index = headers.findIndex((h) => names.includes(h));
    if (index >= 0) column[field] = index;
  }
  const known = new Set(Object.values(ALIASES).flat());
  const unmappedHeaders = table[0]!.filter((h, i) => h.trim() && !known.has(headers[i]!));

  const records: ImportRecord[] = [];
  const invalid: ParsedImport["invalid"] = [];

  table.slice(1).forEach((cells, offset) => {
    const line = offset + 2;
    const cell = (field: string) => (column[field] === undefined ? "" : (cells[column[field]!] ?? "").trim());
    const name = cell("name");
    const email = normalizeEmail(cell("email"));
    if (!name) return invalid.push({ line, name: "", reason: "Missing name" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return invalid.push({ line, name, reason: "Missing or invalid email" });

    const stage = mapStage(cell("stage"), options.blankDecisionMeansPassed === true, parseBoolean(cell("interviewed")) === true || isHttpsUrl(cell("interviewUrl")));
    if (stage === null) return invalid.push({ line, name, reason: `Unrecognized decision "${cell("stage")}". Fix it in the sheet or leave it blank.` });

    const warnings: string[] = [];
    const grad = parseTermLabel(cell("graduation"));
    if (cell("graduation") && !grad) warnings.push(`Graduation "${cell("graduation")}" not recognized`);
    const standingRaw = cell("standing").toLowerCase();
    const standing = STANDINGS[standingRaw] ?? null;
    if (standingRaw && !standing) warnings.push(`Year "${cell("standing")}" not recognized`);

    const primaryLabels = splitList(cell("primaryArea"));
    const rawAreas = [...new Set([...primaryLabels, ...splitList(cell("verifiedAreas"))])];
    const primaryArea = primaryLabels.map(mapArea).find((a): a is ShiftArea => a !== null) ?? null;
    const unmappedPrimary = primaryLabels.filter((l) => !mapArea(l));
    if (!primaryArea && primaryLabels.length) warnings.push(`Area "${unmappedPrimary.join(", ")}" kept as a label only`);

    const interviewUrlRaw = cell("interviewUrl");
    const portfolioRaw = cell("portfolio");
    if (interviewUrlRaw && !isHttpsUrl(interviewUrlRaw)) warnings.push("Interview link is not an https URL and was skipped");
    const portfolioUrl = portfolioRaw && isHttpsUrl(portfolioRaw) ? portfolioRaw : null;
    if (portfolioRaw && !portfolioUrl) warnings.push("Portfolio entry is not an https URL and was skipped");

    const interviewed = parseBoolean(cell("interviewed")) === true || Boolean(interviewUrlRaw && isHttpsUrl(interviewUrlRaw));
    const source: Record<string, string> = {};
    table[0]!.forEach((h, i) => {
      if (h.trim() && (cells[i] ?? "").trim()) source[h.trim()] = (cells[i] ?? "").trim();
    });

    records.push({
      line,
      name,
      email,
      phone: normalizePhone(cell("phone")),
      standing,
      gradTerm: grad?.term ?? null,
      gradYear: grad?.year ?? null,
      rawAreas,
      primaryArea,
      fieldsExperience: splitList(cell("fieldsExperience")),
      fieldsInterested: splitList(cell("fieldsInterested")),
      softwareExperience: splitList(cell("software")),
      stage,
      reviewed: parseBoolean(cell("reviewed")) === true,
      interviewed,
      summerAvailable: parseBoolean(cell("summer")),
      interviewUrl: interviewUrlRaw && isHttpsUrl(interviewUrlRaw) ? interviewUrlRaw : null,
      portfolioUrl,
      externalApplicationId: cell("externalId") || null,
      location: cell("location") || null,
      note: cell("notes") || null,
      source,
      warnings,
    });
  });

  return { records, invalid, unmappedHeaders };
}

export type ExistingApplicant = MatchableApplicant;

export type PlanAction = "create" | "attach" | "skip_existing" | "needs_review" | "duplicate_in_file";

export type PlanItem = {
  record: ImportRecord;
  action: PlanAction;
  applicantId?: string;
  reason?: string;
};

/**
 * Decide what to do with each parsed row. Pure: callers supply the existing
 * people (matching any email in the file, or the same name) and the applicant
 * ids that already have an application in this cycle.
 *
 * - exact email match: attach the application to that person
 * - same normalized name and graduation, different email: needs review (never auto-merged)
 * - already applied this cycle (by person, or by PageUp ID): skipped
 * - the same email twice in one file: the first row wins, later rows are reported
 */
export function planImport(
  records: ImportRecord[],
  existing: ExistingApplicant[],
  alreadyInCycle: { applicantIds: Set<string>; externalIds: Set<string> },
): PlanItem[] {
  const seenEmails = new Set<string>();
  const seenExternal = new Set<string>();
  // Applicants already receiving an application in this file (matched through any alias).
  const plannedApplicants = new Set<string>();
  // Rows planned as new people, so two rows for one person with different emails are flagged.
  const planned: ExistingApplicant[] = [];
  return records.map((record) => {
    if (seenEmails.has(record.email)) {
      return { record, action: "duplicate_in_file", reason: "Same email appears earlier in this file" } satisfies PlanItem;
    }
    seenEmails.add(record.email);

    if (record.externalApplicationId) {
      if (alreadyInCycle.externalIds.has(record.externalApplicationId) || seenExternal.has(record.externalApplicationId)) {
        return { record, action: "skip_existing", reason: "PageUp application ID already imported" } satisfies PlanItem;
      }
      seenExternal.add(record.externalApplicationId);
    }

    const matches = findPossibleMatches(
      { name: record.name, email: record.email, gradTerm: record.gradTerm, gradYear: record.gradYear },
      existing,
    );
    const hard = matches.find((m) => m.reason === "email");
    if (hard) {
      if (alreadyInCycle.applicantIds.has(hard.applicantId)) {
        return { record, action: "skip_existing", applicantId: hard.applicantId, reason: "Already has an application in this cycle" } satisfies PlanItem;
      }
      // A second row for the same person under a different known email would insert a second
      // application for one applicant and cycle, violating the unique key and rolling back the
      // whole import. Report it instead.
      if (plannedApplicants.has(hard.applicantId)) {
        return { record, action: "duplicate_in_file", applicantId: hard.applicantId, reason: `Another row in this file already adds an application for ${hard.name} (different email)` } satisfies PlanItem;
      }
      plannedApplicants.add(hard.applicantId);
      return { record, action: "attach", applicantId: hard.applicantId, reason: `Known applicant: ${hard.name}` } satisfies PlanItem;
    }
    const soft = matches[0];
    if (soft) {
      return { record, action: "needs_review", applicantId: soft.applicantId, reason: soft.reason === "previous_applicant" ? `Same name as a previous applicant whose data was purged (${soft.name})` : `Possibly ${soft.name} (same name and graduation, different email)` } satisfies PlanItem;
    }
    const inFile = findPossibleMatches(
      { name: record.name, email: record.email, gradTerm: record.gradTerm, gradYear: record.gradYear },
      planned,
    )[0];
    if (inFile) {
      return { record, action: "needs_review", reason: `Possibly the same person as an earlier row (${inFile.name}, different email)` } satisfies PlanItem;
    }
    planned.push({ id: `row-${record.line}`, name: record.name, gradTerm: record.gradTerm, gradYear: record.gradYear, emails: [record.email] });
    return { record, action: "create" } satisfies PlanItem;
  });
}

