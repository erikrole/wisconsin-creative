import { ApplicantStanding, ApplicationStage, GraduationTerm, ShiftArea } from "@prisma/client";
import { z } from "zod";

/** Stages in board order. Reviewed is a flag, not a stage (D-065). */
export const APPLICATION_STAGES = [
  ApplicationStage.APPLIED,
  ApplicationStage.ROUND_1,
  ApplicationStage.HIRE,
  ApplicationStage.PASSED,
  ApplicationStage.WITHDRAWN,
] as const;

export const STAGE_LABELS: Record<ApplicationStage, string> = {
  APPLIED: "Applied",
  ROUND_1: "Round 1",
  HIRE: "Hire",
  PASSED: "Passed",
  WITHDRAWN: "Withdrawn",
};

/** Stages that need an explicit confirmation before they are committed. */
export const CONFIRM_STAGES: ReadonlySet<ApplicationStage> = new Set([
  ApplicationStage.HIRE,
  ApplicationStage.PASSED,
]);

export const STANDING_LABELS: Record<ApplicantStanding, string> = {
  INCOMING: "Incoming",
  FRESHMAN: "Freshman",
  SOPHOMORE: "Sophomore",
  JUNIOR: "Junior",
  SENIOR: "Senior",
  GRADUATE: "Graduate",
  OTHER: "Other",
};

export const TERM_LABELS: Record<GraduationTerm, string> = {
  WINTER: "Winter",
  SPRING: "Spring",
  SUMMER: "Summer",
  FALL: "Fall",
};

export function cycleLabel(term: GraduationTerm, year: number): string {
  return `${TERM_LABELS[term]} ${year}`;
}

/** Parse "Spring 2027" style labels; returns null when unrecognized. */
export function parseTermLabel(value: string | null | undefined): { term: GraduationTerm; year: number } | null {
  const match = /^\s*(winter|spring|summer|fall)\s+(\d{4})\s*$/i.exec(value ?? "");
  if (!match?.[1] || !match[2]) return null;
  return { term: match[1].toUpperCase() as GraduationTerm, year: Number(match[2]) };
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Strip Unicode directional marks and spreadsheet noise; keep digits and a leading +. */
export function normalizePhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/[‎‏‪-‮⁦-⁩]/g, "").trim();
  if (!cleaned) return null;
  const digits = cleaned.replace(/\D/g, "");
  if (digits.length < 7) return null;
  return cleaned.startsWith("+") ? `+${digits}` : digits;
}

export function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Only https links may be stored or opened from the review UI. */
export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

const httpsUrl = z
  .string()
  .trim()
  .max(2000)
  .refine(isHttpsUrl, { message: "Must be an https link" });

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

const stringList = z.array(z.string().trim().min(1).max(80)).max(30);

const slotList = z
  .array(z.object({ area: z.nativeEnum(ShiftArea), targetCount: z.number().int().min(0).max(50) }))
  .max(10);

/**
 * The actual date a cycle ended (YYYY-MM-DD), so an older cycle imported late starts its
 * retention clock from when it really closed. Not in the future, and not before 2000.
 */
const closedOn = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2025-05-01")
  .transform((value) => new Date(`${value}T12:00:00.000Z`))
  .refine((date) => !Number.isNaN(date.getTime()) && date.getUTCFullYear() >= 2000, { message: "Enter a valid date" })
  .refine((date) => date.getTime() <= Date.now() + 24 * 60 * 60 * 1000, { message: "The close date cannot be in the future" });

export const createCycleSchema = z
  .object({
    term: z.nativeEnum(GraduationTerm),
    year: z.number().int().min(2000).max(2100),
    status: z.enum(["PLANNING", "OPEN", "CLOSED"]).default("OPEN"),
    /** Only for a cycle created already closed (historical import). */
    closedOn: closedOn.optional(),
    notes: optionalText(2000),
    slots: slotList.optional(),
  })
  .refine((v) => v.closedOn === undefined || v.status === "CLOSED", { message: "A close date needs a closed cycle", path: ["closedOn"] });

export const updateCycleSchema = z
  .object({
    status: z.enum(["PLANNING", "OPEN", "CLOSED", "ARCHIVED"]).optional(),
    /** When closing or archiving: the actual end date. Defaults to now. */
    closedOn: closedOn.optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    slots: slotList.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" })
  .refine((v) => v.closedOn === undefined || v.status === "CLOSED" || v.status === "ARCHIVED", {
    message: "A close date needs a closed or archived status",
    path: ["closedOn"],
  });

export const createApplicationSchema = z.object({
  cycleId: z.string().cuid(),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  phone: optionalText(40),
  standing: z.nativeEnum(ApplicantStanding).optional(),
  gradTerm: z.nativeEnum(GraduationTerm).optional(),
  gradYear: z.number().int().min(2000).max(2100).optional(),
  location: optionalText(120),
  portfolioUrl: httpsUrl.optional(),
  socialHandles: optionalText(500),
  externalApplicationId: optionalText(60),
  rawAreas: stringList.optional(),
  primaryArea: z.nativeEnum(ShiftArea).optional(),
  fieldsExperience: stringList.optional(),
  fieldsInterested: stringList.optional(),
  softwareExperience: stringList.optional(),
  summerAvailable: z.boolean().optional(),
  interviewUrl: httpsUrl.optional(),
  /** When true, create a new person even if a possible match exists. */
  confirmNotDuplicate: z.boolean().optional(),
  /** When set, attach the application to this existing applicant. */
  // Applicants created by the importer carry UUIDs; web-created ones carry cuids.
  existingApplicantId: z.string().trim().min(8).max(64).optional(),
});

export const updateApplicationSchema = z
  .object({
    stage: z.nativeEnum(ApplicationStage).optional(),
    reviewed: z.boolean().optional(),
    interviewUrl: httpsUrl.nullable().optional(),
    interviewed: z.boolean().optional(),
    summerAvailable: z.boolean().nullable().optional(),
    primaryArea: z.nativeEnum(ShiftArea).nullable().optional(),
    rawAreas: stringList.optional(),
    portfolioUrl: httpsUrl.nullable().optional(),
    standing: z.nativeEnum(ApplicantStanding).nullable().optional(),
    gradTerm: z.nativeEnum(GraduationTerm).nullable().optional(),
    gradYear: z.number().int().min(2000).max(2100).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });

export const createNoteSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  rating: z.number().int().min(1).max(5).optional(),
});

export type PossibleMatch = {
  applicantId: string;
  name: string;
  reason: "email" | "name_and_grad" | "previous_applicant";
};

export type MatchableApplicant = {
  id: string;
  name: string;
  gradTerm: GraduationTerm | null;
  gradYear: number | null;
  emails: string[];
  /** Purged applicants keep only their name; a same-name match is a hint, not proof. */
  purged?: boolean;
};

/**
 * Pure possible-match finder used before creating a person. Exact email is a
 * hard match; same normalized name plus same graduation term and year is a
 * soft match the admin must confirm. Nothing here links or merges anything.
 */
export function findPossibleMatches(
  incoming: { name: string; email: string; gradTerm?: GraduationTerm | null; gradYear?: number | null },
  existing: MatchableApplicant[],
): PossibleMatch[] {
  const email = normalizeEmail(incoming.email);
  const name = normalizeName(incoming.name);
  const matches = new Map<string, PossibleMatch>();
  for (const person of existing) {
    if (person.emails.some((e) => normalizeEmail(e) === email)) {
      matches.set(person.id, { applicantId: person.id, name: person.name, reason: "email" });
      continue;
    }
    const sameName = name.length > 0 && normalizeName(person.name) === name;
    const sameGrad =
      incoming.gradTerm != null &&
      incoming.gradYear != null &&
      person.gradTerm === incoming.gradTerm &&
      person.gradYear === incoming.gradYear;
    if (sameName && person.purged) {
      matches.set(person.id, { applicantId: person.id, name: person.name, reason: "previous_applicant" });
      continue;
    }
    if (sameName && sameGrad) {
      matches.set(person.id, { applicantId: person.id, name: person.name, reason: "name_and_grad" });
    }
  }
  return [...matches.values()];
}
