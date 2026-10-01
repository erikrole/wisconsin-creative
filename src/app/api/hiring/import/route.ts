import { z } from "zod";
import { withAuth } from "@/lib/api";
import { createAuditEntry } from "@/lib/audit";
import { db } from "@/lib/db";
import { MAX_IMPORT_CHARS, MAX_IMPORT_ROWS, parseApplicantCsv, planImport, type PlanAction } from "@/lib/hiring/import";
import { HttpError, ok } from "@/lib/http";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";

const importSchema = z.object({
  cycleId: z.string().cuid(),
  csv: z.string().min(1).max(MAX_IMPORT_CHARS),
  /** false (default) returns the dry-run report and writes nothing. */
  apply: z.boolean().default(false),
  /** Archived cycles: a blank decision means the applicant was passed over. */
  blankDecisionMeansPassed: z.boolean().default(false),
});

const DECIDED = new Set(["HIRE", "PASSED", "WITHDRAWN"]);

export const POST = withAuth(async (req, { user }) => {
  requirePermission(user.role, "hiring", "manage");
  await enforceRateLimit(`hiring:import:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const body = importSchema.parse(await req.json());

  const cycle = await db.hiringCycle.findUnique({ where: { id: body.cycleId }, select: { id: true, label: true } });
  if (!cycle) throw new HttpError(404, "Hiring cycle not found.");

  const parsed = parseApplicantCsv(body.csv, { blankDecisionMeansPassed: body.blankDecisionMeansPassed });
  if (parsed.records.length + parsed.invalid.length > MAX_IMPORT_ROWS) {
    throw new HttpError(413, `Imports are limited to ${MAX_IMPORT_ROWS} rows. Split the file and import in parts.`);
  }
  if (parsed.records.length === 0 && parsed.invalid.length === 0) {
    throw new HttpError(400, "No rows found. Include a header row and at least one applicant.");
  }

  const emails = parsed.records.map((r) => r.email);
  const names = [...new Set(parsed.records.map((r) => r.name))];

  const [existingApplicants, cycleApplications, accounts] = await Promise.all([
    db.applicant.findMany({
      where: { OR: [{ emails: { some: { email: { in: emails } } } }, { name: { in: names, mode: "insensitive" } }] },
      select: { id: true, name: true, gradTerm: true, gradYear: true, purgedAt: true, emails: { select: { email: true } } },
    }),
    db.application.findMany({
      where: { cycleId: cycle.id },
      select: { applicantId: true, externalApplicationId: true },
    }),
    db.user.findMany({ where: { email: { in: emails } }, select: { email: true } }),
  ]);

  const plan = planImport(
    parsed.records,
    existingApplicants.map((a) => ({ ...a, purged: a.purgedAt !== null, emails: a.emails.map((e) => e.email) })),
    {
      applicantIds: new Set(cycleApplications.map((a) => a.applicantId)),
      externalIds: new Set(cycleApplications.map((a) => a.externalApplicationId).filter((v): v is string => Boolean(v))),
    },
  );
  const accountEmails = new Set(accounts.map((a) => a.email.toLowerCase()));

  const counts: Record<PlanAction | "invalid", number> = {
    create: 0,
    attach: 0,
    skip_existing: 0,
    needs_review: 0,
    duplicate_in_file: 0,
    invalid: parsed.invalid.length,
  };
  for (const item of plan) counts[item.action]++;

  let applied = false;
  if (body.apply) {
    const writable = plan.filter((p) => p.action === "create" || p.action === "attach");
    const now = new Date();
    await db.$transaction(
      async (tx) => {
        for (const item of writable) {
          const r = item.record;
          let applicantId = item.applicantId;
          if (item.action === "create") {
            const person = await tx.applicant.create({
              data: {
                name: r.name,
                standing: r.standing,
                gradTerm: r.gradTerm,
                gradYear: r.gradYear,
                phone: r.phone,
                location: r.location,
                portfolioUrl: r.portfolioUrl,
                emails: { create: { email: r.email, isPrimary: true } },
              },
              select: { id: true },
            });
            applicantId = person.id;
          }
          const application = await tx.application.create({
            data: {
              applicantId: applicantId!,
              cycleId: cycle.id,
              externalApplicationId: r.externalApplicationId,
              stage: r.stage,
              reviewed: r.reviewed,
              reviewedAt: r.reviewed ? now : null,
              interviewedAt: r.interviewed ? now : null,
              interviewUrl: r.interviewUrl,
              summerAvailable: r.summerAvailable,
              rawAreas: r.rawAreas,
              primaryArea: r.primaryArea,
              fieldsExperience: r.fieldsExperience,
              fieldsInterested: r.fieldsInterested,
              softwareExperience: r.softwareExperience,
              decidedAt: DECIDED.has(r.stage) ? now : null,
              decidedById: DECIDED.has(r.stage) ? user.id : null,
              sourcePayload: r.source,
            },
            select: { id: true },
          });
          if (r.note) {
            await tx.applicationNote.create({
              data: { applicationId: application.id, authorId: user.id, body: `Imported: ${r.note}`.slice(0, 4000) },
            });
          }
        }
      },
      { timeout: 60_000 },
    );
    applied = true;

    // Counts only: audit rows must not carry contact data (D-065).
    await createAuditEntry({
      actorId: user.id,
      actorRole: user.role,
      entityType: "hiring_cycle",
      entityId: cycle.id,
      action: "import",
      after: { created: counts.create, attached: counts.attach, skipped: counts.skip_existing + counts.duplicate_in_file, needsReview: counts.needs_review },
    });
  }

  return ok({
    data: {
      applied,
      cycle: cycle.label,
      counts,
      unmappedHeaders: parsed.unmappedHeaders,
      invalid: parsed.invalid,
      rows: plan.map((p) => ({
        line: p.record.line,
        name: p.record.name,
        action: p.action,
        stage: p.record.stage,
        reason: p.reason,
        hasAccount: accountEmails.has(p.record.email),
        warnings: p.record.warnings,
      })),
    },
  });
});
