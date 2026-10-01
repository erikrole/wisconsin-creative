import { Prisma } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { createAuditEntry } from "@/lib/audit";
import { db } from "@/lib/db";
import {
  createApplicationSchema,
  findPossibleMatches,
  normalizeEmail,
  normalizePhone,
} from "@/lib/hiring/contract";
import { HttpError, ok } from "@/lib/http";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";

export const GET = withAuth(async (req, { user }) => {
  requirePermission(user.role, "hiring", "view");
  const cycleId = new URL(req.url).searchParams.get("cycleId");
  if (!cycleId) throw new HttpError(400, "cycleId is required.");

  const rows = await db.application.findMany({
    where: { cycleId },
    orderBy: [{ createdAt: "asc" }],
    include: {
      applicant: {
        select: {
          id: true,
          name: true,
          standing: true,
          gradTerm: true,
          gradYear: true,
          location: true,
          portfolioUrl: true,
          purgedAt: true,
          emails: { where: { isPrimary: true }, select: { email: true }, take: 1 },
        },
      },
      documents: { select: { kind: true } },
      reviewNotes: { select: { rating: true } },
    },
  });

  return ok({
    data: rows.map((row) => {
      const ratings = row.reviewNotes.map((n) => n.rating).filter((r): r is number => r != null);
      return {
        id: row.id,
        applicantId: row.applicant.id,
        name: row.applicant.name,
        email: row.applicant.emails[0]?.email ?? null,
        standing: row.applicant.standing,
        gradTerm: row.applicant.gradTerm,
        gradYear: row.applicant.gradYear,
        location: row.applicant.location,
        hasPortfolio: Boolean(row.applicant.portfolioUrl),
        stage: row.stage,
        reviewed: row.reviewed,
        hasInterview: Boolean(row.interviewUrl),
        summerAvailable: row.summerAvailable,
        rawAreas: row.rawAreas,
        primaryArea: row.primaryArea,
        hasResume: row.documents.some((d) => d.kind === "RESUME"),
        ratingAverage: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
        ratingCount: ratings.length,
        externalApplicationId: row.externalApplicationId,
      };
    }),
  });
});

export const POST = withAuth(async (req, { user }) => {
  requirePermission(user.role, "hiring", "manage");
  await enforceRateLimit(`hiring:write:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const body = createApplicationSchema.parse(await req.json());
  const email = normalizeEmail(body.email);

  const cycle = await db.hiringCycle.findUnique({ where: { id: body.cycleId }, select: { id: true } });
  if (!cycle) throw new HttpError(404, "Hiring cycle not found.");

  if (!body.existingApplicantId && !body.confirmNotDuplicate) {
    const nearby = await db.applicant.findMany({
      where: {
        OR: [
          { emails: { some: { email } } },
          { name: { equals: body.name, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        name: true,
        gradTerm: true,
        gradYear: true,
        purgedAt: true,
        emails: { select: { email: true } },
      },
      take: 20,
    });
    const matches = findPossibleMatches(
      { name: body.name, email, gradTerm: body.gradTerm, gradYear: body.gradYear },
      nearby.map((a) => ({ ...a, purged: a.purgedAt !== null, emails: a.emails.map((e) => e.email) })),
    );
    if (matches.length) {
      throw new HttpError(409, "This looks like someone already in the system.", {
        code: "possible_match",
        matches,
      });
    }
  }

  const applicationData = {
    cycleId: body.cycleId,
    externalApplicationId: body.externalApplicationId,
    rawAreas: body.rawAreas ?? [],
    primaryArea: body.primaryArea,
    fieldsExperience: body.fieldsExperience ?? [],
    fieldsInterested: body.fieldsInterested ?? [],
    softwareExperience: body.softwareExperience ?? [],
    summerAvailable: body.summerAvailable,
    interviewUrl: body.interviewUrl,
  } satisfies Omit<Prisma.ApplicationUncheckedCreateInput, "applicantId">;

  const created = await db.$transaction(async (tx) => {
    let applicantId = body.existingApplicantId;
    if (applicantId) {
      const existing = await tx.applicant.findUnique({ where: { id: applicantId }, select: { id: true, purgedAt: true } });
      if (!existing) throw new HttpError(404, "Applicant not found.");
      if (existing.purgedAt) {
        // A returning applicant whose old data was purged: refill the profile from
        // this application and restart the retention clock from the new cycle.
        await tx.applicant.update({
          where: { id: applicantId },
          data: {
            standing: body.standing,
            gradTerm: body.gradTerm,
            gradYear: body.gradYear,
            phone: normalizePhone(body.phone),
            location: body.location,
            portfolioUrl: body.portfolioUrl,
            socialHandles: body.socialHandles,
            purgedAt: null,
          },
        });
      }
      const hasEmail = await tx.applicantEmail.findUnique({ where: { email }, select: { applicantId: true } });
      if (!hasEmail) await tx.applicantEmail.create({ data: { applicantId, email } });
      else if (hasEmail.applicantId !== applicantId) {
        throw new HttpError(409, "That email belongs to a different applicant.");
      }
    } else {
      const person = await tx.applicant.create({
        data: {
          name: body.name,
          standing: body.standing,
          gradTerm: body.gradTerm,
          gradYear: body.gradYear,
          phone: normalizePhone(body.phone),
          location: body.location,
          portfolioUrl: body.portfolioUrl,
          socialHandles: body.socialHandles,
          emails: { create: { email, isPrimary: true } },
        },
      });
      applicantId = person.id;
    }
    return tx.application.create({ data: { ...applicationData, applicantId } });
  });

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "hiring_application",
    entityId: created.id,
    action: "create",
    after: { cycleId: created.cycleId, applicantId: created.applicantId, stage: created.stage },
  });

  return ok({ data: { id: created.id, applicantId: created.applicantId } }, 201);
});
