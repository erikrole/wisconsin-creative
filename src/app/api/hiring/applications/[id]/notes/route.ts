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

  const application = await db.application.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!application) throw new HttpError(404, "Application not found.");

  const note = await db.$transaction(async (tx) => {
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
  });

  return ok({ data: note }, 201);
});
