import { z } from "zod";
import { ApplicantStanding } from "@prisma/client";
import { isHttpsUrl, normalizeEmail, normalizePhone, parseTermLabel } from "./contract";
import { mapArea, MAX_IMPORT_ROWS, type ParsedImport } from "./import";

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const link = z.string().trim().max(2000).refine(isHttpsUrl, "Use an https link").nullable().optional();
const list = z.array(z.string().trim().min(1).max(80)).max(30).default([]);

/** Agent extraction is factual intake only. Decision and review fields are intentionally rejected. */
export const agentApplicantSchema = z.object({
  applicationId: z.string().trim().regex(/^\d{1,60}$/, "Use the numeric PageUp Application ID"),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  phone: optionalText(40),
  standing: z.nativeEnum(ApplicantStanding).nullable().optional(),
  graduation: optionalText(40),
  primaryArea: optionalText(80),
  verifiedAreas: list,
  interests: list,
  softwareExperience: list,
  relevantExperience: optionalText(3000),
  location: optionalText(120),
  summerAvailable: z.boolean().nullable().optional(),
  resumeUrl: link,
  applicationFormUrl: link,
  otherMaterialsUrl: link,
  portfolioUrl: link,
  missingMaterials: list,
}).strict();

export const agentBatchSchema = z.object({
  version: z.literal(1),
  source: z.literal("pageup"),
  requisitionId: z.string().trim().regex(/^\d{1,60}$/),
  applicants: z.array(z.unknown()).min(1).max(MAX_IMPORT_ROWS),
}).strict();

/** Validate each extracted person independently so a bad record is visible without losing the batch. */
export function parseAgentApplicants(input: unknown): ParsedImport {
  const batch = agentBatchSchema.parse(input);
  const parsed: ParsedImport = { records: [], invalid: [], unmappedHeaders: [] };
  batch.applicants.forEach((input, index) => {
    const result = agentApplicantSchema.safeParse(input);
    const line = index + 1;
    if (!result.success) {
      const name = typeof input === "object" && input !== null && "name" in input && typeof input.name === "string" ? input.name.slice(0, 120) : "";
      parsed.invalid.push({ line, name, reason: result.error.issues.map((i) => `${i.path.join(".") || "Record"}: ${i.message}`).join(" · ") });
      return;
    }
    const a = result.data;
    const grad = parseTermLabel(a.graduation);
    const warnings: string[] = [];
    if (a.graduation && !grad) warnings.push(`Graduation "${a.graduation}" not recognized; kept in source details`);
    const primaryArea = a.primaryArea ? mapArea(a.primaryArea) : null;
    if (a.primaryArea && !primaryArea) warnings.push(`Area "${a.primaryArea}" kept as a label only`);
    if (a.missingMaterials.length) warnings.push(`Materials unavailable: ${a.missingMaterials.join(", ")}`);
    const source: Record<string, string> = {
      Source: "PageUp", "Requisition ID": batch.requisitionId,
      "Application ID": a.applicationId, Applicant: a.name, Email: normalizeEmail(a.email),
    };
    for (const [key, value] of Object.entries({
      "Resume File": a.resumeUrl, "Application Form": a.applicationFormUrl, "Other Materials": a.otherMaterialsUrl,
      "Portfolio Link": a.portfolioUrl, "Relevant Experience": a.relevantExperience, Graduation: a.graduation,
      "Verified Areas": a.verifiedAreas.join("; "), "Missing Materials": a.missingMaterials.join("; "),
    })) if (value) source[key] = value;
    parsed.records.push({
      line, name: a.name, email: normalizeEmail(a.email), phone: normalizePhone(a.phone), standing: a.standing ?? null,
      gradTerm: grad?.term ?? null, gradYear: grad?.year ?? null,
      rawAreas: [...new Set([...(a.primaryArea ? [a.primaryArea] : []), ...a.verifiedAreas])], primaryArea,
      fieldsExperience: a.verifiedAreas, fieldsInterested: a.interests, softwareExperience: a.softwareExperience,
      stage: "APPLIED", reviewed: false, interviewed: false, summerAvailable: a.summerAvailable ?? null,
      interviewUrl: null, portfolioUrl: a.portfolioUrl ?? null, externalApplicationId: a.applicationId,
      location: a.location ?? null, note: a.relevantExperience ? `Submitted materials: ${a.relevantExperience}` : null,
      source, warnings,
    });
  });
  return parsed;
}

/** Expose only recognized source links; never turn arbitrary source text into a clickable URL. */
export function applicantSourceLinks(source: unknown): { label: string; url: string }[] {
  if (typeof source !== "object" || source === null || Array.isArray(source)) return [];
  const row = source as Record<string, unknown>;
  return [["Resume File", "PageUp resume"], ["Application Form", "Application form"], ["Other Materials", "Other materials"]].flatMap(([key, label]) => {
    const url = row[key!];
    return typeof url === "string" && isHttpsUrl(url) ? [{ label: label!, url }] : [];
  });
}
