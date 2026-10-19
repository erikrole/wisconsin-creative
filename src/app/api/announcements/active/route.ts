import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import {
  ANNOUNCEMENT_KIND_LABEL,
  parseAnnouncementBody,
  type ActiveAnnouncement,
} from "@/lib/announcements";

/**
 * The one announcement this person should see now, or null. Read once when the
 * app opens or comes to the foreground; there is no polling behind it.
 */
export const GET = withAuth(async (req, { user }) => {
  requirePermission(user.role, "announcement", "view");

  const platform = new URL(req.url).searchParams.get("platform") === "ios" ? "ios" : "web";
  const now = new Date();
  const where: Prisma.AnnouncementWhereInput = {
    ...(platform === "ios" ? { showOnIos: true } : { showOnWeb: true }),
    publishedAt: { lte: now },
    AND: [
      { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
      { OR: [{ roles: { isEmpty: true } }, { roles: { has: user.role } }] },
    ],
    dismissals: { none: { userId: user.id } },
  };

  const [row, total] = await Promise.all([
    db.announcement.findFirst({
      where,
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
    }),
    db.announcement.count({ where }),
  ]);

  const data: ActiveAnnouncement | null = row
    ? {
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
        remaining: Math.max(0, total - 1),
      }
    : null;

  return ok({ data });
});
