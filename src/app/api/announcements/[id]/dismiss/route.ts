import { db } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";

/** Record that this person has seen the announcement. Safe to repeat. */
export const POST = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "announcement", "view");

  const announcement = await db.announcement.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!announcement) throw new HttpError(404, "Announcement not found");

  await db.announcementDismissal.upsert({
    where: { announcementId_userId: { announcementId: params.id, userId: user.id } },
    create: { announcementId: params.id, userId: user.id },
    update: {},
  });

  return ok({ dismissed: true });
});
