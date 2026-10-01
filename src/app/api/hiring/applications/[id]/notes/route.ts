import { Prisma } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { createAuditEntryTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { createNoteSchema } from "@/lib/hiring/contract";
import { HttpError, ok } from "@/lib/http";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";

export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "hiring", "manage");
  await enforceRateLimit(`hiring:write:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const body = createNoteSchema.parse(await req.json());

  const application = await db.application.findUnique({
    where: { id: params.id },
    select: { id: true, applicant: { select: { purgedAt: true } } },
  });
  if (!application) throw new HttpError(404, "Application not found.");
  if (application.applicant.purgedAt) {
    throw new HttpError(409, "This applicant's personal data was purged. Add a new application to bring them back before adding notes.");
  }

  const note = await db.$transaction(async (tx) => {
    // Re-check inside the transaction so a purge that committed meanwhile cannot be bypassed.
    const current = await tx.application.findUnique({
      where: { id: params.id },
      select: { applicant: { select: { purgedAt: true } } },
    });
    if (!current || current.applicant.purgedAt) {
      throw new HttpError(409, "This applicant's personal data was purged. Add a new application before adding notes.");
    }
    const created = await tx.applicationNote.create({
      data: { applicationId: params.id, authorId: user.id, body: body.body, rating: body.rating },
      select: { id: true, body: true, rating: true, createdAt: true, author: { select: { id: true, name: true } } },
    });
    // The note text is not copied into the audit trail; only that one was added.
    await createAuditEntryTx(tx, {
      actorId: user.id,
      actorRole: user.role,
      entityType: "hiring_application",
      entityId: params.id,
      action: "note_add",
      after: { noteId: created.id, rated: body.rating != null },
    });
    return created;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  return ok({ data: note }, 201);
});
