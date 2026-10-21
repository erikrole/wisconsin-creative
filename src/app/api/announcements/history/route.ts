import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import {
  ANNOUNCEMENT_KIND_LABEL,
  parseAnnouncementBody,
  type AnnouncementHistoryEntry,
} from "@/lib/announcements";

/**
 * Every announcement this person could have been shown, newest first, with
 * whether they already dismissed it. Backs the "What's new" list, so an
 * announcement stays reachable after the splash is gone. Drafts, scheduled
 * announcements, and other roles' announcements never appear.
 */
export const GET = withAuth(async (req, { user }) => {
  requirePermission(user.role, "announcement", "view");

  const platform = new URL(req.url).searchParams.get("platform") === "ios" ? "ios" : "web";
  const now = new Date();
  const where: Prisma.AnnouncementWhereInput = {
    ...(platform === "ios" ? { showOnIos: true } : { showOnWeb: true }),
    publishedAt: { lte: now },
    OR: [{ roles: { isEmpty: true } }, { roles: { has: user.role } }],
  };

  const rows = await db.announcement.findMany({
    where,
    orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
    take: 50,
    include: {
      dismissals: { where: { userId: user.id }, select: { dismissedAt: true }, take: 1 },
    },
  });

  const data: AnnouncementHistoryEntry[] = rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    kindLabel: ANNOUNCEMENT_KIND_LABEL[row.kind],
    title: row.title,
    blocks: parseAnnouncementBody(row.body),
    ctaLabel: row.ctaLabel,
    ctaUrl: row.ctaUrl,
    imageUrls: row.imageUrls,
    imageAlt: row.imageAlt,
    publishedAt: row.publishedAt!.toISOString(),
    endsAt: row.endsAt?.toISOString() ?? null,
    seenAt: row.dismissals[0]?.dismissedAt.toISOString() ?? null,
  }));

  return ok({ data });
});
