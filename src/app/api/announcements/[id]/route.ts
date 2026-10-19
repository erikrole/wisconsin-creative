import { db } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { createAuditEntry } from "@/lib/audit";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { announcementPatchBody } from "@/lib/schemas/announcements";

/** Edit, publish, end, or re-show an announcement (ADMIN only). */
export const PATCH = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "announcement", "manage");
  await enforceRateLimit(`announcements:write:${user.id}`, SETTINGS_MUTATION_LIMIT);

  const { state, showAgain, ...fields } = announcementPatchBody.parse(await req.json());
  const before = await db.announcement.findUnique({ where: { id: params.id } });
  if (!before) throw new HttpError(404, "Announcement not found");

  const now = new Date();
  const data: Record<string, unknown> = { ...fields };
  if (state === "live") {
    data.publishedAt = now;
    data.endsAt = fields.endsAt ?? null;
  } else if (state === "draft") {
    data.publishedAt = null;
  } else if (state === "ended") {
    data.endsAt = now;
  }

  const after = await db.$transaction(async (tx) => {
    if (showAgain) await tx.announcementDismissal.deleteMany({ where: { announcementId: params.id } });
    return tx.announcement.update({ where: { id: params.id }, data });
  });

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "announcement",
    entityId: params.id,
    action: state ?? (showAgain ? "show_again" : "update"),
    before: { title: before.title, body: before.body, publishedAt: before.publishedAt, endsAt: before.endsAt },
    after: { title: after.title, body: after.body, publishedAt: after.publishedAt, endsAt: after.endsAt },
  });

  return ok({ id: after.id });
});

/** Delete an announcement and its seen record (ADMIN only). */
export const DELETE = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "announcement", "manage");
  await enforceRateLimit(`announcements:write:${user.id}`, SETTINGS_MUTATION_LIMIT);

  const before = await db.announcement.findUnique({ where: { id: params.id } });
  if (!before) throw new HttpError(404, "Announcement not found");
  await db.announcement.delete({ where: { id: params.id } });

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "announcement",
    entityId: params.id,
    action: "delete",
    before: { title: before.title, publishedAt: before.publishedAt },
  });

  return ok({ deleted: true });
});
