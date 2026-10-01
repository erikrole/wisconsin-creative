import { ApplicationStage, Prisma } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { createAuditEntryTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { updateApplicationSchema } from "@/lib/hiring/contract";
import { purgeDate } from "@/lib/hiring/retention";
import { HttpError, ok } from "@/lib/http";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";

const DECIDED_STAGES: ReadonlySet<ApplicationStage> = new Set([
  ApplicationStage.HIRE,
  ApplicationStage.PASSED,
  ApplicationStage.WITHDRAWN,
]);

export const GET = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "hiring", "view");
  const application = await db.application.findUnique({
    where: { id: params.id },
    include: {
      cycle: { select: { id: true, label: true, status: true, closedAt: true } },
      allowedEmail: { select: { id: true, claimedAt: true } },
      applicant: {
        include: {
          hiredUser: { select: { active: true, deactivatedAt: true } },
          // Newest first: the latest address is the default for a hire invite.
          emails: { orderBy: { createdAt: "desc" }, select: { email: true, isPrimary: true } },
          applications: {
            where: { id: { not: params.id } },
            orderBy: { createdAt: "desc" },
            select: { id: true, stage: true, cycle: { select: { label: true, status: true, closedAt: true } } },
          },
        },
      },
      documents: {
        orderBy: { createdAt: "desc" },
        select: { id: true, kind: true, fileName: true, contentType: true, sizeBytes: true, createdAt: true },
      },
      reviewNotes: {
        orderBy: { createdAt: "desc" },
        select: { id: true, body: true, rating: true, createdAt: true, author: { select: { id: true, name: true } } },
      },
    },
  });
  if (!application) throw new HttpError(404, "Application not found.");

  const { applicant } = application;
  const purgeOn = purgeDate({
    linkedAccount: applicant.hiredUser,
    purged: Boolean(applicant.purgedAt),
    cycles: [application.cycle, ...applicant.applications.map((a) => a.cycle)],
  });
  return ok({
    data: {
      id: application.id,
      cycle: { id: application.cycle.id, label: application.cycle.label, status: application.cycle.status },
      purgeOn,
      stage: application.stage,
      reviewed: application.reviewed,
      reviewedAt: application.reviewedAt,
      interviewedAt: application.interviewedAt,
      interviewUrl: application.interviewUrl,
      summerAvailable: application.summerAvailable,
      rawAreas: application.rawAreas,
      primaryArea: application.primaryArea,
      fieldsExperience: application.fieldsExperience,
      fieldsInterested: application.fieldsInterested,
      softwareExperience: application.softwareExperience,
      externalApplicationId: application.externalApplicationId,
      decidedAt: application.decidedAt,
      invite: application.allowedEmail
        ? { id: application.allowedEmail.id, claimed: Boolean(application.allowedEmail.claimedAt) }
        : null,
      applicant: {
        id: applicant.id,
        name: applicant.name,
        standing: applicant.standing,
        gradTerm: applicant.gradTerm,
        gradYear: applicant.gradYear,
        phone: applicant.phone,
        location: applicant.location,
        portfolioUrl: applicant.portfolioUrl,
        socialHandles: applicant.socialHandles,
        emails: applicant.emails,
        hiredUserId: applicant.hiredUserId,
        history: applicant.applications.map((a) => ({ id: a.id, stage: a.stage, cycleLabel: a.cycle.label })),
      },
      documents: application.documents,
      notes: application.reviewNotes,
    },
  });
});

export const PATCH = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "hiring", "manage");
  await enforceRateLimit(`hiring:write:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const body = updateApplicationSchema.parse(await req.json());

  const existing = await db.application.findUnique({
    where: { id: params.id },
    select: { id: true, applicantId: true, stage: true, reviewed: true, allowedEmailId: true, applicant: { select: { purgedAt: true } } },
  });
  if (!existing) throw new HttpError(404, "Application not found.");
  if (existing.applicant.purgedAt) {
    throw new HttpError(409, "This applicant's personal data was purged, so the record is read-only. Add a new application to bring them back.");
  }

  const now = new Date();

  await db.$transaction(
    async (tx) => {
      // Everything that depends on the current stage is derived from this read, inside the
      // serializable transaction. A decision made by another admin since the read above (an
      // applicant moved to Hire with an invite attached) must be seen here, or a live invite
      // could survive for an applicant who is no longer hired.
      const current = await tx.application.findUnique({
        where: { id: params.id },
        select: { stage: true, reviewed: true, allowedEmailId: true, applicant: { select: { purgedAt: true } } },
      });
      // Re-check the purge state too: a purge that committed since the read above must not be
      // undone by writing personal fields onto the tombstone.
      if (!current || current.applicant.purgedAt) {
        throw new HttpError(409, "This applicant's personal data was purged, so the record is read-only. Add a new application to bring them back.");
      }

      const stageChanged = body.stage !== undefined && body.stage !== current.stage;
      const leavingHire = stageChanged && current.stage === ApplicationStage.HIRE && body.stage !== ApplicationStage.HIRE;

      let invitationRevoked = false;
      if (leavingHire && current.allowedEmailId) {
        const invite = await tx.allowedEmail.findUnique({
          where: { id: current.allowedEmailId },
          select: { id: true, claimedAt: true },
        });
        if (invite?.claimedAt) {
          throw new HttpError(409, "This applicant already registered from the hire invite. Deactivate the account instead of undoing the hire.");
        }
        // An unclaimed invite must not outlive the decision. Deleting it also nulls the link.
        if (invite) {
          await tx.allowedEmail.delete({ where: { id: invite.id } });
          invitationRevoked = true;
        }
      }

      await tx.application.update({
        where: { id: params.id },
        data: {
          stage: body.stage,
          decidedAt: stageChanged ? (DECIDED_STAGES.has(body.stage!) ? now : null) : undefined,
          decidedById: stageChanged ? (DECIDED_STAGES.has(body.stage!) ? user.id : null) : undefined,
          reviewed: body.reviewed,
          reviewedAt: body.reviewed === undefined ? undefined : body.reviewed ? now : null,
          interviewedAt: body.interviewed === undefined ? undefined : body.interviewed ? now : null,
          interviewUrl: body.interviewUrl,
          summerAvailable: body.summerAvailable,
          primaryArea: body.primaryArea,
          rawAreas: body.rawAreas,
        },
      });

      const applicantPatch = {
        portfolioUrl: body.portfolioUrl,
        standing: body.standing,
        gradTerm: body.gradTerm,
        gradYear: body.gradYear,
      };
      if (Object.values(applicantPatch).some((v) => v !== undefined)) {
        await tx.applicant.update({ where: { id: existing.applicantId }, data: applicantPatch });
      }

      // Audit rows are deleted after 90 days and must not carry contact data (D-065):
      // record which fields changed and the stage transition only. Written in the same
      // transaction so a mutation never commits without its evidence.
      await createAuditEntryTx(tx, {
        actorId: user.id,
        actorRole: user.role,
        entityType: "hiring_application",
        entityId: params.id,
        action: stageChanged ? "stage_change" : "update",
        before: { stage: current.stage, reviewed: current.reviewed },
        after: { stage: body.stage ?? current.stage, fields: Object.keys(body), invitationRevoked },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

  return ok({ data: { id: params.id } });
});
